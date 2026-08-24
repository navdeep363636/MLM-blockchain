import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Not, Repository } from "typeorm";
import { randomBytes } from "node:crypto";
import { verifyMessage } from "viem";
import { Transaction, User, WalletAddress, Withdrawal } from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { RedisService } from "@/common/redis/redis.service";
import { CacheKeys } from "@/common/redis/cache.keys";
import { paginate, safeSort, type Paginated } from "@/common/dto";
import { add, addHours, dayKey, toDbAmount } from "@/common/utils";
import { AuditService } from "@/modules/audit/audit.service";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import type {
  BalanceResponse, LinkAddressRequest, LinkChallengeResponse, TransactionExportResponse,
  TransactionQuery, TransactionResponse, WalletAddressResponse,
} from "./dto/wallet.dto";

/* ============================================================================
 * Wallet: balances, linked addresses, and the transaction ledger (FRD W-01, W-05).
 *
 * Two decisions worth defending:
 *
 *  1. BALANCES ARE NEVER CACHED. Not for one second. FRD D-01 requires financial
 *     figures to be live, and a cached balance is how a member sees funds they
 *     have already spent — or, worse, how two requests both decide a spend is
 *     affordable. The read is cheap; the bug is not.
 *
 *  2. AN ADDRESS IS LINKED BY SIGNATURE, NOT BY TYPING IT. Accepting an address
 *     without proof of control is how a payout is redirected to an attacker's
 *     wallet: a fat-fingered or phished address would otherwise be a permanent,
 *     irreversible loss. The challenge is single-use and short-lived, so a
 *     signature captured from a log cannot be replayed.
 * ========================================================================== */

const TX_SORT_COLUMNS = ["createdAt", "amountMtt", "type", "status"] as const;
const CHALLENGE_TTL_SECONDS = 300;
const EXPORT_ROW_LIMIT = 10_000;

/** Statuses that still hold a claim on a linked address. */
const OPEN_WITHDRAWAL_STATUSES = [
  "pending", "cooling_off", "review", "approved", "processing",
];

interface LinkChallenge {
  nonce: string;
  issuedAt: string;
}

@Injectable()
export class WalletService {
  private readonly log = new Logger(WalletService.name);

  constructor(
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(WalletAddress) private readonly addresses: Repository<WalletAddress>,
    @InjectRepository(Withdrawal) private readonly withdrawals: Repository<Withdrawal>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly ledger: LedgerService,
    private readonly redis: RedisService,
    private readonly config: EconomyConfigService,
    private readonly audit: AuditService,
  ) {}

  /* ==================================================================== *
   * Balances
   * ==================================================================== */

  /** Live balance snapshot. Read from the ledger every time — see rule 1. */
  async balance(userId: string): Promise<BalanceResponse> {
    const b = await this.ledger.getBalance(userId);

    /* Locked funds are included in the total on purpose: they are still the
     * member's money, they are simply not spendable yet. Excluding them would
     * make a pending withdrawal look like a loss. */
    const totalMtt = [
      b.mttAvailable, b.mttStaked, b.mttPendingRewards,
      b.commissionAvailable, b.mttLockedForWithdrawal,
    ].reduce((acc, v) => add(acc, v), toDbAmount(0));

    return {
      points: b.points,
      mttAvailable: toDbAmount(b.mttAvailable),
      mttStaked: toDbAmount(b.mttStaked),
      mttPendingRewards: toDbAmount(b.mttPendingRewards),
      commissionPending: toDbAmount(b.commissionPending),
      commissionAvailable: toDbAmount(b.commissionAvailable),
      commissionLifetime: toDbAmount(b.commissionLifetime),
      mttLockedForWithdrawal: toDbAmount(b.mttLockedForWithdrawal),
      totalMtt,
      lastLedgerAt: b.lastLedgerAt ? b.lastLedgerAt.toISOString() : null,
      readAt: new Date().toISOString(),
    };
  }

  /* ==================================================================== *
   * Transactions
   * ==================================================================== */

  async transactionHistory(userId: string, q: TransactionQuery): Promise<Paginated<TransactionResponse>> {
    const [rows, total] = await this.txQuery(userId, q)
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();
    return paginate(rows.map(toTxView), total, q);
  }

  /** The same filtered ledger as statement rows (FRD W-05). Bounded — an
   *  unbounded export is a denial-of-service from an authenticated account. */
  async exportTransactions(userId: string, q: TransactionQuery): Promise<TransactionExportResponse> {
    const rows = await this.txQuery(userId, q).take(EXPORT_ROW_LIMIT).getMany();
    return {
      filename: `mtt-statement-${dayKey()}.csv`,
      columns: [
        "Reference", "Date (UTC)", "Type", "MTT", "Fiat", "Currency",
        "Status", "Source", "Tx hash", "Note",
      ],
      rows: rows.map((r) => [
        r.ref,
        r.createdAt.toISOString(),
        r.type,
        toDbAmount(r.amountMtt),
        r.amountFiat ? toDbAmount(r.amountFiat) : "",
        r.currency ?? "",
        r.status,
        r.sourceTag ?? "",
        r.txHash ?? "",
        (r.note ?? "").replace(/[\r\n]+/g, " "),
      ]),
      rowCount: rows.length,
      generatedAt: new Date().toISOString(),
    };
  }

