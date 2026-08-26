import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { StaffOnly } from "@/common/decorators";
import { RedisService } from "@/common/redis/redis.service";
import { CacheKeys, Ttl } from "@/common/redis/cache.keys";
import { AnalyticsService } from "./analytics.service";
import {
  CohortRetentionPoint, KycFunnelStage, MonthsQuery, PayoutVsInflowPoint, RevenueByStreamPoint,
  StakingTvlPoint,
} from "./dto/analytics.dto";

/* ============================================================================
 * The chart data behind the operations dashboard (FRD AD-01).
 *
 * Split from AdminController because these are the only admin reads that are
 * cached. A KPI counter and a twelve-month revenue series look similar on a
 * screen and are nothing alike underneath: the counters must be current to the
 * second because an operator acts on them, while a monthly series changes when a
 * month rolls over. Caching the first would be wrong and not caching the second
 * means every dashboard refresh re-scans a year of the revenue ledger.
 *
 * The TTL is deliberately short enough that a reconciliation run shows up within
 * a minute, and long enough that six operators refreshing during a stand-up
 * costs one query.
 * ========================================================================== */

@ApiTags("admin: analytics")
@StaffOnly("compliance", "finance_admin", "super_admin")
@Controller("admin/analytics")
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly redis: RedisService,
  ) {}

  @Get("revenue-by-stream")
  @ApiOperation({
    summary: "Net revenue per month by stream",
    description:
      "Reconciled money only; unreconciled net revenue is reported in its own " +
      "field. Attributed to `occurredAt`, so a late settlement lands in the month " +
      "it was earned rather than the month it was recorded.",
  })
  @ApiOkResponse({ type: RevenueByStreamPoint, isArray: true })
  revenueByStream(@Query() q: MonthsQuery): Promise<RevenueByStreamPoint[]> {
    return this.cached("revenue-by-stream", q.months, () => this.analytics.revenueByStream(q.months));
  }

  @Get("payout-vs-inflow")
  @ApiOperation({
    summary: "Treasury inflow against pool outflow, per month",
    description:
      "Publishes both ratios. They must not be added together — commission is " +
      "paid from the pool transfer, so summing them double-counts the same MTT.",
  })
  @ApiOkResponse({ type: PayoutVsInflowPoint, isArray: true })
  payoutVsInflow(@Query() q: MonthsQuery): Promise<PayoutVsInflowPoint[]> {
    return this.cached("payout-vs-inflow", q.months, () => this.analytics.payoutVsInflow(q.months));
  }

  @Get("staking-tvl")
  @ApiOperation({
    summary: "Staked value over time",
    description:
      "`tvl` is the per-pool APR snapshot, summed — a figure the platform " +
      "actually recorded. `stakers` counts members who staked during the period, " +
      "which is a flow: no point-in-time holder count was ever snapshotted and " +
      "reconstructing one would be a guess.",
  })
  @ApiOkResponse({ type: StakingTvlPoint, isArray: true })
  stakingTvl(@Query() q: MonthsQuery): Promise<StakingTvlPoint[]> {
    return this.cached("staking-tvl", q.months, () => this.analytics.stakingTvl(q.months));
  }

  @Get("kyc-funnel")
  @ApiOperation({
    summary: "Registration through to Tier 2",
    description: "Each stage is a superset of the next, so the funnel cannot widen.",
  })
  @ApiOkResponse({ type: KycFunnelStage, isArray: true })
  kycFunnel(): Promise<KycFunnelStage[]> {
    return this.cached("kyc-funnel", 0, () => this.analytics.kycFunnel());
  }

  @Get("cohort-retention")
  @ApiOperation({
    summary: "Day-1/7/30 return rates by signup month",
    description:
      "Windows are measured from each member's own signup instant. A cohort too " +
      "young for a window reports null with `partial: true` — never zero, which " +
      "would draw a permanent cliff at the right-hand edge.",
  })
  @ApiOkResponse({ type: CohortRetentionPoint, isArray: true })
  cohortRetention(@Query() q: MonthsQuery): Promise<CohortRetentionPoint[]> {
    return this.cached("cohort-retention", q.months, () => this.analytics.cohortRetention(q.months));
  }

  /**
   * Read-through cache.
   *
   * A Redis failure must not take the dashboard down with it: the cache is an
   * optimisation, and the query underneath still works. So a get or set that
   * throws is logged by the Redis service and the computed value is returned
   * anyway, rather than turning a cache outage into a 500.
   */
  private async cached<T>(name: string, months: number, compute: () => Promise<T>): Promise<T> {
    const key = CacheKeys.analytics(name, months);
    const hit = await this.redis.get<T>(key).catch(() => null);
    if (hit !== null && hit !== undefined) return hit;

    const value = await compute();
    await this.redis.set(key, value, Ttl.analytics).catch(() => undefined);
    return value;
  }
}
