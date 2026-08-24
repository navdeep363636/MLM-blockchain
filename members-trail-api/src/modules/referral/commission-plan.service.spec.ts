import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import { CommissionPlan, RevenueEvent } from "@/database/entities";
import type { CommissionTrigger } from "@/database/entities";
import { EventBusService } from "@/events";
import { economyConfig } from "@/config/configuration";
import { RedisService } from "@/common/redis/redis.service";
import { AuditService } from "@/modules/audit/audit.service";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import { CommissionPlanService, streamToTrigger, triggersToStreams } from "./commission-plan.service";

/* ============================================================================
 * A plan change reprices every member's earnings, so two controls guard it and
 * this file is the proof that both hold:
 *
 *   • FOUR EYES — the approver may never be the proposer.
 *   • SOLVENCY — a plan projecting more liability than the Treasury takes in
 *     CANNOT be published, by anyone, under any override.
 *
 * The second is the one that makes the difference between a referral programme
 * and a Ponzi structure. It is re-simulated at approval time, not trusted from
 * the proposal, because revenue moves in between.
 * ========================================================================== */

const FUTURE = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

function repo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
    save: jest.fn(async (x: unknown) => ({
      id: "plan-new", createdAt: new Date("2026-02-01T00:00:00Z"), ...(x as object),
    })),
    create: jest.fn((x: unknown) => x),
    createQueryBuilder: jest.fn(),
  };
}

/** Query-builder mock that answers per-level revenue and per-stream totals. */
function qb(opts: { rawOne?: Record<string, unknown>; rawMany?: Record<string, unknown>[] }) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "addSelect", "where", "andWhere", "groupBy", "orderBy", "take"]) {
    b[m] = jest.fn(() => b);
  }
  b.getRawOne = jest.fn(async () => opts.rawOne ?? { sum: "0" });
  b.getRawMany = jest.fn(async () => opts.rawMany ?? []);
  return b;
}

const TRIGGERS: CommissionTrigger[] = ["iap", "tournament_entry", "subscription"];

const PLAN_INPUT = {
  l1Bps: 800,
  l2Bps: 300,
  l3Bps: 100,
  maxDepth: 3,
  eligibleTriggers: TRIGGERS,
  monthlyCapAbsolute: "5000.00",
  capMultiplier: "5.00",
  capBase: "100.00",
  minAccountAgeDays: 7,
  minGameplaySessions: 5,
};

