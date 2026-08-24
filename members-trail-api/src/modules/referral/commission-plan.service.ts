import {
  BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CommissionPlan, RevenueEvent, type CommissionTrigger, type RevenueStream } from "@/database/entities";
import { EventBusService, Events } from "@/events";
import { economyConfig, type EconomyConfig } from "@/config/configuration";
import { RedisService } from "@/common/redis/redis.service";
import { CacheKeys, Ttl } from "@/common/redis/cache.keys";
import { Decimal, add, applyBps, dec, trailingMonths, fiat } from "@/common/utils";
import { AuditService } from "@/modules/audit/audit.service";
import {
  COMMISSION_ELIGIBLE_STREAMS, PAYOUT_RATIO_ALERT_BPS,
} from "@/modules/economy-config/economy-config.constants";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import {
  MAX_DEPTH, type PlanResponse, type PlanSimulationResponse, type ProposePlanRequest,
  type SimulatePlanRequest,
} from "./dto/commission.dto";

/* ============================================================================
 * The compensation plan (FRD AD-07).
 *
 * A plan is the rate card for the entire referral programme, so changing it is
 * the highest-leverage economic action an administrator can take. Three controls
 * apply, and none of them is decoration:
 *
 *  1. FOUR EYES. A plan is proposed by one person and approved by another. One
 *     compromised finance account cannot reprice every member's earnings.
 *
 *  2. SIMULATION BEFORE PUBLICATION. Approval is REFUSED for a plan whose
 *     projected liability exceeds the Treasury inflow the same revenue would
 *     produce. A plan that pays out more than it takes in is not aggressive
 *     marketing, it is a Ponzi structure, and the platform must be structurally
 *     incapable of publishing one.
 *
 *  3. VERSIONED, NEVER EDITED. Historical commissions keep pointing at the
 *     version that produced them, so "why was I paid 8%?" is answerable.
 *
 * Depth is hard-capped at 3 here as well as in the schema. Defence in depth on
 * the one number a regulator will ask about first.
 * ========================================================================== */

/** Months of history the simulator projects from. Three matches the trailing
 *  window the cap itself uses, so the two numbers are comparable. */
const SIMULATION_MONTHS = 3;

const LEVELS = [1, 2, 3] as const;

@Injectable()
export class CommissionPlanService {
  private readonly log = new Logger(CommissionPlanService.name);

  constructor(
    @InjectRepository(CommissionPlan) private readonly plans: Repository<CommissionPlan>,
    @InjectRepository(RevenueEvent) private readonly revenue: Repository<RevenueEvent>,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly bus: EventBusService,
    private readonly config: EconomyConfigService,
    @Inject(economyConfig.KEY) private readonly env: EconomyConfig,
  ) {}

  /* ==================================================================== *
   * Resolution
   * ==================================================================== */

  /**
   * The plan in force, or null.
   *
   * Null is a real answer, not a failure to find a default: with no approved
   * plan the engine calculates nothing. Falling back to env defaults here would
   * mean paying commission at rates nobody approved, which is precisely the
   * thing the four-eyes control exists to prevent.
   */
  async active(): Promise<CommissionPlan | null> {
    const cached = await this.redis.get<{ id: string }>(this.cacheKey());
    if (cached) {
      const row = await this.plans.findOne({ where: { id: cached.id } });
      if (row && (row.status === "active" || row.status === "scheduled")) return row;
      await this.redis.del(this.cacheKey());
    }

    const rows = await this.plans.find({
      where: [{ status: "active" }, { status: "scheduled" }],
      order: { effectiveFrom: "DESC", version: "DESC" },
      take: 20,
    });
    const now = Date.now();
    const row = rows.find((p) => p.effectiveFrom.getTime() <= now) ?? null;
    if (!row) {
      this.log.warn("no approved commission plan is in force — no commission will be calculated");
      return null;
    }

    /* A scheduled plan whose time has come is promoted on first use, so the
     * transition does not depend on a cron having run. */
    if (row.status === "scheduled") await this.promote(row);

    await this.redis.set(this.cacheKey(), { id: row.id }, Ttl.platformConfig);
    return row;
  }

