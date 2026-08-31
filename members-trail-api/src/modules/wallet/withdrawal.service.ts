import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { IsNull, LessThanOrEqual, Repository } from "typeorm";
import {
  Transaction, User, UserBalance, WalletAddress, Withdrawal,
  type WithdrawalStatus,
} from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { EventBusService, Events } from "@/events";
import { Jobs, Queues, jobKey } from "@/queues/queue.constants";
import { paginate, safeSort, type Paginated } from "@/common/dto";
import {
  Ref, add, addDays, addHours, dec, gt, gte, lt, sub, toDbAmount, toWei,
} from "@/common/utils";
import { AuditService } from "@/modules/audit/audit.service";
import { ConfigKeys, type WithdrawalPolicyConfig } from "@/modules/economy-config/economy-config.constants";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import type {
  AdminWithdrawalQuery, CreateWithdrawalRequest, UpdateWithdrawalPolicyRequest,
  WithdrawalHistoryQuery, WithdrawalLimitsResponse, WithdrawalResponse,
} from "./dto/withdrawal.dto";

/* ============================================================================
 * Withdrawals — the only path by which value leaves the platform (FRD W-04, AD-06).
 *
 * Everything here exists because a payout is irreversible. The four controls,
 * and why each one is not optional:
 *
 *  1. KYC TIER LIMITS over a ROLLING 30-DAY WINDOW. A calendar-month cap resets
 *     at a predictable instant, so the same identity can withdraw twice the
 *     monthly limit across a month boundary in 48 hours. A rolling window has no
 *     such seam. Tier 0 cannot withdraw at all — an unverified identity has no
 *     allowance, not a small one.
 *
 *  2. REVIEW THRESHOLD. Above the configured amount, or for any fiat payout, or
 *     for an elevated risk score, the request goes to a human. Auto-approving
 *     large payouts is how a single compromised session drains an account.
 *
 *  3. COOLING-OFF ON A NEW DESTINATION. The clock starts when the address is
 *     linked, not when the payout is requested, so an attacker who links their
 *     own address must wait — and the member is notified inside that window.
 *
 *  4. FUNDS ARE LOCKED AT REQUEST TIME, in the same transaction that writes the
 *     request row. Otherwise the member could spend the balance while compliance
 *     is still reviewing the payout of it, and the approved payout would fail at
 *     the last step with the money already gone.
 *
 * Source tagging (`sourceTag`) is recorded on every request because AML review
 * needs to know how the funds were earned, and reconstructing that after the
 * fact from a merged ledger is guesswork.
 * ========================================================================== */

/**
 * What the payout worker should actually do with an approved withdrawal.
 *
 * The worker used to build the chain call itself, which meant a queue processor
 * decided WHICH ADDRESS RECEIVES MONEY. That decision belongs here, next to the
 * whitelisting and cooling-off rules that made the address trustworthy in the
 * first place — the processor only carries it out.
 */
export type PayoutInstruction =
  | {
      rail: "chain";
      withdrawalId: string;
      ref: string;
      /** The whitelisted destination. Never derived from the job payload. */
      toAddress: string;
      /** Base units (18 decimals), as a decimal string — BigInt is not JSON. */
      amountWei: string;
      idempotencyKey: string;
    }
  | { rail: "fiat"; withdrawalId: string; ref: string; amountFiat: string | null }
  | { rail: "none"; withdrawalId: string; reason: string };

const SORT_COLUMNS = ["createdAt", "amountMtt", "status"] as const;

/** Statuses that still consume rolling-window allowance. A rejected, cancelled
 *  or failed request returns its allowance — no value left the platform. */
const WINDOW_CONSUMING: WithdrawalStatus[] = [
  "pending", "cooling_off", "review", "approved", "processing", "completed",
];

/** Statuses a member may still cancel. */
const CANCELLABLE: WithdrawalStatus[] = ["pending", "cooling_off", "review"];

/** Account states allowed to withdraw. `frozen` is a compliance hold on funds. */
const WITHDRAWABLE_STATUSES = new Set(["active"]);