  private txQuery(userId: string, q: TransactionQuery) {
    const sortBy = safeSort(q.sortBy, TX_SORT_COLUMNS, "createdAt");
    const qb = this.transactions.createQueryBuilder("t").where("t.userId = :userId", { userId });
    if (q.type) qb.andWhere("t.type = :type", { type: q.type });
    if (q.status) qb.andWhere("t.status = :status", { status: q.status });
    if (q.from) qb.andWhere("t.createdAt >= :from", { from: q.from });
    if (q.to) qb.andWhere("t.createdAt <= :to", { to: q.to });
    if (q.q) qb.andWhere("(t.ref LIKE :s OR t.txHash LIKE :s)", { s: `%${q.q}%` });
    /* sortBy is allowlisted above — never interpolated from raw input. */
    return qb.orderBy(`t.${sortBy}`, q.sortDir);
  }

  async findTransaction(userId: string, ref: string): Promise<TransactionResponse> {
    const row = await this.transactions.findOne({ where: { userId, ref } });
    if (!row) throw new NotFoundException("Transaction not found");
    return toTxView(row);
  }

  /* ==================================================================== *
   * Linked addresses
   * ==================================================================== */

  async listAddresses(userId: string): Promise<WalletAddressResponse[]> {
    const policy = await this.config.withdrawalPolicy();
    const rows = await this.addresses.find({
      where: { userId },
      order: { isPrimary: "DESC", createdAt: "DESC" },
    });
    return rows.map((r) => this.addressView(r, policy.coolingOffHours));
  }

  /**
   * Issues a single-use challenge for proving control of an address.
   *
   * The nonce is stored server-side rather than embedded in a signed token so it
   * can be *consumed*: a signature is only ever valid once, which is what stops
   * a captured signature from linking the same address again later.
   */
  async linkChallenge(userId: string): Promise<LinkChallengeResponse> {
    const nonce = randomBytes(16).toString("hex");
    /* Derived from the OTP key family: same shape (short-lived, single-use,
     * per-subject challenge) rather than inventing an unreviewed key. */
    await this.redis.set(
      CacheKeys.otp("wallet-link", userId),
      { nonce, issuedAt: new Date().toISOString() } satisfies LinkChallenge,
      CHALLENGE_TTL_SECONDS,
    );

    return {
      message: buildLinkMessage(userId, nonce),
      expiresInSeconds: CHALLENGE_TTL_SECONDS,
    };
  }

  /**
   * Links an address after verifying the challenge signature.
   *
   * The cooling-off clock starts here, not at first withdrawal: an attacker who
   * links an address must then wait out the window, during which the member is
   * notified and can revoke it.
   */
  async linkAddress(
    userId: string,
    dto: LinkAddressRequest,
    ip: string | null,
  ): Promise<WalletAddressResponse> {
    const key = CacheKeys.otp("wallet-link", userId);
    const challenge = await this.redis.get<LinkChallenge>(key);
    if (!challenge) {
      throw new BadRequestException({
        code: "CHALLENGE_EXPIRED",
        message: "The signing challenge has expired — request a new one",
      });
    }

    const address = dto.address.toLowerCase();
    const message = buildLinkMessage(userId, challenge.nonce);

    let valid = false;
    try {
      valid = await verifyMessage({
        address: dto.address as `0x${string}`,
        message,
        signature: dto.signature as `0x${string}`,
      });
    } catch (e) {
      /* A malformed signature is a failed proof, not a server error. */
      this.log.warn(`wallet link signature rejected for ${userId}: ${e instanceof Error ? e.message : String(e)}`);
      valid = false;
    }

    if (!valid) {
      throw new BadRequestException({
        code: "SIGNATURE_INVALID",
        message: "The signature does not prove control of this address",
      });
    }

    /* Consume the challenge whether or not the rest succeeds — a proof is
     * single-use by definition. */
    await this.redis.del(key);

    /* An address may belong to exactly one account. Sharing one across accounts
     * is the standard shape of both self-referral and payout laundering. */
    const claimedElsewhere = await this.addresses.findOne({
      where: { address, userId: Not(userId) },
    });
    if (claimedElsewhere) {
      throw new ConflictException({
        code: "ADDRESS_ALREADY_LINKED",
        message: "This address is already linked to another account",
      });
    }

    const existing = await this.addresses.findOne({ where: { userId, address } });
    if (existing) {
      const policy = await this.config.withdrawalPolicy();
      return this.addressView(existing, policy.coolingOffHours);
    }

    const isFirst = (await this.addresses.count({ where: { userId } })) === 0;
    const now = new Date();

    const row = await this.addresses.save(
      this.addresses.create({
        userId,
        address,
        type: "external",
        isPrimary: isFirst,
        label: dto.label ?? null,
        verifiedAt: now,
        /* Cooling-off starts now; the withdrawal path reads this timestamp. */
        whitelistedAt: now,
      }),
    );

    if (isFirst) {
      await this.users.update({ id: userId }, { walletAddress: address, walletType: "external" });
    }

    await this.audit.recordOrThrow({
      actorId: userId,
      action: "wallet.address.link",
      targetType: "wallet_address",
      targetId: row.id,
      after: { address, isPrimary: row.isPrimary },
      ip,
    });

    const policy = await this.config.withdrawalPolicy();
    return this.addressView(row, policy.coolingOffHours);
  }

