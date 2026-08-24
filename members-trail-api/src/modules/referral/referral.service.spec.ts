import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import { Commission, GameSession, ReferralEdge, User } from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { appConfig } from "@/config/configuration";
import { CommissionPlanService } from "./commission-plan.service";
import { ReferralService } from "./referral.service";

/* ============================================================================
 * The property under test: a member sees the SHAPE of their downline, never the
 * IDENTITY of anyone in it (FRD R-02). Exposing names or emails would turn the
 * referral tree into a contact list for pressuring people — the dynamic that
 * makes these programmes harmful — so these tests assert that no identifying
 * field can appear in a response.
 * ========================================================================== */

function repo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
    findAndCount: jest.fn(async (): Promise<[unknown[], number]> => [[], 0]),
    count: jest.fn(async () => 0),
    createQueryBuilder: jest.fn(),
  };
}

function qb(raw: { rawOne?: Record<string, unknown>; rawMany?: Record<string, unknown>[] }) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "addSelect", "where", "andWhere", "groupBy", "orderBy"]) {
    b[m] = jest.fn(() => b);
  }
  b.getRawOne = jest.fn(async () => raw.rawOne ?? { sum: "0", count: "0" });
  b.getRawMany = jest.fn(async () => raw.rawMany ?? []);
  return b;
}

const MEMBER = {
  id: "down-1",
  ref: "USR-QRSTUV",
  /* Present on the entity, and must never reach a response. */
  email: "victim@example.com",
  fullName: "Real Name",
  displayName: "realname",
  kycTier: 1,
  createdAt: new Date("2026-01-05T00:00:00Z"),
};

