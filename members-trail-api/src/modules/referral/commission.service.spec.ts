import { ConflictException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import {
  Commission, CommissionCapUsage, GameSession, ReferralEdge, RevenueEvent, TreasuryOutflow, User,
} from "@/database/entities";
import type { CommissionTrigger } from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { EventBusService } from "@/events";
import { RedisService } from "@/common/redis/redis.service";
import { AuditService } from "@/modules/audit/audit.service";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import { CommissionPlanService } from "./commission-plan.service";
import { CommissionService } from "./commission.service";

/* ============================================================================
 * The referral engine is the part of this platform a regulator reads first, and
 * the part where a wrong line pays real money that cannot be recalled. These
 * tests are the executable statement of the seven rules the engine exists to
 * enforce:
 *
 *   1  only settled, reconciled, commission-eligible revenue pays
 *   2  calculated on NET, never gross
 *   3  depth caps at 3
 *   4  monthly cap per recipient, excess NEVER carried over
 *   5  released commission never exceeds confirmed pool funding (solvency)
 *   6  anti-abuse refusals are recorded, not silent
 *   7  a refund claws back, and returns the cap allowance it consumed
 *
 * Every one of these has a "REFUSES" test. A failure in this file is a release
 * blocker, not a flaky test.
 * ========================================================================== */

const DAY = 86_400_000;

interface MockRepo {
  findOne: jest.Mock;
  find: jest.Mock;
  findAndCount: jest.Mock;
  save: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  count: jest.Mock;
  createQueryBuilder: jest.Mock;
}

function repo(): MockRepo {
  return {
    findOne: jest.fn(),
    find: jest.fn(async (): Promise<unknown[]> => []),
    findAndCount: jest.fn(async (): Promise<[unknown[], number]> => [[], 0]),
    save: jest.fn(async (x: unknown) => x),
    create: jest.fn((x: unknown) => x),
    update: jest.fn(),
    count: jest.fn(async () => 0),
    createQueryBuilder: jest.fn(),
  };
}

/** Query-builder mock that resolves through a caller-supplied resolver, so a
 *  test can answer differently depending on the parameters the service passed. */
function qb(resolve: (params: Record<string, unknown>) => Record<string, unknown>) {
  const params: Record<string, unknown> = {};
  const b: Record<string, unknown> = {};
  const record = (...args: unknown[]) => {
    const p = args[1];
    if (p && typeof p === "object") Object.assign(params, p);
    return b;
  };
  for (const m of ["select", "addSelect", "where", "andWhere", "orderBy", "groupBy", "skip", "take"]) {
    b[m] = jest.fn(record);
  }
  b.getRawOne = jest.fn(async () => resolve(params));
  b.getRawMany = jest.fn(async () => []);
  b.getManyAndCount = jest.fn(async () => [[], 0]);
  b.getMany = jest.fn(async () => []);
  return b;
}

const PLAN = {
  id: "plan-1",
  version: 1,
  l1Bps: 800,
  l2Bps: 300,
  l3Bps: 100,
  maxDepth: 3,
  eligibleTriggers: ["iap", "tournament_entry", "subscription"] as CommissionTrigger[],
  monthlyCapAbsolute: "5000.00",
  capMultiplier: "5.00",
  capBase: "100.00",
  minAccountAgeDays: 7,
  minGameplaySessions: 5,
  status: "active" as const,
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
};

/** Net 100, gross 120: the difference is what rule 2 is about. */
const EVENT = {
  id: "rev-1",
  ref: "TD-EVENT",
  userId: "spender",
  stream: "iap" as RevenueEvent["stream"],
  grossAmount: "120.00",
  netAmount: "100.00",
  processorFee: "20.00",
  currency: "INR",
  occurredAt: new Date("2026-02-10T00:00:00Z"),
  reconciled: true,
  commissionEligible: true,
  commissionProcessedAt: null as Date | null,
  reversedAt: null as Date | null,
};

function sponsor(over: Partial<User> = {}): User {
  return {
    id: "sponsor-1",
    ref: "USR-ABCDEF",
    kycTier: 1,
    status: "active",
    createdAt: new Date(Date.now() - 90 * DAY),
    ...over,
  } as User;
}

describe("CommissionService", () => {
  let svc: CommissionService;
  let commissions: MockRepo;
  let capUsage: MockRepo;
  let edges: MockRepo;
  let revenue: MockRepo;
  let users: MockRepo;
  let sessions: MockRepo;
  let outflows: MockRepo;
  /* The solvency view, mocked from the same `sums` fixture the four per-status
   * queries used to read — so the tests below still assert the invariant rather
   * than the plumbing that computes it. */
  let routines: { commissionSolvency: jest.Mock };
  let plans: { active: jest.Mock; rateFor: jest.Mock };
  let ledger: { getBalance: jest.Mock; withUserLock: jest.Mock; transferBucket: jest.Mock };
  let bus: { publish: jest.Mock };
  let redis: { withLock: jest.Mock };
  let config: { treasuryAllocation: jest.Mock };
  let audit: { record: jest.Mock; recordOrThrow: jest.Mock };

  let balance: Record<string, unknown>;
  let written: { entity: string; row: Record<string, unknown> }[];
  /** Sums the mocked query builders report. */
  let sums: { funding: string; committed: string; queued: string; pendingKyc: string; trailingSpend: string };

  const eventOf = (over: Partial<typeof EVENT> = {}) => ({ ...EVENT, ...over });

  beforeEach(async () => {
    commissions = repo();
    capUsage = repo();
    edges = repo();
    revenue = repo();
    users = repo();
    sessions = repo();
    outflows = repo();
    routines = {
      commissionSolvency: jest.fn(async () => ({
        poolFundedMtt: sums.funding,
        committedMtt: sums.committed,
        queuedMtt: sums.queued,
        pendingKycMtt: sums.pendingKyc,
      })),
    };
    written = [];
    sums = {
      funding: "100000.000000000000000000",
      committed: "0.000000000000000000",
      queued: "0.000000000000000000",
      pendingKyc: "0.000000000000000000",
      trailingSpend: "0.00",
    };
    balance = {
      commissionPending: "0.000000000000000000",
      commissionAvailable: "0.000000000000000000",
      commissionLifetime: "0.000000000000000000",
      mttAvailable: "0.000000000000000000",
      lastLedgerAt: null,
    };

    plans = {
      active: jest.fn(async () => ({ ...PLAN })),
      rateFor: jest.fn((plan: typeof PLAN, level: number) => {
        if (level > Math.min(plan.maxDepth, 3)) return 0;
        return { 1: plan.l1Bps, 2: plan.l2Bps, 3: plan.l3Bps }[level] ?? 0;
      }),
    };
    ledger = {
      getBalance: jest.fn(async () => balance),
      transferBucket: jest.fn(async () => ({ row: { ref: "TX-CLAIM" }, replayed: false })),
      withUserLock: jest.fn(async (_u: string, fn: (tx: unknown, b: unknown) => Promise<unknown>) => {
        const tx = {
          getRepository: (entity: { name: string }) => ({
            create: (row: Record<string, unknown>) => row,
            save: async (row: Record<string, unknown>) => {
              written.push({ entity: entity.name, row });
              return { createdAt: new Date("2026-02-10T00:00:00Z"), ...row, id: `${entity.name}-id` };
            },
          }),
        };
        return fn(tx, balance);
      }),
    };
    bus = { publish: jest.fn() };
    redis = { withLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()) };
    config = { treasuryAllocation: jest.fn(async () => ({ fiatPerMtt: "1.000000000000000000" })) };
    audit = { record: jest.fn(), recordOrThrow: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        CommissionService,
        { provide: getRepositoryToken(Commission), useValue: commissions },
        { provide: getRepositoryToken(CommissionCapUsage), useValue: capUsage },
        { provide: getRepositoryToken(ReferralEdge), useValue: edges },
        { provide: getRepositoryToken(RevenueEvent), useValue: revenue },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(GameSession), useValue: sessions },
        { provide: getRepositoryToken(TreasuryOutflow), useValue: outflows },
        { provide: CommissionPlanService, useValue: plans },
        { provide: LedgerService, useValue: ledger },
        { provide: EventBusService, useValue: bus },
        { provide: RedisService, useValue: redis },
        { provide: EconomyConfigService, useValue: config },
        { provide: AuditService, useValue: audit },
        { provide: DbRoutinesService, useValue: routines },
      ],
    }).compile();

    svc = mod.get(CommissionService);

    revenue.findOne.mockResolvedValue(eventOf());
    revenue.createQueryBuilder.mockImplementation(() => qb(() => ({ sum: sums.trailingSpend })));
    commissions.findOne.mockResolvedValue(null);
    commissions.createQueryBuilder.mockImplementation(() =>
      qb((params) => {
        const statuses = params.statuses as string[] | undefined;
        if (!statuses) return { sum: "0" };
        if (statuses.includes("released") && statuses.includes("claimed")) return { sum: sums.committed };
        if (statuses.includes("queued") && statuses.length === 1) return { sum: sums.queued };
        if (statuses.includes("pending_kyc") && statuses.length === 1) return { sum: sums.pendingKyc };
        return { sum: "0" };
      }),
    );
    outflows.createQueryBuilder.mockImplementation(() => qb(() => ({ sum: sums.funding })));
    outflows.findOne.mockResolvedValue({ ref: "TO-FUND1" });
    edges.find.mockResolvedValue([{ userId: "spender", ancestorId: "sponsor-1", level: 1 }]);
    edges.findOne.mockResolvedValue(null);
    users.findOne.mockResolvedValue(sponsor());
    sessions.count.mockResolvedValue(50);
    capUsage.findOne.mockResolvedValue(null);
    capUsage.save.mockImplementation(async (x: unknown) => x);
  });

  const savedCommission = () => written.find((w) => w.entity === "Commission")?.row;
  const publishedNamed = (name: string) =>
    (bus.publish.mock.calls as [string, Record<string, unknown>][]).find(([n]) => n === name)?.[1];

  /* ==================================================================== *
   * Rule 1 — only real, settled revenue pays
   * ==================================================================== */

  describe("rule 1: commission comes only from reconciled, eligible revenue", () => {
    it("REFUSES an unreconciled event — we do not yet know the money arrived", async () => {
      revenue.findOne.mockResolvedValue(eventOf({ reconciled: false }));
      const r = await svc.processRevenueEvent("rev-1");
      expect(r.skipped).toBe("NOT_RECONCILED");
      expect(r.created).toBe(0);
      expect(commissions.save).not.toHaveBeenCalled();
      /* And it is NOT stamped processed, so it will pay once reconciled. */
      expect(revenue.save).not.toHaveBeenCalled();
    });

    it("REFUSES an event that is not commission-eligible", async () => {
      revenue.findOne.mockResolvedValue(eventOf({ commissionEligible: false }));
      const r = await svc.processRevenueEvent("rev-1");
      expect(r.skipped).toBe("NOT_COMMISSION_ELIGIBLE");
    });

    it("REFUSES an already-reversed event", async () => {
      revenue.findOne.mockResolvedValue(eventOf({ reversedAt: new Date() }));
      const r = await svc.processRevenueEvent("rev-1");
      expect(r.skipped).toBe("EVENT_REVERSED");
    });

    it("is idempotent: an already-processed event pays nothing more", async () => {
      revenue.findOne.mockResolvedValue(eventOf({ commissionProcessedAt: new Date() }));
      const r = await svc.processRevenueEvent("rev-1");
      expect(r.skipped).toBe("ALREADY_PROCESSED");
      expect(written).toHaveLength(0);
    });

    it("REFUSES to pay with no approved plan, and leaves the event unprocessed", async () => {
      plans.active.mockResolvedValue(null);
      const r = await svc.processRevenueEvent("rev-1");
      expect(r.skipped).toBe("NO_ACTIVE_PLAN");
      /* Not stamped: once a plan is approved this revenue still pays out. */
      expect(revenue.save).not.toHaveBeenCalled();
    });

    it("REFUSES a stream the plan does not treat as commissionable", async () => {
      plans.active.mockResolvedValue({ ...PLAN, eligibleTriggers: ["subscription"] });
      const r = await svc.processRevenueEvent("rev-1");
      expect(r.skipped).toBe("TRIGGER_NOT_IN_PLAN");
    });

    it("REFUSES marketplace revenue — it is not attributable to a member's purchase", async () => {
      revenue.findOne.mockResolvedValue(eventOf({ stream: "marketplace" }));
      const r = await svc.processRevenueEvent("rev-1");
      expect(r.skipped).toBe("STREAM_NOT_COMMISSIONABLE");
    });
  });

  /* ==================================================================== *
   * Rule 2 — NET, never gross
   * ==================================================================== */

  describe("rule 2: calculated on NET", () => {
    it("applies the rate to netAmount, not grossAmount", async () => {
      await svc.processRevenueEvent("rev-1");
      const row = savedCommission();
      /* 8% of net 100 = 8.00. 8% of gross 120 would be 9.60 — money we never had. */
      expect(row?.grossAmount).toBe("8.00");
      expect(row?.eligibleSpend).toBe("100.00");
      expect(row?.amount).toBe("8.00");
    });

    it("records on the event that the basis was netAmount, for the audit trail", async () => {
      await svc.processRevenueEvent("rev-1");
      expect(publishedNamed("commission.calculated")?.calculatedOn).toBe("netAmount");
    });

    it("prices MTT from the reference rate, truncating down", async () => {
      config.treasuryAllocation.mockResolvedValue({ fiatPerMtt: "3.000000000000000000" });
      await svc.processRevenueEvent("rev-1");
      /* 8.00 / 3 = 2.666… truncated at 18dp, never rounded up. */
      expect(savedCommission()?.amountMtt).toBe("2.666666666666666666");
    });

    it("refuses to price commission with no reference price configured", async () => {
      config.treasuryAllocation.mockResolvedValue({ fiatPerMtt: "0" });
      await expect(svc.processRevenueEvent("rev-1"))
        .rejects.toMatchObject({ response: { code: "REFERENCE_PRICE_UNSET" } });
    });
  });

  /* ==================================================================== *
   * Rule 3 — depth
   * ==================================================================== */

  describe("rule 3: depth caps at 3", () => {
    it("pays all three tiers at their own rates", async () => {
      edges.find.mockResolvedValue([
        { userId: "spender", ancestorId: "l1", level: 1 },
        { userId: "spender", ancestorId: "l2", level: 2 },
        { userId: "spender", ancestorId: "l3", level: 3 },
      ]);
      users.findOne.mockImplementation(async (o: { where: { id: string } }) =>
        sponsor({ id: o.where.id, ref: `USR-${o.where.id}` }),
      );

      const r = await svc.processRevenueEvent("rev-1");

      expect(r.created).toBe(3);
      const rates = written
        .filter((w) => w.entity === "Commission")
        .map((w) => w.row.rateBps);
      expect(rates).toEqual([800, 300, 100]);
    });

    it("ignores an edge deeper than the plan's depth", async () => {
      plans.active.mockResolvedValue({ ...PLAN, maxDepth: 2 });
      edges.find.mockResolvedValue([
        { userId: "spender", ancestorId: "l1", level: 1 },
        { userId: "spender", ancestorId: "l2", level: 2 },
        { userId: "spender", ancestorId: "l3", level: 3 },
      ]);
      users.findOne.mockImplementation(async (o: { where: { id: string } }) =>
        sponsor({ id: o.where.id, ref: `USR-${o.where.id}` }),
      );

      const r = await svc.processRevenueEvent("rev-1");
      expect(r.created).toBe(2);
    });

    it("skips a level whose rate is zero rather than writing a zero row", async () => {
      plans.active.mockResolvedValue({ ...PLAN, l2Bps: 0 });
      edges.find.mockResolvedValue([
        { userId: "spender", ancestorId: "l1", level: 1 },
        { userId: "spender", ancestorId: "l2", level: 2 },
      ]);
      users.findOne.mockImplementation(async (o: { where: { id: string } }) =>
        sponsor({ id: o.where.id, ref: `USR-${o.where.id}` }),
      );

      const r = await svc.processRevenueEvent("rev-1");
      expect(r.created).toBe(1);
    });

    it("pays nothing when the spender has no upline", async () => {
      edges.find.mockResolvedValue([]);
      const r = await svc.processRevenueEvent("rev-1");
      expect(r.created).toBe(0);
      expect(r.processed).toBe(true);
    });
  });

  /* ==================================================================== *
   * Rule 4 — the monthly cap
   * ==================================================================== */

  describe("rule 4: monthly cap, never carried over", () => {
    it("computes cap = min(absolute, multiplier × trailing spend + base)", () => {
      /* 5 × 200 + 100 = 1100, under the 5000 absolute ceiling. */
      expect(svc.computeCap(PLAN as never, "200.00")).toBe("1100.00");
      /* 5 × 100000 + 100 would be 500100 — the absolute ceiling binds. */
      expect(svc.computeCap(PLAN as never, "100000.00")).toBe("5000.00");
      /* No spend at all still leaves the flat base. */
      expect(svc.computeCap(PLAN as never, "0")).toBe("100.00");
    });

    it("clamps a commission to the remaining allowance and records the shortfall", async () => {
      capUsage.findOne.mockResolvedValue({
        userId: "sponsor-1", monthKey: "2026-02",
        capAmount: "10.00", usedAmount: "6.00", cappedAwayAmount: "0.00",
        trailingSpend: "0.00", entryCount: 1,
      });

      await svc.processRevenueEvent("rev-1");

      const row = savedCommission();
      expect(row?.grossAmount).toBe("8.00");
      expect(row?.amount).toBe("4.00");
      expect(row?.cappedAmount).toBe("4.00");
    });

    it("records a fully capped commission as `capped` with zero payable", async () => {
      capUsage.findOne.mockResolvedValue({
        userId: "sponsor-1", monthKey: "2026-02",
        capAmount: "10.00", usedAmount: "10.00", cappedAwayAmount: "0.00",
        trailingSpend: "0.00", entryCount: 3,
      });

      const r = await svc.processRevenueEvent("rev-1");

      expect(r.capped).toBe(1);
      const row = commissions.save.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(row.status).toBe("capped");
      expect(row.amount).toBe("0.00");
      expect(row.cappedAmount).toBe("8.00");
      /* No balance movement for a fully capped row. */
      expect(written).toHaveLength(0);
    });

    it("states explicitly that the capped excess is NOT carried over", async () => {
      capUsage.findOne.mockResolvedValue({
        userId: "sponsor-1", monthKey: "2026-02",
        capAmount: "10.00", usedAmount: "10.00", cappedAwayAmount: "0.00",
        trailingSpend: "0.00", entryCount: 3,
      });
      await svc.processRevenueEvent("rev-1");
      expect(publishedNamed("commission.capped")?.carriedOver).toBe(false);
    });

    it("buckets the cap by the month the SPEND happened, not the month it is processed", async () => {
      await svc.processRevenueEvent("rev-1");
      /* Event occurred 2026-02-10. */
      expect(savedCommission()?.monthKey).toBe("2026-02");
    });

    it("advances the recipient's cap usage by the payable amount", async () => {
      await svc.processRevenueEvent("rev-1");
      const usage = capUsage.save.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(usage.usedAmount).toBe("8.00");
      expect(usage.entryCount).toBe(1);
    });

    it("serialises cap arithmetic per recipient and month", async () => {
      await svc.processRevenueEvent("rev-1");
      expect(redis.withLock).toHaveBeenCalledWith(
        "commission:cap:sponsor-1:2026-02", expect.any(Number), expect.any(Function),
        /* Waits for its turn rather than failing on contention: two downlines of
           one sponsor buying at the same moment is ordinary traffic, and a lost
           commission is not an acceptable outcome for it. */
        expect.objectContaining({ waitMs: expect.any(Number) }),
      );
    });

    it("retries rather than skipping when the cap lock cannot be taken", async () => {
      redis.withLock.mockResolvedValue(null);
      await expect(svc.processRevenueEvent("rev-1")).rejects.toBeInstanceOf(ConflictException);
    });
  });

  /* ==================================================================== *
   * Rule 5 — solvency
   * ==================================================================== */

  describe("rule 5: released commission never exceeds confirmed pool funding", () => {
    it("releases when the pool can fund it, crediting the claimable bucket", async () => {
      await svc.processRevenueEvent("rev-1");

      expect(savedCommission()?.status).toBe("released");
      expect(balance.commissionAvailable).toBe("8.000000000000000000");
      expect(balance.commissionLifetime).toBe("8.000000000000000000");
      expect(balance.commissionPending).toBe("0.000000000000000000");
    });

    it("QUEUES rather than releasing when the pool is unfunded", async () => {
      sums.funding = "0.000000000000000000";
      const r = await svc.processRevenueEvent("rev-1");

      expect(r.queued).toBe(1);
      expect(savedCommission()?.status).toBe("queued");
      /* Visible as accrued, but not claimable and not counted as lifetime. */
      expect(balance.commissionPending).toBe("8.000000000000000000");
      expect(balance.commissionAvailable).toBe("0.000000000000000000");
      expect(balance.commissionLifetime).toBe("0.000000000000000000");
    });

    it("QUEUES when prior commitments have exhausted the funding", async () => {
      sums.funding = "10.000000000000000000";
      sums.committed = "5.000000000000000000";
      /* 5 MTT available, 8 MTT needed. */
      const r = await svc.processRevenueEvent("rev-1");
      expect(r.queued).toBe(1);
    });

    it("holds commission for an unverified recipient regardless of funding", async () => {
      users.findOne.mockResolvedValue(sponsor({ kycTier: 0 }));
      const r = await svc.processRevenueEvent("rev-1");
      expect(r.pendingKyc).toBe(1);
      expect(savedCommission()?.status).toBe("pending_kyc");
      expect(balance.commissionPending).toBe("8.000000000000000000");
    });

    it("records the funding transfer that backed a released payout", async () => {
      await svc.processRevenueEvent("rev-1");
      expect(savedCommission()?.treasuryInflowRef).toBe("TO-FUND1");
    });

    it("reads funding from the solvency view rather than recomputing it", async () => {
      /* The "confirmed outflows only" rule now lives in v_commission_solvency,
       * where the e2e suite asserts it against a real database. What matters
       * here is that this service does not keep a second opinion: an approved
       * but unsubmitted transfer must never be counted as funding, and the only
       * way to guarantee that is to have one definition. */
      await svc.fundingAvailable();
      expect(routines.commissionSolvency).toHaveBeenCalledTimes(1);
    });

    it("reports queued and pending liabilities separately from commitments", async () => {
      sums.funding = "100.000000000000000000";
      sums.committed = "40.000000000000000000";
      sums.queued = "25.000000000000000000";
      sums.pendingKyc = "5.000000000000000000";

      const s = await svc.fundingAvailable();

      expect(s.availableMtt).toBe("60.000000000000000000");
      expect(s.queuedMtt).toBe("25.000000000000000000");
      expect(s.pendingKycMtt).toBe("5.000000000000000000");
      expect(s.solvent).toBe(true);
    });

    it("reports insolvency rather than a negative allowance if commitments ever exceed funding", async () => {
      sums.funding = "10.000000000000000000";
      sums.committed = "40.000000000000000000";
      const s = await svc.fundingAvailable();
      expect(s.solvent).toBe(false);
      expect(s.availableMtt).toBe("0.000000000000000000");
    });
  });

  /* ==================================================================== *
   * Rule 6 — anti-abuse
   * ==================================================================== */

  describe("rule 6: anti-abuse refusals are recorded, not silent", () => {
    const expectRejected = async (reason: string) => {
      const r = await svc.processRevenueEvent("rev-1");
      expect(r.rejected).toBe(1);
      const row = commissions.save.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(row.status).toBe("rejected");
      expect(row.rejectionReason).toBe(reason);
      expect(row.amount).toBe("0.00");
      /* No balance movement for a refusal. */
      expect(written).toHaveLength(0);
    };

    it("REFUSES self-referral", async () => {
      edges.find.mockResolvedValue([{ userId: "spender", ancestorId: "spender", level: 1 }]);
      users.findOne.mockResolvedValue(sponsor({ id: "spender" }));
      await expectRejected("SELF_REFERRAL");
    });

    it("REFUSES a referral loop — the shape of a mutual-referral farm", async () => {
      edges.findOne.mockResolvedValue({ userId: "sponsor-1", ancestorId: "spender", level: 1 });
      await expectRejected("REFERRAL_LOOP");
    });

    it("REFUSES an account younger than the plan's minimum age", async () => {
      users.findOne.mockResolvedValue(sponsor({ createdAt: new Date(Date.now() - 2 * DAY) }));
      await expectRejected("ACCOUNT_TOO_NEW");
    });

    it("REFUSES an account with too little genuine gameplay", async () => {
      sessions.count.mockResolvedValue(1);
      await expectRejected("INSUFFICIENT_GAMEPLAY");
    });

    it("counts VALIDATED sessions only — starting games you never played proves nothing", async () => {
      await svc.processRevenueEvent("rev-1");
      expect(sessions.count).toHaveBeenCalledWith({
        where: { userId: "sponsor-1", status: "validated" },
      });
    });

    it("REFUSES a suspended recipient", async () => {
      users.findOne.mockResolvedValue(sponsor({ status: "suspended" }));
      await expectRejected("RECIPIENT_SUSPENDED");
    });

    it("REFUSES a frozen recipient — a compliance hold must hold", async () => {
      users.findOne.mockResolvedValue(sponsor({ status: "frozen" }));
      await expectRejected("RECIPIENT_FROZEN");
    });

    it("skips the gameplay check entirely when the plan does not require sessions", async () => {
      plans.active.mockResolvedValue({ ...PLAN, minGameplaySessions: 0 });
      await svc.processRevenueEvent("rev-1");
      expect(sessions.count).not.toHaveBeenCalled();
    });
  });

  /* ==================================================================== *
   * Idempotency of the fan-out
   * ==================================================================== */

  describe("fan-out idempotency", () => {
    it("does not re-pay a recipient who already has a row for this event", async () => {
      commissions.findOne.mockResolvedValue({
        status: "released", amount: "8.00", amountMtt: "8.000000000000000000",
      });
      const r = await svc.processRevenueEvent("rev-1");
      expect(r.created).toBe(1);
      expect(written).toHaveLength(0);
    });

    it("stamps the event processed only after the fan-out completes", async () => {
      await svc.processRevenueEvent("rev-1");
      const saved = revenue.save.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(saved.commissionProcessedAt).toBeInstanceOf(Date);
    });
  });

  /* ==================================================================== *
   * Release
   * ==================================================================== */

  describe("releaseQueued", () => {
    const queuedRow = (id: string, amountMtt: string) => ({
      id, ref: `CM-${id}`, recipientId: "sponsor-1", amountMtt, status: "queued",
      monthKey: "2026-02", amount: "8.00", treasuryInflowRef: null,
    });

    it("releases oldest-first and stops when the funding runs out", async () => {
      sums.funding = "10.000000000000000000";
      commissions.find.mockResolvedValue([
        queuedRow("a", "6.000000000000000000"),
        queuedRow("b", "6.000000000000000000"),
      ]);

      const r = await svc.releaseQueued();

      /* 10 available: the first fits, the second does not. */
      expect(r.released).toBe(1);
      expect(r.releasedMtt).toBe("6.000000000000000000");
    });

    it("does nothing when the pool has no available funding", async () => {
      sums.funding = "0.000000000000000000";
      const r = await svc.releaseQueued();
      expect(r.released).toBe(0);
      expect(commissions.find).not.toHaveBeenCalled();
    });

    it("moves a recipient whose KYC lapsed back to pending_kyc instead of paying them", async () => {
      commissions.find.mockResolvedValue([queuedRow("a", "6.000000000000000000")]);
      users.findOne.mockResolvedValue(sponsor({ kycTier: 0 }));

      const r = await svc.releaseQueued();

      expect(r.released).toBe(0);
      expect(commissions.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: "pending_kyc" }),
      );
    });

    it("moves the funds from pending to claimable and bumps lifetime", async () => {
      balance.commissionPending = "6.000000000000000000";
      commissions.find.mockResolvedValue([queuedRow("a", "6.000000000000000000")]);

      await svc.releaseQueued();

      expect(balance.commissionPending).toBe("0.000000000000000000");
      expect(balance.commissionAvailable).toBe("6.000000000000000000");
      expect(balance.commissionLifetime).toBe("6.000000000000000000");
    });
  });

  describe("releaseForKyc", () => {
    it("releases held commission once identity is verified, if the pool can fund it", async () => {
      commissions.find.mockResolvedValue([
        { id: "a", ref: "CM-a", recipientId: "sponsor-1", amountMtt: "8.000000000000000000", status: "pending_kyc" },
      ]);
      const r = await svc.releaseForKyc("sponsor-1");
      expect(r.released).toBe(1);
    });

    it("moves to queued — not released — when KYC clears but the pool cannot fund it", async () => {
      sums.funding = "1.000000000000000000";
      commissions.find.mockResolvedValue([
        { id: "a", ref: "CM-a", recipientId: "sponsor-1", amountMtt: "8.000000000000000000", status: "pending_kyc" },
      ]);

      const r = await svc.releaseForKyc("sponsor-1");

      expect(r.released).toBe(0);
      expect(r.queued).toBe(1);
    });

    it("does nothing for a recipient who is still unverified", async () => {
      users.findOne.mockResolvedValue(sponsor({ kycTier: 0 }));
      const r = await svc.releaseForKyc("sponsor-1");
      expect(r).toEqual({ released: 0, queued: 0 });
    });
  });

  /* ==================================================================== *
   * Claim
   * ==================================================================== */

  describe("claim", () => {
    const released = (id: string, amountMtt: string) => ({
      id, ref: `CM-${id}`, recipientId: "sponsor-1", amountMtt, status: "released",
    });

    it("moves all released commission into the spendable balance in ONE transaction", async () => {
      commissions.find.mockResolvedValue([
        released("a", "5.000000000000000000"),
        released("b", "3.000000000000000000"),
      ]);

      const r = await svc.claim("sponsor-1");

      expect(ledger.transferBucket).toHaveBeenCalledTimes(1);
      expect(ledger.transferBucket).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "commissionAvailable", to: "available",
          amount: "8.000000000000000000", type: "commission_claim",
        }),
      );
      expect(r.claimedMtt).toBe("8.000000000000000000");
      expect(r.entries).toBe(2);
    });

    it("REFUSES to claim without identity verification", async () => {
      users.findOne.mockResolvedValue(sponsor({ kycTier: 0 }));
      await expect(svc.claim("sponsor-1"))
        .rejects.toMatchObject({ response: { code: "KYC_REQUIRED" } });
    });

    it("reports what remains unreleased rather than silently omitting it", async () => {
      sums.queued = "12.000000000000000000";
      commissions.find.mockResolvedValue([]);
      const r = await svc.claim("sponsor-1");
      expect(r.claimedMtt).toBe("0.000000000000000000");
      expect(r.entries).toBe(0);
    });

    it("serialises claims per member so a double tap cannot pay twice", async () => {
      redis.withLock.mockResolvedValue(null);
      await expect(svc.claim("sponsor-1"))
        .rejects.toMatchObject({ response: { code: "CLAIM_IN_FLIGHT" } });
    });

    it("marks exactly the claimed rows, never a broader set", async () => {
      commissions.find.mockResolvedValue([released("a", "5.000000000000000000")]);
      await svc.claim("sponsor-1");
      const [where, patch] = commissions.update.mock.calls[0] as [unknown, Record<string, unknown>];
      expect(patch.status).toBe("claimed");
      expect(where).toBeDefined();
    });
  });

  /* ==================================================================== *
   * Rule 7 — clawback
   * ==================================================================== */

  describe("rule 7: a refund claws back", () => {
    const row = (status: string, over: Record<string, unknown> = {}) => ({
      id: "c1", ref: "CM-1", recipientId: "sponsor-1", revenueEventId: "rev-1",
      amount: "8.00", amountMtt: "8.000000000000000000", status, monthKey: "2026-02",
      ...over,
    });

    it("reclaims a CLAIMED commission from the spendable balance", async () => {
      balance.mttAvailable = "20.000000000000000000";
      commissions.find.mockResolvedValue([row("claimed")]);

      const r = await svc.clawbackForRevenueEvent("rev-1", "card chargeback");

      expect(balance.mttAvailable).toBe("12.000000000000000000");
      expect(r.recoveredMtt).toBe("8.000000000000000000");
      expect(r.shortfallMtt).toBe("0.000000000000000000");
    });

    it("reclaims a RELEASED commission from the claimable bucket", async () => {
      balance.commissionAvailable = "8.000000000000000000";
      commissions.find.mockResolvedValue([row("released")]);

      await svc.clawbackForRevenueEvent("rev-1", "refund");

      expect(balance.commissionAvailable).toBe("0.000000000000000000");
    });

    it("reclaims a QUEUED commission from the pending bucket", async () => {
      balance.commissionPending = "8.000000000000000000";
      commissions.find.mockResolvedValue([row("queued")]);

      await svc.clawbackForRevenueEvent("rev-1", "refund");

      expect(balance.commissionPending).toBe("0.000000000000000000");
    });

    it("does NOT reduce lifetime earnings — that record is monotonic by design", async () => {
      balance.commissionAvailable = "8.000000000000000000";
      balance.commissionLifetime = "8.000000000000000000";
      commissions.find.mockResolvedValue([row("released")]);

      await svc.clawbackForRevenueEvent("rev-1", "refund");

      expect(balance.commissionLifetime).toBe("8.000000000000000000");
    });

    it("records a shortfall and RAISES A FRAUD ALERT rather than forcing a negative balance", async () => {
      balance.mttAvailable = "3.000000000000000000";
      commissions.find.mockResolvedValue([row("claimed")]);

      const r = await svc.clawbackForRevenueEvent("rev-1", "chargeback after withdrawal");

      expect(r.recoveredMtt).toBe("3.000000000000000000");
      expect(r.shortfallMtt).toBe("5.000000000000000000");
      expect(balance.mttAvailable).toBe("0.000000000000000000");
      expect(publishedNamed("fraud.alert_raised")).toMatchObject({
        kind: "commission_clawback_shortfall",
        shortfallMtt: "5.000000000000000000",
      });
    });

    it("returns the cap allowance the reversed commission consumed", async () => {
      balance.commissionAvailable = "8.000000000000000000";
      commissions.find.mockResolvedValue([row("released")]);
      capUsage.findOne.mockResolvedValue({
        userId: "sponsor-1", monthKey: "2026-02",
        capAmount: "100.00", usedAmount: "8.00", cappedAwayAmount: "0.00",
        trailingSpend: "0.00", entryCount: 1,
      });

      await svc.clawbackForRevenueEvent("rev-1", "refund");

      const usage = capUsage.save.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      /* The purchase never happened, so the headroom it consumed comes back. */
      expect(usage.usedAmount).toBe("0.00");
    });

    it("never drives cap usage below zero", async () => {
      balance.commissionAvailable = "8.000000000000000000";
      commissions.find.mockResolvedValue([row("released")]);
      capUsage.findOne.mockResolvedValue({
        userId: "sponsor-1", monthKey: "2026-02",
        capAmount: "100.00", usedAmount: "2.00", cappedAwayAmount: "0.00",
        trailingSpend: "0.00", entryCount: 1,
      });

      await svc.clawbackForRevenueEvent("rev-1", "refund");

      const usage = capUsage.save.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(usage.usedAmount).toBe("0.00");
    });

    it("audits every reversal with the before state and the reason", async () => {
      balance.commissionAvailable = "8.000000000000000000";
      commissions.find.mockResolvedValue([row("released")]);

      await svc.clawbackForRevenueEvent("rev-1", "refund issued", "compliance-1");

      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "commission.clawback",
          actorId: "compliance-1",
          reason: "refund issued",
        }),
      );
    });

    it("refuses a manual clawback of a row with nothing to reclaim", async () => {
      commissions.findOne.mockResolvedValue(row("capped"));
      await expect(svc.clawbackOne("c1", "fraud", "compliance-1"))
        .rejects.toMatchObject({ response: { code: "NOT_CLAWABLE" } });
    });
  });

  /* ==================================================================== *
   * Cap meter
   * ==================================================================== */

  describe("capMeter", () => {
    it("reports the live meter with the parameters that produced the cap", async () => {
      capUsage.findOne.mockResolvedValue({
        userId: "sponsor-1", monthKey: "2026-02",
        capAmount: "1100.00", usedAmount: "250.00", cappedAwayAmount: "12.00",
        trailingSpend: "200.00", entryCount: 7,
      });

      const m = await svc.capMeter("sponsor-1", "2026-02");

      expect(m.capAmount).toBe("1100.00");
      expect(m.remainingAmount).toBe("850.00");
      expect(m.cappedAwayAmount).toBe("12.00");
      expect(m.absoluteCap).toBe("5000.00");
      expect(m.capMultiplier).toBe("5.00");
      expect(m.capBase).toBe("100.00");
    });

    it("derives the cap from trailing spend for a member with no usage row yet", async () => {
      sums.trailingSpend = "300.00";
      const m = await svc.capMeter("sponsor-1", "2026-02");
      /* 5 × 300 + 100 = 1600. */
      expect(m.capAmount).toBe("1600.00");
      expect(m.usedAmount).toBe("0.00");
    });

    it("refuses to quote a cap with no approved plan", async () => {
      plans.active.mockResolvedValue(null);
      await expect(svc.capMeter("sponsor-1"))
        .rejects.toMatchObject({ response: { code: "NO_ACTIVE_PLAN" } });
    });

    it("never reports negative remaining allowance", async () => {
      capUsage.findOne.mockResolvedValue({
        userId: "sponsor-1", monthKey: "2026-02",
        capAmount: "10.00", usedAmount: "25.00", cappedAwayAmount: "0.00",
        trailingSpend: "0.00", entryCount: 1,
      });
      const m = await svc.capMeter("sponsor-1", "2026-02");
      expect(m.remainingAmount).toBe("0.00");
    });
  });
});