  async setPrimary(userId: string, id: string, ip: string | null): Promise<WalletAddressResponse> {
    const row = await this.addresses.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException("Address not found");
    if (!row.verifiedAt) {
      throw new BadRequestException({
        code: "ADDRESS_UNVERIFIED",
        message: "Only a verified address can be made primary",
      });
    }

    const others = await this.addresses.find({ where: { userId, isPrimary: true } });
    for (const o of others) {
      if (o.id === row.id) continue;
      o.isPrimary = false;
      await this.addresses.save(o);
    }
    row.isPrimary = true;
    await this.addresses.save(row);

    await this.users.update({ id: userId }, { walletAddress: row.address, walletType: row.type });
    await this.audit.recordOrThrow({
      actorId: userId,
      action: "wallet.address.set_primary",
      targetType: "wallet_address",
      targetId: row.id,
      after: { address: row.address },
      ip,
    });

    const policy = await this.config.withdrawalPolicy();
    return this.addressView(row, policy.coolingOffHours);
  }

  /**
   * Unlinks an address.
   *
   * Refused while a withdrawal to it is in flight: removing the destination of a
   * queued payout would leave a transfer with nowhere to land and no record of
   * where it was meant to go.
   */
  async removeAddress(userId: string, id: string, ip: string | null): Promise<void> {
    const row = await this.addresses.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException("Address not found");

    const openCount = await this.withdrawals.count({
      where: OPEN_WITHDRAWAL_STATUSES.map((status) => ({
        userId,
        destinationAddress: row.address,
        status: status as Withdrawal["status"],
      })),
    });
    if (openCount > 0) {
      throw new ConflictException({
        code: "ADDRESS_IN_USE",
        message: "A withdrawal to this address is still in progress",
      });
    }

    await this.addresses.delete({ id: row.id });
    await this.audit.recordOrThrow({
      actorId: userId,
      action: "wallet.address.unlink",
      targetType: "wallet_address",
      targetId: row.id,
      before: { address: row.address, isPrimary: row.isPrimary },
      ip,
    });
  }

  /* ------------------------------------------------------------------ */

  private addressView(r: WalletAddress, coolingOffHours: number): WalletAddressResponse {
    const withdrawableAt = r.whitelistedAt ? addHours(r.whitelistedAt, coolingOffHours) : null;
    return {
      id: r.id,
      address: r.address,
      type: r.type,
      isPrimary: r.isPrimary,
      label: r.label ?? null,
      verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
      whitelistedAt: r.whitelistedAt ? r.whitelistedAt.toISOString() : null,
      withdrawable: Boolean(r.verifiedAt) && withdrawableAt !== null && withdrawableAt.getTime() <= Date.now(),
      withdrawableAt: withdrawableAt ? withdrawableAt.toISOString() : null,
    };
  }
}

/**
 * The exact string the wallet signs.
 *
 * It names the platform, the account and a single-use nonce so a signature
 * harvested from another dapp cannot be replayed here, and so a member can read
 * what they are signing before they sign it.
 */
export function buildLinkMessage(userId: string, nonce: string): string {
  return [
    "Members Trail — verify wallet ownership",
    `Account: ${userId}`,
    `Nonce: ${nonce}`,
    "Signing this message proves you control this address. It authorises no transfer.",
  ].join("\n");
}

function toTxView(t: Transaction): TransactionResponse {
  return {
    ref: t.ref,
    createdAt: t.createdAt.toISOString(),
    type: t.type,
    amountMtt: toDbAmount(t.amountMtt),
    amountFiat: t.amountFiat ? toDbAmount(t.amountFiat) : null,
    currency: t.currency ?? null,
    status: t.status,
    sourceTag: t.sourceTag ?? null,
    txHash: t.txHash ?? null,
    note: t.note ?? null,
    settledAt: t.settledAt ? t.settledAt.toISOString() : null,
  };
}