  /** Rate for a level, from the plan. Levels beyond the plan's depth earn zero. */
  rateFor(plan: CommissionPlan, level: number): number {
    if (level > Math.min(plan.maxDepth, MAX_DEPTH)) return 0;
    return { 1: plan.l1Bps, 2: plan.l2Bps, 3: plan.l3Bps }[level] ?? 0;
  }

  async list(limit = 50): Promise<PlanResponse[]> {
    const rows = await this.plans.find({
      order: { version: "DESC" },
      take: Math.min(limit, 200),
    });
    return rows.map(toPlanView);
  }

  /* ==================================================================== *
   * Simulation
   * ==================================================================== */

  /**
   * Projects the liability a plan would create against the Treasury inflow the
   * same revenue produces.
   *
   * Deliberately an UPPER bound: monthly caps are ignored, so the projection
   * cannot flatter a plan by assuming caps will save it. A plan that is only
   * solvent because members hit their caps is not solvent.
   *
   * Per-level revenue is measured, not assumed: revenue only creates a level-3
   * liability if the spender actually has a third-tier ancestor, and early in a
   * platform's life most of them do not.
   */
  async simulate(input: SimulatePlanRequest): Promise<PlanSimulationResponse> {
    const { start } = trailingMonths(SIMULATION_MONTHS);
    const notes: string[] = [];

    const eligibleStreams = triggersToStreams(input.eligibleTriggers);
    if (eligibleStreams.length === 0) {
      notes.push("No eligible triggers selected: this plan would pay no commission at all.");
    }

    /* Revenue per level, counting only events whose spender genuinely has an
     * ancestor at that level. */
    const perLevel: string[] = [];
    for (const level of LEVELS) {
      if (level > Math.min(input.maxDepth, MAX_DEPTH) || eligibleStreams.length === 0) {
        /* Fiat throughout this projection: 2dp, consistent with every other
         * amount in it. */
        perLevel.push(fiat(0));
        continue;
      }
      const raw = await this.revenue
        .createQueryBuilder("e")
        .select("COALESCE(SUM(e.netAmount), 0)", "sum")
        .where("e.reconciled = true")
        .andWhere("e.commissionEligible = true")
        .andWhere("e.reversedAt IS NULL")
        .andWhere("e.stream IN (:...streams)", { streams: eligibleStreams })
        .andWhere("e.occurredAt >= :start", { start })
        .andWhere(
          "EXISTS (SELECT 1 FROM referral_edges edge WHERE edge.userId = e.userId AND edge.level = :level)",
          { level },
        )
        .getRawOne<{ sum: string | null }>();
      perLevel.push(fiat(raw?.sum ?? 0));
    }

    const totalRaw = await this.revenue
      .createQueryBuilder("e")
      .select("COALESCE(SUM(e.netAmount), 0)", "sum")
      .where("e.reconciled = true")
      .andWhere("e.commissionEligible = true")
      .andWhere("e.reversedAt IS NULL")
      .andWhere("e.occurredAt >= :start", { start })
      .getRawOne<{ sum: string | null }>();
    const eligibleRevenue = fiat(totalRaw?.sum ?? 0);

    const rates = [input.l1Bps, input.l2Bps, input.l3Bps];
    const projectedLiability = perLevel.reduce(
      (acc, revenue, i) => fiat(add(acc, applyBps(revenue, rates[i]))),
      fiat(0),
    );

    /* The Treasury takes an allocation of the same revenue, per stream. */
    const { allocationBps } = await this.config.treasuryAllocation();
    const byStream = await this.revenue
      .createQueryBuilder("e")
      .select("e.stream", "stream")
      .addSelect("COALESCE(SUM(e.netAmount), 0)", "sum")
      .where("e.reconciled = true")
      .andWhere("e.reversedAt IS NULL")
      .andWhere("e.occurredAt >= :start", { start })
      .groupBy("e.stream")
      .getRawMany<{ stream: RevenueStream; sum: string }>();

    const projectedTreasuryInflow = byStream.reduce(
      (acc, r) => fiat(add(acc, applyBps(r.sum, allocationBps[r.stream] ?? 0))),
      fiat(0),
    );

    const payoutRatioBps = dec(projectedTreasuryInflow).lte(0)
      ? dec(projectedLiability).lte(0)
        ? 0
        : /* Liability with no inflow is unbounded insolvency, not a big number. */
          Number.MAX_SAFE_INTEGER
      : Number(
          dec(projectedLiability).div(dec(projectedTreasuryInflow)).mul(10_000)
            .toFixed(0, Decimal.ROUND_HALF_UP),
        );

    if (dec(eligibleRevenue).lte(0)) {
      notes.push(
        "No reconciled commission-eligible revenue in the sample window: this projection is " +
        "structural only and cannot be used to judge solvency.",
      );
    }
    if (dec(projectedTreasuryInflow).lte(0) && dec(projectedLiability).gt(0)) {
      notes.push("This plan creates a liability with no Treasury inflow to fund it.");
    }
    notes.push("Monthly caps are ignored: this is an upper bound on liability, by design.");

    return {
      monthsSampled: SIMULATION_MONTHS,
      eligibleRevenue,
      revenueWithUplinePerLevel: perLevel,
      projectedLiability,
      projectedTreasuryInflow,
      payoutRatioBps,
      solvent: payoutRatioBps < 10_000,
      breachesAlertThreshold: payoutRatioBps >= PAYOUT_RATIO_ALERT_BPS,
      notes,
    };
  }

