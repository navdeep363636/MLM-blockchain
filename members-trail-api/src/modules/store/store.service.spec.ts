import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import {
  MarketListing, PointsLedgerEntry, StoreItem, Transaction, User, UserInventoryItem,
} from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { EventBusService } from "@/events";
import { Queues } from "@/queues/queue.constants";
import { AuditService } from "@/modules/audit/audit.service";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import { TreasuryService } from "@/modules/treasury/treasury.service";
import { StoreService } from "./store.service";
import { DbRoutinesService } from "@/database/routines/db-routines.service";

/* ============================================================================
 * The distinction this file exists to protect:
 *
 *   MTT store purchase → revenue on the `iap` stream, COMMISSIONABLE
 *   Points purchase    → not revenue, NEVER commissionable
 *   Marketplace buy    → the seller's money; only the FEE is revenue, on the
 *                        `marketplace` stream, which is never commissionable
 *
 * Getting the second one wrong pays real referral commission out of an internal
 * score the platform issued for free. Getting the third one wrong pays
 * commission on money that never belonged to the platform.
 * ========================================================================== */

function repo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
    save: jest.fn(async (x: unknown) => x),
    create: jest.fn((x: unknown) => x),
    createQueryBuilder: jest.fn(),
  };
}

const ITEM = {
  id: "item-1",
  sku: "skin-orbit",
  name: "Orbit Skin",
  description: "A cosmetic skin.",
  category: "cosmetic" as const,
  rarity: "rare" as const,
  priceMtt: "50.000000000000000000",
  pricePoints: 5_000 as number | null,
  hue: 24,
  active: true,
  consumable: false,
  tradable: true,
};

const POLICY = {
  feeBps: 500,
  minAskMtt: "1.000000000000000000",
  maxAskMtt: "1000000.000000000000000000",
  listingTtlDays: 30,
};

