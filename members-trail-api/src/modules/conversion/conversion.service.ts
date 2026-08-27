import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThanOrEqual, MoreThan, Repository } from "typeorm";
import {
  Conversion, ConversionRate, PointsLedgerEntry, Transaction, UserBalance,
} from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { EventBusService, Events } from "@/events";
import { RedisService } from "@/common/redis/redis.service";
import { CacheKeys, Ttl } from "@/common/redis/cache.keys";
import { paginate, safeSort, type Paginated } from "@/common/dto";
import {
  Ref, add, dayKey, dec, monthKey, pointsToMtt, secondsUntilUtcMidnight,
  secondsUntilUtcMonthEnd, startOfUtcDay, startOfUtcMonth, sub, toDbAmount,
} from "@/common/utils";
import { AuditService } from "@/modules/audit/audit.service";
import {
  ConfigKeys, type ConversionCapsConfig,
} from "@/modules/economy-config/economy-config.constants";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import {
  RATE_MAX, RATE_MIN, type AdminConversionQuery, type ConversionCapMeter,
  type ConversionHistoryQuery, type ConversionQuoteResponse, type ConversionRateResponse,
  type ConversionResponse, type ConversionSummaryResponse, type ProposeRateRequest,
  type ConversionCapsOverview, type RateResponse, type UpdateConversionCapsRequest,
} from "./dto/conversion.dto";

/* ============================================================================
 * Points → MTT conversion (FRD W-02, AD-05).
 *
 * The five rules that make this safe:
 *
 *  1. TRUNCATION, ALWAYS DOWN. `pointsToMtt` floors at 18dp. Rounding up by even
 *     one wei per conversion mints MTT that no revenue backs — across millions
 *     of conversions that is a real hole in the supply.
 *
 *  2. THE RATE IS APPROVED, NOT SET. A rate change is a four-eyes action: the
 *     proposer can never be the approver, and the rate applied to a conversion
 *     is the one that was *active at that instant*, snapshotted onto the row.
 *     Repricing history is not possible.
 *
 *  3. CAPS REFUSE, THEY DO NOT CLAMP. Points issuance clamps because the player
 *     already earned it; a conversion is a chosen amount, so silently converting
 *     less than asked would be worse than refusing — the player would not know
 *     how much they spent. The quote endpoint exists precisely so the client can
 *     show the convertible amount before submitting.
 *
 *  4. ONE TRANSACTION. The Points debit, the MTT credit, the ledger row and the
 *     conversion row commit together under the user's balance lock. There is no
 *     window where the Points are gone and the MTT has not arrived.
 *
 *  5. NEVER COMMISSIONABLE. A conversion is not revenue — nobody paid anything.
 *     It creates no `revenue_events` row, so the commission engine structurally
 *     cannot see it (conventions §3).
 * ========================================================================== */

const HISTORY_SORT_COLUMNS = ["createdAt", "pointsSpent", "mttCredited"] as const;
const LOCK_TTL_SECONDS = 15;

/** Conversion statuses that still consume cap allowance. A failed or cancelled
 *  conversion returns the allowance — it never spent the Points. */
const CAP_CONSUMING_STATUSES = ["pending", "queued", "processing", "review", "completed"];

interface CachedRate {
  id: string;
  pointsPerMtt: number;
  effectiveFrom: string;
}

@Injectable()
export class ConversionService {
  private readonly log = new Logger(ConversionService.name);

  constructor(
    @InjectRepository(Conversion) private readonly conversions: Repository<Conversion>,
    @InjectRepository(ConversionRate) private readonly rates: Repository<ConversionRate>,
    private readonly ledger: LedgerService,
    private readonly bus: EventBusService,
    private readonly redis: RedisService,
    private readonly config: EconomyConfigService,
    private readonly audit: AuditService,
  ) {}

  /* ==================================================================== *
   * Rate
   * ==================================================================== */

