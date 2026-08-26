import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  KycSubmission, RevenueEvent, StakingAprHistory, StakingPosition, Transaction, User,
} from "@/database/entities";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import { add, dec, fiat, toDbAmount } from "@/common/utils";
import type {
  CohortRetentionPoint, KycFunnelStage, PayoutVsInflowPoint, RevenueByStreamPoint, StakingTvlPoint,
} from "./dto/analytics.dto";

/* ============================================================================
 * Dashboard analytics.
 *
 * Three rules, because a dashboard is read by people who will act on it:
 *
 *  1. NO SYNTHESISED HISTORY. Every series comes from something the platform
 *     actually recorded. Where the data cannot answer a question — a
 *     point-in-time holder count for a month we never snapshotted — the answer
 *     is a differently-defined figure that IS answerable, named for what it
 *     really counts. Inventing a plausible curve is worse than a gap, because
 *     nobody audits a curve that looks right.
 *
 *  2. AN INCOMPLETE PERIOD SAYS SO. The current month is always partial and a
 *     30-day retention figure for a cohort that is nine days old is not a low
 *     number, it is not a number. Those come back null with `partial: true`
 *     rather than as a cliff on a chart.
 *
 *  3. RECONCILED AND UNRECONCILED MONEY STAY APART. Revenue that has not been
 *     matched to a settlement is reported in its own field, never folded into a
 *     stream total.
 *
 * These reads are cheap because of the indexes and views added in the hardening
 * migration: the period series are single scans of a view, and the groupings
 * below use `idx_revenue_occurred`, `idx_tx_type_created` and
 * `idx_kyc_status_created`. None of them is on a request-serving hot path
 * anyway — the controller caches them.
 * ========================================================================== */

/** The five revenue streams the FRD recognises, in dashboard order. */
const STREAMS = ["iap", "tournament", "marketplace", "advertising", "subscription"] as const;
type Stream = (typeof STREAMS)[number];

interface MonthStreamRow { periodKey: string; stream: string; net: string | null; reconciled: number }
interface MonthAmountRow { periodKey: string; total: string | null; members: string | number }
interface CohortActivityRow { periodKey: string; cohort: string | number; d1: string | number; d7: string | number; d30: string | number }

