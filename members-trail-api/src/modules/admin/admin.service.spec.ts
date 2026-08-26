import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import {
  ApprovalRequest, AuditLog, Commission, FraudAlert, KycSubmission, PointsLedgerEntry,
  RolePermission, Ticket, User, Withdrawal,
} from "@/database/entities";
import { EventBusService } from "@/events";
import { AuditService } from "@/modules/audit/audit.service";
import { NotificationsService } from "@/modules/notifications/notifications.service";
import { CommissionService } from "@/modules/referral/commission.service";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import { AdminService } from "./admin.service";

/* ============================================================================
 * Two governance properties:
 *
 *  1  THE APPROVER IS NEVER THE REQUESTER — checked on decision, and excluded
 *     from the "what can I decide" query so the UI cannot offer it.
 *  2  A PENDING REQUEST EXPIRES — enforced at decision time, not just displayed,
 *     so an approval raised during an incident cannot be applied months later.
 * ========================================================================== */

const HOUR = 3_600_000;

function repo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
    /* The database assigns id and createdAt on insert. */
    save: jest.fn(async (x: unknown) => ({
      id: "row-1", createdAt: new Date("2026-02-01T00:00:00Z"), ...(x as object),
    })),
    create: jest.fn((x: unknown) => x),
    count: jest.fn(async (..._a: unknown[]) => 0),
    createQueryBuilder: jest.fn(),
  };
}

function qb(opts: { rawOne?: Record<string, unknown>; count?: number }) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "addSelect", "where", "andWhere", "groupBy", "orderBy", "skip", "take"]) {
    b[m] = jest.fn(() => b);
  }
  b.getRawOne = jest.fn(async () => opts.rawOne ?? { sum: "0" });
  b.getRawMany = jest.fn(async () => []);
  b.getManyAndCount = jest.fn(async () => [[], 0]);
  b.getMany = jest.fn(async () => []);
  b.getCount = jest.fn(async () => opts.count ?? 0);
  return b;
}

const PENDING = {
  id: "a1",
  ref: "APR-ABC",
  kind: "treasury_outflow" as const,
  targetId: "to-1",
  payload: { amount: "1000" },
  reason: "funding the commission pool for February",
  requestedById: "finance-1",
  approverId: null as string | null,
  status: "pending" as const,
  decisionNote: null as string | null,
  decidedAt: null as Date | null,
  appliedAt: null as Date | null,
  expiresAt: new Date(Date.now() + 24 * HOUR),
  requiresHardwareKey: true,
  createdAt: new Date(),
};

