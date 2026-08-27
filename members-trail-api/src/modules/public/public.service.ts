import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CommissionPlan, ConversionRate, Game, Tournament } from "@/database/entities";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import { RedisService } from "@/common/redis/redis.service";
import { CacheKeys, Ttl } from "@/common/redis/cache.keys";
import { dec, monthKey, toDbAmount } from "@/common/utils";
import {
  GLOBAL_MIN_AGE, JURISDICTION_MIN_AGE, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH,
  RESTRICTED_JURISDICTIONS,
} from "@/modules/auth/auth.constants";
import type { PublicConfigResponse, PublicStatsResponse } from "./dto/public.dto";

/* ============================================================================
 * Public statistics for the landing page.
 *
 * Two constraints shape everything here.
 *
 * FIRST, IT IS UNAUTHENTICATED. Anyone on the internet can call it as often as
 * they like, so it is served from a cache with a fixed TTL and the underlying
 * reads are views, not scans. An uncached public aggregate over a financial
 * ledger is a denial-of-service endpoint with a marketing label.
 *
 * SECOND, EVERY NUMBER IS A CLAIM. These figures appear next to the product's
 * promises, so a figure that cannot be substantiated is not rounded down or
 * defaulted to something flattering — it is null, and the UI omits it. There is
 * no field in this response that the platform could not evidence from the
 * ledger on request.
 * ========================================================================== */

@Injectable()
export class PublicService {
  private readonly log = new Logger(PublicService.name);

  constructor(
    @InjectRepository(Game) private readonly games: Repository<Game>,
    @InjectRepository(Tournament) private readonly tournaments: Repository<Tournament>,
    @InjectRepository(ConversionRate) private readonly rates: Repository<ConversionRate>,
    @InjectRepository(CommissionPlan) private readonly plans: Repository<CommissionPlan>,
    private readonly economy: EconomyConfigService,
    private readonly routines: DbRoutinesService,
    private readonly redis: RedisService,
  ) {}

  async stats(): Promise<PublicStatsResponse> {
    const cached = await this.redis.get<PublicStatsResponse>(CacheKeys.publicStats()).catch(() => null);
    if (cached) return cached;

    const stats = await this.compute();
    await this.redis.set(CacheKeys.publicStats(), stats, Ttl.publicStats).catch(() => undefined);
    return stats;
  }

  private async compute(): Promise<PublicStatsResponse> {
    const [kpis, liability, ratio, solvency, gamesLive, tournamentsRun, rate] = await Promise.all([
      this.routines.adminKpis(),
      this.routines.mttLiability(),
      this.routines.payoutRatio(monthKey()),
      this.routines.commissionSolvency(),
      this.games.count({ where: { active: true } }),
      this.tournaments.count({ where: { status: "completed" } }),
      /* The active rate, read directly. Going through ConversionService would
       * drag the whole conversion module — with its caps, locks and ledger
       * writes — into an anonymous endpoint that only needs one number. */
      this.rates.findOne({ where: { status: "active" }, order: { effectiveFrom: "DESC" } }),
    ]);

    return {
      /* Coerced: a MySQL COUNT over a view arrives as a string through the driver,
       * and a JSON number is what the contract promises. Left alone, one field
       * would be 4 and its neighbour "0", and the browser would sort them as text. */
      activeMembers30d: Number(kpis.activeMembers30d),
      totalMembers: Number(kpis.members),
      mttStaked: toDbAmount(liability.stakedMtt),
      tournamentsRun,
      gamesLive,
      revenueFundedPct: this.fundedPct(solvency.poolFundedMtt, solvency.committedMtt),
      payoutRatioPct: this.bpsToPct(ratio.commissionRatioBps),
      pointsPerMtt: rate?.pointsPerMtt ?? 0,
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * How much of what has been committed is covered by confirmed pool funding.
   *
   * Capped at 100: the pool is routinely funded ahead of commitments, and
   * "312% funded" invites the reading that members are owed three times what
   * they earned. Above full coverage the honest public claim is "fully funded".
   */
  private fundedPct(funded: string, committed: string): number | null {
    const c = dec(committed);
    if (c.lte(0)) return null;
    const pct = dec(funded).div(c).mul(100);
    return Number(pct.gt(100) ? "100.0" : pct.toFixed(1));
  }

  private bpsToPct(bps: number | null): number | null {
    if (bps === null || bps === undefined) return null;
    return Number(dec(bps).div(100).toFixed(1));
  }

  /**
   * The registration rules, from the constants the server actually enforces.
   *
   * Read from the same module the guards read, not re-declared here: two lists
   * that are supposed to agree will not, and the one in the wrong place is the
   * one that lets someone register from a sanctioned jurisdiction.
   */
  async config(): Promise<PublicConfigResponse> {
    const [plan, caps, rate] = await Promise.all([
      this.plans.findOne({ where: { status: "active" }, order: { version: "DESC" } }),
      this.economy.conversionCaps(),
      this.rates.findOne({ where: { status: "active" }, order: { effectiveFrom: "DESC" } }),
    ]);

    return {
      restrictedJurisdictions: [...RESTRICTED_JURISDICTIONS].sort(),
      globalMinimumAge: GLOBAL_MIN_AGE,
      jurisdictionMinimumAge: { ...JURISDICTION_MIN_AGE },
      password: {
        minLength: PASSWORD_MIN_LENGTH,
        maxLength: PASSWORD_MAX_LENGTH,
        rules: [
          `At least ${PASSWORD_MIN_LENGTH} characters`,
          "An uppercase and a lowercase letter",
          "A number",
          "A symbol",
          "Not your name, email or phone number",
          "Not a known breached or common password",
        ],
      },
      requiredLegalDocuments: ["terms", "privacy", "risk-disclosure"],
      referral: {
        /* Empty when no plan is active. A calculator with no rates shows nothing
         * rather than quoting a default nobody approved. */
        levels: plan
          ? [
              { level: 1, rateBps: plan.l1Bps },
              { level: 2, rateBps: plan.l2Bps },
              { level: 3, rateBps: plan.l3Bps },
            ].slice(0, plan.maxDepth)
          : [],
        eligibleTypes: plan?.eligibleTriggers ?? [],
        maxDepth: plan?.maxDepth ?? 0,
        monthlyCapAbsoluteMtt: toDbAmount(plan?.monthlyCapAbsolute ?? 0),
        /* Stored as a decimal string like "5.000000". A multiplier is small and
         * bounded, so a Number here cannot lose anything a reader would notice —
         * unlike the cap amounts beside it, which stay strings. */
        monthlyCapMultiplier: Number(plan?.capMultiplier ?? 0),
        monthlyCapBaseMtt: toDbAmount(plan?.capBase ?? 0),
        minAccountAgeDays: plan?.minAccountAgeDays ?? 0,
        minGameplaySessions: plan?.minGameplaySessions ?? 0,
      },
      conversion: {
        pointsPerMtt: rate?.pointsPerMtt ?? 0,
        perUserDailyPoints: String(caps.dailyPoints),
        perUserMonthlyPoints: String(caps.monthlyPoints),
        /* One MTT's worth is the floor: below that the conversion rounds to zero
         * and the member has spent Points for nothing. */
        minimumPoints: String(rate?.pointsPerMtt ?? 0),
      },
    };
  }
}
