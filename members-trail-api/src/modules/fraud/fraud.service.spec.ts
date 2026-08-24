import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import {
  Commission, FraudAlert, FraudRule, GameSession, ReferralEdge, User, Withdrawal,
} from "@/database/entities";
import { EventBusService } from "@/events";
import { AuditService } from "@/modules/audit/audit.service";
import { NotificationsService } from "@/modules/notifications/notifications.service";
import { FraudService } from "./fraud.service";
import { DbRoutinesService } from "@/database/routines/db-routines.service";

/* ============================================================================
 * What these tests protect, in order of how much harm getting it wrong causes:
 *
 *  1  DETECTION IS ADVISORY BY DEFAULT. Freezing a legitimate member's funds is
 *     itself a serious harm, so auto-freeze is opt-in per rule.
 *  2  ALERTS ARE DEDUPED. A pattern that persists must not alert every cron tick;
 *     that buries the real ones.
 *  3  EVERY ALERT CARRIES ITS SIGNALS. An alert a reviewer cannot disagree with
 *     is an instruction, not a finding.
 *  4  A DISMISSAL IS A DECISION and is audited like one.
 * ========================================================================== */

function repo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
    save: jest.fn(async (x: unknown) => ({ id: "row-1", ...(x as object) })),
    create: jest.fn((x: unknown) => x),
    count: jest.fn(async (..._a: unknown[]) => 0),
    createQueryBuilder: jest.fn(),
  };
}

function qb(rawMany: Record<string, unknown>[]) {
  const b: Record<string, unknown> = {};
  for (const m of [
    "select", "addSelect", "where", "andWhere", "groupBy", "having", "andHaving",
    "orderBy", "addOrderBy", "innerJoin", "skip", "take",
  ]) {
    b[m] = jest.fn(() => b);
  }
  b.getRawMany = jest.fn(async () => rawMany);
  b.getRawOne = jest.fn(async () => rawMany[0] ?? {});
  b.getManyAndCount = jest.fn(async () => [[], 0]);
  b.getMany = jest.fn(async () => []);
  return b;
}