  /**
   * The rate in force right now.
   *
   * Cached for 30s. That staleness window is deliberate and bounded: a rate is
   * only ever *scheduled* into the future by an approver, so a 30s lag can at
   * worst apply the previous approved rate a moment longer — it can never apply
   * a rate that was never approved.
   */
  async activeRate(): Promise<ConversionRate> {
    const cached = await this.redis.get<CachedRate>(CacheKeys.conversionRate());
    if (cached) {
      const row = await this.rates.findOne({ where: { id: cached.id } });
      /* Trust the row, not the cache, for status: an approver may have
       * superseded it within the TTL. */
      if (row && (row.status === "active" || row.status === "scheduled")) return row;
      await this.redis.del(CacheKeys.conversionRate());
    }

    const row = await this.rates.findOne({
      where: [
        { status: "active", effectiveFrom: LessThanOrEqual(new Date()) },
        { status: "scheduled", effectiveFrom: LessThanOrEqual(new Date()) },
      ],
      order: { effectiveFrom: "DESC" },
    });

    if (!row) {
      /* Refusing is correct. Guessing a rate here would convert real Points at
       * a number nobody approved. */
      throw new ConflictException({
        code: "NO_ACTIVE_RATE",
        message: "Conversion is unavailable: no approved rate is in force",
      });
    }

    /* A scheduled rate whose time has come is promoted on first use, so the
     * transition does not depend on a cron having run. */
    if (row.status === "scheduled") await this.activate(row);

    await this.redis.set(
      CacheKeys.conversionRate(),
      { id: row.id, pointsPerMtt: row.pointsPerMtt, effectiveFrom: row.effectiveFrom.toISOString() },
      Ttl.conversionRate,
    );
    return row;
  }

  /** Current rate plus the next scheduled one, for the client's rate banner. */
  async ratePublic(): Promise<ConversionRateResponse> {
    const current = await this.activeRate();
    const next = await this.rates.findOne({
      where: { status: "scheduled", effectiveFrom: MoreThan(new Date()) },
      order: { effectiveFrom: "ASC" },
    });
    return {
      pointsPerMtt: current.pointsPerMtt,
      effectiveFrom: current.effectiveFrom.toISOString(),
      nextPointsPerMtt: next?.pointsPerMtt ?? null,
      nextEffectiveFrom: next?.effectiveFrom.toISOString() ?? null,
    };
  }

  private async activate(row: ConversionRate): Promise<void> {
    const previous = await this.rates.find({ where: { status: "active" } });
    for (const p of previous) {
      if (p.id === row.id) continue;
      p.status = "superseded";
      await this.rates.save(p);
    }
    row.status = "active";
    await this.rates.save(row);
    await this.redis.del(CacheKeys.conversionRate());
    this.log.log(`conversion rate active: ${row.pointsPerMtt} Points/MTT (${row.id})`);
  }

  /* ==================================================================== *
   * Caps
   * ==================================================================== */

  /**
   * Points already committed to conversions inside the day and month windows.
   *
   * Read from the `conversions` table rather than a Redis counter on purpose: a
   * counter can drift or be evicted, and a cap that silently resets is an
   * emission control that does not control anything. Redis caches the *rate*,
   * never the cap.
   */
  async capMeters(userId: string): Promise<ConversionCapMeter[]> {
    const caps = await this.config.conversionCaps();
    const [usedDay, usedMonth] = await Promise.all([
      this.sumConverted(userId, startOfUtcDay()),
      this.sumConverted(userId, startOfUtcMonth()),
    ]);

    return [
      {
        window: "day",
        periodKey: dayKey(),
        limitPoints: caps.dailyPoints,
        usedPoints: usedDay,
        remainingPoints: Math.max(0, caps.dailyPoints - usedDay),
        resetsInSeconds: secondsUntilUtcMidnight(),
      },
      {
        window: "month",
        periodKey: monthKey(),
        limitPoints: caps.monthlyPoints,
        usedPoints: usedMonth,
        remainingPoints: Math.max(0, caps.monthlyPoints - usedMonth),
        resetsInSeconds: secondsUntilUtcMonthEnd(),
      },
    ];
  }

  private async sumConverted(userId: string, since: Date): Promise<number> {
    const raw = await this.conversions
      .createQueryBuilder("c")
      .select("COALESCE(SUM(c.pointsSpent), 0)", "sum")
      .where("c.userId = :userId", { userId })
      .andWhere("c.createdAt >= :since", { since })
      .andWhere("c.status IN (:...statuses)", { statuses: CAP_CONSUMING_STATUSES })
      .getRawOne<{ sum: string | null }>();
    return Number(raw?.sum ?? 0);
  }

  /* ==================================================================== *
   * Quote
   * ==================================================================== */