describe("CommissionPlanService", () => {
  let svc: CommissionPlanService;
  let plans: ReturnType<typeof repo>;
  let revenue: ReturnType<typeof repo>;
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let audit: { record: jest.Mock; recordOrThrow: jest.Mock };
  let bus: { publish: jest.Mock };
  let config: { treasuryAllocation: jest.Mock };

  /** Revenue the simulator sees: per-level upline coverage and per-stream totals. */
  let revenuePerLevel: string;
  let revenueByStream: { stream: string; sum: string }[];

  beforeEach(async () => {
    plans = repo();
    revenue = repo();
    revenuePerLevel = "10000.00";
    revenueByStream = [{ stream: "iap", sum: "10000.00" }];

    redis = { get: jest.fn(async () => null), set: jest.fn(), del: jest.fn() };
    audit = { record: jest.fn(), recordOrThrow: jest.fn() };
    bus = { publish: jest.fn() };
    /* 30% of net revenue goes to the Treasury for iap. */
    config = {
      treasuryAllocation: jest.fn(async () => ({
        allocationBps: { iap: 3_000, tournament: 3_000, subscription: 3_000, marketplace: 5_000, advertising: 5_000 },
        fiatPerMtt: "1.00",
        reserveBps: 1_500,
      })),
    };

    const mod = await Test.createTestingModule({
      providers: [
        CommissionPlanService,
        { provide: getRepositoryToken(CommissionPlan), useValue: plans },
        { provide: getRepositoryToken(RevenueEvent), useValue: revenue },
        { provide: RedisService, useValue: redis },
        { provide: AuditService, useValue: audit },
        { provide: EventBusService, useValue: bus },
        { provide: EconomyConfigService, useValue: config },
        {
          provide: economyConfig.KEY,
          useValue: {
            commission: {
              l1Bps: 800, l2Bps: 300, l3Bps: 100, maxDepth: 3,
              monthlyCapAbsolute: 5_000, capMultiplier: 5, capBase: 100,
              minAccountAgeDays: 7, minSessions: 5,
            },
          },
        },
      ],
    }).compile();

    svc = mod.get(CommissionPlanService);
    revenue.createQueryBuilder.mockImplementation(() =>
      qb({ rawOne: { sum: revenuePerLevel }, rawMany: revenueByStream }),
    );
  });

  /* ==================================================================== *
   * Simulation
   * ==================================================================== */

  describe("simulate", () => {
    it("projects liability from measured per-level upline coverage, not an assumption", async () => {
      const s = await svc.simulate(PLAN_INPUT);
      /* All three levels see 10,000 of covered revenue: 8% + 3% + 1% = 1,200. */
      expect(s.projectedLiability).toBe("1200.00");
      expect(s.revenueWithUplinePerLevel).toEqual(["10000.00", "10000.00", "10000.00"]);
    });

    it("compares liability against the Treasury allocation the same revenue produces", async () => {
      const s = await svc.simulate(PLAN_INPUT);
      /* 30% of 10,000 = 3,000 into the Treasury; 1,200 out = 4,000 bps. */
      expect(s.projectedTreasuryInflow).toBe("3000.00");
      expect(s.payoutRatioBps).toBe(4_000);
      expect(s.solvent).toBe(true);
    });

    it("marks a plan that pays out more than it takes in as INSOLVENT", async () => {
      /* 40% + 30% + 20% = 90% of 10,000 = 9,000 out against 3,000 in. */
      const s = await svc.simulate({ ...PLAN_INPUT, l1Bps: 4_000, l2Bps: 3_000, l3Bps: 2_000 });
      expect(s.solvent).toBe(false);
      expect(s.payoutRatioBps).toBeGreaterThan(10_000);
    });

    it("flags a solvent plan that still breaches the compliance alert threshold", async () => {
      /* 27.5% of 10,000 = 2,750 against 3,000 = 9,166 bps: solvent, but loud. */
      const s = await svc.simulate({ ...PLAN_INPUT, l1Bps: 2_000, l2Bps: 500, l3Bps: 250 });
      expect(s.solvent).toBe(true);
      expect(s.breachesAlertThreshold).toBe(true);
    });

    it("treats liability with no inflow as unbounded insolvency, not a large ratio", async () => {
      revenueByStream = [];
      const s = await svc.simulate(PLAN_INPUT);
      expect(s.projectedTreasuryInflow).toBe("0.00");
      expect(s.solvent).toBe(false);
      expect(s.notes.join(" ")).toContain("no Treasury inflow");
    });

    it("ignores levels beyond the plan's depth", async () => {
      const s = await svc.simulate({ ...PLAN_INPUT, maxDepth: 1 });
      expect(s.revenueWithUplinePerLevel[1]).toBe("0.00");
      expect(s.revenueWithUplinePerLevel[2]).toBe("0.00");
      /* Only the 8% level 1 liability remains. */
      expect(s.projectedLiability).toBe("800.00");
    });

    it("projects nothing at all when no trigger is eligible, and says so", async () => {
      const s = await svc.simulate({ ...PLAN_INPUT, eligibleTriggers: [] });
      expect(s.projectedLiability).toBe("0.00");
      expect(s.notes.join(" ")).toContain("no commission at all");
    });

    it("states that caps are ignored, so the figure is read as an upper bound", async () => {
      const s = await svc.simulate(PLAN_INPUT);
      expect(s.notes.join(" ")).toContain("upper bound");
    });

    it("warns that a projection from no eligible revenue cannot judge solvency", async () => {
      revenuePerLevel = "0";
      revenueByStream = [{ stream: "iap", sum: "0" }];
      const s = await svc.simulate(PLAN_INPUT);
      expect(s.notes.join(" ")).toContain("structural only");
    });
  });

  /* ==================================================================== *
   * Propose
   * ==================================================================== */

  describe("propose", () => {
    it("creates the version as pending_approval and stores the simulation for the approver", async () => {
      const r = await svc.propose(
        { ...PLAN_INPUT, effectiveFrom: FUTURE(), rationale: "launch compensation plan" },
        "finance-1",
        "1.2.3.4",
      );

      expect(r.status).toBe("pending_approval");
      expect(r.simulationSnapshot?.payoutRatioBps).toBe(4_000);
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ requiredSecondApproval: true }),
      );
    });

    it("REFUSES a backdated plan — that would reprice commissions already paid", async () => {
      await expect(
        svc.propose(
          { ...PLAN_INPUT, effectiveFrom: "2020-01-01T00:00:00Z", rationale: "retroactive raise" },
          "finance-1",
          null,
        ),
      ).rejects.toMatchObject({ response: { code: "PLAN_NOT_FUTURE" } });
    });

    it("REFUSES a depth beyond 3 — there is no level 4", async () => {
      await expect(
        svc.propose(
          { ...PLAN_INPUT, maxDepth: 4, effectiveFrom: FUTURE(), rationale: "deeper structure" },
          "finance-1",
          null,
        ),
      ).rejects.toMatchObject({ response: { code: "DEPTH_EXCEEDED" } });
    });

    it("rejects negative cap parameters", async () => {
      await expect(
        svc.propose(
          { ...PLAN_INPUT, capBase: "-100", effectiveFrom: FUTURE(), rationale: "negative base" },
          "finance-1",
          null,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("increments the version rather than editing the previous plan", async () => {
      plans.findOne.mockResolvedValue({ version: 4 });
      const r = await svc.propose(
        { ...PLAN_INPUT, effectiveFrom: FUTURE(), rationale: "quarterly revision" },
        "finance-1",
        null,
      );
      expect(r.version).toBe(5);
    });
  });

  /* ==================================================================== *
   * Approve — the two hard refusals
   * ==================================================================== */

  describe("approve", () => {
    const pending = (over: Partial<CommissionPlan> = {}) =>
      ({
        id: "plan-9",
        version: 2,
        ...PLAN_INPUT,
        status: "pending_approval",
        effectiveFrom: new Date(Date.now() + 7 * 86_400_000),
        proposedById: "finance-1",
        approvedById: null,
        approvedAt: null,
        rationale: "quarterly revision",
        createdAt: new Date("2026-02-01T00:00:00Z"),
        ...over,
      }) as unknown as CommissionPlan;

    it("REFUSES when the approver is the proposer", async () => {
      plans.findOne.mockResolvedValue(pending());
      await expect(svc.approve("plan-9", null, "finance-1", null))
        .rejects.toMatchObject({ response: { code: "FOUR_EYES_VIOLATION" } });
    });

    it("REFUSES an insolvent plan — no approver, override or role can publish one", async () => {
      plans.findOne.mockResolvedValue(pending({ l1Bps: 4_000, l2Bps: 3_000, l3Bps: 2_000 }));
      await expect(svc.approve("plan-9", "growth push", "finance-2", null))
        .rejects.toMatchObject({ response: { code: "PLAN_INSOLVENT" } });
      expect(plans.save).not.toHaveBeenCalled();
    });

    it("RE-SIMULATES at approval time, so a revenue collapse since proposal blocks it", async () => {
      plans.findOne.mockResolvedValue(pending());
      /* Revenue has since disappeared: the projection is now unfundable. */
      revenueByStream = [];
      await expect(svc.approve("plan-9", null, "finance-2", null))
        .rejects.toMatchObject({ response: { code: "PLAN_INSOLVENT" } });
    });

    it("schedules a future-dated plan rather than applying it immediately", async () => {
      plans.findOne.mockResolvedValue(pending());
      const r = await svc.approve("plan-9", "reviewed the projection", "finance-2", null);
      expect(r.status).toBe("scheduled");
      expect(r.approvedById).toBe("finance-2");
    });

    it("activates immediately when the effective window has already opened", async () => {
      plans.findOne.mockResolvedValue(pending({ effectiveFrom: new Date(Date.now() - 1_000) }));
      plans.find.mockResolvedValue([]);
      const r = await svc.approve("plan-9", null, "finance-2", null);
      expect(r.status).toBe("active");
    });

    it("supersedes the incumbent so exactly one plan is ever active", async () => {
      plans.findOne.mockResolvedValue(pending({ effectiveFrom: new Date(Date.now() - 1_000) }));
      plans.find.mockResolvedValue([{ id: "plan-old", status: "active" }]);

      await svc.approve("plan-9", null, "finance-2", null);

      expect(plans.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: "plan-old", status: "superseded" }),
      );
    });

    it("publishes a payout-ratio alert when a solvent plan sits close to the line", async () => {
      plans.findOne.mockResolvedValue(pending({ l1Bps: 2_000, l2Bps: 500, l3Bps: 250 }));
      await svc.approve("plan-9", null, "finance-2", null);

      const alert = (bus.publish.mock.calls as [string, Record<string, unknown>][])
        .find(([n]) => n === "treasury.payout_ratio_breach");
      expect(alert?.[1]).toMatchObject({ source: "commission_plan_approval" });
    });

    it("stores the approval-time simulation on the row, not the proposal-time one", async () => {
      plans.findOne.mockResolvedValue(pending());
      const r = await svc.approve("plan-9", null, "finance-2", null);
      expect(r.simulationSnapshot?.payoutRatioBps).toBe(4_000);
    });

    it("refuses to approve a plan that is no longer pending", async () => {
      plans.findOne.mockResolvedValue(pending({ status: "active" }));
      await expect(svc.approve("plan-9", null, "finance-2", null))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it("busts the plan cache so the engine picks up the new rates", async () => {
      plans.findOne.mockResolvedValue(pending());
      await svc.approve("plan-9", null, "finance-2", null);
      expect(redis.del).toHaveBeenCalled();
    });
  });

  describe("reject", () => {
    it("requires a different reviewer, exactly like approval", async () => {
      plans.findOne.mockResolvedValue({
        id: "plan-9", status: "pending_approval", proposedById: "finance-1",
        effectiveFrom: new Date(), createdAt: new Date(), ...PLAN_INPUT,
      });
      await expect(svc.reject("plan-9", "not now", "finance-1", null))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it("records the rejection in the rationale so the history explains itself", async () => {
      plans.findOne.mockResolvedValue({
        id: "plan-9", status: "pending_approval", proposedById: "finance-1",
        rationale: "growth push", effectiveFrom: new Date(), createdAt: new Date(), ...PLAN_INPUT,
      });
      const r = await svc.reject("plan-9", "wait for Q3 numbers", "finance-2", null);
      expect(r.status).toBe("rejected");
      expect(r.rationale).toContain("wait for Q3 numbers");
    });
  });

  /* ==================================================================== *
   * Resolution
   * ==================================================================== */

  describe("active", () => {
    it("returns null when nothing is approved — the engine then pays nothing", async () => {
      plans.find.mockResolvedValue([]);
      expect(await svc.active()).toBeNull();
    });

    it("ignores a plan whose effective date has not arrived", async () => {
      plans.find.mockResolvedValue([
        { id: "p1", status: "scheduled", effectiveFrom: new Date(Date.now() + 86_400_000), version: 2 },
      ]);
      expect(await svc.active()).toBeNull();
    });

    it("promotes a scheduled plan whose time has come, without waiting for a cron", async () => {
      plans.find.mockImplementation(async (...args: unknown[]) =>
        Array.isArray((args[0] as { where?: unknown } | undefined)?.where)
          ? [{ id: "p1", status: "scheduled", effectiveFrom: new Date(Date.now() - 1_000), version: 2, l1Bps: 800, l2Bps: 300, l3Bps: 100 }]
          : [],
      );
      const p = await svc.active();
      expect(p?.status).toBe("active");
    });
  });

  describe("rateFor", () => {
    const plan = { l1Bps: 800, l2Bps: 300, l3Bps: 100, maxDepth: 3 } as CommissionPlan;

    it("returns the level's rate", () => {
      expect(svc.rateFor(plan, 1)).toBe(800);
      expect(svc.rateFor(plan, 2)).toBe(300);
      expect(svc.rateFor(plan, 3)).toBe(100);
    });

    it("returns zero beyond the plan's depth", () => {
      expect(svc.rateFor({ ...plan, maxDepth: 1 }, 2)).toBe(0);
    });

    it("returns zero for a level that does not exist, even if the plan claims deeper", () => {
      expect(svc.rateFor({ ...plan, maxDepth: 9 }, 4)).toBe(0);
    });
  });

  describe("stream ↔ trigger mapping", () => {
    it("maps only genuine purchase streams to a commission trigger", () => {
      expect(streamToTrigger("iap")).toBe("iap");
      expect(streamToTrigger("tournament")).toBe("tournament_entry");
      expect(streamToTrigger("subscription")).toBe("subscription");
    });

    it("maps marketplace and advertising to nothing — they are not a member's purchase", () => {
      expect(streamToTrigger("marketplace")).toBeNull();
      expect(streamToTrigger("advertising")).toBeNull();
    });

    it("converts triggers back to the streams that produce them", () => {
      expect(triggersToStreams(TRIGGERS)).toEqual(["iap", "tournament", "subscription"]);
    });
  });
});