describe("StoreService", () => {
  let svc: StoreService;
  let items: ReturnType<typeof repo>;
  let inventory: ReturnType<typeof repo>;
  let listings: ReturnType<typeof repo>;
  let users: ReturnType<typeof repo>;
  let ledger: { withUserLock: jest.Mock; withTwoUserLock: jest.Mock };
  let treasury: { recognise: jest.Mock };
  let config: { marketplacePolicy: jest.Mock; write: jest.Mock };
  let bus: { publish: jest.Mock };
  let routines: Record<string, jest.Mock>;
  let audit: { record: jest.Mock; recordOrThrow: jest.Mock };
  let queue: { add: jest.Mock };

  let balances: Record<string, Record<string, unknown>>;
  let written: { entity: string; row: unknown }[];

  beforeEach(async () => {
    items = repo();
    inventory = repo();
    listings = repo();
    users = repo();
    written = [];
    balances = {
      buyer: { mttAvailable: "500.000000000000000000", points: 20_000, lastLedgerAt: null },
      seller: { mttAvailable: "10.000000000000000000", points: 0, lastLedgerAt: null },
    };

    const txFor = () => ({
      getRepository: (entity: { name: string }) => ({
        create: (row: unknown) => row,
        findOne: async () => inventory.findOne(),
        save: async (row: unknown) => {
          written.push({ entity: entity.name, row });
          return Array.isArray(row) ? row : { id: `${entity.name}-id`, ...(row as object) };
        },
      }),
    });

    ledger = {
      withUserLock: jest.fn(async (userId: string, fn: (tx: unknown, b: unknown) => Promise<unknown>) =>
        fn(txFor(), balances[userId] ?? balances.buyer),
      ),
      withTwoUserLock: jest.fn(
        async (a: string, b: string, fn: (tx: unknown, bal: Record<string, unknown>) => Promise<unknown>) =>
          fn(txFor(), { [a]: balances[a], [b]: balances[b] }),
      ),
    };
    treasury = { recognise: jest.fn(async () => ({ id: "rev-1", ref: "RE-1" })) };
    config = { marketplacePolicy: jest.fn(async () => POLICY), write: jest.fn() };
    bus = { publish: jest.fn() };
    audit = { record: jest.fn(), recordOrThrow: jest.fn() };
    queue = { add: jest.fn() };

    routines = { expireStaleListings: jest.fn(async () => 0) };

    const mod = await Test.createTestingModule({
      providers: [
        StoreService,
        { provide: getRepositoryToken(StoreItem), useValue: items },
        { provide: getRepositoryToken(UserInventoryItem), useValue: inventory },
        { provide: getRepositoryToken(MarketListing), useValue: listings },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(Transaction), useValue: repo() },
        { provide: getRepositoryToken(PointsLedgerEntry), useValue: repo() },
        { provide: LedgerService, useValue: ledger },
        { provide: TreasuryService, useValue: treasury },
        { provide: DbRoutinesService, useValue: routines },
        { provide: EconomyConfigService, useValue: config },
        { provide: EventBusService, useValue: bus },
        { provide: AuditService, useValue: audit },
        { provide: getQueueToken(Queues.Commission), useValue: queue },
      ],
    }).compile();

    svc = mod.get(StoreService);
    items.findOne.mockResolvedValue({ ...ITEM });
    users.findOne.mockResolvedValue({ id: "buyer", status: "active" });
    inventory.findOne.mockResolvedValue(null);
  });

  /* ==================================================================== *
   * MTT purchase — revenue
   * ==================================================================== */

  describe("purchase with MTT", () => {
    it("charges MTT and recognises `iap` revenue, which IS commissionable", async () => {
      const r = await svc.purchase("buyer", { itemId: "item-1", payWith: "mtt" }, "idem-0001", null);

      expect(balances.buyer.mttAvailable).toBe("450.000000000000000000");
      expect(treasury.recognise).toHaveBeenCalledWith(
        expect.objectContaining({ stream: "iap", grossAmount: "50.000000000000000000" }),
      );
      expect(r.commissionable).toBe(true);
      expect(r.revenueEventId).toBe("rev-1");
    });

    it("queues the commission fan-out for the purchase", async () => {
      await svc.purchase("buyer", { itemId: "item-1", payWith: "mtt" }, "idem-0001", null);
      expect(queue.add).toHaveBeenCalledWith(
        "process-revenue-event", { revenueEventId: "rev-1" }, { jobId: "commission-rev-1" },
      );
    });

    it("charges and grants the item in ONE commit", async () => {
      await svc.purchase("buyer", { itemId: "item-1", payWith: "mtt" }, "idem-0001", null);
      expect(ledger.withUserLock).toHaveBeenCalledTimes(1);
      const entities = written.map((w) => w.entity);
      expect(entities).toContain("Transaction");
      expect(entities).toContain("UserInventoryItem");
    });

    it("multiplies the price by the quantity", async () => {
      await svc.purchase("buyer", { itemId: "item-1", payWith: "mtt", quantity: 3 }, "idem-0001", null);
      expect(balances.buyer.mttAvailable).toBe("350.000000000000000000");
      expect(treasury.recognise).toHaveBeenCalledWith(
        expect.objectContaining({ grossAmount: "150.000000000000000000" }),
      );
    });

    it("REFUSES on an insufficient balance, recognising no revenue", async () => {
      balances.buyer.mttAvailable = "10.000000000000000000";
      await expect(svc.purchase("buyer", { itemId: "item-1", payWith: "mtt" }, "idem-0001", null))
        .rejects.toMatchObject({ response: { code: "INSUFFICIENT_BALANCE" } });
      expect(treasury.recognise).not.toHaveBeenCalled();
    });

    it("uses a deterministic processor reference, so a replay cannot double-count revenue", async () => {
      await svc.purchase("buyer", { itemId: "item-1", payWith: "mtt" }, "idem-0001", null);
      const [args] = treasury.recognise.mock.calls[0] as [{ processorRef: string }];
      expect(args.processorRef).toMatch(/^store:OR-/);
    });

    it("REFUSES an inactive item", async () => {
      items.findOne.mockResolvedValue({ ...ITEM, active: false });
      await expect(svc.purchase("buyer", { itemId: "item-1", payWith: "mtt" }, "idem-0001", null))
        .rejects.toMatchObject({ response: { code: "ITEM_UNAVAILABLE" } });
    });

    it("REFUSES a frozen account", async () => {
      users.findOne.mockResolvedValue({ id: "buyer", status: "frozen" });
      await expect(svc.purchase("buyer", { itemId: "item-1", payWith: "mtt" }, "idem-0001", null))
        .rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  /* ==================================================================== *
   * Points purchase — NOT revenue
   * ==================================================================== */

  describe("purchase with Points", () => {
    it("debits Points and recognises NO revenue — it is not commissionable", async () => {
      const r = await svc.purchase("buyer", { itemId: "item-1", payWith: "points" }, "idem-0001", null);

      expect(balances.buyer.points).toBe(15_000);
      expect(treasury.recognise).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      expect(r.commissionable).toBe(false);
      expect(r.revenueEventId).toBeNull();
      expect(r.paidMtt).toBe("0.000000000000000000");
    });

    it("writes the Points debit as a negative ledger row with the running balance", async () => {
      await svc.purchase("buyer", { itemId: "item-1", payWith: "points" }, "idem-0001", null);
      const entry = written.find((w) => w.entity === "PointsLedgerEntry")?.row as Record<string, unknown>;
      expect(entry.amount).toBe(-5_000);
      expect(entry.runningBalance).toBe(15_000);
      expect(entry.source).toBe("purchase");
    });

    it("REFUSES when the item has no Points price", async () => {
      items.findOne.mockResolvedValue({ ...ITEM, pricePoints: null });
      await expect(svc.purchase("buyer", { itemId: "item-1", payWith: "points" }, "idem-0001", null))
        .rejects.toMatchObject({ response: { code: "POINTS_PRICE_UNSET" } });
    });

    it("REFUSES on insufficient Points", async () => {
      balances.buyer.points = 100;
      await expect(svc.purchase("buyer", { itemId: "item-1", payWith: "points" }, "idem-0001", null))
        .rejects.toMatchObject({ response: { code: "INSUFFICIENT_POINTS" } });
    });
  });

  /* ==================================================================== *
   * Listing
   * ==================================================================== */

  describe("createListing", () => {
    const owned = {
      id: "inv-1", userId: "seller", itemId: "item-1", quantity: 1,
      consumedAt: null, lockedByListingId: null, expiresAt: null,
    };

    beforeEach(() => {
      inventory.findOne.mockResolvedValue({ ...owned });
      listings.save.mockImplementation(async (x: unknown) => ({
        id: "listing-1", createdAt: new Date("2026-02-01T00:00:00Z"), ...(x as object),
      }));
    });

    it("computes the fee from the ask and shows what the seller nets", async () => {
      const r = await svc.createListing("seller", { inventoryItemId: "inv-1", askMtt: "100" }, null);
      /* 5% of 100. */
      expect(r.feeMtt).toBe("5.000000000000000000");
      expect(r.sellerReceivesMtt).toBe("95.000000000000000000");
    });

    it("LOCKS the inventory row to the listing, so the same item cannot be sold twice", async () => {
      await svc.createListing("seller", { inventoryItemId: "inv-1", askMtt: "100" }, null);
      expect(inventory.save).toHaveBeenCalledWith(
        expect.objectContaining({ lockedByListingId: "listing-1" }),
      );
    });

    it("REFUSES to relist an already-listed item", async () => {
      inventory.findOne.mockResolvedValue({ ...owned, lockedByListingId: "listing-0" });
      await expect(svc.createListing("seller", { inventoryItemId: "inv-1", askMtt: "100" }, null))
        .rejects.toMatchObject({ response: { code: "ALREADY_LISTED" } });
    });

    it("REFUSES to sell a used item", async () => {
      inventory.findOne.mockResolvedValue({ ...owned, consumedAt: new Date(), quantity: 0 });
      await expect(svc.createListing("seller", { inventoryItemId: "inv-1", askMtt: "100" }, null))
        .rejects.toMatchObject({ response: { code: "ITEM_CONSUMED" } });
    });

    it("REFUSES to sell an untradable item", async () => {
      items.findOne.mockResolvedValue({ ...ITEM, tradable: false });
      await expect(svc.createListing("seller", { inventoryItemId: "inv-1", askMtt: "100" }, null))
        .rejects.toMatchObject({ response: { code: "ITEM_NOT_TRADABLE" } });
    });

    it("enforces the minimum and maximum ask", async () => {
      await expect(svc.createListing("seller", { inventoryItemId: "inv-1", askMtt: "0.5" }, null))
        .rejects.toMatchObject({ response: { code: "ASK_BELOW_MINIMUM" } });
      await expect(svc.createListing("seller", { inventoryItemId: "inv-1", askMtt: "9999999" }, null))
        .rejects.toMatchObject({ response: { code: "ASK_ABOVE_MAXIMUM" } });
    });

    it("anonymises the seller in the response", async () => {
      const r = await svc.createListing("seller", { inventoryItemId: "inv-1", askMtt: "100" }, null);
      expect(r.seller).toMatch(/^Member #/);
    });
  });

  /* ==================================================================== *
   * Marketplace purchase
   * ==================================================================== */

  describe("buyListing", () => {
    const listing = {
      id: "listing-1", ref: "OR-ABC", sellerId: "seller", inventoryItemId: "inv-1",
      itemId: "item-1", askMtt: "100.000000000000000000", feeMtt: "5.000000000000000000",
      status: "active" as const, buyerId: null as string | null,
      revenueEventId: null as string | null, soldAt: null as Date | null,
      createdAt: new Date("2026-02-01T00:00:00Z"),
    };

    beforeEach(() => {
      listings.findOne.mockResolvedValue({ ...listing });
      inventory.findOne.mockResolvedValue({
        id: "inv-1", userId: "seller", itemId: "item-1", quantity: 1,
        lockedByListingId: "listing-1", consumedAt: null,
      });
    });

    it("pays the SELLER the ask net of fee, and the platform only the fee", async () => {
      const r = await svc.buyListing("buyer", "OR-ABC", "idem-0001", null);

      expect(balances.buyer.mttAvailable).toBe("400.000000000000000000");
      /* Seller receives 95, not 100 — the fee is the platform's. */
      expect(balances.seller.mttAvailable).toBe("105.000000000000000000");
      expect(r.sellerReceivedMtt).toBe("95.000000000000000000");
      expect(r.feeMtt).toBe("5.000000000000000000");
    });

    it("recognises ONLY the fee as revenue, on the non-commissionable marketplace stream", async () => {
      const r = await svc.buyListing("buyer", "OR-ABC", "idem-0001", null);

      expect(treasury.recognise).toHaveBeenCalledWith(
        expect.objectContaining({ stream: "marketplace", grossAmount: "5.000000000000000000" }),
      );
      expect(r.commissionable).toBe(false);
      /* No commission job: a member-to-member trade is not a platform sale. */
      expect(queue.add).not.toHaveBeenCalled();
    });

    it("transfers the item and releases the lock in the SAME commit as the money", async () => {
      await svc.buyListing("buyer", "OR-ABC", "idem-0001", null);

      expect(ledger.withTwoUserLock).toHaveBeenCalledTimes(1);
      const inv = written.find((w) => w.entity === "UserInventoryItem")?.row as Record<string, unknown>;
      expect(inv.userId).toBe("buyer");
      expect(inv.lockedByListingId).toBeNull();
    });

    it("REFUSES a self-purchase — it would launder a balance and fake volume", async () => {
      await expect(svc.buyListing("seller", "OR-ABC", "idem-0001", null))
        .rejects.toMatchObject({ response: { code: "SELF_PURCHASE" } });
    });

    it("REFUSES a listing that is no longer active", async () => {
      listings.findOne.mockResolvedValue({ ...listing, status: "sold" });
      await expect(svc.buyListing("buyer", "OR-ABC", "idem-0001", null))
        .rejects.toMatchObject({ response: { code: "LISTING_UNAVAILABLE" } });
    });

    it("re-checks the lock inside the transaction, catching a cancellation mid-purchase", async () => {
      inventory.findOne.mockResolvedValue({
        id: "inv-1", userId: "seller", itemId: "item-1", quantity: 1,
        lockedByListingId: null, consumedAt: null,
      });
      await expect(svc.buyListing("buyer", "OR-ABC", "idem-0001", null))
        .rejects.toMatchObject({ response: { code: "LISTING_UNAVAILABLE" } });
    });

    it("REFUSES on an insufficient buyer balance", async () => {
      balances.buyer.mttAvailable = "10.000000000000000000";
      await expect(svc.buyListing("buyer", "OR-ABC", "idem-0001", null))
        .rejects.toMatchObject({ response: { code: "INSUFFICIENT_BALANCE" } });
    });

    it("writes matching sale and purchase transactions for both sides", async () => {
      await svc.buyListing("buyer", "OR-ABC", "idem-0001", null);
      const txTypes = written
        .filter((w) => w.entity === "Transaction")
        .map((w) => (w.row as { type: string }).type);
      expect(txTypes).toEqual(["marketplace_purchase", "marketplace_sale"]);
    });

    it("states on the published event that a trade is not commissionable", async () => {
      await svc.buyListing("buyer", "OR-ABC", "idem-0001", null);
      const [, payload] = bus.publish.mock.calls[0] as [string, Record<string, unknown>];
      expect(payload.commissionable).toBe(false);
    });
  });

  /* ==================================================================== *
   * Cancellation and expiry
   * ==================================================================== */

  describe("cancelListing", () => {
    it("releases the item lock", async () => {
      listings.findOne.mockResolvedValue({
        id: "listing-1", ref: "OR-ABC", sellerId: "seller", inventoryItemId: "inv-1",
        itemId: "item-1", askMtt: "100", feeMtt: "5", status: "active",
        createdAt: new Date(), soldAt: null,
      });
      inventory.findOne.mockResolvedValue({ id: "inv-1", lockedByListingId: "listing-1" });

      await svc.cancelListing("seller", "OR-ABC");

      expect(inventory.save).toHaveBeenCalledWith(
        expect.objectContaining({ lockedByListingId: null }),
      );
    });

    it("REFUSES to cancel someone else's listing", async () => {
      listings.findOne.mockResolvedValue({
        id: "listing-1", ref: "OR-ABC", sellerId: "someone-else", status: "active",
      });
      await expect(svc.cancelListing("seller", "OR-ABC")).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("expireStaleListings", () => {
    it("expires stale listings AND releases their locks in ONE transaction", async () => {
      /* The two writes used to be separate, per row: a failure between them left
       * an item locked to a listing that no longer existed — unsellable, with
       * nothing to tell the member why. sp_expire_stale_listings does both or
       * neither, and the e2e suite proves it against a real database. */
      routines.expireStaleListings.mockResolvedValue(1);

      const n = await svc.expireStaleListings();

      expect(n).toBe(1);
      expect(routines.expireStaleListings).toHaveBeenCalledWith(expect.any(Date));
      expect(listings.save).not.toHaveBeenCalled();
      expect(inventory.save).not.toHaveBeenCalled();
    });
  });

  /* ==================================================================== *
   * Consume
   * ==================================================================== */

  describe("consume", () => {
    it("REFUSES to use an item that is listed for sale", async () => {
      inventory.findOne.mockResolvedValue({
        id: "inv-1", userId: "buyer", itemId: "item-1", quantity: 1,
        lockedByListingId: "listing-1", consumedAt: null, expiresAt: null,
      });
      await expect(svc.consume("buyer", "inv-1", {}))
        .rejects.toMatchObject({ response: { code: "ITEM_LISTED" } });
    });

    it("REFUSES to use more than is owned", async () => {
      inventory.findOne.mockResolvedValue({
        id: "inv-1", userId: "buyer", itemId: "item-1", quantity: 1,
        lockedByListingId: null, consumedAt: null, expiresAt: null,
      });
      await expect(svc.consume("buyer", "inv-1", { quantity: 5 }))
        .rejects.toMatchObject({ response: { code: "INSUFFICIENT_QUANTITY" } });
    });

    it("REFUSES to use an expired item", async () => {
      inventory.findOne.mockResolvedValue({
        id: "inv-1", userId: "buyer", itemId: "item-1", quantity: 1,
        lockedByListingId: null, consumedAt: null, expiresAt: new Date(Date.now() - 1_000),
      });
      await expect(svc.consume("buyer", "inv-1", {}))
        .rejects.toMatchObject({ response: { code: "ITEM_EXPIRED" } });
    });

    it("marks the row consumed once the quantity reaches zero", async () => {
      const row = {
        id: "inv-1", userId: "buyer", itemId: "item-1", quantity: 1,
        lockedByListingId: null, consumedAt: null as Date | null, expiresAt: null,
      };
      inventory.findOne.mockResolvedValue(row);
      inventory.find.mockResolvedValue([]);

      await svc.consume("buyer", "inv-1", {});

      expect(row.quantity).toBe(0);
      expect(row.consumedAt).toBeInstanceOf(Date);
    });
  });

  /* ==================================================================== *
   * Admin
   * ==================================================================== */

  describe("upsertItem", () => {
    const base = {
      sku: "skin-orbit", name: "Orbit Skin", description: "A cosmetic skin for the ship.",
      category: "cosmetic" as const, rarity: "rare" as const, priceMtt: "50",
      hue: 24, active: true, consumable: false, tradable: true,
      reason: "seasonal cosmetic launch",
    };

    it("REFUSES a consumable that is also tradable — no lock protects that buyer", async () => {
      items.findOne.mockResolvedValue(null);
      await expect(svc.upsertItem({ ...base, consumable: true, tradable: true }, "admin-1", null))
        .rejects.toMatchObject({ response: { code: "CONSUMABLE_NOT_TRADABLE" } });
    });

    it("REFUSES an item with no price at all", async () => {
      items.findOne.mockResolvedValue(null);
      await expect(svc.upsertItem({ ...base, priceMtt: "0" }, "admin-1", null))
        .rejects.toMatchObject({ response: { code: "NO_PRICE" } });
    });

    it("audits a price change with the previous values", async () => {
      items.findOne.mockResolvedValue({ ...ITEM });
      await svc.upsertItem({ ...base, priceMtt: "80", reason: "repricing cosmetics" }, "admin-1", "1.2.3.4");
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "store.item.update",
          before: expect.objectContaining({ priceMtt: "50.000000000000000000" }),
        }),
      );
    });

    it("accepts a Points-only item", async () => {
      items.findOne.mockResolvedValue(null);
      const r = await svc.upsertItem(
        { ...base, priceMtt: "0", pricePoints: 5_000 }, "admin-1", null,
      );
      expect(r.pricePoints).toBe(5_000);
      expect(BadRequestException).toBeDefined();
    });
  });

  describe("updatePolicy", () => {
    it("REFUSES inverted listing bounds", async () => {
      await expect(
        svc.updatePolicy(
          { feeBps: 500, minAskMtt: "100", maxAskMtt: "10", listingTtlDays: 30, reason: "tightening the market" },
          "admin-1",
          null,
        ),
      ).rejects.toMatchObject({ response: { code: "BOUNDS_INVERTED" } });
    });

    it("versions the fee change and audits before and after", async () => {
      const v = await svc.updatePolicy(
        { feeBps: 250, minAskMtt: "1", maxAskMtt: "500000", listingTtlDays: 14, reason: "halving the market fee" },
        "admin-1",
        "1.2.3.4",
      );

      expect(v.feeBps).toBe(250);
      expect(config.write).toHaveBeenCalled();
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "market.policy.update",
          before: expect.objectContaining({ feeBps: 500 }),
        }),
      );
      expect(ConflictException).toBeDefined();
    });
  });
});