  /**
   * What the player would get, and what is stopping them if anything.
   *
   * `pointsConvertible` is the minimum of the request, the balance, and both cap
   * meters — and is then floored to a whole multiple of the rate, because Points
   * spent on a fractional-MTT remainder would be burned for nothing.
   */
  async quote(userId: string, points: number): Promise<ConversionQuoteResponse> {
    const rate = await this.activeRate();
    const caps = await this.capMeters(userId);
    const balance = await this.ledger.getBalance(userId);

    /* Every ceiling that applies, with the code the client shows if it binds.
     * Reporting the *binding* one matters: "you can convert 2,000 now" is
     * actionable, "conversion failed" is not. */
    const ceilings = [
      { code: "INSUFFICIENT_POINTS", value: balance.points },
      { code: "DAILY_CAP", value: caps[0].remainingPoints },
      { code: "MONTHLY_CAP", value: caps[1].remainingPoints },
    ];
    let tightest = ceilings[0];
    for (const c of ceilings) if (c.value < tightest.value) tightest = c;

    const allowed = Math.max(0, Math.min(points, tightest.value));

    /* Only whole multiples of the rate produce MTT the player can see. The
     * remainder stays in the Points balance rather than vanishing. */
    const convertible = allowed - (allowed % rate.pointsPerMtt);
    const mttOut = pointsToMtt(convertible, rate.pointsPerMtt);

    let blockedBy: string | null = null;
    if (convertible <= 0) {
      blockedBy = tightest.value < rate.pointsPerMtt ? tightest.code : "BELOW_MINIMUM";
    } else if (convertible < points) {
      /* Partially constrained: either a ceiling, or the rate granularity that
       * would otherwise spend Points for a fraction of an MTT. */
      blockedBy = tightest.value < points ? tightest.code : "RATE_GRANULARITY";
    }

    return {
      pointsRequested: points,
      pointsConvertible: convertible,
      pointsPerMtt: rate.pointsPerMtt,
      mttOut,
      remainderPoints: Math.max(0, points - convertible),
      pointsBalance: balance.points,
      caps,
      executable: convertible > 0,
      blockedBy,
    };
  }

  /* ==================================================================== *
   * Convert
   * ==================================================================== */

  /**
   * Executes a conversion.
   *
   * `idempotencyKey` is the client's Idempotency-Key header, scoped to the user.
   * The HTTP interceptor already refuses a duplicate in-flight request; this key
   * is the durable defence — it is UNIQUE on the row, so even a replay that
   * arrives after the Redis reservation expired resolves to the original
   * conversion instead of spending the Points again.
   */
  async convert(userId: string, points: number, idempotencyKey: string): Promise<ConversionResponse> {
    if (!Number.isInteger(points) || points <= 0) {
      throw new BadRequestException("Points to convert must be a positive whole number");
    }

    const key = `conversion:${userId}:${idempotencyKey}`;

    const existing = await this.conversions.findOne({ where: { idempotencyKey: key } });
    if (existing) {
      /* A replay resolves to the original row rather than converting again. */
      const balance = await this.ledger.getBalance(userId);
      return this.view(existing, balance.points, true);
    }

    const result = await this.redis.withLock(
      `conversion:${userId}`,
      LOCK_TTL_SECONDS,
      () => this.convertUnderLock(userId, points, key),
    );

    if (result === null) {
      throw new ConflictException({
        code: "CONVERSION_IN_FLIGHT",
        message: "Another conversion is already being processed for this account",
      });
    }
    return result;
  }