/** Risk score at or above which a payout always goes to a human. */
export const REVIEW_RISK_SCORE = 70;

/** Dust guard: below this, network fees exceed the payout. */
export const MIN_WITHDRAWAL_MTT = "1";

@Injectable()
export class WithdrawalService {
  private readonly log = new Logger(WithdrawalService.name);

  constructor(
    @InjectRepository(Withdrawal) private readonly withdrawals: Repository<Withdrawal>,
    @InjectRepository(WalletAddress) private readonly addresses: Repository<WalletAddress>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly ledger: LedgerService,
    private readonly bus: EventBusService,
    private readonly config: EconomyConfigService,
    private readonly audit: AuditService,
    @InjectQueue(Queues.Withdrawal) private readonly queue: Queue,
  ) {}

  /* ==================================================================== *
   * Limits
   * ==================================================================== */

  /** Everything the client needs to render the withdrawal form honestly. */
  async limits(userId: string): Promise<WithdrawalLimitsResponse> {
    const policy = await this.config.withdrawalPolicy();
    const user = await this.requireUser(userId);
    const balance = await this.ledger.getBalance(userId);

    const tierKey = String(user.kycTier) as keyof WithdrawalPolicyConfig["tierLimitsMtt"];
    const tierLimit = policy.tierLimitsMtt[tierKey] ?? toDbAmount(0);
    const used = await this.windowUsage(userId, policy.rollingWindowDays);
    const remaining = gt(tierLimit, used) ? sub(tierLimit, used) : toDbAmount(0);

    const maxRequestable = lt(balance.mttAvailable, remaining)
      ? toDbAmount(balance.mttAvailable)
      : remaining;

    let blockedBy: string | null = null;
    if (!WITHDRAWABLE_STATUSES.has(user.status)) blockedBy = `ACCOUNT_${user.status.toUpperCase()}`;
    else if (user.kycTier < 1) blockedBy = "KYC_REQUIRED";
    else if (dec(remaining).lte(0)) blockedBy = "TIER_LIMIT_REACHED";
    else if (lt(balance.mttAvailable, MIN_WITHDRAWAL_MTT)) blockedBy = "INSUFFICIENT_BALANCE";

    return {
      kycTier: user.kycTier,
      tierLimitMtt: toDbAmount(tierLimit),
      windowDays: policy.rollingWindowDays,
      usedMtt: used,
      remainingMtt: remaining,
      reviewThresholdMtt: toDbAmount(policy.autoApproveMtt),
      coolingOffHours: policy.coolingOffHours,
      availableMtt: toDbAmount(balance.mttAvailable),
      maxRequestableMtt: maxRequestable,
      eligible: blockedBy === null,
      blockedBy,
    };
  }

  /**
   * MTT already committed inside the rolling window.
   *
   * Measured from the `withdrawals` table rather than a counter, so the number
   * cannot drift or be evicted. A cap that silently resets is not a cap.
   */
  private async windowUsage(userId: string, windowDays: number): Promise<string> {
    const since = addDays(new Date(), -windowDays);
    const raw = await this.withdrawals
      .createQueryBuilder("w")
      .select("COALESCE(SUM(w.amountMtt), 0)", "sum")
      .where("w.userId = :userId", { userId })
      .andWhere("w.createdAt >= :since", { since })
      .andWhere("w.status IN (:...statuses)", { statuses: WINDOW_CONSUMING })
      .getRawOne<{ sum: string | null }>();
    return toDbAmount(raw?.sum ?? 0);
  }

  /* ==================================================================== *
   * Request
   * ==================================================================== */