describe("FraudService", () => {
  let svc: FraudService;
  let alerts: ReturnType<typeof repo>;
  let rules: ReturnType<typeof repo>;
  let users: ReturnType<typeof repo>;
  let withdrawals: ReturnType<typeof repo>;
  let sessions: ReturnType<typeof repo>;
  let edges: ReturnType<typeof repo>;
  let commissions: ReturnType<typeof repo>;
  let notifications: { notify: jest.Mock };
  let bus: { publish: jest.Mock };
  /* Risk bumps are one UPDATE now. The GREATEST semantics are asserted against a
   * real database in the e2e suite. */
  let routines: { bumpRiskScores: jest.Mock };
  let audit: { record: jest.Mock; recordOrThrow: jest.Mock };

  beforeEach(async () => {
    alerts = repo();
    rules = repo();
    users = repo();
    withdrawals = repo();
    sessions = repo();
    edges = repo();
    commissions = repo();
    notifications = { notify: jest.fn() };
    bus = { publish: jest.fn() };
    audit = { record: jest.fn(), recordOrThrow: jest.fn() };

    routines = { bumpRiskScores: jest.fn(async (ids: string[]) => ids.length) };

    const mod = await Test.createTestingModule({
      providers: [
        FraudService,
        { provide: getRepositoryToken(FraudAlert), useValue: alerts },
        { provide: getRepositoryToken(FraudRule), useValue: rules },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(Withdrawal), useValue: withdrawals },
        { provide: getRepositoryToken(GameSession), useValue: sessions },
        { provide: getRepositoryToken(ReferralEdge), useValue: edges },
        { provide: getRepositoryToken(Commission), useValue: commissions },
        { provide: NotificationsService, useValue: notifications },
        { provide: EventBusService, useValue: bus },
        { provide: DbRoutinesService, useValue: routines },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    svc = mod.get(FraudService);
    alerts.findOne.mockResolvedValue(null);
    rules.findOne.mockResolvedValue(null);
    users.findOne.mockResolvedValue({ id: "u1", status: "active", riskScore: 0 });
    withdrawals.createQueryBuilder.mockImplementation(() => qb([]));
    sessions.createQueryBuilder.mockImplementation(() => qb([]));
    edges.createQueryBuilder.mockImplementation(() => qb([]));
    commissions.createQueryBuilder.mockImplementation(() => qb([]));
  });

  const savedAlert = () => alerts.save.mock.calls[0]?.[0] as Record<string, unknown>;

  /* ==================================================================== *
   * Rule 1 — advisory by default
   * ==================================================================== */

  describe("auto-freeze", () => {
    it("does NOT freeze accounts when no rule opts in", async () => {
      await svc.raise({
        kind: "multi_account",
        affectedUserIds: ["u1", "u2"],
        summary: "5 accounts on one device",
        signals: ["device_shared"],
        riskScore: 60,
        dedupeKey: "multi_account:fp-1",
      });

      /* The alert exists; the funds are untouched. */
      expect(alerts.save).toHaveBeenCalled();
      expect(users.save).not.toHaveBeenCalledWith(expect.objectContaining({ status: "frozen" }));
    });

    it("freezes only when the rule explicitly opts in", async () => {
      rules.findOne.mockResolvedValue({
        kind: "structuring", enabled: true, autoFreeze: true, baseRiskScore: 90, thresholds: {},
      });

      await svc.raise({
        kind: "structuring",
        affectedUserIds: ["u1"],
        summary: "structured withdrawals",
        signals: ["structuring_pattern"],
        riskScore: 90,
        dedupeKey: "structuring:u1",
      });

      expect(users.save).toHaveBeenCalledWith(expect.objectContaining({ status: "frozen" }));
    });

    it("audits an automatic freeze with the alert as the reason", async () => {
      rules.findOne.mockResolvedValue({
        kind: "structuring", enabled: true, autoFreeze: true, baseRiskScore: 90, thresholds: {},
      });

      await svc.raise({
        kind: "structuring", affectedUserIds: ["u1"], summary: "structured withdrawals",
        signals: ["structuring_pattern"], riskScore: 90, dedupeKey: "structuring:u1",
      });

      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ action: "compliance.account.freeze.auto", actorId: null }),
      );
    });

    it("tells a frozen member as a SECURITY notification they cannot have muted", async () => {
      rules.findOne.mockResolvedValue({
        kind: "structuring", enabled: true, autoFreeze: true, baseRiskScore: 90, thresholds: {},
      });

      await svc.raise({
        kind: "structuring", affectedUserIds: ["u1"], summary: "s",
        signals: ["structuring_pattern"], riskScore: 90, dedupeKey: "structuring:u1",
      });

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "security", userId: "u1" }),
      );
    });

    it("never re-freezes an already frozen or closed account", async () => {
      rules.findOne.mockResolvedValue({
        kind: "structuring", enabled: true, autoFreeze: true, baseRiskScore: 90, thresholds: {},
      });
      users.findOne.mockResolvedValue({ id: "u1", status: "frozen", riskScore: 90 });

      await svc.raise({
        kind: "structuring", affectedUserIds: ["u1"], summary: "s",
        signals: ["x"], riskScore: 90, dedupeKey: "k",
      });

      expect(users.save).not.toHaveBeenCalled();
    });
  });

  /* ==================================================================== *
   * Rule 2 — dedupe
   * ==================================================================== */

  describe("dedupe", () => {
    it("UPDATES an open alert with the same key rather than duplicating it", async () => {
      alerts.findOne.mockResolvedValue({
        id: "a1", riskScore: 50, severity: "medium", signals: ["old_signal"],
        evidence: { a: 1 }, summary: "old", status: "open",
      });

      await svc.raise({
        kind: "velocity", affectedUserIds: ["u1"], summary: "new summary",
        signals: ["new_signal"], evidence: { b: 2 }, riskScore: 80,
        dedupeKey: "velocity:u1:2026-02-01T10",
      });

      const saved = alerts.save.mock.calls[0][0] as Record<string, unknown>;
      expect(saved.id).toBe("a1");
      /* Keeps the higher score and merges the signals. */
      expect(saved.riskScore).toBe(80);
      expect(saved.severity).toBe("high");
      expect(saved.signals).toEqual(["old_signal", "new_signal"]);
      expect(saved.evidence).toEqual({ a: 1, b: 2 });
    });

    it("does not lower a risk score that was already higher", async () => {
      alerts.findOne.mockResolvedValue({
        id: "a1", riskScore: 95, severity: "critical", signals: [], evidence: {}, status: "open",
      });

      await svc.raise({
        kind: "velocity", affectedUserIds: ["u1"], summary: "s",
        signals: [], riskScore: 20, dedupeKey: "k",
      });

      expect((alerts.save.mock.calls[0][0] as { riskScore: number }).riskScore).toBe(95);
    });

    it("raises a NEW alert when the pattern returns after a decision", async () => {
      /* findOne only matches open/investigating, so a resolved one does not
       * suppress the recurrence — the pattern coming back is information. */
      alerts.findOne.mockResolvedValue(null);

      await svc.raise({
        kind: "velocity", affectedUserIds: ["u1"], summary: "s",
        signals: ["x"], riskScore: 60, dedupeKey: "velocity:u1:hour",
      });

      expect(savedAlert().status).toBe("open");
      const [args] = alerts.findOne.mock.calls[0] as [{ where: { status: unknown } }];
      expect(JSON.stringify(args.where.status)).toContain("open");
    });
  });

  /* ==================================================================== *
   * Rule 3 — reviewable alerts
   * ==================================================================== */

  describe("alert content", () => {
    it("stores the signals and evidence a reviewer needs to disagree", async () => {
      await svc.raise({
        kind: "structuring",
        affectedUserIds: ["u1"],
        summary: "6 withdrawals just under the review threshold",
        signals: ["structuring_pattern", "requests=6", "all_below_review_threshold"],
        evidence: { requests: [{ ref: "WD-1", amountMtt: "499" }] },
        riskScore: 80,
        dedupeKey: "k",
      });

      const alert = savedAlert();
      expect(alert.signals).toContain("all_below_review_threshold");
      expect(alert.evidence).toBeDefined();
      expect(alert.summary).toContain("just under the review threshold");
    });

    it("derives severity from the risk score", async () => {
      const cases: [number, string][] = [
        [95, "critical"], [75, "high"], [50, "medium"], [10, "low"],
      ];
      for (const [score, severity] of cases) {
        alerts.save.mockClear();
        await svc.raise({
          kind: "velocity", affectedUserIds: ["u1"], summary: "s",
          signals: [], riskScore: score, dedupeKey: `k-${score}`,
        });
        expect(savedAlert().severity).toBe(severity);
      }
    });

    it("raises the member's stored risk score, which forces payouts into review", async () => {
      await svc.raise({
        kind: "velocity", affectedUserIds: ["u1"], summary: "s",
        signals: [], riskScore: 75, dedupeKey: "k",
      });
      /* One UPDATE for the whole affected set. That it RAISES rather than
       * assigns — so a sweep can never clear a manually raised score — is a
       * GREATEST in the statement, asserted against a real database in the e2e
       * suite. */
      expect(routines.bumpRiskScores).toHaveBeenCalledWith(["u1"], 75);
      expect(users.save).not.toHaveBeenCalled();
    });

    it("never LOWERS a member's risk score", async () => {
      users.findOne.mockResolvedValue({ id: "u1", status: "active", riskScore: 90 });
      await svc.raise({
        kind: "velocity", affectedUserIds: ["u1"], summary: "s",
        signals: [], riskScore: 30, dedupeKey: "k",
      });
      expect(users.save).not.toHaveBeenCalled();
    });

    it("caps the risk score at 100", async () => {
      await svc.raise({
        kind: "velocity", affectedUserIds: ["u1"], summary: "s",
        signals: [], riskScore: 500, dedupeKey: "k",
      });
      expect(routines.bumpRiskScores).toHaveBeenCalledWith(["u1"], 100);
    });
  });

  /* ==================================================================== *
   * Detection patterns
   * ==================================================================== */

  describe("sweepWithdrawalVelocity", () => {
    it("alerts on many requests inside the window", async () => {
      withdrawals.createQueryBuilder.mockImplementation(() =>
        qb([{ userId: "u1", count: "7", total: "3500" }]),
      );

      const r = await svc.sweepWithdrawalVelocity();

      expect(r.raised).toBe(1);
      expect(savedAlert().kind).toBe("velocity");
    });

    it("skips a disabled rule", async () => {
      rules.findOne.mockResolvedValue({ kind: "velocity", enabled: false, thresholds: {}, autoFreeze: false, baseRiskScore: 60 });
      const r = await svc.sweepWithdrawalVelocity();
      expect(r.skipped).toBe("DISABLED");
      expect(alerts.save).not.toHaveBeenCalled();
    });
  });

  describe("sweepStructuring", () => {
    it("alerts only when the amounts CLUSTER near each other under the threshold", async () => {
      withdrawals.createQueryBuilder.mockImplementation(() =>
        qb([{ userId: "u1", count: "4", total: "1960" }]),
      );
      /* Four requests all within 95% of the largest: deliberate sizing. */
      withdrawals.find.mockResolvedValue([
        { ref: "WD-1", amountMtt: "490", reviewRequired: false, createdAt: new Date() },
        { ref: "WD-2", amountMtt: "495", reviewRequired: false, createdAt: new Date() },
        { ref: "WD-3", amountMtt: "499", reviewRequired: false, createdAt: new Date() },
        { ref: "WD-4", amountMtt: "492", reviewRequired: false, createdAt: new Date() },
      ]);

      const r = await svc.sweepStructuring();

      expect(r.raised).toBe(1);
      expect(savedAlert().signals).toContain("all_below_review_threshold");
    });

    it("does NOT alert on genuinely varied amounts", async () => {
      withdrawals.createQueryBuilder.mockImplementation(() =>
        qb([{ userId: "u1", count: "4", total: "700" }]),
      );
      withdrawals.find.mockResolvedValue([
        { ref: "WD-1", amountMtt: "500", reviewRequired: false, createdAt: new Date() },
        { ref: "WD-2", amountMtt: "20", reviewRequired: false, createdAt: new Date() },
        { ref: "WD-3", amountMtt: "150", reviewRequired: false, createdAt: new Date() },
        { ref: "WD-4", amountMtt: "30", reviewRequired: false, createdAt: new Date() },
      ]);

      const r = await svc.sweepStructuring();

      /* A member managing their own money is not structuring. */
      expect(r.raised).toBe(0);
    });
  });

  describe("sweepDeviceClusters", () => {
    it("names every account on the shared device", async () => {
      let call = 0;
      sessions.createQueryBuilder.mockImplementation(() => {
        call += 1;
        return call === 1
          ? qb([{ fingerprint: "fp-1", accounts: "6" }])
          : qb([{ userId: "u1" }, { userId: "u2" }, { userId: "u3" }]);
      });

      const r = await svc.sweepDeviceClusters();

      expect(r.raised).toBe(1);
      expect(savedAlert().affectedUserIds).toEqual(["u1", "u2", "u3"]);
    });
  });

  describe("sweepSelfReferralRings", () => {
    it("returns each mutual pair once, from SQL, and orders the truncation", async () => {
      /* The de-duplication moved into the query: `a.userId < a.ancestorId`
       * returns one row per pair instead of two, so the 500-row limit covers
       * twice as many rings. The ORDER BY matters as much — with a bare LIMIT,
       * which pairs the sweep looked at was the optimiser's choice, so a ring
       * could go unexamined every night while the cron reported a clean run. */
      const builder = qb([{ userId: "a", ancestorId: "b" }]);
      edges.createQueryBuilder.mockReturnValue(builder);

      const r = await svc.sweepSelfReferralRings();

      expect(r.raised).toBe(1);
      expect(builder.where).toHaveBeenCalledWith("a.userId < a.ancestorId");
      expect(builder.orderBy).toHaveBeenCalledWith("a.createdAt", "DESC");
    });
  });

  describe("sweepBotFarming", () => {
    it("alerts on many very short VALIDATED sessions", async () => {
      sessions.createQueryBuilder.mockImplementation(() =>
        qb([{ userId: "u1", sessions: "120", avgDuration: "2500" }]),
      );

      const r = await svc.sweepBotFarming();

      expect(r.raised).toBe(1);
      expect(savedAlert().signals).toContain("avg_duration_ms=2500");
    });

    it("filters implausible durations in SQL, not after the fact", async () => {
      /* The duration test used to run in JavaScript, after the database had
       * shipped every member with enough sessions. Now it is a second HAVING, so
       * a member playing at a human pace is never returned at all. */
      const builder = qb([]);
      sessions.createQueryBuilder.mockReturnValue(builder);

      const r = await svc.sweepBotFarming();

      expect(r.raised).toBe(0);
      expect(builder.andHaving).toHaveBeenCalledWith(
        expect.stringContaining("AVG(s.durationMs) <= :maxDuration"),
        { maxDuration: 4_000 },
      );
    });
  });

  /* ==================================================================== *
   * Rule 4 — a dismissal is a decision
   * ==================================================================== */

  describe("resolve", () => {
    const open = {
      id: "a1", ref: "FA-ABC", kind: "structuring", severity: "high", riskScore: 80,
      affectedUserIds: ["u1"], summary: "s", signals: ["x"], evidence: {},
      status: "investigating", createdAt: new Date(),
    };

    it("audits a DISMISSAL with the reviewer's note", async () => {
      alerts.findOne.mockResolvedValue({ ...open });

      const r = await svc.resolve(
        "FA-ABC",
        { decision: "dismiss", note: "Member verified the transactions by phone" },
        "compliance-1",
      );

      expect(r.status).toBe("dismissed");
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "fraud.alert.dismissed",
          reason: "Member verified the transactions by phone",
        }),
      );
    });

    it("freezes only when the reviewer asks for it", async () => {
      alerts.findOne.mockResolvedValue({ ...open });

      await svc.resolve("FA-ABC", { decision: "action", note: "Confirmed farming" }, "compliance-1");
      expect(users.save).not.toHaveBeenCalled();

      alerts.findOne.mockResolvedValue({ ...open });
      await svc.resolve(
        "FA-ABC",
        { decision: "action", note: "Confirmed farming", freezeAccounts: true },
        "compliance-1",
      );
      expect(users.save).toHaveBeenCalledWith(expect.objectContaining({ status: "frozen" }));
    });

    it("REFUSES to resolve an already-resolved alert", async () => {
      alerts.findOne.mockResolvedValue({ ...open, status: "dismissed" });
      await expect(svc.resolve("FA-ABC", { decision: "action", note: "again" }, "c1"))
        .rejects.toMatchObject({ response: { code: "ALREADY_RESOLVED" } });
    });
  });

  /* ==================================================================== *
   * Rules as configuration
   * ==================================================================== */

  describe("upsertRule", () => {
    it("calls out enabling auto-freeze in the audit entry", async () => {
      rules.findOne.mockResolvedValue(null);

      await svc.upsertRule(
        {
          code: "STRUCT_1", name: "Structuring", description: "Detects structured withdrawals",
          kind: "structuring", thresholds: { minCount: 3 }, enabled: true,
          autoFreeze: true, baseRiskScore: 90,
          reason: "regulator asked for automatic holds on this pattern",
        },
        "compliance-1",
        "1.2.3.4",
      );

      const [entry] = audit.recordOrThrow.mock.calls[0] as [{ after: Record<string, unknown> }];
      expect(entry.after.autoFreeze).toBe(true);
    });

    it("records the previous thresholds when a rule is retuned", async () => {
      rules.findOne.mockResolvedValue({
        id: "r1", code: "STRUCT_1", kind: "structuring",
        thresholds: { minCount: 3 }, enabled: true, autoFreeze: false, baseRiskScore: 80,
      });

      await svc.upsertRule(
        {
          code: "STRUCT_1", name: "Structuring", description: "Detects structured withdrawals",
          kind: "structuring", thresholds: { minCount: 5 }, enabled: true,
          autoFreeze: false, baseRiskScore: 80, reason: "too many false positives at 3",
        },
        "compliance-1",
        null,
      );

      const [entry] = audit.recordOrThrow.mock.calls[0] as [{ before: Record<string, unknown> }];
      expect(entry.before.thresholds).toEqual({ minCount: 3 });
    });
  });
});