  private async convertUnderLock(
    userId: string,
    points: number,
    key: string,
  ): Promise<ConversionResponse> {
    const rate = await this.activeRate();
    const quote = await this.quote(userId, points);

    /* Refuse rather than convert a smaller amount. See rule 3 in the header. */
    if (quote.pointsConvertible < points) {
      throw new ConflictException({
        code: quote.blockedBy ?? "CONVERSION_LIMIT",
        message:
          quote.blockedBy === "INSUFFICIENT_POINTS"
            ? "Insufficient Points balance for this conversion"
            : `This conversion exceeds your limit. Convertible now: ${quote.pointsConvertible} Points`,
        requested: points,
        convertible: quote.pointsConvertible,
        caps: quote.caps,
      });
    }

    const mtt = pointsToMtt(points, rate.pointsPerMtt);
    if (dec(mtt).lte(0)) {
      throw new BadRequestException({
        code: "BELOW_MINIMUM",
        message: `At least ${rate.pointsPerMtt} Points are required to receive 1 MTT`,
      });
    }

    /* One transaction, one lock. `withUserLock` is the sanctioned way to write
     * two ledger effects that must agree (see the LedgerService docs) — doing
     * this as mutatePoints() then mutateMtt() would leave a window in which the
     * Points had been debited and the MTT did not yet exist. */
    const { conversion, balanceAfter } = await this.ledger.withUserLock(userId, async (tx, balance) => {
      if (balance.points < points) {
        throw new ConflictException({
          code: "INSUFFICIENT_POINTS",
          message: "Insufficient Points balance",
          available: balance.points,
          requested: points,
        });
      }

      const nextPoints = balance.points - points;

      const entry = await tx.getRepository(PointsLedgerEntry).save(
        tx.getRepository(PointsLedgerEntry).create({
          ref: Ref.pointsEntry(),
          userId,
          source: "conversion",
          amount: -points,
          runningBalance: nextPoints,
          note: `Converted to ${mtt} MTT at ${rate.pointsPerMtt} Points/MTT`,
          idempotencyKey: `${key}:points`,
        }),
      );

      const transaction = await tx.getRepository(Transaction).save(
        tx.getRepository(Transaction).create({
          ref: Ref.transaction(),
          userId,
          type: "conversion",
          amountMtt: toDbAmount(mtt),
          status: "completed",
          sourceTag: "gameplay",
          note: `${points} Points → ${mtt} MTT`,
          metadata: {
            pointsSpent: points,
            rateApplied: rate.pointsPerMtt,
            rateId: rate.id,
            pointsEntryRef: entry.ref,
          },
          idempotencyKey: `${key}:mtt`,
          settledAt: new Date(),
        }),
      );

      const row = await tx.getRepository(Conversion).save(
        tx.getRepository(Conversion).create({
          ref: Ref.conversion(),
          userId,
          pointsSpent: points,
          /* Snapshotted, not referenced: a later rate change must not reprice
           * a conversion that already happened. */
          rateApplied: rate.pointsPerMtt,
          mttCredited: toDbAmount(mtt),
          status: "completed",
          transactionId: transaction.id,
          idempotencyKey: key,
        }),
      );

      balance.points = nextPoints;
      balance.mttAvailable = add(balance.mttAvailable, mtt);
      balance.lastLedgerAt = new Date();
      await tx.getRepository(UserBalance).save(balance);

      return { conversion: row, balanceAfter: nextPoints };
    });

    await this.bus.publish(Events.ConversionCompleted, {
      userId,
      ref: conversion.ref,
      pointsSpent: points,
      mttCredited: conversion.mttCredited,
      rateApplied: rate.pointsPerMtt,
      /* Stated explicitly so no downstream consumer ever treats a conversion as
       * revenue and pays commission on it (conventions §3). */
      commissionable: false,
    });

    /* No on-chain settlement, deliberately.
     *
     * Converted MTT is CUSTODIAL: it sits in the platform's balance sheet until
     * the member withdraws, and the withdrawal is where a transfer actually
     * happens. An earlier version queued a per-conversion `transfer` here, which
     * would have signed a token transfer to the member's user id — not an
     * address — for every conversion. If treasury policy later wants each
     * conversion mirrored on chain, it needs a contract function that records
     * one; a transfer is not that function. `attachTxHash` exists for the case
     * where operations settles one manually.
     */

    return this.view(conversion, balanceAfter, false);
  }

  /* ==================================================================== *
   * Player reads
   * ==================================================================== */

  async history(userId: string, q: ConversionHistoryQuery): Promise<Paginated<ConversionResponse>> {
    const sortBy = safeSort(q.sortBy, HISTORY_SORT_COLUMNS, "createdAt");
    const qb = this.conversions.createQueryBuilder("c").where("c.userId = :userId", { userId });
    if (q.from) qb.andWhere("c.createdAt >= :from", { from: q.from });
    if (q.to) qb.andWhere("c.createdAt <= :to", { to: q.to });
    if (q.q) qb.andWhere("c.ref LIKE :ref", { ref: `%${q.q}%` });

    const [rows, total] = await qb
      .orderBy(`c.${sortBy}`, q.sortDir)
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();

    return paginate(rows.map((r) => this.view(r, null, false)), total, q);
  }