  async request(
    userId: string,
    dto: CreateWithdrawalRequest,
    idempotencyKey: string,
    ip: string | null,
  ): Promise<WithdrawalResponse> {
    const key = `withdrawal:${userId}:${idempotencyKey}`;

    const replay = await this.withdrawals.findOne({ where: { idempotencyKey: key } });
    if (replay) return toView(replay);

    const amount = toDbAmount(dto.amountMtt);
    if (dec(amount).lte(0)) throw new BadRequestException("Withdrawal amount must be positive");
    if (lt(amount, MIN_WITHDRAWAL_MTT)) {
      throw new BadRequestException({
        code: "BELOW_MINIMUM",
        message: `The minimum withdrawal is ${MIN_WITHDRAWAL_MTT} MTT`,
      });
    }

    const policy = await this.config.withdrawalPolicy();
    const user = await this.requireUser(userId);

    /* A frozen account is a compliance hold on funds. Letting a payout through
     * would defeat the hold entirely. */
    if (!WITHDRAWABLE_STATUSES.has(user.status)) {
      throw new ForbiddenException({
        code: `ACCOUNT_${user.status.toUpperCase()}`,
        message: "This account cannot withdraw in its current state",
      });
    }
    if (user.kycTier < 1) {
      throw new ForbiddenException({
        code: "KYC_REQUIRED",
        message: "Identity verification is required before withdrawing",
      });
    }

    /* Tier ceiling over the rolling window. */
    const tierKey = String(user.kycTier) as keyof WithdrawalPolicyConfig["tierLimitsMtt"];
    const tierLimit = policy.tierLimitsMtt[tierKey] ?? toDbAmount(0);
    const used = await this.windowUsage(userId, policy.rollingWindowDays);
    const remaining = gt(tierLimit, used) ? sub(tierLimit, used) : toDbAmount(0);

    if (gt(amount, remaining)) {
      throw new ConflictException({
        code: "TIER_LIMIT_EXCEEDED",
        message: `This exceeds your ${policy.rollingWindowDays}-day limit for KYC tier ${user.kycTier}`,
        requested: amount,
        remaining,
        tierLimit: toDbAmount(tierLimit),
        windowDays: policy.rollingWindowDays,
      });
    }

    /* Destination resolution. */
    let destinationAddress: string | null = null;
    let destination: string;
    let address: WalletAddress | null = null;

    if (dto.kind === "mtt") {
      if (!dto.destinationAddress) {
        throw new BadRequestException({
          code: "DESTINATION_REQUIRED",
          message: "A destination address is required for an MTT withdrawal",
        });
      }
      destinationAddress = dto.destinationAddress.toLowerCase();
      destination = destinationAddress;

      /* Only a signature-verified address that belongs to THIS account. An
       * arbitrary address supplied at request time is the single easiest way to
       * exfiltrate a compromised account's balance. */
      address = await this.addresses.findOne({
        where: { userId, address: destinationAddress },
      });
      if (!address || !address.verifiedAt) {
        throw new ForbiddenException({
          code: "DESTINATION_NOT_VERIFIED",
          message: "Link and verify this address before withdrawing to it",
        });
      }
    } else {
      if (!dto.payoutMethodRef) {
        throw new BadRequestException({
          code: "PAYOUT_METHOD_REQUIRED",
          message: "A payout method reference is required for a fiat withdrawal",
        });
      }
      destination = dto.payoutMethodRef;
    }

    /* Cooling-off: measured from when the address was whitelisted. */
    const coolingOffUntil = address?.whitelistedAt
      ? addHours(address.whitelistedAt, policy.coolingOffHours)
      : null;
    const cooling = coolingOffUntil !== null && coolingOffUntil.getTime() > Date.now();

    /* Review routing. Any one of these is sufficient — they are not scored. */
    const reviewRequired =
      gt(amount, policy.autoApproveMtt) ||
      dto.kind === "fiat" ||
      user.riskScore >= REVIEW_RISK_SCORE;

    const status: WithdrawalStatus = cooling ? "cooling_off" : reviewRequired ? "review" : "approved";

    /* The balance lock and the request row commit together. Splitting them would
     * leave either an unfunded approved payout or a permanently locked balance
     * with no request to release it. */
    const row = await this.ledger.withUserLock(userId, async (tx, balance) => {
      if (!gte(balance.mttAvailable, amount)) {
        throw new ConflictException({
          code: "INSUFFICIENT_BALANCE",
          message: "Insufficient available MTT balance",
          available: toDbAmount(balance.mttAvailable),
          requested: amount,
        });
      }

      balance.mttAvailable = sub(balance.mttAvailable, amount);
      balance.mttLockedForWithdrawal = add(balance.mttLockedForWithdrawal, amount);
      balance.lastLedgerAt = new Date();
      await tx.getRepository(UserBalance).save(balance);

      return tx.getRepository(Withdrawal).save(
        tx.getRepository(Withdrawal).create({
          ref: Ref.withdrawal(),
          userId,
          kind: dto.kind,
          amountMtt: amount,
          destination,
          destinationAddress,
          sourceTag: dto.sourceTag,
          status,
          /* Snapshotted: a later tier change must not retroactively justify or
           * invalidate a payout that was already assessed. */
          kycTierAtRequest: user.kycTier,
          reviewRequired,
          coolingOffUntil: cooling ? coolingOffUntil : null,
          idempotencyKey: key,
          requestIp: ip,
        }),
      );
    });

    await this.audit.recordOrThrow({
      actorId: userId,
      action: "wallet.withdrawal.request",
      targetType: "withdrawal",
      targetId: row.id,
      after: {
        amountMtt: amount, kind: dto.kind, status, sourceTag: dto.sourceTag,
        destinationAddress, kycTier: user.kycTier, reviewRequired,
      },
      ip,
    });

    await this.bus.publish(Events.WithdrawalRequested, {
      userId,
      ref: row.ref,
      amountMtt: amount,
      kind: dto.kind,
      status,
      sourceTag: dto.sourceTag,
      reviewRequired,
      coolingOffUntil: cooling && coolingOffUntil ? coolingOffUntil.toISOString() : null,
    });

    if (cooling && coolingOffUntil) {
      /* Delayed job rather than a polling cron: the release happens at the
       * instant the window closes, and the deterministic job id makes a retried
       * enqueue a no-op. */
      await this.queue.add(
        Jobs.ReleaseCoolingOff,
        { withdrawalId: row.id },
        { delay: Math.max(0, coolingOffUntil.getTime() - Date.now()), jobId: jobKey(`cooling-off:${row.id}`) },
      );
    } else if (status === "approved") {
      await this.enqueuePayout(row.id);
    }

    return toView(row);
  }

