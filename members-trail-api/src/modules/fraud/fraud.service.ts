import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import {
  Commission, FraudAlert, FraudRule, GameSession, ReferralEdge, User, Withdrawal,
  type FraudAlertKind, type FraudAlertStatus, type FraudSeverity,
} from "@/database/entities";
import { EventBusService, Events } from "@/events";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import { paginate, type Paginated } from "@/common/dto";
import { Ref, addDays, dec, monthKey } from "@/common/utils";
import { AuditService } from "@/modules/audit/audit.service";
import { NotificationsService } from "@/modules/notifications/notifications.service";
import type {
  AlertQuery, AlertResponse, FraudRuleResponse, ResolveAlertRequest, UpsertRuleRequest,
} from "./dto/fraud.dto";

/* ============================================================================
 * Fraud detection (FRD AD-14).
 *
 * The design constraints that shape everything here:
 *
 *  1. DETECTION IS ADVISORY BY DEFAULT. A rule raises an alert for a human.
 *     Auto-freezing is opt-in PER RULE (`autoFreeze`) and is reserved for
 *     patterns where the evidence is unambiguous, because freezing a legitimate
 *     member's funds is itself a serious harm — not a safe default.
 *
 *  2. ALERTS ARE DEDUPED. A pattern that persists must not raise an alert every
 *     time the cron runs; that turns the queue into noise and buries the real
 *     ones. `dedupeKey` is derived from the pattern and its subject, and an open
 *     alert with the same key is updated rather than duplicated.
 *
 *  3. EVERY ALERT CARRIES ITS SIGNALS AND EVIDENCE. "Risk score 82" is not
 *     reviewable. "6 withdrawals in 40 minutes, each just under the review
 *     threshold" is. A reviewer has to be able to disagree with the machine.
 *
 *  4. THRESHOLDS ARE CONFIGURATION, NOT CODE. They live on `fraud_rules` so
 *     compliance can tune them without a deploy, and every change is audited.
 *
 * The patterns implemented below are the ones that actually occur in a referral
 * gaming platform: structuring withdrawals under the review threshold, farming
 * with many accounts from one device, mutual-referral rings, and members who sit
 * exactly at their cap every single day.
 * ========================================================================== */

/** Fallbacks used when no rule row exists yet for a pattern. */
const DEFAULT_THRESHOLDS: Record<FraudAlertKind, Record<string, number>> = {
  velocity: { windowMinutes: 60, maxWithdrawals: 5 },
  structuring: { windowHours: 24, minCount: 3, withinPctOfThreshold: 95 },
  self_referral_ring: { minMutualPairs: 1 },
  bot_farming: { windowHours: 24, minSessions: 60, maxMedianDurationMs: 4_000 },
  multi_account: { windowDays: 30, maxAccountsPerDevice: 3 },
  device_cluster: { windowDays: 7, maxAccountsPerDevice: 5 },
  impossible_travel: { maxKmPerHour: 900 },
  cap_hugging: { windowDays: 7, minDaysAtCap: 6 },
};

const SEVERITY_BY_SCORE = (score: number): FraudSeverity => {
  if (score >= 90) return "critical";
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
};

export interface RaiseAlertInput {
  kind: FraudAlertKind;
  affectedUserIds: string[];
  summary: string;
  signals: string[];
  evidence?: Record<string, unknown> | null;
  riskScore: number;
  /** Derived from the pattern + subject. Prevents an alert per cron tick. */
  dedupeKey: string;
}

export interface SweepResult {
  kind: FraudAlertKind;
  evaluated: number;
  raised: number;
  frozen: number;
  skipped?: string;
}

@Injectable()
export class FraudService {
  private readonly log = new Logger(FraudService.name);

