import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { In, Repository } from "typeorm";
import {
  MarketListing, PointsLedgerEntry, StoreItem, Transaction, User, UserBalance,
  UserInventoryItem,
} from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { EventBusService, Events } from "@/events";
import { Jobs, Queues, jobKey } from "@/queues/queue.constants";
import { paginate, safeSort, type Paginated } from "@/common/dto";
import {
  Ref, add, addDays, anonLabel, applyBps, dec, gt, gte, mul, sub, toDbAmount,
} from "@/common/utils";
import { AuditService } from "@/modules/audit/audit.service";
import {
  ConfigKeys, type MarketplacePolicyConfig,
} from "@/modules/economy-config/economy-config.constants";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import { TreasuryService } from "@/modules/treasury/treasury.service";
import type {
  ConsumeRequest, CreateListingRequest, InventoryItemResponse, ListingResponse, MarketPolicyResponse,
  MarketQuery, PurchaseListingResponse, PurchaseRequest, PurchaseResponse, StoreItemResponse,
  StoreQuery, UpdateMarketPolicyRequest, UpsertItemRequest,
} from "./dto/store.dto";

/* ============================================================================
 * Store, inventory and marketplace (FRD W-06, S-05).
 *
 * The distinction this whole module turns on:
 *
 *   AN MTT PURCHASE FROM THE STORE IS REVENUE. Real value left the member and
 *   arrived at the platform, so it creates a `revenue_events` row on the `iap`
 *   stream — which funds the Treasury and can generate referral commission.
 *
 *   A POINTS PURCHASE IS NOT. Nobody paid anything; Points are an in-game score
 *   the platform issued for free. It creates no revenue event, and therefore
 *   cannot generate commission (conventions §3). Treating it as revenue would
 *   mean paying real commission out of an internal score.
 *
 *   A MARKETPLACE SALE IS A MEMBER-TO-MEMBER TRADE. The buyer's MTT goes to the
 *   SELLER, not to the platform. Only the FEE is platform revenue, and it is
 *   recognised on the `marketplace` stream, which is deliberately NOT
 *   commission-eligible — the buyer bought from another member.
 *
 * Everything else here follows from two mechanical rules: inventory moves in the
 * same commit as the money, and a listed item is locked so it cannot be sold
 * twice or consumed mid-sale.
 * ========================================================================== */

const ITEM_SORT = ["name", "priceMtt", "rarity", "createdAt"] as const;
const LISTING_SORT = ["askMtt", "createdAt"] as const;

@Injectable()
export class StoreService {
  private readonly log = new Logger(StoreService.name);

  constructor(
    @InjectRepository(StoreItem) private readonly items: Repository<StoreItem>,
    @InjectRepository(UserInventoryItem) private readonly inventory: Repository<UserInventoryItem>,
    @InjectRepository(MarketListing) private readonly listings: Repository<MarketListing>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly ledger: LedgerService,
    private readonly treasury: TreasuryService,
    private readonly config: EconomyConfigService,
    private readonly routines: DbRoutinesService,
    private readonly bus: EventBusService,
    private readonly audit: AuditService,
    @InjectQueue(Queues.Commission) private readonly commissionQueue: Queue,
  ) {}

  /* ==================================================================== *
   * Catalogue
   * ==================================================================== */

  async listItems(q: StoreQuery, includeInactive = false): Promise<Paginated<StoreItemResponse>> {
    const sortBy = safeSort(q.sortBy, ITEM_SORT, "name");
    const qb = this.items.createQueryBuilder("i");
    if (!includeInactive) qb.andWhere("i.active = true");
    if (q.category) qb.andWhere("i.category = :category", { category: q.category });
    if (q.rarity) qb.andWhere("i.rarity = :rarity", { rarity: q.rarity });
    if (q.q) qb.andWhere("(i.name LIKE :s OR i.sku LIKE :s)", { s: `%${q.q}%` });

    const [rows, total] = await qb
      .orderBy(`i.${sortBy}`, q.sortDir)
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();
    return paginate(rows.map(toItemView), total, q);
  }

  /* ==================================================================== *
   * Purchase
   * ==================================================================== */