  /* ==================================================================== *
   * Member actions
   * ==================================================================== */

  async cancel(userId: string, ref: string, ip: string | null): Promise<WithdrawalResponse> {
    const row = await this.withdrawals.findOne({ where: { userId, ref } });
    if (!row) throw new NotFoundException("Withdrawal not found");

    if (!CANCELLABLE.includes(row.status)) {
      throw new ConflictException({
        code: "NOT_CANCELLABLE",
        message: `A withdrawal that is ${row.status} can no longer be cancelled`,
      });
    }

    await this.releaseHold(row, "cancelled", null);
    await this.audit.recordOrThrow({
      actorId: userId,
      action: "wallet.withdrawal.cancel",
      targetType: "withdrawal",
      targetId: row.id,
      before: { status: row.status },
      after: { status: "cancelled" },
      ip,
    });
    return toView(row);
  }

  async history(userId: string, q: WithdrawalHistoryQuery): Promise<Paginated<WithdrawalResponse>> {
    const sortBy = safeSort(q.sortBy, SORT_COLUMNS, "createdAt");
    const qb = this.withdrawals.createQueryBuilder("w").where("w.userId = :userId", { userId });
    if (q.status) qb.andWhere("w.status = :status", { status: q.status });
    if (q.from) qb.andWhere("w.createdAt >= :from", { from: q.from });
    if (q.to) qb.andWhere("w.createdAt <= :to", { to: q.to });
    if (q.q) qb.andWhere("w.ref LIKE :s", { s: `%${q.q}%` });

    const [rows, total] = await qb
      .orderBy(`w.${sortBy}`, q.sortDir)
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();
    return paginate(rows.map(toView), total, q);
  }

  /* ==================================================================== *
   * Compliance actions
   * ==================================================================== */