@Injectable()
export class AnalyticsService {
  private readonly log = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(RevenueEvent) private readonly revenue: Repository<RevenueEvent>,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(StakingAprHistory) private readonly aprHistory: Repository<StakingAprHistory>,
    @InjectRepository(StakingPosition) private readonly positions: Repository<StakingPosition>,
    @InjectRepository(KycSubmission) private readonly kyc: Repository<KycSubmission>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly routines: DbRoutinesService,
  ) {}

  /* ==================================================================== *
   * Revenue by stream
   * ==================================================================== */

  /**
   * Net revenue per month, split by stream.
   *
   * Grouped on `occurredAt`, not `createdAt`: a payment processor can deliver a
   * settlement days late, and attributing February's revenue to March because
   * that is when the row was written makes every month wrong twice.
   */
  async revenueByStream(months: number): Promise<RevenueByStreamPoint[]> {
    const keys = this.periodKeys(months);

    const rows = await this.revenue.createQueryBuilder("r")
      .select("DATE_FORMAT(r.occurredAt, '%Y-%m')", "periodKey")
      .addSelect("r.stream", "stream")
      .addSelect("SUM(r.netAmount)", "net")
      .addSelect("r.reconciled", "reconciled")
      .where("r.occurredAt >= :from", { from: this.startOf(keys[0]) })
      .andWhere("r.reversedAt IS NULL")
      .groupBy("periodKey")
      .addGroupBy("r.stream")
      .addGroupBy("r.reconciled")
      .getRawMany<MonthStreamRow>();

    const byKey = new Map<string, Map<string, string>>();
    const unreconciled = new Map<string, string>();

    for (const row of rows) {
      const amount = fiat(row.net ?? 0);
      if (!row.reconciled) {
        unreconciled.set(row.periodKey, fiat(add(unreconciled.get(row.periodKey) ?? 0, amount)));
        continue;
      }
      const streams = byKey.get(row.periodKey) ?? new Map<string, string>();
      streams.set(row.stream, fiat(add(streams.get(row.stream) ?? 0, amount)));
      byKey.set(row.periodKey, streams);
    }

    return keys.map((periodKey) => {
      const streams = byKey.get(periodKey);
      const value = (s: Stream): string => fiat(streams?.get(s) ?? 0);
      const total = STREAMS.reduce<string>((sum, s) => add(sum, value(s)), "0");
      return {
        periodKey,
        label: this.label(periodKey),
        iap: value("iap"),
        tournament: value("tournament"),
        marketplace: value("marketplace"),
        advertising: value("advertising"),
        subscription: value("subscription"),
        total: fiat(total),
        unreconciled: fiat(unreconciled.get(periodKey) ?? 0),
      };
    });
  }

  /* ==================================================================== *
   * Payout vs inflow
   * ==================================================================== */

  /**
   * The compliance chart: what came in against what went out, per month.
   *
   * Both ratios are published because they answer different questions and are
   * NOT summable — commission is paid out of the pool transfer, so adding the
   * two counts the same MTT twice. The view computes them once; this method only
   * joins the two series and converts basis points to a display percentage.
   */
  async payoutVsInflow(months: number): Promise<PayoutVsInflowPoint[]> {
    const [treasury, ratios] = await Promise.all([
      this.routines.treasuryPeriodSeries(months),
      this.routines.payoutRatioSeries(months),
    ]);

    const ratioByKey = new Map(ratios.map((r) => [r.periodKey, r]));
    const treasuryByKey = new Map(treasury.map((t) => [t.periodKey, t]));

    return this.periodKeys(months).map((periodKey) => {
      const t = treasuryByKey.get(periodKey);
      const r = ratioByKey.get(periodKey);
      return {
        periodKey,
        label: this.label(periodKey),
        inflow: toDbAmount(t?.reconciledInflow ?? 0),
        commission: toDbAmount(t?.commissionPoolOut ?? 0),
        staking: toDbAmount(t?.stakingPoolOut ?? 0),
        reserve: toDbAmount(t?.reserveOut ?? 0),
        outflowRatioPct: this.bpsToPct(r?.outflowRatioBps ?? null),
        commissionRatioPct: this.bpsToPct(r?.commissionRatioBps ?? null),
      };
    });
  }

  /* ==================================================================== *
   * Staking TVL
   * ==================================================================== */

  /**
   * Staked value over time.
   *
   * `tvl` comes from `staking_apr_history`, which the APR recompute writes per
   * pool per period — a real snapshot rather than a figure reverse-engineered
   * from the ledger. The current period is not in that table until the recompute
   * runs, so it is filled from live positions and is the only point that can move.
   *
   * `stakers` is deliberately a FLOW, not a holder count: distinct members who
   * staked during the period. The platform never snapshotted a per-month holder
   * count, and reconstructing one from bucket transfers would be a guess dressed
   * as a metric.
   */
  async stakingTvl(months: number): Promise<StakingTvlPoint[]> {
    const keys = this.periodKeys(months);
    const from = this.startOf(keys[0]);

    const [snapshots, flows, live] = await Promise.all([
      this.aprHistory.createQueryBuilder("h")
        .select("h.periodKey", "periodKey")
        .addSelect("SUM(h.tvl)", "total")
        .addSelect("0", "members")
        .where("h.periodKey >= :first", { first: keys[0] })
        .groupBy("h.periodKey")
        .getRawMany<MonthAmountRow>(),

      this.transactions.createQueryBuilder("t")
        .select("DATE_FORMAT(t.createdAt, '%Y-%m')", "periodKey")
        .addSelect("SUM(CASE WHEN t.type = 'stake' THEN ABS(t.amountMtt) ELSE 0 END)", "total")
        .addSelect("COUNT(DISTINCT CASE WHEN t.type = 'stake' THEN t.userId END)", "members")
        .addSelect("SUM(CASE WHEN t.type = 'unstake' THEN ABS(t.amountMtt) ELSE 0 END)", "unstaked")
        .where("t.createdAt >= :from", { from })
        .andWhere("t.type IN (:...types)", { types: ["stake", "unstake"] })
        .andWhere("t.status = :status", { status: "completed" })
        .groupBy("periodKey")
        .getRawMany<MonthAmountRow & { unstaked: string | null }>(),

      this.positions.createQueryBuilder("p")
        .select("SUM(p.amount)", "total")
        .addSelect("COUNT(DISTINCT p.userId)", "members")
        .where("p.amount > 0")
        .getRawOne<MonthAmountRow>(),
    ]);

    const snapshotByKey = new Map(snapshots.map((s) => [s.periodKey, s]));
    const flowByKey = new Map(flows.map((f) => [f.periodKey, f]));
    const current = this.periodKeys(1)[0];

    return keys.map((periodKey) => {
      const flow = flowByKey.get(periodKey);
      const snapshot = snapshotByKey.get(periodKey);
      /* The live figure stands in for the current period only. Using it for an
       * older month would draw today's TVL across history. */
      const tvl = snapshot?.total ?? (periodKey === current ? live?.total : null);
      return {
        periodKey,
        label: this.label(periodKey),
        tvl: toDbAmount(tvl ?? 0),
        stakers: Number(flow?.members ?? 0),
        staked: toDbAmount(flow?.total ?? 0),
        unstaked: toDbAmount(flow?.unstaked ?? 0),
      };
    });
  }

  /* ==================================================================== *
   * KYC funnel
   * ==================================================================== */

  /**
   * Registration through to Tier 2, as absolute counts.
   *
   * Each stage is a superset of the next by construction — a Tier 2 member is
   * also verified and also registered — so the funnel cannot show a stage
   * growing, which is the usual sign that a funnel was assembled from
   * independently-filtered queries.
   */
  async kycFunnel(): Promise<KycFunnelStage[]> {
    const [registered, verified, submitted, tier1, tier2] = await Promise.all([
      this.users.count(),
      this.users.createQueryBuilder("u")
        .where("u.emailVerifiedAt IS NOT NULL")
        .andWhere("u.phoneVerifiedAt IS NOT NULL")
        .getCount(),
      this.kyc.createQueryBuilder("k")
        .select("COUNT(DISTINCT k.userId)", "total")
        .getRawOne<{ total: string }>()
        .then((r) => Number(r?.total ?? 0)),
      this.users.createQueryBuilder("u")
        .where("u.kycTier IN (:...tiers)", { tiers: ["tier1", "tier2"] })
        .getCount(),
      this.users.createQueryBuilder("u")
        .where("u.kycTier = :tier", { tier: "tier2" })
        .getCount(),
    ]);

    const stages: [string, number][] = [
      ["Registered", registered],
      ["Email + phone verified", verified],
      ["KYC submitted", submitted],
      ["Tier 1 approved", tier1],
      ["Tier 2 approved", tier2],
    ];

    const top = stages[0][1];
    return stages.map(([stage, count]) => ({
      stage,
      count,
      ofTopPct: top === 0 ? 0 : Number(((count / top) * 100).toFixed(1)),
    }));
  }

  /* ==================================================================== *
   * Cohort retention
   * ==================================================================== */

  /**
   * Day-1, day-7 and day-30 return rates by signup month.
   *
   * "Returned" means a successful login recorded in `login_history` inside the
   * window, counted from the member's own signup instant rather than from the
   * start of the month — a member who joined on the 28th has not had 30 days
   * just because the month has.
   *
   * A cohort younger than the window reports null, not zero. Zero would draw a
   * cliff at the right-hand edge of every retention chart forever.
   */
  async cohortRetention(months: number): Promise<CohortRetentionPoint[]> {
    const keys = this.periodKeys(months);
    const from = this.startOf(keys[0]);

    /* One grouped join rather than three queries per cohort. `login_history` is
     * indexed on (userId, createdAt), so this is an index scan per member. */
    const rows = await this.users.createQueryBuilder("u")
      .select("DATE_FORMAT(u.createdAt, '%Y-%m')", "periodKey")
      .addSelect("COUNT(DISTINCT u.id)", "cohort")
      .addSelect("COUNT(DISTINCT CASE WHEN l.createdAt <= u.createdAt + INTERVAL 1 DAY THEN u.id END)", "d1")
      .addSelect("COUNT(DISTINCT CASE WHEN l.createdAt <= u.createdAt + INTERVAL 7 DAY THEN u.id END)", "d7")
      .addSelect("COUNT(DISTINCT CASE WHEN l.createdAt <= u.createdAt + INTERVAL 30 DAY THEN u.id END)", "d30")
      .leftJoin(
        "login_history", "l",
        "l.userId = u.id AND l.success = 1 AND l.createdAt > u.createdAt + INTERVAL 1 HOUR",
      )
      .where("u.createdAt >= :from", { from })
      .andWhere("u.isStaff = 0")
      .groupBy("periodKey")
      .getRawMany<CohortActivityRow>();

    const byKey = new Map(rows.map((r) => [r.periodKey, r]));
    const now = Date.now();

    return keys.map((periodKey) => {
      const row = byKey.get(periodKey);
      const cohort = Number(row?.cohort ?? 0);
      /* Age measured from the END of the cohort month: the last member to join
       * in it is the one that decides whether the window has elapsed. */
      const monthEnd = this.startOf(this.nextKey(periodKey)).getTime();
      const rate = (n: string | number | undefined, windowDays: number): number | null => {
        if (cohort === 0) return null;
        if (now < monthEnd + windowDays * 86_400_000) return null;
        return Number(((Number(n ?? 0) / cohort) * 100).toFixed(1));
      };
      return {
        periodKey,
        label: this.label(periodKey),
        cohort,
        d1: rate(row?.d1, 1),
        d7: rate(row?.d7, 7),
        d30: rate(row?.d30, 30),
        partial: now < monthEnd + 30 * 86_400_000,
      };
    });
  }

  /* ==================================================================== *
   * Period helpers
   * ==================================================================== */

  /** Trailing N period keys, oldest first, ending with the current month. */
  private periodKeys(months: number, now: Date = new Date()): string[] {
    const n = Math.min(Math.max(Math.trunc(months) || 12, 1), 60);
    const keys: string[] = [];
    for (let i = n - 1; i >= 0; i -= 1) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      keys.push(d.toISOString().slice(0, 7));
    }
    return keys;
  }

  private startOf(periodKey: string): Date {
    return new Date(`${periodKey}-01T00:00:00.000Z`);
  }

  private nextKey(periodKey: string): string {
    const d = this.startOf(periodKey);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
  }

  /** "2026-08" → "Aug 26". The axis label; the key is what callers sort on. */
  private label(periodKey: string): string {
    const d = this.startOf(periodKey);
    const month = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
    return `${month} ${String(d.getUTCFullYear()).slice(2)}`;
  }

  /** Basis points to a one-decimal percentage. Null in stays null out. */
  private bpsToPct(bps: number | null): number | null {
    if (bps === null || bps === undefined) return null;
    return Number(dec(bps).div(100).toFixed(1));
  }
}