describe("ReferralService", () => {
  let svc: ReferralService;
  let edges: ReturnType<typeof repo>;
  let users: ReturnType<typeof repo>;
  let commissions: ReturnType<typeof repo>;
  let sessions: ReturnType<typeof repo>;
  let plans: { active: jest.Mock; rateFor: jest.Mock };
  let ledger: { getBalance: jest.Mock };

  beforeEach(async () => {
    edges = repo();
    users = repo();
    commissions = repo();
    sessions = repo();
    plans = {
      active: jest.fn(async () => ({ version: 3, maxDepth: 3, l1Bps: 800, l2Bps: 300, l3Bps: 100 })),
      rateFor: jest.fn((_p: unknown, level: number) => ({ 1: 800, 2: 300, 3: 100 }[level] ?? 0)),
    };
    ledger = {
      getBalance: jest.fn(async () => ({
        commissionLifetime: "120.000000000000000000",
        commissionAvailable: "30.000000000000000000",
        commissionPending: "10.000000000000000000",
      })),
    };

    const mod = await Test.createTestingModule({
      providers: [
        ReferralService,
        { provide: getRepositoryToken(ReferralEdge), useValue: edges },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(Commission), useValue: commissions },
        { provide: getRepositoryToken(GameSession), useValue: sessions },
        { provide: CommissionPlanService, useValue: plans },
        { provide: LedgerService, useValue: ledger },
        { provide: appConfig.KEY, useValue: { webUrl: "https://memberstrail.example/" } },
      ],
    }).compile();

    svc = mod.get(ReferralService);
    users.findOne.mockResolvedValue({ id: "me", ref: "USR-ME1234", referralCode: "MTT-ABC123" });
    commissions.createQueryBuilder.mockImplementation(() => qb({ rawOne: { sum: "0" }, rawMany: [] }));
    sessions.createQueryBuilder.mockImplementation(() => qb({ rawOne: { count: "0" }, rawMany: [] }));
  });

  describe("code", () => {
    it("builds a share link containing the member's code", async () => {
      edges.count.mockResolvedValue(4);
      const r = await svc.code("me");
      expect(r.code).toBe("MTT-ABC123");
      expect(r.link).toBe("https://memberstrail.example/register?ref=MTT-ABC123");
      expect(r.directJoins).toBe(4);
    });
  });

  describe("downline", () => {
    beforeEach(() => {
      edges.findAndCount.mockResolvedValue([
        [{ userId: "down-1", ancestorId: "me", level: 1, createdAt: new Date("2026-01-05T00:00:00Z") }],
        1,
      ]);
      users.find.mockResolvedValue([MEMBER]);
    });

    it("returns an anonymised label, never a name, email or handle", async () => {
      const r = await svc.downline("me", { skip: 0, limit: 20, sortDir: "DESC" } as never);
      const [member] = r.data;

      expect(member.label).toBe("Member #QRSTUV");
      const serialised = JSON.stringify(r);
      expect(serialised).not.toContain("victim@example.com");
      expect(serialised).not.toContain("Real Name");
      expect(serialised).not.toContain("realname");
      /* The internal id must not leak either — it is a lookup key elsewhere. */
      expect(serialised).not.toContain("down-1");
    });

    it("reports activity as a flag rather than a session history", async () => {
      sessions.createQueryBuilder.mockImplementation(() =>
        qb({ rawMany: [{ userId: "down-1" }] }),
      );
      const r = await svc.downline("me", { skip: 0, limit: 20, sortDir: "DESC" } as never);
      expect(r.data[0].active).toBe(true);
    });

    it("reports a member with no recent validated session as inactive", async () => {
      const r = await svc.downline("me", { skip: 0, limit: 20, sortDir: "DESC" } as never);
      expect(r.data[0].active).toBe(false);
    });

    it("shows only the day a member joined, not a precise timestamp", async () => {
      const r = await svc.downline("me", { skip: 0, limit: 20, sortDir: "DESC" } as never);
      expect(r.data[0].joinedAt).toBe("2026-01-05");
    });

    it("attributes committed earnings per downline member", async () => {
      commissions.createQueryBuilder.mockImplementation(() =>
        qb({ rawMany: [{ downlineUserId: "down-1", sum: "12.5" }] }),
      );
      const r = await svc.downline("me", { skip: 0, limit: 20, sortDir: "DESC" } as never);
      expect(r.data[0].earnedFromMtt).toBe("12.500000000000000000");
    });

    it("returns an empty page without querying members when there is no downline", async () => {
      edges.findAndCount.mockResolvedValue([[], 0]);
      const r = await svc.downline("me", { skip: 0, limit: 20, sortDir: "DESC" } as never);
      expect(r.data).toEqual([]);
      expect(users.find).not.toHaveBeenCalled();
    });
  });

  describe("stats", () => {
    it("breaks the network down by tier with the plan's rate at each level", async () => {
      edges.find.mockResolvedValue([{ userId: "down-1" }, { userId: "down-2" }]);

      const s = await svc.stats("me");

      expect(s.levels).toHaveLength(3);
      expect(s.levels.map((l) => l.rateBps)).toEqual([800, 300, 100]);
      expect(s.totalDownline).toBe(6);
      expect(s.maxDepth).toBe(3);
      expect(s.planVersion).toBe(3);
    });

    it("separates pending from claimable, so unfunded accrual is never shown as spendable", async () => {
      const s = await svc.stats("me");
      expect(s.claimableMtt).toBe("30.000000000000000000");
      expect(s.pendingMtt).toBe("10.000000000000000000");
      expect(s.lifetimeEarnedMtt).toBe("120.000000000000000000");
    });

    it("shows a zero rate when no plan is approved, rather than a rate nobody signed off", async () => {
      plans.active.mockResolvedValue(null);
      const s = await svc.stats("me");
      expect(s.levels.map((l) => l.rateBps)).toEqual([0, 0, 0]);
      expect(s.planVersion).toBeNull();
    });

    it("never asks for a fourth tier", async () => {
      await svc.stats("me");
      const levels = (edges.find.mock.calls).map(
        (c) => (c[0] as { where: { level: number } } | undefined)?.where.level,
      );
      expect(levels).toEqual([1, 2, 3]);
    });
  });
});