  async adminList(q: AdminWithdrawalQuery): Promise<Paginated<WithdrawalResponse & { userId: string }>> {
    const sortBy = safeSort(q.sortBy, SORT_COLUMNS, "createdAt");
    const qb = this.withdrawals.createQueryBuilder("w");
    if (q.userId) qb.andWhere("w.userId = :userId", { userId: q.userId });
    if (q.status) qb.andWhere("w.status = :status", { status: q.status });
    if (q.sourceTag) qb.andWhere("w.sourceTag = :tag", { tag: q.sourceTag });
    if (q.from) qb.andWhere("w.createdAt >= :from", { from: q.from });
    if (q.to) qb.andWhere("w.createdAt <= :to", { to: q.to });
    if (q.q) qb.andWhere("w.ref LIKE :s", { s: `%${q.q}%` });

    const [rows, total] = await qb
      .orderBy(`w.${sortBy}`, q.sortDir)
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();

    return paginate(rows.map((r) => ({ ...toView(r), userId: r.userId })), total, q);
  }

  /**
   * Approves a payout under review.
   *
   * The reviewer may not be the requester. In practice a member is not staff, so
   * this asserts a property that should already hold — which is exactly why it is
   * worth asserting: a staff account withdrawing its own balance is the one case
   * where the control matters, and it is the case an attacker would aim for.
   */
  async approve(
    id: string,
    note: string,
    reviewerId: string,
    ip: string | null,
  ): Promise<WithdrawalResponse> {
    const row = await this.withdrawals.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Withdrawal not found");

    if (row.userId === reviewerId) {
      throw new ForbiddenException({
        code: "FOUR_EYES_VIOLATION",
        message: "A withdrawal cannot be approved by the account that requested it",
      });
    }
    if (row.status !== "review" && row.status !== "cooling_off") {
      throw new BadRequestException({
        code: "NOT_REVIEWABLE",
        message: `A withdrawal that is ${row.status} is not awaiting review`,
      });
    }
    /* Approving before the anti-fraud window closes would defeat it. Staff can
     * reject early, never release early. */
    if (row.coolingOffUntil && row.coolingOffUntil.getTime() > Date.now()) {
      throw new ConflictException({
        code: "COOLING_OFF_ACTIVE",
        message: "The cooling-off window on this destination has not closed yet",
        until: row.coolingOffUntil.toISOString(),
      });
    }

    const before = { status: row.status };
    row.status = "approved";
    row.reviewedById = reviewerId;
    row.reviewedAt = new Date();
    row.reviewNotes = note;
    await this.withdrawals.save(row);

    await this.audit.recordOrThrow({
      actorId: reviewerId,
      action: "wallet.withdrawal.approve",
      targetType: "withdrawal",
      targetId: row.id,
      before,
      after: { status: "approved", amountMtt: toDbAmount(row.amountMtt) },
      reason: note,
      ip,
      approvedById: reviewerId,
    });

    await this.bus.publish(Events.WithdrawalApproved, {
      userId: row.userId,
      ref: row.ref,
      amountMtt: toDbAmount(row.amountMtt),
      reviewedById: reviewerId,
    });

    await this.enqueuePayout(row.id);
    return toView(row);
  }

  /** Rejects a payout and returns the held funds to the spendable balance. */
  async reject(
    id: string,
    reason: string,
    reviewerId: string,
    ip: string | null,
  ): Promise<WithdrawalResponse> {
    const row = await this.withdrawals.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Withdrawal not found");
    if (!CANCELLABLE.includes(row.status)) {
      throw new BadRequestException({
        code: "NOT_REVIEWABLE",
        message: `A withdrawal that is ${row.status} can no longer be rejected`,
      });
    }

    const before = { status: row.status };
    await this.releaseHold(row, "rejected", reason);
    row.reviewedById = reviewerId;
    row.reviewedAt = new Date();
    await this.withdrawals.save(row);

    await this.audit.recordOrThrow({
      actorId: reviewerId,
      action: "wallet.withdrawal.reject",
      targetType: "withdrawal",
      targetId: row.id,
      before,
      after: { status: "rejected" },
      reason,
      ip,
    });

    await this.bus.publish(Events.WithdrawalRejected, {
      userId: row.userId,
      ref: row.ref,
      amountMtt: toDbAmount(row.amountMtt),
      reason,
      reviewedById: reviewerId,
    });

    return toView(row);
  }