  async summary(userId: string): Promise<ConversionSummaryResponse> {
    const raw = await this.conversions
      .createQueryBuilder("c")
      .select("COUNT(*)", "count")
      .addSelect("COALESCE(SUM(c.pointsSpent), 0)", "points")
      .addSelect("COALESCE(SUM(c.mttCredited), 0)", "mtt")
      .addSelect("MAX(c.createdAt)", "last")
      .where("c.userId = :userId", { userId })
      .andWhere("c.status = 'completed'")
      .getRawOne<{ count: string; points: string; mtt: string; last: Date | null }>();

    const points = Number(raw?.points ?? 0);
    const mtt = toDbAmount(raw?.mtt ?? 0);

    return {
      totalConversions: Number(raw?.count ?? 0),
      pointsSpentLifetime: points,
      mttReceivedLifetime: mtt,
      lastConvertedAt: raw?.last ? new Date(raw.last).toISOString() : null,
      /* Weighted by Points, not a mean of rates: converting 10 Points at one
       * rate and 10,000 at another must not weigh those equally. */
      averageRate: dec(mtt).isZero() ? 0 : Math.round(dec(points).div(dec(mtt)).toNumber()),
    };
  }

  /* ==================================================================== *
   * Admin — rate lifecycle (four-eyes, conventions §11)
   * ==================================================================== */

  async listRates(limit = 50): Promise<RateResponse[]> {
    const rows = await this.rates.find({ order: { createdAt: "DESC" }, take: Math.min(limit, 200) });
    return rows.map(toRateView);
  }

  /**
   * Proposes a rate. Deliberately does NOT take effect: it sits in
   * `pending_approval` until a *different* staff member approves it.
   */
  async proposeRate(
    dto: ProposeRateRequest,
    actorId: string,
    ip: string | null,
  ): Promise<RateResponse> {
    const effectiveFrom = new Date(dto.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime())) {
      throw new BadRequestException("effectiveFrom is not a valid instant");
    }
    if (effectiveFrom.getTime() <= Date.now()) {
      /* A backdated rate would reprice conversions that already used the old
       * one, which is not a rate change but a rewrite of history. */
      throw new BadRequestException({
        code: "RATE_NOT_FUTURE",
        message: "effectiveFrom must be in the future — a rate can never be backdated",
      });
    }
    if (dto.pointsPerMtt < RATE_MIN || dto.pointsPerMtt > RATE_MAX) {
      throw new BadRequestException(`pointsPerMtt must be between ${RATE_MIN} and ${RATE_MAX}`);
    }

    const row = await this.rates.save(
      this.rates.create({
        pointsPerMtt: dto.pointsPerMtt,
        effectiveFrom,
        status: "pending_approval",
        proposedById: actorId,
        rationale: dto.rationale,
      }),
    );

    await this.audit.recordOrThrow({
      actorId,
      action: "conversion.rate.propose",
      targetType: "conversion_rate",
      targetId: row.id,
      after: { pointsPerMtt: row.pointsPerMtt, effectiveFrom: row.effectiveFrom.toISOString() },
      reason: dto.rationale,
      ip,
      requiredSecondApproval: true,
    });

    await this.bus.publish(Events.ApprovalRequested, {
      kind: "conversion_rate",
      targetId: row.id,
      requestedById: actorId,
      summary: `Conversion rate → ${row.pointsPerMtt} Points/MTT from ${row.effectiveFrom.toISOString()}`,
    });