  /* ==================================================================== *
   * Lifecycle
   * ==================================================================== */

  async propose(dto: ProposePlanRequest, actorId: string, ip: string | null): Promise<PlanResponse> {
    const effectiveFrom = new Date(dto.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime())) {
      throw new BadRequestException("effectiveFrom is not a valid instant");
    }
    if (effectiveFrom.getTime() <= Date.now()) {
      /* Backdating would retroactively change the rate applied to commissions
       * that have already been calculated and, in some cases, paid. */
      throw new BadRequestException({
        code: "PLAN_NOT_FUTURE",
        message: "effectiveFrom must be in the future — a plan can never be backdated",
      });
    }
    if (dto.maxDepth > MAX_DEPTH) {
      throw new BadRequestException({
        code: "DEPTH_EXCEEDED",
        message: `Depth is capped at ${MAX_DEPTH}. There is no level 4.`,
      });
    }
    if (dec(dto.capMultiplier).isNegative() || dec(dto.capBase).isNegative()) {
      throw new BadRequestException("Cap parameters cannot be negative");
    }

    /* Simulated at proposal time and stored on the row, so the approver reviews
     * the same projection the proposer saw. */
    const simulation = await this.simulate(dto);

    const latest = await this.plans.findOne({ order: { version: "DESC" }, where: {} });
    const row = await this.plans.save(
      this.plans.create({
        version: (latest?.version ?? 0) + 1,
        l1Bps: dto.l1Bps,
        l2Bps: dto.l2Bps,
        l3Bps: dto.l3Bps,
        maxDepth: Math.min(dto.maxDepth, MAX_DEPTH),
        eligibleTriggers: dto.eligibleTriggers,
        monthlyCapAbsolute: fiat(dto.monthlyCapAbsolute),
        capMultiplier: dec(dto.capMultiplier).toFixed(2, Decimal.ROUND_DOWN),
        capBase: fiat(dto.capBase),
        minAccountAgeDays: dto.minAccountAgeDays,
        minGameplaySessions: dto.minGameplaySessions,
        status: "pending_approval",
        effectiveFrom,
        proposedById: actorId,
        simulationSnapshot: simulation as unknown as Record<string, unknown>,
        rationale: dto.rationale,
      }),
    );

    await this.audit.recordOrThrow({
      actorId,
      action: "commission.plan.propose",
      targetType: "commission_plan",
      targetId: row.id,
      after: {
        version: row.version, l1Bps: row.l1Bps, l2Bps: row.l2Bps, l3Bps: row.l3Bps,
        maxDepth: row.maxDepth, payoutRatioBps: simulation.payoutRatioBps,
        solvent: simulation.solvent,
      },
      reason: dto.rationale,
      ip,
      requiredSecondApproval: true,
    });

    await this.bus.publish(Events.ApprovalRequested, {
      kind: "commission_plan",
      targetId: row.id,
      requestedById: actorId,
      summary: `Commission plan v${row.version} (${row.l1Bps}/${row.l2Bps}/${row.l3Bps} bps)`,
      payoutRatioBps: simulation.payoutRatioBps,
      solvent: simulation.solvent,
    });