  /** Versioned, audited change to the withdrawal policy numbers. */
  async updatePolicy(
    dto: UpdateWithdrawalPolicyRequest,
    actorId: string,
    ip: string | null,
  ): Promise<WithdrawalPolicyConfig> {
    const hours = Number(dto.coolingOffHours);
    if (!Number.isInteger(hours) || hours < 0 || hours > 24 * 30) {
      throw new BadRequestException("coolingOffHours must be a whole number of hours up to 720");
    }
    if (gt(dto.tier1Mtt, dto.tier2Mtt)) {
      throw new BadRequestException({
        code: "TIERS_INVERTED",
        message: "Tier 2 is the higher verification level and cannot have a lower limit than tier 1",
      });
    }

    const before = await this.config.withdrawalPolicy();
    const value: WithdrawalPolicyConfig = {
      autoApproveMtt: toDbAmount(dto.autoApproveMtt),
      coolingOffHours: hours,
      tierLimitsMtt: {
        /* Tier 0 stays at zero: it is not a policy number, it is the rule that
         * an unverified identity has no allowance at all. */
        "0": toDbAmount(0),
        "1": toDbAmount(dto.tier1Mtt),
        "2": toDbAmount(dto.tier2Mtt),
      },
      rollingWindowDays: before.rollingWindowDays,
    };

    await this.config.write(ConfigKeys.withdrawalPolicy, value, actorId, dto.reason);
    await this.audit.recordOrThrow({
      actorId,
      action: "wallet.withdrawal.policy.update",
      targetType: "platform_config",
      targetId: ConfigKeys.withdrawalPolicy,
      before: { ...before },
      after: { ...value },
      reason: dto.reason,
      ip,
    });
    return value;
  }

  /* ==================================================================== *
   * Called by queue processors — not exposed over HTTP
   * ==================================================================== */

  /**
   * Finds cooling-off windows that have closed and releases them.
   *
   * The primary mechanism is a delayed job scheduled at request time, which is
   * the right design — the release happens at the instant the window closes
   * rather than up to a poll interval later. But that job lives in Redis for the
   * length of the window, which is 48 hours by default, and Redis is not the
   * system of record. A restart without persistence, a flush, a changed key
   * prefix or a failover all lose it.
   *
   * Losing it was unrecoverable: nothing else in the platform looked at
   * `coolingOffUntil`, so the request stayed in `cooling_off` forever with the
   * member's funds locked, no error raised and no operator path to advance it.
   * A withdrawal is not a cache entry; it needs a floor under it.
   *
   * So this reconciles from the database, which does hold the truth. It is a
   * safety net, not the mechanism: on a healthy instance the delayed job has
   * already done the work and this finds nothing.
   */
  async sweepExpiredCoolingOff(limit = 200): Promise<{ released: number }> {
    const due = await this.withdrawals.find({
      where: { status: "cooling_off", coolingOffUntil: LessThanOrEqual(new Date()) },
      order: { coolingOffUntil: "ASC" },
      take: limit,
    });

    let released = 0;
    for (const row of due) {
      try {
        await this.releaseCoolingOff(row.id);
        released += 1;
      } catch (e) {
        /* One bad row must not stop the rest — a stuck withdrawal is exactly what
         * this exists to clear. */
        this.log.error(
          `could not release ${row.ref} after its cooling-off window closed`,
          e instanceof Error ? e.stack : String(e),
        );
      }
    }

    if (released > 0) {
      this.log.warn(
        `released ${released} withdrawal(s) whose cooling-off window had closed without the ` +
        `delayed job firing — the scheduled release was lost, which is worth investigating`,
      );
    }
    return { released };
  }