    return toRateView(row);
  }

  /**
   * Approves a proposed rate.
   *
   * The approver must not be the proposer. This is the whole point of the
   * control: one compromised or mistaken account cannot change the price of
   * every player's Points on its own.
   */
  async approveRate(
    id: string,
    note: string | null,
    approverId: string,
    ip: string | null,
  ): Promise<RateResponse> {
    const row = await this.rates.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Rate proposal not found");
    if (row.status !== "pending_approval") {
      throw new BadRequestException({
        code: "RATE_NOT_PENDING",
        message: `This proposal is ${row.status} and can no longer be approved`,
      });
    }
    if (row.proposedById === approverId) {
      throw new ForbiddenException({
        code: "FOUR_EYES_VIOLATION",
        message: "A rate change must be approved by someone other than the person who proposed it",
      });
    }

    const before = { status: row.status, approvedById: row.approvedById ?? null };

    row.approvedById = approverId;
    row.approvedAt = new Date();
    /* Future-dated proposals wait; a proposal whose window has already opened
     * activates now and supersedes the incumbent. */
    row.status = row.effectiveFrom.getTime() <= Date.now() ? "active" : "scheduled";
    await this.rates.save(row);

    if (row.status === "active") await this.activate(row);
    await this.redis.del(CacheKeys.conversionRate());

    await this.audit.recordOrThrow({
      actorId: approverId,
      action: "conversion.rate.approve",
      targetType: "conversion_rate",
      targetId: row.id,
      before,
      after: { status: row.status, pointsPerMtt: row.pointsPerMtt },
      reason: note ?? row.rationale ?? null,
      ip,
      approvedById: approverId,
    });

    await this.bus.publish(Events.ApprovalDecided, {
      kind: "conversion_rate",
      targetId: row.id,
      decision: "approved",
      decidedById: approverId,
      pointsPerMtt: row.pointsPerMtt,
      effectiveFrom: row.effectiveFrom.toISOString(),
    });

    return toRateView(row);
  }

  async rejectRate(
    id: string,
    reason: string,
    approverId: string,
    ip: string | null,
  ): Promise<RateResponse> {
    const row = await this.rates.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Rate proposal not found");
    if (row.status !== "pending_approval") {
      throw new BadRequestException({
        code: "RATE_NOT_PENDING",
        message: `This proposal is ${row.status} and can no longer be rejected`,
      });
    }
    if (row.proposedById === approverId) {
      throw new ForbiddenException({
        code: "FOUR_EYES_VIOLATION",
        message: "A proposal must be reviewed by someone other than its proposer",
      });
    }

    row.status = "rejected";
    row.rejectionReason = reason;
    row.approvedById = approverId;
    row.approvedAt = new Date();
    await this.rates.save(row);

    await this.audit.recordOrThrow({
      actorId: approverId,
      action: "conversion.rate.reject",
      targetType: "conversion_rate",
      targetId: row.id,
      after: { status: "rejected" },
      reason,
      ip,
    });

    await this.bus.publish(Events.ApprovalDecided, {
      kind: "conversion_rate",
      targetId: row.id,
      decision: "rejected",
      decidedById: approverId,
      reason,
    });

    return toRateView(row);
  }

  /** Cap changes are versioned in platform_config and audited, never overwritten. */
  /**
   * The ceilings in force, plus today's platform-wide usage.
   *
   * Usage is summed from `conversions` over the UTC day rather than kept as a
   * counter, because a counter and a ledger disagree the first time a conversion
   * fails after the counter was incremented — and the ledger is the one an
   * auditor reads.
   */
  async capsOverview(): Promise<ConversionCapsOverview> {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    const [caps, global, used] = await Promise.all([
      this.config.conversionCaps(),
      this.config.read<{ dailyPoints?: number }>(ConfigKeys.conversionGlobalCaps, {}),
      this.conversions.createQueryBuilder("c")
        .select("SUM(c.pointsSpent)", "points")
        .addSelect("COUNT(*)", "count")
        .where("c.createdAt >= :from", { from: dayStart })
        .andWhere("c.status IN (:...statuses)", { statuses: CAP_CONSUMING_STATUSES })
        .getRawOne<{ points: string | null; count: string }>(),
    ]);

    return {
      perUserDailyPoints: caps.dailyPoints,
      perUserMonthlyPoints: caps.monthlyPoints,
      globalDailyPoints: global?.dailyPoints ?? null,
      globalDailyUsedPoints: String(used?.points ?? "0"),
      globalDailyConversions: Number(used?.count ?? 0),
    };
  }

  async updateCaps(
    dto: UpdateConversionCapsRequest,
    actorId: string,
    ip: string | null,
  ): Promise<ConversionCapsConfig> {
    if (dto.monthlyPoints < dto.dailyPoints) {
      throw new BadRequestException({
        code: "CAPS_INCONSISTENT",
        message: "The monthly cap cannot be lower than the daily cap",
      });
    }

    const before = await this.config.conversionCaps();
    const value: ConversionCapsConfig = {
      dailyPoints: dto.dailyPoints,
      monthlyPoints: dto.monthlyPoints,
    };
    await this.config.write(ConfigKeys.conversionCaps, value, actorId, dto.reason);

    await this.audit.recordOrThrow({
      actorId,
      action: "conversion.caps.update",
      targetType: "platform_config",
      targetId: ConfigKeys.conversionCaps,
      before: { ...before },
      after: { ...value },
      reason: dto.reason,
      ip,
    });

    return value;
  }

  /** Staff view of conversion activity, for support and reconciliation. */
  async adminList(q: AdminConversionQuery): Promise<Paginated<ConversionResponse & { userId: string }>> {
    const sortBy = safeSort(q.sortBy, HISTORY_SORT_COLUMNS, "createdAt");
    const qb = this.conversions.createQueryBuilder("c");
    if (q.userId) qb.andWhere("c.userId = :userId", { userId: q.userId });
    if (q.from) qb.andWhere("c.createdAt >= :from", { from: q.from });
    if (q.to) qb.andWhere("c.createdAt <= :to", { to: q.to });
    if (q.q) qb.andWhere("c.ref LIKE :ref", { ref: `%${q.q}%` });

    const [rows, total] = await qb
      .orderBy(`c.${sortBy}`, q.sortDir)
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();

    return paginate(
      rows.map((r) => ({ ...this.view(r, null, false), userId: r.userId })),
      total,
      q,
    );
  }

  /* ==================================================================== *
   * Internal — called by the settlement processor
   * ==================================================================== */

  /** Records the on-chain hash for a settled conversion. Idempotent. */
  async attachTxHash(conversionId: string, txHash: string): Promise<void> {
    const row = await this.conversions.findOne({ where: { id: conversionId } });
    if (!row || row.txHash === txHash) return;
    row.txHash = txHash;
    await this.conversions.save(row);
  }

  /**
   * Marks a conversion failed and returns the Points.
   *
   * Only reachable from the settlement processor after every retry is exhausted.
   * The reversal is a fresh ledger row, never an edit of the original — the
   * original conversion stays in the history where the player can see it.
   */
  async reverse(conversionId: string, reason: string): Promise<void> {
    const row = await this.conversions.findOne({ where: { id: conversionId } });
    if (!row) throw new NotFoundException("Conversion not found");
    if (row.status === "failed") return;

    await this.ledger.withUserLock(row.userId, async (tx, balance) => {
      const nextPoints = balance.points + row.pointsSpent;

      await tx.getRepository(PointsLedgerEntry).save(
        tx.getRepository(PointsLedgerEntry).create({
          ref: Ref.pointsEntry(),
          userId: row.userId,
          source: "reversal",
          amount: row.pointsSpent,
          runningBalance: nextPoints,
          note: `Conversion ${row.ref} reversed: ${reason}`.slice(0, 255),
          idempotencyKey: `${row.idempotencyKey}:reverse`,
        }),
      );

      balance.points = nextPoints;
      balance.mttAvailable = sub(balance.mttAvailable, row.mttCredited);
      balance.lastLedgerAt = new Date();
      await tx.getRepository(UserBalance).save(balance);

      row.status = "failed";
      await tx.getRepository(Conversion).save(row);
    });

    this.log.warn(`conversion ${row.ref} reversed: ${reason}`);
  }

  /* ------------------------------------------------------------------ */

  private view(row: Conversion, balanceAfter: number | null, replayed: boolean): ConversionResponse {
    return {
      ref: row.ref,
      createdAt: row.createdAt.toISOString(),
      pointsSpent: row.pointsSpent,
      rateApplied: row.rateApplied,
      mttCredited: toDbAmount(row.mttCredited),
      status: row.status,
      txHash: row.txHash ?? null,
      pointsBalanceAfter: balanceAfter ?? 0,
      replayed,
    };
  }
}

function toRateView(r: ConversionRate): RateResponse {
  return {
    id: r.id,
    pointsPerMtt: r.pointsPerMtt,
    effectiveFrom: r.effectiveFrom.toISOString(),
    status: r.status,
    proposedById: r.proposedById,
    approvedById: r.approvedById ?? null,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    rationale: r.rationale ?? null,
    rejectionReason: r.rejectionReason ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