describe("AdminService", () => {
  let svc: AdminService;
  let approvals: ReturnType<typeof repo>;
  let permissions: ReturnType<typeof repo>;
  let auditLogs: ReturnType<typeof repo>;
  let users: ReturnType<typeof repo>;
  let withdrawals: ReturnType<typeof repo>;
  let alerts: ReturnType<typeof repo>;
  let tickets: ReturnType<typeof repo>;
  let commissions: ReturnType<typeof repo>;
  let kycSubmissions: ReturnType<typeof repo>;
  let pointsLedger: ReturnType<typeof repo>;
  let commission: { fundingAvailable: jest.Mock };
  let notifications: { notify: jest.Mock };
  let bus: { publish: jest.Mock };
  /* The dashboard counters come from v_admin_kpis now; the view is asserted
   * against a real database in the e2e suite. Here it is a fixture, so these
   * tests stay about what the service DOES with the numbers. */
  let routines: {
    adminKpis: jest.Mock; mttLiability: jest.Mock; payoutRatio: jest.Mock;
    treasuryPeriod: jest.Mock; expireStaleApprovals: jest.Mock;
  };
  let audit: { record: jest.Mock; recordOrThrow: jest.Mock };

  beforeEach(async () => {
    approvals = repo();
    permissions = repo();
    auditLogs = repo();
    users = repo();
    withdrawals = repo();
    alerts = repo();
    tickets = repo();
    commissions = repo();
    commission = {
      fundingAvailable: jest.fn(async () => ({
        poolFundedMtt: "1000", committedMtt: "400", availableMtt: "600",
        queuedMtt: "0", pendingKycMtt: "0", solvent: true,
      })),
    };
    notifications = { notify: jest.fn() };
    bus = { publish: jest.fn() };
    audit = { record: jest.fn(), recordOrThrow: jest.fn() };

    /* The dashboard's extra reads. `count` and the query builder are stubbed to
     * zero because these assertions are about governance, not about the tiles —
     * but they have to be present or the service cannot be constructed. */
    kycSubmissions = repo();
    pointsLedger = repo();
    pointsLedger.createQueryBuilder.mockReturnValue(qb({ rawOne: { total: "0" } }));

    routines = {
      adminKpis: jest.fn(async () => ({
        members: 0, activeMembers30d: 0, kycVerified: 0, frozenAccounts: 0,
        withdrawalsInReview: 0, openFraudAlerts: 0, pendingApprovals: 0,
        breachedTickets: 0, queuedCommissionMtt: "0",
      })),
      mttLiability: jest.fn(async () => ({
        accounts: 0, availableMtt: "0", stakedMtt: "0", pendingRewardsMtt: "0",
        lockedForWithdrawalMtt: "0", commissionAvailableMtt: "0", commissionPendingMtt: "0",
        totalLiabilityMtt: "0", totalPoints: "0",
      })),
      treasuryPeriod: jest.fn(async () => ({
        periodKey: "2026-08", reconciledInflow: "0", unreconciledInflow: "0", grossRevenue: "0",
        commissionPoolOut: "0", stakingPoolOut: "0", reserveOut: "0",
        inflowCount: 0, outflowCount: 0,
      })),
      payoutRatio: jest.fn(async () => ({
        periodKey: "2026-08", reconciledNetRevenue: "0", releasedCommission: "0",
        confirmedOutflow: "0", reconciledTreasuryInflow: "0",
        commissionRatioBps: null, outflowRatioBps: null,
      })),
      expireStaleApprovals: jest.fn(async () => 0),
    };

    const mod = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(ApprovalRequest), useValue: approvals },
        { provide: getRepositoryToken(RolePermission), useValue: permissions },
        { provide: getRepositoryToken(AuditLog), useValue: auditLogs },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(Withdrawal), useValue: withdrawals },
        { provide: getRepositoryToken(FraudAlert), useValue: alerts },
        { provide: getRepositoryToken(Ticket), useValue: tickets },
        { provide: getRepositoryToken(Commission), useValue: commissions },
        { provide: getRepositoryToken(KycSubmission), useValue: kycSubmissions },
        { provide: getRepositoryToken(PointsLedgerEntry), useValue: pointsLedger },
        { provide: CommissionService, useValue: commission },
        { provide: DbRoutinesService, useValue: routines },
        { provide: NotificationsService, useValue: notifications },
        { provide: EventBusService, useValue: bus },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    svc = mod.get(AdminService);
    approvals.findOne.mockResolvedValue({ ...PENDING });
    users.findOne.mockResolvedValue({ id: "u1", status: "active", isStaff: false });
    tickets.createQueryBuilder.mockImplementation(() => qb({ count: 0 }));
    users.createQueryBuilder.mockImplementation(() => qb({ count: 0 }));
    commissions.createQueryBuilder.mockImplementation(() => qb({ rawOne: { sum: "0" } }));
    /* The dashboard's in-flight withdrawal totals. */
    withdrawals.createQueryBuilder.mockImplementation(
      () => qb({ rawOne: { count: "0", amount: "0" } }),
    );
  });

  /* ==================================================================== *
   * Property 1 — four eyes
   * ==================================================================== */

  describe("decide", () => {
    it("REFUSES when the decider raised the request", async () => {
      await expect(
        svc.decide("APR-ABC", { decision: "approve", note: "looks fine to me" }, "finance-1", null),
      ).rejects.toMatchObject({ response: { code: "FOUR_EYES_VIOLATION" } });
      expect(approvals.save).not.toHaveBeenCalled();
    });

    it("approves for a different decider and records the note", async () => {
      const r = await svc.decide(
        "APR-ABC", { decision: "approve", note: "checked against the reconciliation" }, "finance-2", null,
      );

      expect(r.status).toBe("approved");
      expect(r.approverId).toBe("finance-2");
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ action: "approval.approved", approvedById: "finance-2" }),
      );
    });

    it("records a rejection with the same rigour as an approval", async () => {
      const r = await svc.decide(
        "APR-ABC", { decision: "reject", note: "the February reconciliation is not closed" }, "finance-2", null,
      );
      expect(r.status).toBe("rejected");
      expect(r.decisionNote).toContain("not closed");
    });

    it("REFUSES to decide something already decided", async () => {
      approvals.findOne.mockResolvedValue({ ...PENDING, status: "approved" });
      await expect(
        svc.decide("APR-ABC", { decision: "approve", note: "again" }, "finance-2", null),
      ).rejects.toMatchObject({ response: { code: "NOT_PENDING" } });
    });
  });

  describe("listApprovals", () => {
    it("excludes the caller's own requests from the decidable list", async () => {
      const builder = qb({});
      approvals.createQueryBuilder.mockReturnValue(builder);

      await svc.listApprovals({ decidableByMe: true, page: 1, limit: 25, sortDir: "DESC", skip: 0 } as never, "finance-1");

      const clauses = (builder.andWhere as jest.Mock).mock.calls.map((c) => c[0] as string);
      /* The UI cannot even offer a four-eyes violation. */
      expect(clauses.some((c) => c.includes("requestedById !="))).toBe(true);
      expect(clauses.some((c) => c.includes("expiresAt >"))).toBe(true);
    });
  });

  /* ==================================================================== *
   * Property 2 — expiry
   * ==================================================================== */

  describe("expiry", () => {
    it("REFUSES to decide an expired request, and marks it expired", async () => {
      approvals.findOne.mockResolvedValue({
        ...PENDING, expiresAt: new Date(Date.now() - HOUR),
      });

      await expect(
        svc.decide("APR-ABC", { decision: "approve", note: "found this in my queue" }, "finance-2", null),
      ).rejects.toMatchObject({ response: { code: "APPROVAL_EXPIRED" } });

      expect(approvals.save).toHaveBeenCalledWith(expect.objectContaining({ status: "expired" }));
    });

    it("sets a deadline on every new request", async () => {
      const before = Date.now();
      await svc.requestApproval(
        {
          kind: "treasury_outflow", targetId: "to-1", payload: {},
          reason: "funding the commission pool",
        },
        "finance-1",
        null,
      );

      const saved = approvals.save.mock.calls[0][0] as { expiresAt: Date };
      expect(saved.expiresAt.getTime()).toBeGreaterThan(before);
    });

    it("marks the consequential kinds as needing a hardware key", async () => {
      await svc.requestApproval(
        { kind: "treasury_outflow", payload: {}, reason: "moving funds to the pool" },
        "finance-1",
        null,
      );
      expect((approvals.save.mock.calls[0][0] as { requiresHardwareKey: boolean }).requiresHardwareKey).toBe(true);

      approvals.save.mockClear();
      await svc.requestApproval(
        { kind: "points_rule", payload: {}, reason: "tuning a gameplay rule" },
        "finance-1",
        null,
      );
      expect((approvals.save.mock.calls[0][0] as { requiresHardwareKey: boolean }).requiresHardwareKey).toBe(false);
    });

    it("sweeps stale requests in ONE statement, not one per row", async () => {
      /* It used to select up to a thousand rows and save each one back. The
       * expiry rule itself (pending, past expiresAt) is asserted against a real
       * database in the e2e suite. */
      routines.expireStaleApprovals.mockResolvedValue(7);

      const n = await svc.expireStaleApprovals();

      expect(n).toBe(7);
      expect(routines.expireStaleApprovals).toHaveBeenCalledTimes(1);
      expect(approvals.save).not.toHaveBeenCalled();
    });
  });

  describe("markApplied", () => {
    it("records that an approved change actually took effect", async () => {
      approvals.findOne.mockResolvedValue({ ...PENDING, status: "approved" });
      const r = await svc.markApplied("APR-ABC", "finance-2");
      expect(r.status).toBe("applied");
      expect(r.appliedAt).not.toBeNull();
    });

    it("REFUSES to apply something that was not approved", async () => {
      approvals.findOne.mockResolvedValue({ ...PENDING, status: "pending" });
      await expect(svc.markApplied("APR-ABC", "finance-2")).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  /* ==================================================================== *
   * Member state
   * ==================================================================== */

  describe("changeUserStatus", () => {
    it("REFUSES to set a verification-derived status", async () => {
      await expect(
        svc.changeUserStatus(
          "u1",
          { status: "verified_kyc_pending", reason: "member asked me to" },
          "support-1",
          null,
        ),
      ).rejects.toMatchObject({ response: { code: "STATUS_NOT_SETTABLE" } });
    });

    it("freezes with an audit entry and a security notification", async () => {
      const r = await svc.changeUserStatus(
        "u1",
        { status: "frozen", reason: "compliance hold pending source-of-funds review" },
        "compliance-1",
        "1.2.3.4",
      );

      expect(r.status).toBe("frozen");
      expect(r.previousStatus).toBe("active");
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ action: "compliance.account.frozen" }),
      );
      /* A member always learns that their funds are held. */
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "security" }),
      );
    });

    it("publishes the freeze so downstream holds apply", async () => {
      await svc.changeUserStatus("u1", { status: "frozen", reason: "hold pending review" }, "c1", null);
      const names = bus.publish.mock.calls.map((c) => c[0] as string);
      expect(names).toContain("compliance.account_frozen");
      expect(names).toContain("user.status_changed");
    });

    it("REFUSES to lock out a staff account through member status", async () => {
      users.findOne.mockResolvedValue({ id: "s1", status: "active", isStaff: true });
      await expect(
        svc.changeUserStatus("s1", { status: "suspended", reason: "offboarding this person" }, "admin-1", null),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("is a no-op when the status is already what was asked for", async () => {
      users.findOne.mockResolvedValue({ id: "u1", status: "frozen", isStaff: false });
      const r = await svc.changeUserStatus("u1", { status: "frozen", reason: "already held" }, "c1", null);
      expect(r.previousStatus).toBe("frozen");
      expect(users.save).not.toHaveBeenCalled();
    });
  });

  /* ==================================================================== *
   * RBAC
   * ==================================================================== */

  describe("setPermission", () => {
    it("calls out granting canApprove — that decides who can be the second approver", async () => {
      permissions.findOne.mockResolvedValue(null);

      await svc.setPermission(
        {
          role: "finance_admin", module: "treasury",
          canRead: true, canWrite: true, canApprove: true,
          reason: "finance leads now co-sign outflows",
        },
        "super-1",
        null,
      );

      const entry = audit.recordOrThrow.mock.calls[0][0] as { after: Record<string, unknown> };
      expect(entry.after.canApprove).toBe(true);
    });

    it("records the previous cell when a permission changes", async () => {
      permissions.findOne.mockResolvedValue({
        id: "p1", role: "support", module: "wallet", canRead: true, canWrite: false, canApprove: false,
      });

      await svc.setPermission(
        {
          role: "support", module: "wallet", canRead: true, canWrite: true, canApprove: false,
          reason: "support now edits payout notes",
        },
        "super-1",
        null,
      );

      const entry = audit.recordOrThrow.mock.calls[0][0] as { before: Record<string, unknown> };
      expect(entry.before.canWrite).toBe(false);
    });
  });

  /* ==================================================================== *
   * Dashboard
   * ==================================================================== */

  describe("kpis", () => {
    it("names what needs a human today rather than only counting", async () => {
      routines.adminKpis.mockResolvedValue({
        members: 10, activeMembers30d: 5, kycVerified: 4, frozenAccounts: 0,
        withdrawalsInReview: 3, openFraudAlerts: 2, pendingApprovals: 1,
        breachedTickets: 4, queuedCommissionMtt: "250",
      });

      const k = await svc.kpis();

      const joined = k.attentionRequired.join(" | ");
      expect(joined).toContain("withdrawals awaiting compliance review");
      expect(joined).toContain("open fraud alerts");
      expect(joined).toContain("past their SLA");
      expect(joined).toContain("waiting for a second approver");
      expect(joined).toContain("unfunded");
    });

    it("puts an insolvent commission pool FIRST — it is a release blocker", async () => {
      commission.fundingAvailable.mockResolvedValue({
        poolFundedMtt: "100", committedMtt: "400", availableMtt: "0",
        queuedMtt: "0", pendingKycMtt: "0", solvent: false,
      });

      const k = await svc.kpis();

      expect(k.commissionSolvent).toBe(false);
      expect(k.attentionRequired[0]).toContain("COMMISSION POOL INSOLVENT");
    });

    it("reads the invariant from the service that owns it", async () => {
      await svc.kpis();
      expect(commission.fundingAvailable).toHaveBeenCalled();
    });

    it("says nothing needs attention when nothing does", async () => {
      const k = await svc.kpis();
      expect(k.attentionRequired).toEqual([]);
      expect(k.commissionSolvent).toBe(true);
      expect(ConflictException).toBeDefined();
    });
  });

  /* ==================================================================== *
   * Audit trail
   * ==================================================================== */

  describe("auditTrail", () => {
    it("filters to four-eyes entries when asked", async () => {
      const builder = qb({});
      auditLogs.createQueryBuilder.mockReturnValue(builder);

      await svc.auditTrail({ fourEyesOnly: true, page: 1, limit: 25, sortDir: "DESC", skip: 0 } as never);

      const clauses = (builder.andWhere as jest.Mock).mock.calls.map((c) => c[0] as string);
      expect(clauses.some((c) => c.includes("requiredSecondApproval"))).toBe(true);
    });

    it("matches an action prefix rather than requiring an exact verb", async () => {
      const builder = qb({});
      auditLogs.createQueryBuilder.mockReturnValue(builder);

      await svc.auditTrail({ action: "treasury.", page: 1, limit: 25, sortDir: "DESC", skip: 0 } as never);

      const call = (builder.andWhere as jest.Mock).mock.calls.find(
        (c) => typeof c[0] === "string" && (c[0]).includes("l.action LIKE"),
      );
      expect(call?.[1]).toEqual({ action: "treasury.%" });
    });
  });
});