  /**
   * Closes the cooling-off window. Routes to review or straight to payout using
   * the *stored* decision, so a policy change during the window cannot silently
   * downgrade a request that was already assessed as needing review.
   */
  async releaseCoolingOff(id: string): Promise<void> {
    const row = await this.withdrawals.findOne({ where: { id } });
    if (!row || row.status !== "cooling_off") return;
    if (row.coolingOffUntil && row.coolingOffUntil.getTime() > Date.now()) {
      this.log.warn(`cooling-off release for ${row.ref} fired early — leaving it held`);
      return;
    }

    row.status = row.reviewRequired ? "review" : "approved";
    row.coolingOffUntil = null;
    await this.withdrawals.save(row);

    if (row.status === "approved") await this.enqueuePayout(row.id);
  }

  /**
   * Moves an approved withdrawal into processing and says how to pay it.
   *
   * Three things this refuses to do, each of which was a real hazard:
   *
   *  - It will not pay a request that is not approved. Re-delivering an old job
   *    after a member's account was frozen must not resurrect the payout, so the
   *    status is re-checked here rather than trusted from the job payload.
   *  - It will not pay MTT without a destination address. A missing address is a
   *    data bug; the member's funds are returned rather than sent somewhere
   *    guessed, and the request fails loudly.
   *  - It will not put a fiat payout on chain. A fiat withdrawal settles through
   *    the payment provider; sending tokens instead would be an unrecoverable
   *    mistake, so the rails are distinguished in the type, not in a comment.
   */
  async beginPayout(id: string): Promise<PayoutInstruction> {
    const row = await this.withdrawals.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Withdrawal not found");

    if (row.status === "completed") return { rail: "none", withdrawalId: id, reason: "ALREADY_COMPLETED" };
    if (row.status !== "approved" && row.status !== "processing") {
      /* Not an error: an approval that was later rejected, cancelled or frozen
       * leaves a job in the queue, and that job must simply do nothing. */
      this.log.warn(`payout skipped for ${row.ref}: status is ${row.status}, not approved`);
      return { rail: "none", withdrawalId: id, reason: `STATUS_${row.status.toUpperCase()}` };
    }

    if (row.kind === "mtt" && !row.destinationAddress) {
      await this.markFailed(id, "No destination address recorded for an MTT withdrawal");
      return { rail: "none", withdrawalId: id, reason: "NO_DESTINATION_ADDRESS" };
    }

    await this.markProcessing(id);

    if (row.kind === "fiat") {
      return { rail: "fiat", withdrawalId: id, ref: row.ref, amountFiat: row.amountFiat ?? null };
    }

    return {
      rail: "chain",
      withdrawalId: id,
      ref: row.ref,
      toAddress: row.destinationAddress as string,
      /* The ledger stores DECIMAL(36,18); the chain wants base units. Converting
       * here, once, keeps the rounding decision out of the worker. */
      amountWei: toWei(row.amountMtt).toString(),
      /* Domain-derived: a retried job resolves to the same outbound transaction
       * instead of submitting a second transfer. */
      idempotencyKey: `withdrawal:${id}`,
    };
  }

  async markProcessing(id: string): Promise<void> {
    const row = await this.withdrawals.findOne({ where: { id } });
    if (!row || row.status !== "approved") return;
    row.status = "processing";
    await this.withdrawals.save(row);
  }