  /**
   * Buys an item from the store.
   *
   * The debit and the inventory row commit together: a charge with no item, or an
   * item with no charge, are both unrecoverable from the UI. The revenue event
   * follows immediately for an MTT purchase and is stored nowhere else — the
   * commission engine reads it from `revenue_events`, never from here.
   */
  async purchase(
    userId: string,
    dto: PurchaseRequest,
    idempotencyKey: string,
    ip: string | null,
  ): Promise<PurchaseResponse> {
    const quantity = dto.quantity ?? 1;
    const item = await this.items.findOne({ where: { id: dto.itemId } });
    if (!item) throw new NotFoundException("Item not found");
    if (!item.active) {
      throw new ConflictException({ code: "ITEM_UNAVAILABLE", message: "This item is not for sale" });
    }

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("Account not found");
    if (user.status !== "active") {
      throw new ForbiddenException({
        code: `ACCOUNT_${user.status.toUpperCase()}`,
        message: "This account cannot make a purchase",
      });
    }

    const key = `store:${userId}:${idempotencyKey}`;
    const orderRef = Ref.order();

    if (dto.payWith === "points") {
      if (item.pricePoints === null || item.pricePoints === undefined) {
        throw new BadRequestException({
          code: "POINTS_PRICE_UNSET",
          message: "This item cannot be bought with Points",
        });
      }
      return this.purchaseWithPoints({ userId, item, quantity, key, orderRef, ip });
    }

    return this.purchaseWithMtt({ userId, item, quantity, key, orderRef, ip });
  }

  /**
   * MTT purchase: real value, therefore revenue.
   *
   * This is the platform's primary commissionable event, which is exactly why the
   * revenue recognition is not optional and not deferred to a listener that might
   * not run.
   */
  private async purchaseWithMtt(params: {
    userId: string;
    item: StoreItem;
    quantity: number;
    key: string;
    orderRef: string;
    ip: string | null;
  }): Promise<PurchaseResponse> {
    const { userId, item, quantity, key, orderRef, ip } = params;
    const total = toDbAmount(mul(item.priceMtt, quantity));
    if (dec(total).lte(0)) {
      throw new BadRequestException("This item has no MTT price");
    }

    const inventoryItem = await this.ledger.withUserLock(userId, async (tx, balance) => {
      if (!gte(balance.mttAvailable, total)) {
        throw new ConflictException({
          code: "INSUFFICIENT_BALANCE",
          message: "Insufficient available MTT for this purchase",
          available: toDbAmount(balance.mttAvailable),
          required: total,
        });
      }

      balance.mttAvailable = sub(balance.mttAvailable, total);
      balance.lastLedgerAt = new Date();
      await tx.getRepository(UserBalance).save(balance);

      await tx.getRepository(Transaction).save(
        tx.getRepository(Transaction).create({
          ref: Ref.transaction(),
          userId,
          type: "store_purchase",
          amountMtt: toDbAmount(dec(total).neg()),
          status: "completed",
          note: `${quantity} × ${item.name}`,
          metadata: { itemId: item.id, sku: item.sku, quantity, orderRef },
          idempotencyKey: `${key}:mtt`,
          settledAt: new Date(),
        }),
      );

      return tx.getRepository(UserInventoryItem).save(
        tx.getRepository(UserInventoryItem).create({
          userId,
          itemId: item.id,
          quantity,
          expiresAt: item.category === "pass" ? addDays(new Date(), 30) : null,
        }),
      );
    });

    /* Revenue: an in-app purchase on the `iap` stream, which IS
     * commission-eligible. The deterministic processorRef makes a replayed
     * purchase incapable of recognising the revenue twice. */
    const event = await this.treasury.recognise({
      userId,
      stream: "iap",
      grossAmount: total,
      processorFee: toDbAmount(0),
      currency: "MTT",
      processor: "internal",
      processorRef: `store:${orderRef}`,
    });

    await this.commissionQueue.add(
      Jobs.ProcessRevenueEvent,
      { revenueEventId: event.id },
      { jobId: jobKey(`commission:${event.id}`) },
    );

    await this.audit.record({
      actorId: userId,
      action: "store.purchase",
      targetType: "store_item",
      targetId: item.id,
      after: { quantity, paidMtt: total, revenueEventId: event.id },
      ip,
    });

    return {
      orderRef,
      itemId: item.id,
      sku: item.sku,
      quantity,
      paidWith: "mtt",
      paidMtt: total,
      paidPoints: 0,
      revenueEventId: event.id,
      commissionable: true,
      inventoryItemId: inventoryItem.id,
    };
  }