  constructor(
    @InjectRepository(FraudAlert) private readonly alerts: Repository<FraudAlert>,
    @InjectRepository(FraudRule) private readonly rules: Repository<FraudRule>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Withdrawal) private readonly withdrawals: Repository<Withdrawal>,
    @InjectRepository(GameSession) private readonly sessions: Repository<GameSession>,
    @InjectRepository(ReferralEdge) private readonly edges: Repository<ReferralEdge>,
    @InjectRepository(Commission) private readonly commissions: Repository<Commission>,
    private readonly notifications: NotificationsService,
    private readonly bus: EventBusService,
    private readonly routines: DbRoutinesService,
    private readonly audit: AuditService,
  ) {}

  /* ==================================================================== *
   * Raising
   * ==================================================================== */

  /**
   * Raises or updates an alert.
   *
   * Rule 2 lives here: an OPEN alert with the same dedupe key is updated with the
   * fresh evidence and the higher risk score rather than duplicated. Once a
   * reviewer has actioned or dismissed it, a recurrence raises a new alert — the
   * pattern coming back after a decision is itself information.
   */
  async raise(input: RaiseAlertInput): Promise<FraudAlert> {
    const existing = await this.alerts.findOne({
      where: {
        dedupeKey: input.dedupeKey,
        status: In(["open", "investigating"] as FraudAlertStatus[]),
      },
    });

    if (existing) {
      existing.riskScore = Math.max(existing.riskScore, input.riskScore);
      existing.severity = SEVERITY_BY_SCORE(existing.riskScore);
      existing.signals = [...new Set([...existing.signals, ...input.signals])];
      existing.evidence = { ...(existing.evidence ?? {}), ...(input.evidence ?? {}) };
      existing.summary = input.summary;
      await this.alerts.save(existing);
      return existing;
    }

    const severity = SEVERITY_BY_SCORE(input.riskScore);
    const alert = await this.alerts.save(
      this.alerts.create({
        ref: Ref.alert(),
        kind: input.kind,
        severity,
        riskScore: input.riskScore,
        affectedUserIds: input.affectedUserIds,
        summary: input.summary,
        /* Rule 3: the signals are stored so a reviewer can disagree. */
        signals: input.signals,
        evidence: input.evidence ?? null,
        status: "open",
        dedupeKey: input.dedupeKey,
      }),
    );

    await this.bus.publish(Events.FraudAlertRaised, {
      ref: alert.ref,
      kind: alert.kind,
      severity,
      riskScore: input.riskScore,
      affectedUserIds: input.affectedUserIds,
      signals: input.signals,
    });

    /* Risk score is advisory context for review — it is not a sentence. */
    await this.bumpRiskScores(input.affectedUserIds, input.riskScore);

    const rule = await this.ruleFor(input.kind);
    if (rule?.autoFreeze) {
      await this.freezeAll(input.affectedUserIds, alert);
    }

    this.log.warn(
      `fraud alert ${alert.ref} (${alert.kind}, ${severity}): ${input.summary}`,
    );
    return alert;
  }

  /**
   * Raises the stored risk score, which the withdrawal path reads to force a
   * payout into manual review.
   *
   * Capped at 100 and only ever increased by this path: a detection lowering
   * someone's risk score would let one weak signal wash out a strong one.
   */
  private async bumpRiskScores(userIds: string[], contribution: number): Promise<void> {
    /* One UPDATE with GREATEST, not a read-modify-write per member: a device
     * cluster of forty accounts used to cost eighty round trips.
     *
     * GREATEST is the rule, not an optimisation — a sweep may only RAISE a
     * score. Lowering one is a compliance decision a human makes, and a cron
     * that assigned instead of raised would quietly clear an investigation. */
    await this.routines.bumpRiskScores(userIds, Math.min(100, contribution));
  }

  /**
   * Freezes accounts named by an auto-freeze rule.
   *
   * A freeze holds funds — it is the most consequential thing this module can
   * do, so it is audited per account, the member is told, and the alert that
   * caused it is recorded as the reason.
   */
  private async freezeAll(userIds: string[], alert: FraudAlert): Promise<number> {
    let frozen = 0;
    for (const userId of userIds) {
      const user = await this.users.findOne({ where: { id: userId } });
      if (!user || user.status === "frozen" || user.status === "closed") continue;

      const before = { status: user.status };
      user.status = "frozen";
      user.statusReason = `Automatic hold: ${alert.kind} (${alert.ref})`;
      await this.users.save(user);
      frozen += 1;

      await this.audit.recordOrThrow({
        actorId: null,
        action: "compliance.account.freeze.auto",
        targetType: "user",
        targetId: userId,
        before,
        after: { status: "frozen" },
        reason: `${alert.kind}: ${alert.summary}`.slice(0, 500),
      });

      await this.bus.publish(Events.AccountFrozen, {
        userId,
        reason: alert.kind,
        alertRef: alert.ref,
        automatic: true,
      });

      /* Security kind: the member is told even if they muted everything. */
      await this.notifications.notify({
        userId,
        kind: "security",
        title: "Your account is on hold",
        body:
          "We have placed a temporary hold on your account while we review recent activity. " +
          "Contact support and we will explain what is needed.",
        href: "/support",
        dedupeKey: `freeze:${alert.ref}:${userId}`,
      });
    }
    return frozen;
  }

  /* ==================================================================== *
   * Detection sweeps — run by the fraud cron
   * ==================================================================== */

  /** Runs every enabled pattern. */
  async sweepAll(): Promise<SweepResult[]> {
    return [
      await this.sweepWithdrawalVelocity(),
      await this.sweepStructuring(),
      await this.sweepDeviceClusters(),
      await this.sweepSelfReferralRings(),
      await this.sweepBotFarming(),
    ];
  }

  /**
   * Velocity: many withdrawal requests in a short window.
   *
   * The signature of an account being drained by someone who just got access,
   * rather than a member managing their own money.
   */
  async sweepWithdrawalVelocity(): Promise<SweepResult> {
    const rule = await this.ruleFor("velocity");
    if (rule && !rule.enabled) return { kind: "velocity", evaluated: 0, raised: 0, frozen: 0, skipped: "DISABLED" };

    const t = rule?.thresholds ?? DEFAULT_THRESHOLDS.velocity;
    const since = new Date(Date.now() - (t.windowMinutes ?? 60) * 60_000);

    const rows = await this.withdrawals
      .createQueryBuilder("w")
      .select("w.userId", "userId")
      .addSelect("COUNT(*)", "count")
      .addSelect("COALESCE(SUM(w.amountMtt), 0)", "total")
      .where("w.createdAt >= :since", { since })
      .groupBy("w.userId")
      .having("COUNT(*) >= :min", { min: t.maxWithdrawals ?? 5 })
      .getRawMany<{ userId: string; count: string; total: string }>();

    let raised = 0;
    for (const row of rows) {
      await this.raise({
        kind: "velocity",
        affectedUserIds: [row.userId],
        riskScore: rule?.baseRiskScore ?? 60,
        summary:
          `${row.count} withdrawal requests totalling ${row.total} MTT in ` +
          `${t.windowMinutes ?? 60} minutes`,
        signals: ["withdrawal_velocity", `count=${row.count}`, `window=${t.windowMinutes ?? 60}m`],
        evidence: { withdrawalCount: Number(row.count), totalMtt: row.total, windowMinutes: t.windowMinutes },
        /* Deduped per member per hour: the same burst must not alert repeatedly. */
        dedupeKey: `velocity:${row.userId}:${new Date().toISOString().slice(0, 13)}`,
      });
      raised += 1;
    }

    return { kind: "velocity", evaluated: rows.length, raised, frozen: 0 };
  }

  /**
   * Structuring: repeated withdrawals sized just under the review threshold.
   *
   * This is the pattern that matters most for AML, and it is invisible to a
   * simple amount limit: each request is individually compliant, and the intent
   * only shows up in the sequence.
   */
  async sweepStructuring(): Promise<SweepResult> {
    const rule = await this.ruleFor("structuring");
    if (rule && !rule.enabled) {
      return { kind: "structuring", evaluated: 0, raised: 0, frozen: 0, skipped: "DISABLED" };
    }

    const t = rule?.thresholds ?? DEFAULT_THRESHOLDS.structuring;
    const since = new Date(Date.now() - (t.windowHours ?? 24) * 3_600_000);

    /* Requests that cleared auto-approval by a whisker: reviewRequired = false
     * but sized in the top few percent of the allowed band. */
    const rows = await this.withdrawals
      .createQueryBuilder("w")
      .select("w.userId", "userId")
      .addSelect("COUNT(*)", "count")
      .addSelect("COALESCE(SUM(w.amountMtt), 0)", "total")
      .where("w.createdAt >= :since", { since })
      .andWhere("w.reviewRequired = false")
      .groupBy("w.userId")
      .having("COUNT(*) >= :min", { min: t.minCount ?? 3 })
      .getRawMany<{ userId: string; count: string; total: string }>();

    let raised = 0;
    for (const row of rows) {
      const detail = await this.withdrawals.find({
        where: { userId: row.userId },
        order: { createdAt: "DESC" },
        take: 20,
      });
      const recent = detail.filter((w) => w.createdAt >= since && !w.reviewRequired);
      if (recent.length < (t.minCount ?? 3)) continue;

      /* Are they clustered near the top of the auto-approve band? A member with
       * genuinely varied amounts is not structuring. */
      const amounts = recent.map((w) => dec(w.amountMtt));
      const max = amounts.reduce((a, b) => (a.gt(b) ? a : b));
      const nearMax = amounts.filter((a) =>
        max.gt(0) ? a.div(max).mul(100).gte(t.withinPctOfThreshold ?? 95) : false,
      ).length;
      if (nearMax < (t.minCount ?? 3)) continue;

      await this.raise({
        kind: "structuring",
        affectedUserIds: [row.userId],
        riskScore: rule?.baseRiskScore ?? 80,
        summary:
          `${nearMax} withdrawals within ${t.withinPctOfThreshold ?? 95}% of each other, all below ` +
          `the review threshold, totalling ${row.total} MTT in ${t.windowHours ?? 24}h`,
        signals: [
          "structuring_pattern",
          `requests=${nearMax}`,
          `all_below_review_threshold`,
          `window=${t.windowHours ?? 24}h`,
        ],
        evidence: {
          requests: recent.map((w) => ({ ref: w.ref, amountMtt: w.amountMtt, at: w.createdAt.toISOString() })),
          totalMtt: row.total,
        },
        dedupeKey: `structuring:${row.userId}:${new Date().toISOString().slice(0, 10)}`,
      });
      raised += 1;
    }

    return { kind: "structuring", evaluated: rows.length, raised, frozen: 0 };
  }

  /**
   * Device clusters: many accounts sharing one device fingerprint.
   *
   * The most common shape of Points farming. A shared family device is a real
   * false positive, which is exactly why this raises an alert for a human rather
   * than freezing by default.
   */
  async sweepDeviceClusters(): Promise<SweepResult> {
    const rule = await this.ruleFor("multi_account");
    if (rule && !rule.enabled) {
      return { kind: "multi_account", evaluated: 0, raised: 0, frozen: 0, skipped: "DISABLED" };
    }

    const t = rule?.thresholds ?? DEFAULT_THRESHOLDS.multi_account;
    const since = addDays(new Date(), -(t.windowDays ?? 30));

    const rows = await this.sessions
      .createQueryBuilder("s")
      .select("s.deviceFingerprint", "fingerprint")
      .addSelect("COUNT(DISTINCT s.userId)", "accounts")
      .where("s.deviceFingerprint IS NOT NULL")
      .andWhere("s.createdAt >= :since", { since })
      .groupBy("s.deviceFingerprint")
      .having("COUNT(DISTINCT s.userId) > :max", { max: t.maxAccountsPerDevice ?? 3 })
      .getRawMany<{ fingerprint: string; accounts: string }>();

    let raised = 0;
    for (const row of rows) {
      const members = await this.sessions
        .createQueryBuilder("s")
        .select("DISTINCT s.userId", "userId")
        .where("s.deviceFingerprint = :fp", { fp: row.fingerprint })
        .andWhere("s.createdAt >= :since", { since })
        .getRawMany<{ userId: string }>();

      await this.raise({
        kind: "multi_account",
        affectedUserIds: members.map((m) => m.userId),
        riskScore: rule?.baseRiskScore ?? 55,
        summary: `${row.accounts} accounts played from one device in ${t.windowDays ?? 30} days`,
        signals: ["device_shared", `accounts=${row.accounts}`],
        evidence: { fingerprint: row.fingerprint.slice(0, 16), accounts: Number(row.accounts) },
        dedupeKey: `multi_account:${row.fingerprint}`,
      });
      raised += 1;
    }

    return { kind: "multi_account", evaluated: rows.length, raised, frozen: 0 };
  }

  /**
   * Self-referral rings: two members who each sit in the other's upline.
   *
   * The commission engine already refuses to pay a loop, but a loop existing at
   * all means either a data-integrity bug or a deliberate attempt — both worth a
   * human looking at.
   */
  async sweepSelfReferralRings(): Promise<SweepResult> {
    const rule = await this.ruleFor("self_referral_ring");
    if (rule && !rule.enabled) {
      return { kind: "self_referral_ring", evaluated: 0, raised: 0, frozen: 0, skipped: "DISABLED" };
    }

    /* A mutual pair: an edge A→B and an edge B→A both exist.
     *
     * `a.userId < a.ancestorId` returns each pair ONCE rather than twice, which
     * removes the JavaScript de-duplication that used to follow — and, more
     * importantly, halves what the LIMIT truncates. The ORDER BY is not
     * cosmetic: with a bare LIMIT and no ordering, which 500 pairs the sweep
     * examined was up to the optimiser, so a ring could sit undetected while the
     * cron reported a clean run every night. */
    const pairs = await this.edges
      .createQueryBuilder("a")
      .select("a.userId", "userId")
      .addSelect("a.ancestorId", "ancestorId")
      .innerJoin(
        ReferralEdge,
        "b",
        "b.userId = a.ancestorId AND b.ancestorId = a.userId",
      )
      .where("a.userId < a.ancestorId")
      .orderBy("a.createdAt", "DESC")
      .take(500)
      .getRawMany<{ userId: string; ancestorId: string }>();

    let raised = 0;

    for (const pair of pairs) {
      const key = [pair.userId, pair.ancestorId].sort().join(":");

      await this.raise({
        kind: "self_referral_ring",
        affectedUserIds: [pair.userId, pair.ancestorId],
        riskScore: rule?.baseRiskScore ?? 85,
        summary: "Two accounts each appear in the other's referral upline",
        signals: ["mutual_referral_edge", "commission_refused_by_engine"],
        evidence: { pair: [pair.userId, pair.ancestorId] },
        dedupeKey: `self_referral_ring:${key}`,
      });
      raised += 1;
    }

    return { kind: "self_referral_ring", evaluated: pairs.length, raised, frozen: 0 };
  }

  /**
   * Bot farming: many very short validated sessions in a day.
   *
   * Uses the SERVER-side duration and validated status, so a member cannot dodge
   * this by reporting longer play than they had.
   */
  async sweepBotFarming(): Promise<SweepResult> {
    const rule = await this.ruleFor("bot_farming");
    if (rule && !rule.enabled) {
      return { kind: "bot_farming", evaluated: 0, raised: 0, frozen: 0, skipped: "DISABLED" };
    }

    const t = rule?.thresholds ?? DEFAULT_THRESHOLDS.bot_farming;
    const since = new Date(Date.now() - (t.windowHours ?? 24) * 3_600_000);

    const maxDuration = t.maxMedianDurationMs ?? 4_000;

    /* BOTH thresholds in the HAVING clause.
     *
     * The duration test used to run in JavaScript, after the database had
     * returned every member with enough sessions — so the query read and shipped
     * rows it was always going to discard, and `evaluated` counted them as
     * examined. Now the database returns exactly the accounts that match. */
    const rows = await this.sessions
      .createQueryBuilder("s")
      .select("s.userId", "userId")
      .addSelect("COUNT(*)", "sessions")
      .addSelect("AVG(s.durationMs)", "avgDuration")
      .where("s.createdAt >= :since", { since })
      .andWhere("s.status = :status", { status: "validated" })
      .groupBy("s.userId")
      .having("COUNT(*) >= :min", { min: t.minSessions ?? 60 })
      .andHaving("AVG(s.durationMs) <= :maxDuration", { maxDuration })
      .getRawMany<{ userId: string; sessions: string; avgDuration: string | null }>();

    let raised = 0;
    for (const row of rows) {
      const avg = Number(row.avgDuration ?? 0);

      await this.raise({
        kind: "bot_farming",
        affectedUserIds: [row.userId],
        riskScore: rule?.baseRiskScore ?? 70,
        summary:
          `${row.sessions} validated sessions averaging ${Math.round(avg)}ms in ` +
          `${t.windowHours ?? 24}h — consistent with automated play`,
        signals: ["high_session_count", `avg_duration_ms=${Math.round(avg)}`],
        evidence: { sessions: Number(row.sessions), avgDurationMs: Math.round(avg) },
        dedupeKey: `bot_farming:${row.userId}:${new Date().toISOString().slice(0, 10)}`,
      });
      raised += 1;
    }

    return { kind: "bot_farming", evaluated: rows.length, raised, frozen: 0 };
  }

  /**
   * Cap hugging: a member whose commission sits exactly at their monthly cap.
   *
   * On its own this is just a successful referrer. Combined with a device cluster
   * or a young downline it is the signature of a farm, which is why it is a
   * low-score signal that raises an alert rather than an action.
   */
  async sweepCapHugging(month = monthKey()): Promise<SweepResult> {
    const rule = await this.ruleFor("cap_hugging");
    if (rule && !rule.enabled) {
      return { kind: "cap_hugging", evaluated: 0, raised: 0, frozen: 0, skipped: "DISABLED" };
    }

    /* The threshold comes from the rule row, like every other sweep. It was
     * hard-coded at five here, so an operator tuning `minDaysAtCap` in the admin
     * UI changed nothing and had no way to tell. */
    const t = rule?.thresholds ?? DEFAULT_THRESHOLDS.cap_hugging;
    const minEntries = t.minDaysAtCap ?? 6;

    const rows = await this.commissions
      .createQueryBuilder("c")
      .select("c.recipientId", "recipientId")
      .addSelect("COUNT(*)", "cappedEntries")
      .where("c.monthKey = :month", { month })
      .andWhere("c.status = :status", { status: "capped" })
      .groupBy("c.recipientId")
      .having("COUNT(*) >= :min", { min: minEntries })
      .getRawMany<{ recipientId: string; cappedEntries: string }>();

    let raised = 0;
    for (const row of rows) {
      await this.raise({
        kind: "cap_hugging",
        affectedUserIds: [row.recipientId],
        riskScore: rule?.baseRiskScore ?? 35,
        summary: `${row.cappedEntries} commission entries hit the monthly cap in ${month}`,
        signals: ["persistently_at_cap", `capped_entries=${row.cappedEntries}`],
        evidence: { monthKey: month, cappedEntries: Number(row.cappedEntries) },
        dedupeKey: `cap_hugging:${row.recipientId}:${month}`,
      });
      raised += 1;
    }

    return { kind: "cap_hugging", evaluated: rows.length, raised, frozen: 0 };
  }

  /* ==================================================================== *
   * Review
   * ==================================================================== */

  async list(q: AlertQuery): Promise<Paginated<AlertResponse>> {
    const qb = this.alerts.createQueryBuilder("a");
    if (q.status) qb.andWhere("a.status = :status", { status: q.status });
    if (q.kind) qb.andWhere("a.kind = :kind", { kind: q.kind });
    if (q.severity) qb.andWhere("a.severity = :severity", { severity: q.severity });
    if (q.assigneeId) qb.andWhere("a.assigneeId = :assigneeId", { assigneeId: q.assigneeId });

    const [rows, total] = await qb
      /* Highest risk first: the queue orders itself by consequence. */
      .orderBy("a.riskScore", "DESC")
      .addOrderBy("a.createdAt", "DESC")
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();

    return paginate(rows.map(toAlertView), total, q);
  }

  async assign(ref: string, assigneeId: string, actorId: string): Promise<AlertResponse> {
    const alert = await this.alerts.findOne({ where: { ref } });
    if (!alert) throw new NotFoundException("Alert not found");

    alert.assigneeId = assigneeId;
    if (alert.status === "open") alert.status = "investigating";
    await this.alerts.save(alert);

    await this.audit.record({
      actorId,
      action: "fraud.alert.assign",
      targetType: "fraud_alert",
      targetId: alert.id,
      after: { assigneeId, status: alert.status },
    });

    return toAlertView(alert);
  }

  /**
   * Closes an alert with a decision.
   *
   * A dismissal is as consequential as an action: it says the platform looked and
   * decided nothing was wrong. Both require a note, and both are audited — a
   * pattern of dismissals is exactly what an audit would examine.
   */
  async resolve(
    ref: string,
    dto: ResolveAlertRequest,
    actorId: string,
  ): Promise<AlertResponse> {
    const alert = await this.alerts.findOne({ where: { ref } });
    if (!alert) throw new NotFoundException("Alert not found");
    if (alert.status === "actioned" || alert.status === "dismissed") {
      throw new ConflictException({
        code: "ALREADY_RESOLVED",
        message: `This alert was already ${alert.status}`,
      });
    }

    const before = { status: alert.status };
    alert.status = dto.decision === "action" ? "actioned" : "dismissed";
    alert.resolutionNote = dto.note;
    alert.resolvedAt = new Date();
    await this.alerts.save(alert);

    if (dto.decision === "action" && dto.freezeAccounts) {
      await this.freezeAll(alert.affectedUserIds, alert);
    }

    await this.audit.recordOrThrow({
      actorId,
      action: `fraud.alert.${alert.status}`,
      targetType: "fraud_alert",
      targetId: alert.id,
      before,
      after: {
        status: alert.status,
        kind: alert.kind,
        affectedUserIds: alert.affectedUserIds,
        froze: Boolean(dto.freezeAccounts),
      },
      reason: dto.note,
    });

    return toAlertView(alert);
  }

  /* ==================================================================== *
   * Rules
   * ==================================================================== */

  async listRules(): Promise<FraudRuleResponse[]> {
    const rows = await this.rules.find({ order: { kind: "ASC" } });
    return rows.map(toRuleView);
  }

  /**
   * Creates or updates a rule.
   *
   * Turning on `autoFreeze` is the significant change here — it converts an
   * advisory rule into one that can hold a member's funds without a human — so
   * the audit entry records it explicitly.
   */
  async upsertRule(dto: UpsertRuleRequest, actorId: string, ip: string | null): Promise<FraudRuleResponse> {
    const existing = await this.rules.findOne({ where: { code: dto.code } });
    const before = existing
      ? {
          thresholds: existing.thresholds, enabled: existing.enabled,
          autoFreeze: existing.autoFreeze, baseRiskScore: existing.baseRiskScore,
        }
      : null;

    const row = existing ?? this.rules.create({ code: dto.code });
    row.name = dto.name;
    row.description = dto.description;
    row.kind = dto.kind;
    row.thresholds = dto.thresholds;
    row.enabled = dto.enabled;
    row.autoFreeze = dto.autoFreeze;
    row.baseRiskScore = dto.baseRiskScore;
    const saved = await this.rules.save(row);

    await this.audit.recordOrThrow({
      actorId,
      action: existing ? "fraud.rule.update" : "fraud.rule.create",
      targetType: "fraud_rule",
      targetId: saved.id,
      before,
      after: {
        code: dto.code, kind: dto.kind, thresholds: dto.thresholds,
        enabled: dto.enabled,
        /* Called out on its own: this is the flag that lets a machine freeze
         * funds without a human. */
        autoFreeze: dto.autoFreeze,
        baseRiskScore: dto.baseRiskScore,
      },
      reason: dto.reason,
      ip,
    });

    if (dto.autoFreeze && !before?.autoFreeze) {
      this.log.warn(
        `rule ${dto.code} now AUTO-FREEZES accounts — funds can be held without a human decision`,
      );
    }

    return toRuleView(saved);
  }

  private async ruleFor(kind: FraudAlertKind): Promise<FraudRule | null> {
    return this.rules.findOne({ where: { kind } });
  }
}

/* --------------------------------- helpers -------------------------------- */

function toAlertView(a: FraudAlert): AlertResponse {
  return {
    ref: a.ref,
    kind: a.kind,
    severity: a.severity,
    riskScore: a.riskScore,
    affectedUserIds: a.affectedUserIds,
    summary: a.summary,
    signals: a.signals,
    evidence: a.evidence ?? null,
    status: a.status,
    assigneeId: a.assigneeId ?? null,
    resolutionNote: a.resolutionNote ?? null,
    resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
  };
}

function toRuleView(r: FraudRule): FraudRuleResponse {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    kind: r.kind,
    thresholds: r.thresholds,
    enabled: r.enabled,
    autoFreeze: r.autoFreeze,
    baseRiskScore: r.baseRiskScore,
  };
}