  /**
   * Settles a completed payout: the held funds leave the platform and a
   * transaction row records the outflow. Both in one commit, and idempotent —
   * a re-delivered chain confirmation must not debit twice.
   */
  async markCompleted(id: string, txHash: string): Promise<void> {
    const row = await this.withdrawals.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Withdrawal not found");
    if (row.status === "completed") return;

    const amount = toDbAmount(row.amountMtt);

    await this.ledger.withUserLock(row.userId, async (tx, balance) => {
      balance.mttLockedForWithdrawal = sub(balance.mttLockedForWithdrawal, amount);
      balance.lastLedgerAt = new Date();
      await tx.getRepository(UserBalance).save(balance);

      const transaction = await tx.getRepository(Transaction).save(
        tx.getRepository(Transaction).create({
          ref: Ref.transaction(),
          userId: row.userId,
          type: "withdrawal",
          /* Negative: value left the member's account. */
          amountMtt: toDbAmount(dec(amount).neg()),
          status: "completed",
          sourceTag: row.sourceTag,
          txHash,
          note: `Withdrawal ${row.ref} to ${row.destinationAddress ?? row.kind}`,
          idempotencyKey: `${row.idempotencyKey}:settle`,
          settledAt: new Date(),
        }),
      );

      row.status = "completed";
      row.txHash = txHash;
      row.transactionId = transaction.id;
      await tx.getRepository(Withdrawal).save(row);
    });

    /* First successful payout to this address ends its "new destination"
     * status for reporting; the cooling-off decision itself is already made. */
    if (row.destinationAddress) {
      /* IsNull, not undefined: an undefined filter is dropped by TypeORM and
       * would overwrite the original first-use timestamp on every payout. */
      await this.addresses.update(
        { userId: row.userId, address: row.destinationAddress, firstUsedAt: IsNull() },
        { firstUsedAt: new Date() },
      );
    }

    await this.bus.publish(Events.WithdrawalCompleted, {
      userId: row.userId,
      ref: row.ref,
      amountMtt: amount,
      txHash,
      sourceTag: row.sourceTag,
    });
  }

  /** Terminal failure from the payout processor: funds go back to the member. */
  async markFailed(id: string, reason: string): Promise<void> {
    const row = await this.withdrawals.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Withdrawal not found");
    if (row.status === "failed" || row.status === "completed") return;

    await this.releaseHold(row, "failed", reason);
    this.log.error(`withdrawal ${row.ref} failed: ${reason}`);
  }

  /* ------------------------------------------------------------------ */

  /**
   * Returns held funds to the spendable balance and sets the terminal status,
   * in one commit. Doing this as two steps risks a status that says "rejected"
   * while the funds are still locked, which support cannot fix from the UI.
   */
  private async releaseHold(
    row: Withdrawal,
    status: Extract<WithdrawalStatus, "cancelled" | "rejected" | "failed">,
    reason: string | null,
  ): Promise<void> {
    const amount = toDbAmount(row.amountMtt);
    await this.ledger.withUserLock(row.userId, async (tx, balance) => {
      balance.mttLockedForWithdrawal = sub(balance.mttLockedForWithdrawal, amount);
      balance.mttAvailable = add(balance.mttAvailable, amount);
      balance.lastLedgerAt = new Date();
      await tx.getRepository(UserBalance).save(balance);

      row.status = status;
      row.coolingOffUntil = null;
      if (reason) row.rejectionReason = reason;
      await tx.getRepository(Withdrawal).save(row);
    });
  }

  private async enqueuePayout(id: string): Promise<void> {
    await this.queue.add(
      Jobs.ProcessWithdrawal,
      { withdrawalId: id },
      /* Deterministic id: an approval retried by an impatient reviewer must not
       * queue two payouts of the same request. */
      { jobId: jobKey(`payout:${id}`) },
    );
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("Account not found");
    return user;
  }
}

function toView(w: Withdrawal): WithdrawalResponse {
  return {
    ref: w.ref,
    createdAt: w.createdAt.toISOString(),
    kind: w.kind,
    amountMtt: toDbAmount(w.amountMtt),
    amountFiat: w.amountFiat ? toDbAmount(w.amountFiat) : null,
    destinationAddress: w.destinationAddress ?? null,
    sourceTag: w.sourceTag,
    status: w.status,
    kycTierAtRequest: w.kycTierAtRequest,
    reviewRequired: w.reviewRequired,
    coolingOffUntil: w.coolingOffUntil ? w.coolingOffUntil.toISOString() : null,
    txHash: w.txHash ?? null,
    rejectionReason: w.rejectionReason ?? null,
    reviewedAt: w.reviewedAt ? w.reviewedAt.toISOString() : null,
  };
}