    return toPlanView(row);
  }

  /**
   * Approves a plan.
   *
   * Two refusals, both unconditional:
   *   • the approver may not be the proposer;
   *   • an insolvent projection cannot be published, at all, by anyone.
   *
   * The second is re-simulated here rather than trusted from the stored
   * snapshot: revenue has moved since the proposal, and the number that matters
   * is the one true at the moment of publication.
   */
  async approve(
    id: string,
    note: string | null,
    approverId: string,
    ip: string | null,
  ): Promise<PlanResponse> {
    const row = await this.plans.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Plan not found");
    if (row.status !== "pending_approval") {
      throw new BadRequestException({
        code: "PLAN_NOT_PENDING",
        message: `This plan is ${row.status} and can no longer be approved`,
      });
    }
    if (row.proposedById === approverId) {
      throw new ForbiddenException({
        code: "FOUR_EYES_VIOLATION",
        message: "A commission plan must be approved by someone other than the person who proposed it",
      });
    }

    const simulation = await this.simulate({
      l1Bps: row.l1Bps,
      l2Bps: row.l2Bps,
      l3Bps: row.l3Bps,
      maxDepth: row.maxDepth,
      eligibleTriggers: row.eligibleTriggers,
      monthlyCapAbsolute: row.monthlyCapAbsolute,
      capMultiplier: row.capMultiplier,
      capBase: row.capBase,
      minAccountAgeDays: row.minAccountAgeDays,
      minGameplaySessions: row.minGameplaySessions,
    });

    if (!simulation.solvent) {
      throw new ForbiddenException({
        code: "PLAN_INSOLVENT",
        message:
          "Refused: this plan projects a commission liability greater than the Treasury inflow " +
          "the same revenue produces. A payout structure that cannot be funded from real revenue " +
          "may not be published.",
        payoutRatioBps: simulation.payoutRatioBps,
        projectedLiability: simulation.projectedLiability,
        projectedTreasuryInflow: simulation.projectedTreasuryInflow,
      });
    }

    const before = { status: row.status, approvedById: row.approvedById ?? null };

    row.approvedById = approverId;
    row.approvedAt = new Date();
    row.simulationSnapshot = simulation as unknown as Record<string, unknown>;
    row.status = row.effectiveFrom.getTime() <= Date.now() ? "active" : "scheduled";
    await this.plans.save(row);

    if (row.status === "active") await this.promote(row);
    await this.redis.del(this.cacheKey());

    await this.audit.recordOrThrow({
      actorId: approverId,
      action: "commission.plan.approve",
      targetType: "commission_plan",
      targetId: row.id,
      before,
      after: {
        status: row.status, version: row.version,
        payoutRatioBps: simulation.payoutRatioBps,
        breachesAlertThreshold: simulation.breachesAlertThreshold,
      },
      reason: note ?? row.rationale ?? null,
      ip,
      approvedById: approverId,
    });

    if (simulation.breachesAlertThreshold) {
      /* Solvent but close to the line. Publishing is allowed; doing it quietly
       * is not. */
      await this.bus.publish(Events.PayoutRatioBreach, {
        source: "commission_plan_approval",
        planId: row.id,
        version: row.version,
        payoutRatioBps: simulation.payoutRatioBps,
        thresholdBps: PAYOUT_RATIO_ALERT_BPS,
      });
    }

    await this.bus.publish(Events.ApprovalDecided, {
      kind: "commission_plan",
      targetId: row.id,
      decision: "approved",
      decidedById: approverId,
      version: row.version,
    });

    return toPlanView(row);
  }

  async reject(
    id: string,
    reason: string,
    approverId: string,
    ip: string | null,
  ): Promise<PlanResponse> {
    const row = await this.plans.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Plan not found");
    if (row.status !== "pending_approval") {
      throw new BadRequestException({
        code: "PLAN_NOT_PENDING",
        message: `This plan is ${row.status} and can no longer be rejected`,
      });
    }
    if (row.proposedById === approverId) {
      throw new ForbiddenException({
        code: "FOUR_EYES_VIOLATION",
        message: "A plan must be reviewed by someone other than its proposer",
      });
    }

    row.status = "rejected";
    row.approvedById = approverId;
    row.approvedAt = new Date();
    row.rationale = `${row.rationale ?? ""}\n\nRejected: ${reason}`.trim();
    await this.plans.save(row);

    await this.audit.recordOrThrow({
      actorId: approverId,
      action: "commission.plan.reject",
      targetType: "commission_plan",
      targetId: row.id,
      after: { status: "rejected" },
      reason,
      ip,
    });

    await this.bus.publish(Events.ApprovalDecided, {
      kind: "commission_plan",
      targetId: row.id,
      decision: "rejected",
      decidedById: approverId,
      reason,
    });

    return toPlanView(row);
  }

  /** The env defaults, offered as a starting point for a first proposal. */
  defaults(): SimulatePlanRequest {
    return {
      l1Bps: this.env.commission.l1Bps,
      l2Bps: this.env.commission.l2Bps,
      l3Bps: this.env.commission.l3Bps,
      maxDepth: Math.min(this.env.commission.maxDepth, MAX_DEPTH),
      eligibleTriggers: ["iap", "tournament_entry", "subscription"],
      monthlyCapAbsolute: fiat(this.env.commission.monthlyCapAbsolute),
      capMultiplier: String(this.env.commission.capMultiplier),
      capBase: fiat(this.env.commission.capBase),
      minAccountAgeDays: this.env.commission.minAccountAgeDays,
      minGameplaySessions: this.env.commission.minSessions,
    };
  }

  /* ------------------------------------------------------------------ */

  private async promote(row: CommissionPlan): Promise<void> {
    const previous = await this.plans.find({ where: { status: "active" } });
    for (const p of previous) {
      if (p.id === row.id) continue;
      p.status = "superseded";
      await this.plans.save(p);
    }
    row.status = "active";
    await this.plans.save(row);
    await this.redis.del(this.cacheKey());
    this.log.log(`commission plan v${row.version} active (${row.l1Bps}/${row.l2Bps}/${row.l3Bps} bps)`);
  }

  /** Derived from the platform-config key family rather than inventing a key. */
  private cacheKey(): string {
    return CacheKeys.platformConfig("commission.plan");
  }
}