  /**
   * Points purchase: an internal score, therefore NOT revenue.
   *
   * No revenue event, no Treasury allocation, no commission. The absence is the
   * feature: a member cannot generate real commission for their upline by
   * spending Points the platform gave them for free.
   */
  private async purchaseWithPoints(params: {
    userId: string;
    item: StoreItem;
    quantity: number;
    key: string;
    orderRef: string;
    ip: string | null;
  }): Promise<PurchaseResponse> {
    const { userId, item, quantity, key, orderRef, ip } = params;
    const cost = (item.pricePoints ?? 0) * quantity;
    if (cost <= 0) throw new BadRequestException("This item has no Points price");

    const inventoryItem = await this.ledger.withUserLock(userId, async (tx, balance) => {
      if (balance.points < cost) {
        throw new ConflictException({
          code: "INSUFFICIENT_POINTS",
          message: "Insufficient Points for this purchase",
          available: balance.points,
          required: cost,
        });
      }

      const next = balance.points - cost;

      await tx.getRepository(PointsLedgerEntry).save(
        tx.getRepository(PointsLedgerEntry).create({
          ref: Ref.pointsEntry(),
          userId,
          source: "purchase",
          amount: -cost,
          runningBalance: next,
          note: `${quantity} × ${item.name}`,
          idempotencyKey: `${key}:points`,
        }),
      );

      balance.points = next;
      balance.lastLedgerAt = new Date();
      await tx.getRepository(UserBalance).save(balance);

      return tx.getRepository(UserInventoryItem).save(
        tx.getRepository(UserInventoryItem).create({
          userId,
          itemId: item.id,
          quantity,
          expiresAt: item.category === "pass" ? addDays(new Date(), 30) : null,
        }),
      );
    });

    await this.audit.record({
      actorId: userId,
      action: "store.purchase.points",
      targetType: "store_item",
      targetId: item.id,
      after: { quantity, paidPoints: cost },
      ip,
    });

    return {
      orderRef,
      itemId: item.id,
      sku: item.sku,
      quantity,
      paidWith: "points",
      paidMtt: toDbAmount(0),
      paidPoints: cost,
      /* Explicit nulls rather than omitted fields, so no consumer has to guess
       * whether commission applies. */
      revenueEventId: null,
      commissionable: false,
      inventoryItemId: inventoryItem.id,
    };
  }

  /* ==================================================================== *
   * Inventory
   * ==================================================================== */

  async myInventory(userId: string): Promise<InventoryItemResponse[]> {
    const rows = await this.inventory.find({ where: { userId }, order: { createdAt: "DESC" }, take: 500 });
    if (rows.length === 0) return [];

    const items = await this.items.find({ where: { id: In(rows.map((r) => r.itemId)) } });
    const byId = new Map(items.map((i) => [i.id, i]));

    return rows.map((row) => {
      const item = byId.get(row.itemId);
      return {
        id: row.id,
        itemId: row.itemId,
        sku: item?.sku ?? "unknown",
        name: item?.name ?? "Item",
        category: item?.category ?? "cosmetic",
        rarity: item?.rarity ?? "common",
        quantity: row.quantity,
        hue: item?.hue ?? 24,
        consumedAt: row.consumedAt ? row.consumedAt.toISOString() : null,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        locked: Boolean(row.lockedByListingId),
        sellable:
          Boolean(item?.tradable) &&
          !row.consumedAt &&
          !row.lockedByListingId &&
          row.quantity > 0,
      };
    });
  }

  /**
   * Consumes a quantity of an owned item.
   *
   * Refused while the item is listed: consuming something that is on sale would
   * let a seller take payment for an item they had already used.
   */
  async consume(userId: string, inventoryItemId: string, dto: ConsumeRequest): Promise<InventoryItemResponse> {
    const quantity = dto.quantity ?? 1;
    const row = await this.inventory.findOne({ where: { id: inventoryItemId, userId } });
    if (!row) throw new NotFoundException("Inventory item not found");

    if (row.lockedByListingId) {
      throw new ConflictException({
        code: "ITEM_LISTED",
        message: "This item is listed for sale. Cancel the listing before using it.",
      });
    }
    if (row.quantity < quantity) {
      throw new ConflictException({
        code: "INSUFFICIENT_QUANTITY",
        message: "You do not own that many of this item",
        owned: row.quantity,
      });
    }
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException({ code: "ITEM_EXPIRED", message: "This item has expired" });
    }

    row.quantity -= quantity;
    if (row.quantity === 0) row.consumedAt = new Date();
    await this.inventory.save(row);

    const inventory = await this.myInventory(userId);
    return inventory.find((i) => i.id === inventoryItemId) ?? {
      id: row.id, itemId: row.itemId, sku: "unknown", name: "Item",
      category: "cosmetic", rarity: "common", quantity: row.quantity, hue: 24,
      consumedAt: row.consumedAt ? row.consumedAt.toISOString() : null,
      expiresAt: null, locked: false, sellable: false,
    };
  }

  /* ==================================================================== *
   * Marketplace
   * ==================================================================== */

  async policy(): Promise<MarketPolicyResponse> {
    const p = await this.config.marketplacePolicy();
    return {
      feeBps: p.feeBps,
      minAskMtt: toDbAmount(p.minAskMtt),
      maxAskMtt: toDbAmount(p.maxAskMtt),
      listingTtlDays: p.listingTtlDays,
    };
  }

  /**
   * Lists an owned item for sale.
   *
   * The inventory row is LOCKED to the listing in the same operation. Without
   * that lock the same item can be listed twice, or sold and then consumed —
   * both of which end with a buyer paying for nothing.
   */
  async createListing(
    userId: string,
    dto: CreateListingRequest,
    ip: string | null,
  ): Promise<ListingResponse> {
    const policy = await this.config.marketplacePolicy();
    const ask = toDbAmount(dto.askMtt);

    if (dec(ask).lte(0)) throw new BadRequestException("The asking price must be positive");
    if (dec(ask).lt(dec(policy.minAskMtt))) {
      throw new BadRequestException({
        code: "ASK_BELOW_MINIMUM",
        message: `The minimum asking price is ${toDbAmount(policy.minAskMtt)} MTT`,
      });
    }
    if (gt(ask, policy.maxAskMtt)) {
      throw new BadRequestException({
        code: "ASK_ABOVE_MAXIMUM",
        message: `The maximum asking price is ${toDbAmount(policy.maxAskMtt)} MTT`,
      });
    }

    const row = await this.inventory.findOne({ where: { id: dto.inventoryItemId, userId } });
    if (!row) throw new NotFoundException("Inventory item not found");
    if (row.lockedByListingId) {
      throw new ConflictException({
        code: "ALREADY_LISTED",
        message: "This item is already listed for sale",
      });
    }
    if (row.consumedAt || row.quantity <= 0) {
      throw new ConflictException({
        code: "ITEM_CONSUMED",
        message: "A used item cannot be sold",
      });
    }

    const item = await this.items.findOne({ where: { id: row.itemId } });
    if (!item) throw new NotFoundException("Item not found");
    if (!item.tradable) {
      throw new ForbiddenException({
        code: "ITEM_NOT_TRADABLE",
        message: "This item cannot be traded",
      });
    }

    const fee = applyBps(ask, policy.feeBps);

    const listing = await this.listings.save(
      this.listings.create({
        ref: Ref.order(),
        sellerId: userId,
        inventoryItemId: row.id,
        itemId: row.itemId,
        askMtt: ask,
        feeMtt: fee,
        status: "active",
      }),
    );

    /* Lock after the listing exists, so the lock always points at a real row. */
    row.lockedByListingId = listing.id;
    await this.inventory.save(row);

    await this.audit.record({
      actorId: userId,
      action: "market.list",
      targetType: "market_listing",
      targetId: listing.id,
      after: { askMtt: ask, feeMtt: fee, itemId: row.itemId },
      ip,
    });

    return this.listingView(listing, item, userId);
  }

  async browse(q: MarketQuery, userId: string | null): Promise<Paginated<ListingResponse>> {
    const sortBy = safeSort(q.sortBy, LISTING_SORT, "createdAt");
    const qb = this.listings.createQueryBuilder("l").where("l.status = 'active'");
    if (q.mine && userId) qb.andWhere("l.sellerId = :userId", { userId });

    const [rows, total] = await qb
      .orderBy(`l.${sortBy}`, q.sortDir)
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();

    if (rows.length === 0) return paginate([], total, q);

    const items = await this.items.find({ where: { id: In(rows.map((r) => r.itemId)) } });
    const byId = new Map(items.map((i) => [i.id, i]));

    /* Category and rarity live on the item, so they are filtered after the join
     * rather than being denormalised onto the listing. */
    const views = rows
      .filter((r) => {
        const item = byId.get(r.itemId);
        if (!item) return false;
        if (q.category && item.category !== q.category) return false;
        if (q.rarity && item.rarity !== q.rarity) return false;
        return true;
      })
      .map((r) => this.listingView(r, byId.get(r.itemId) ?? null, userId));

    return paginate(views, total, q);
  }

  /**
   * Buys a listing.
   *
   * The buyer's MTT goes to the SELLER; only the fee is the platform's. Both
   * balances move under a two-user lock taken in a deterministic order, so two
   * members buying each other's listings at the same instant cannot deadlock.
   */
  async buyListing(
    buyerId: string,
    ref: string,
    idempotencyKey: string,
    ip: string | null,
  ): Promise<PurchaseListingResponse> {
    const listing = await this.listings.findOne({ where: { ref } });
    if (!listing) throw new NotFoundException("Listing not found");
    if (listing.status !== "active") {
      throw new ConflictException({
        code: "LISTING_UNAVAILABLE",
        message: `This listing is ${listing.status}`,
      });
    }
    if (listing.sellerId === buyerId) {
      /* Buying your own listing would launder a balance into a fee-reduced
       * transfer and fake marketplace volume. */
      throw new ForbiddenException({
        code: "SELF_PURCHASE",
        message: "You cannot buy your own listing",
      });
    }

    const buyer = await this.users.findOne({ where: { id: buyerId } });
    if (!buyer) throw new NotFoundException("Account not found");
    if (buyer.status !== "active") {
      throw new ForbiddenException({
        code: `ACCOUNT_${buyer.status.toUpperCase()}`,
        message: "This account cannot buy",
      });
    }

    const ask = toDbAmount(listing.askMtt);
    const fee = toDbAmount(listing.feeMtt);
    const toSeller = sub(ask, fee);
    const key = `market:${buyerId}:${idempotencyKey}`;

    const inventoryItem = await this.ledger.withTwoUserLock(
      buyerId,
      listing.sellerId,
      async (tx, balances) => {
        const buyerBalance = balances[buyerId];
        const sellerBalance = balances[listing.sellerId];

        if (!gte(buyerBalance.mttAvailable, ask)) {
          throw new ConflictException({
            code: "INSUFFICIENT_BALANCE",
            message: "Insufficient available MTT for this purchase",
            available: toDbAmount(buyerBalance.mttAvailable),
            required: ask,
          });
        }

        /* Re-read the inventory row inside the lock: the seller may have
         * cancelled the listing between our check and this commit. */
        const inventoryRow = await tx.getRepository(UserInventoryItem).findOne({
          where: { id: listing.inventoryItemId },
        });
        if (!inventoryRow || inventoryRow.lockedByListingId !== listing.id) {
          throw new ConflictException({
            code: "LISTING_UNAVAILABLE",
            message: "This listing was withdrawn while you were buying it",
          });
        }

        buyerBalance.mttAvailable = sub(buyerBalance.mttAvailable, ask);
        buyerBalance.lastLedgerAt = new Date();
        sellerBalance.mttAvailable = add(sellerBalance.mttAvailable, toSeller);
        sellerBalance.lastLedgerAt = new Date();
        await tx.getRepository(UserBalance).save([buyerBalance, sellerBalance]);

        await tx.getRepository(Transaction).save(
          tx.getRepository(Transaction).create({
            ref: Ref.transaction(),
            userId: buyerId,
            type: "marketplace_purchase",
            amountMtt: toDbAmount(dec(ask).neg()),
            status: "completed",
            note: `Bought listing ${listing.ref}`,
            metadata: { listingId: listing.id, itemId: listing.itemId, feeMtt: fee },
            idempotencyKey: `${key}:buy`,
            settledAt: new Date(),
          }),
        );

        await tx.getRepository(Transaction).save(
          tx.getRepository(Transaction).create({
            ref: Ref.transaction(),
            userId: listing.sellerId,
            type: "marketplace_sale",
            amountMtt: toSeller,
            status: "completed",
            note: `Sold listing ${listing.ref} (fee ${fee} MTT)`,
            metadata: { listingId: listing.id, itemId: listing.itemId, feeMtt: fee },
            idempotencyKey: `market-sale:${listing.id}`,
            settledAt: new Date(),
          }),
        );

        /* The item moves to the buyer and the lock is released in the same
         * commit as the money. */
        inventoryRow.userId = buyerId;
        inventoryRow.lockedByListingId = null;
        await tx.getRepository(UserInventoryItem).save(inventoryRow);

        listing.status = "sold";
        listing.buyerId = buyerId;
        listing.soldAt = new Date();
        await tx.getRepository(MarketListing).save(listing);

        return inventoryRow;
      },
    );

    /* Only the FEE is platform revenue, and the `marketplace` stream is not
     * commission-eligible — the buyer bought from another member. */
    let feeRevenueEventId: string | null = null;
    if (dec(fee).gt(0)) {
      const event = await this.treasury.recognise({
        userId: listing.sellerId,
        stream: "marketplace",
        grossAmount: fee,
        processorFee: toDbAmount(0),
        currency: "MTT",
        processor: "internal",
        processorRef: `market:${listing.id}`,
      });
      feeRevenueEventId = event.id;
      listing.revenueEventId = event.id;
      await this.listings.save(listing);
    }

    await this.audit.record({
      actorId: buyerId,
      action: "market.buy",
      targetType: "market_listing",
      targetId: listing.id,
      after: { paidMtt: ask, feeMtt: fee, sellerReceived: toSeller, feeRevenueEventId },
      ip,
    });

    await this.bus.publish(Events.RevenueRecognised, {
      source: "marketplace_fee",
      listingRef: listing.ref,
      sellerId: listing.sellerId,
      buyerId,
      askMtt: ask,
      feeMtt: fee,
      revenueEventId: feeRevenueEventId,
      /* Stated on the event so nothing downstream treats a trade as an IAP. */
      commissionable: false,
    });

    return {
      ref: listing.ref,
      itemId: listing.itemId,
      paidMtt: ask,
      feeMtt: fee,
      sellerReceivedMtt: toSeller,
      feeRevenueEventId,
      commissionable: false,
      inventoryItemId: inventoryItem.id,
    };
  }

  /** Cancels an active listing and releases the inventory lock. */
  async cancelListing(userId: string, ref: string): Promise<ListingResponse> {
    const listing = await this.listings.findOne({ where: { ref } });
    if (!listing) throw new NotFoundException("Listing not found");
    if (listing.sellerId !== userId) {
      throw new ForbiddenException({ code: "NOT_YOUR_LISTING", message: "This is not your listing" });
    }
    if (listing.status !== "active") {
      throw new ConflictException({
        code: "LISTING_UNAVAILABLE",
        message: `This listing is ${listing.status}`,
      });
    }

    listing.status = "cancelled";
    await this.listings.save(listing);

    const row = await this.inventory.findOne({ where: { id: listing.inventoryItemId } });
    if (row && row.lockedByListingId === listing.id) {
      row.lockedByListingId = null;
      await this.inventory.save(row);
    }

    const item = await this.items.findOne({ where: { id: listing.itemId } });
    return this.listingView(listing, item ?? null, userId);
  }

  /**
   * Expires stale listings and releases their locks. Run by the daily cron.
   *
   * The lock release is the point: an expired listing that keeps its lock would
   * strand the item, unusable and unsellable, with nothing in the UI to explain
   * why.
   */
  async expireStaleListings(): Promise<number> {
    const policy = await this.config.marketplacePolicy();
    const cutoff = addDays(new Date(), -policy.listingTtlDays);

    /* Two statements in one transaction, through sp_expire_stale_listings.
     *
     * This was a listing save plus an inventory read and save PER ROW, and the
     * two writes were not atomic: a failure between them left an item locked to
     * a listing that no longer existed — unsellable, with nothing to tell the
     * member why. The procedure unlocks and expires together or not at all. */
    const expired = await this.routines.expireStaleListings(cutoff);

    if (expired > 0) this.log.log(`expired ${expired} stale listings and released their locks`);
    return expired;
  }

  /* ==================================================================== *
   * Admin
   * ==================================================================== */

  async upsertItem(dto: UpsertItemRequest, actorId: string, ip: string | null): Promise<StoreItemResponse> {
    if (dec(dto.priceMtt).isNegative()) throw new BadRequestException("Price cannot be negative");
    if (dec(dto.priceMtt).lte(0) && !dto.pricePoints) {
      throw new BadRequestException({
        code: "NO_PRICE",
        message: "An item must have an MTT price, a Points price, or both",
      });
    }
    if (dto.consumable && dto.tradable) {
      /* A consumable that is also tradable can be used and then sold, or sold
       * and then used — the lock cannot save a buyer from that. */
      throw new BadRequestException({
        code: "CONSUMABLE_NOT_TRADABLE",
        message: "A consumable item cannot be tradable",
      });
    }

    const existing = await this.items.findOne({ where: { sku: dto.sku } });
    const before = existing
      ? { priceMtt: existing.priceMtt, pricePoints: existing.pricePoints ?? null, active: existing.active }
      : null;

    const row = existing ?? this.items.create({ sku: dto.sku });
    row.name = dto.name;
    row.description = dto.description;
    row.category = dto.category;
    row.rarity = dto.rarity;
    row.priceMtt = toDbAmount(dto.priceMtt);
    row.pricePoints = dto.pricePoints ?? null;
    row.hue = dto.hue;
    row.active = dto.active;
    row.consumable = dto.consumable;
    row.tradable = dto.tradable;
    const saved = await this.items.save(row);

    await this.audit.recordOrThrow({
      actorId,
      action: existing ? "store.item.update" : "store.item.create",
      targetType: "store_item",
      targetId: saved.id,
      before,
      after: { sku: dto.sku, priceMtt: saved.priceMtt, pricePoints: saved.pricePoints, active: dto.active },
      reason: dto.reason,
      ip,
    });

    return toItemView(saved);
  }

  /** Versioned, audited change to the marketplace fee and listing bounds. */
  async updatePolicy(
    dto: UpdateMarketPolicyRequest,
    actorId: string,
    ip: string | null,
  ): Promise<MarketplacePolicyConfig> {
    if (gt(dto.minAskMtt, dto.maxAskMtt)) {
      throw new BadRequestException({
        code: "BOUNDS_INVERTED",
        message: "The minimum asking price cannot exceed the maximum",
      });
    }

    const before = await this.config.marketplacePolicy();
    const value: MarketplacePolicyConfig = {
      feeBps: dto.feeBps,
      minAskMtt: toDbAmount(dto.minAskMtt),
      maxAskMtt: toDbAmount(dto.maxAskMtt),
      listingTtlDays: dto.listingTtlDays,
    };

    await this.config.write(ConfigKeys.marketplacePolicy, value, actorId, dto.reason);
    await this.audit.recordOrThrow({
      actorId,
      action: "market.policy.update",
      targetType: "platform_config",
      targetId: ConfigKeys.marketplacePolicy,
      before: { ...before },
      after: { ...value },
      reason: dto.reason,
      ip,
    });

    return value;
  }

  /* ------------------------------------------------------------------ */

  private listingView(
    listing: MarketListing,
    item: StoreItem | null,
    viewerId: string | null,
  ): ListingResponse {
    const ask = toDbAmount(listing.askMtt);
    const fee = toDbAmount(listing.feeMtt);
    return {
      ref: listing.ref,
      itemId: listing.itemId,
      sku: item?.sku ?? "unknown",
      name: item?.name ?? "Item",
      rarity: item?.rarity ?? "common",
      hue: item?.hue ?? 24,
      askMtt: ask,
      feeMtt: fee,
      sellerReceivesMtt: sub(ask, fee),
      status: listing.status,
      /* The seller is anonymised: a marketplace does not need to expose who owns
       * what, and doing so invites targeted pressure. */
      seller: anonLabel(listing.sellerId),
      isYours: listing.sellerId === viewerId,
      listedAt: listing.createdAt.toISOString(),
      soldAt: listing.soldAt ? listing.soldAt.toISOString() : null,
    };
  }
}

function toItemView(i: StoreItem): StoreItemResponse {
  return {
    id: i.id,
    sku: i.sku,
    name: i.name,
    description: i.description,
    category: i.category,
    rarity: i.rarity,
    priceMtt: toDbAmount(i.priceMtt),
    pricePoints: i.pricePoints ?? null,
    hue: i.hue,
    active: i.active,
    consumable: i.consumable,
    tradable: i.tradable,
  };
}