/** Which revenue streams a set of commission triggers corresponds to. */
export function triggersToStreams(triggers: CommissionTrigger[]): RevenueStream[] {
  const map: Record<CommissionTrigger, RevenueStream> = {
    iap: "iap",
    tournament_entry: "tournament",
    subscription: "subscription",
  };
  return triggers
    .map((t) => map[t])
    .filter((s): s is RevenueStream => Boolean(s) && COMMISSION_ELIGIBLE_STREAMS.includes(s));
}

/** The reverse mapping: the trigger a revenue stream produces, if any. */
export function streamToTrigger(stream: RevenueStream): CommissionTrigger | null {
  return (
    {
      iap: "iap" as CommissionTrigger,
      tournament: "tournament_entry" as CommissionTrigger,
      subscription: "subscription" as CommissionTrigger,
      marketplace: null,
      advertising: null,
    }[stream] ?? null
  );
}

function toPlanView(p: CommissionPlan): PlanResponse {
  return {
    id: p.id,
    version: p.version,
    l1Bps: p.l1Bps,
    l2Bps: p.l2Bps,
    l3Bps: p.l3Bps,
    maxDepth: p.maxDepth,
    eligibleTriggers: p.eligibleTriggers,
    monthlyCapAbsolute: p.monthlyCapAbsolute,
    capMultiplier: p.capMultiplier,
    capBase: p.capBase,
    minAccountAgeDays: p.minAccountAgeDays,
    minGameplaySessions: p.minGameplaySessions,
    status: p.status,
    effectiveFrom: p.effectiveFrom.toISOString(),
    proposedById: p.proposedById,
    approvedById: p.approvedById ?? null,
    approvedAt: p.approvedAt ? p.approvedAt.toISOString() : null,
    simulationSnapshot: (p.simulationSnapshot as unknown as PlanSimulationResponse | null) ?? null,
    rationale: p.rationale ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}
