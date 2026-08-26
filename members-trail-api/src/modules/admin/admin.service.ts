import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  ApprovalRequest, AuditLog, Commission, FraudAlert, KycSubmission, PointsLedgerEntry,
  RolePermission, Ticket, User, Withdrawal,
  type ApprovalKind, type UserStatus,
} from "@/database/entities";
import { EventBusService, Events } from "@/events";
import { paginate, safeSort, type Paginated } from "@/common/dto";
import { Ref, addHours, dec, monthKey, toDbAmount } from "@/common/utils";
import { AuditService } from "@/modules/audit/audit.service";
import { NotificationsService } from "@/modules/notifications/notifications.service";
import { CommissionService } from "@/modules/referral/commission.service";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import { MEMBER_SORTS } from "./dto/admin.dto";
import type {
  ApprovalQuery, ApprovalResponse, AuditEntryResponse, AuditQuery, ChangeUserStatusRequest,
  CreateApprovalRequest, DecideApprovalRequest, MemberQuery, MemberSummaryResponse,
  PlatformKpisResponse, RolePermissionResponse, SetRolePermissionRequest, StaffIdentityResponse,
  StaffMemberResponse,
} from "./dto/admin.dto";

/* ============================================================================
 * Governance: dual control, RBAC, the audit trail and the operations dashboard
 * (FRD AD-01, AD-02, AD-08).
 *
 * The dual-control record here is the GENERIC one. Modules that need it for a
 * specific action — a rate change, a treasury outflow, a plan version — enforce
 * four eyes inline on their own rows, because the check has to be next to the
 * thing it protects. This service exists for the actions that have no natural
 * home, and to give compliance one queue to work from.
 *
 * Two properties it guarantees:
 *
 *  1. THE APPROVER IS NEVER THE REQUESTER. Checked here, and the query that
 *     lists "what can I decide" excludes the caller's own requests, so the UI
 *     cannot even offer it.
 *
 *  2. A PENDING REQUEST EXPIRES. Without that, an approval raised during an
 *     incident can be applied months later, when the reasoning no longer holds
 *     and nobody remembers it. The expiry is enforced at decision time, not just
 *     displayed.
 * ========================================================================== */

/** How long a request stays decidable. */
const APPROVAL_TTL_HOURS = 72;

/** Kinds whose consequence justifies requiring a hardware key. */
const HARDWARE_KEY_KINDS = new Set<ApprovalKind>([
  "treasury_outflow", "balance_adjustment", "commission_plan", "role_assignment",
]);

/** Status transitions an operator may make directly. Anything else is a bug. */
const ALLOWED_STATUS_TARGETS = new Set<UserStatus>(["active", "suspended", "frozen", "closed"]);

@Injectable()
export class AdminService {
  private readonly log = new Logger(AdminService.name);

  constructor(
    @InjectRepository(ApprovalRequest) private readonly approvals: Repository<ApprovalRequest>,
    @InjectRepository(RolePermission) private readonly permissions: Repository<RolePermission>,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Withdrawal) private readonly withdrawals: Repository<Withdrawal>,
    @InjectRepository(FraudAlert) private readonly alerts: Repository<FraudAlert>,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(Commission) private readonly commissions: Repository<Commission>,
    @InjectRepository(KycSubmission) private readonly kycSubmissions: Repository<KycSubmission>,
    @InjectRepository(PointsLedgerEntry) private readonly pointsLedger: Repository<PointsLedgerEntry>,
    private readonly commission: CommissionService,
    private readonly routines: DbRoutinesService,
    private readonly notifications: NotificationsService,
    private readonly bus: EventBusService,
    private readonly audit: AuditService,
  ) {}

  /* ==================================================================== *
   * Dual control
   * ==================================================================== */

  async requestApproval(
    dto: CreateApprovalRequest,
    actorId: string,
    ip: string | null,
  ): Promise<ApprovalResponse> {
    const row = await this.approvals.save(
      this.approvals.create({
        ref: Ref.audit().replace("AL-", "APR-"),
        kind: dto.kind,
        targetId: dto.targetId ?? null,
        payload: dto.payload,
        reason: dto.reason,
        requestedById: actorId,
        status: "pending",
        /* Property 2: every request has a deadline from the moment it is made. */
        expiresAt: addHours(new Date(), APPROVAL_TTL_HOURS),
        requiresHardwareKey: HARDWARE_KEY_KINDS.has(dto.kind),
      }),
    );

    await this.audit.recordOrThrow({
      actorId,
      action: "approval.request",
      targetType: "approval_request",
      targetId: row.id,
      after: { kind: dto.kind, targetId: dto.targetId ?? null },
      reason: dto.reason,
      ip,
      requiredSecondApproval: true,
    });

    await this.bus.publish(Events.ApprovalRequested, {
      ref: row.ref,
      kind: dto.kind,
      targetId: dto.targetId ?? null,
      requestedById: actorId,
      expiresAt: row.expiresAt.toISOString(),
      requiresHardwareKey: row.requiresHardwareKey,
    });

    return toApprovalView(row);
  }

  /**
   * Decides a pending request.
   *
   * Refuses when the decider raised it (property 1) and when it has expired
   * (property 2). The expiry is enforced here rather than by a cron, so a request
   * cannot be decided in the window between expiring and being swept.
   */
  async decide(
    ref: string,
    dto: DecideApprovalRequest,
    actorId: string,
    ip: string | null,
  ): Promise<ApprovalResponse> {
    const row = await this.approvals.findOne({ where: { ref } });
    if (!row) throw new NotFoundException("Approval request not found");

    if (row.status !== "pending") {
      throw new ConflictException({
        code: "NOT_PENDING",
        message: `This request is ${row.status} and can no longer be decided`,
      });
    }
    if (row.requestedById === actorId) {
      throw new ForbiddenException({
        code: "FOUR_EYES_VIOLATION",
        message: "A request must be decided by someone other than the person who raised it",
      });
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      /* Marked expired on the way out, so the queue reflects reality. */
      row.status = "expired";
      await this.approvals.save(row);
      throw new ConflictException({
        code: "APPROVAL_EXPIRED",
        message:
          "This request expired. Raise it again with current reasoning rather than applying " +
          "a decision nobody remembers making.",
        expiresAt: row.expiresAt.toISOString(),
      });
    }

    const before = { status: row.status };
    row.status = dto.decision === "approve" ? "approved" : "rejected";
    row.approverId = actorId;
    row.decisionNote = dto.note;
    row.decidedAt = new Date();
    await this.approvals.save(row);

    await this.audit.recordOrThrow({
      actorId,
      action: `approval.${row.status}`,
      targetType: "approval_request",
      targetId: row.id,
      before,
      after: { status: row.status, kind: row.kind, targetId: row.targetId },
      reason: dto.note,
      ip,
      approvedById: actorId,
    });

    await this.bus.publish(Events.ApprovalDecided, {
      ref: row.ref,
      kind: row.kind,
      targetId: row.targetId,
      decision: row.status,
      decidedById: actorId,
    });

    return toApprovalView(row);
  }

  /**
   * Marks an approved request as applied.
   *
   * Separate from the decision because approving and applying are different acts
   * at different times: the record needs to show that the approved change
   * actually took effect, and which one did not.
   */
  async markApplied(ref: string, actorId: string): Promise<ApprovalResponse> {
    const row = await this.approvals.findOne({ where: { ref } });
    if (!row) throw new NotFoundException("Approval request not found");
    if (row.status !== "approved") {
      throw new BadRequestException({
        code: "NOT_APPROVED",
        message: `Only an approved request can be applied; this one is ${row.status}`,
      });
    }

    row.status = "applied";
    row.appliedAt = new Date();
    await this.approvals.save(row);

    await this.audit.recordOrThrow({
      actorId,
      action: "approval.applied",
      targetType: "approval_request",
      targetId: row.id,
      after: { status: "applied", kind: row.kind },
      reason: row.reason,
    });

    return toApprovalView(row);
  }

  async listApprovals(q: ApprovalQuery, actorId: string): Promise<Paginated<ApprovalResponse>> {
    const qb = this.approvals.createQueryBuilder("a");
    if (q.status) qb.andWhere("a.status = :status", { status: q.status });
    if (q.kind) qb.andWhere("a.kind = :kind", { kind: q.kind });
    if (q.decidableByMe) {
      /* Property 1 in the query: the UI cannot offer the caller their own request. */
      qb.andWhere("a.status = :pending", { pending: "pending" })
        .andWhere("a.requestedById != :actorId", { actorId })
        .andWhere("a.expiresAt > :now", { now: new Date() });
    }

    const [rows, total] = await qb
      .orderBy("a.createdAt", "DESC")
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();

    return paginate(rows.map(toApprovalView), total, q);
  }

  /** Sweeps requests past their deadline. Run by the cron. */
  async expireStaleApprovals(): Promise<number> {
    /* One UPDATE. This was a SELECT of up to a thousand rows followed by a
     * thousand single-row saves, and it ran hourly. */
    const expired = await this.routines.expireStaleApprovals();
    if (expired > 0) this.log.log(`expired ${expired} stale approval requests`);
    return expired;
  }

  /* ==================================================================== *
   * Member state
   * ==================================================================== */

  /**
   * Changes an account's status.
   *
   * Freezing holds funds and suspending removes access, so both are audited with
   * a mandatory reason and the member is told — as a security notification, which
   * they cannot have muted. An operator cannot set an account back to a
   * verification state from here: that would misrepresent an identity check that
   * did or did not happen.
   */
  async changeUserStatus(
    userId: string,
    dto: ChangeUserStatusRequest,
    actorId: string,
    ip: string | null,
  ): Promise<{ userId: string; status: UserStatus; previousStatus: UserStatus }> {
    if (!ALLOWED_STATUS_TARGETS.has(dto.status)) {
      throw new BadRequestException({
        code: "STATUS_NOT_SETTABLE",
        message:
          `${dto.status} is derived from verification and KYC, not set by an operator. ` +
          "Settable states are active, suspended, frozen and closed.",
      });
    }

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("Account not found");
    if (user.status === dto.status) {
      return { userId, status: dto.status, previousStatus: dto.status };
    }
    if (user.isStaff && dto.status !== "active") {
      /* A staff account being locked out is an access-control decision, not a
       * member-support one, and goes through role management. */
      throw new ForbiddenException({
        code: "STAFF_ACCOUNT",
        message: "Staff access is managed through role assignment, not member status",
      });
    }

    const previousStatus = user.status;
    user.status = dto.status;
    user.statusReason = dto.reason;
    await this.users.save(user);

    await this.audit.recordOrThrow({
      actorId,
      action: `compliance.account.${dto.status}`,
      targetType: "user",
      targetId: userId,
      before: { status: previousStatus },
      after: { status: dto.status },
      reason: dto.reason,
      ip,
    });

    if (dto.status === "frozen") {
      await this.bus.publish(Events.AccountFrozen, {
        userId,
        reason: dto.reason,
        automatic: false,
        actorId,
      });
    }
    await this.bus.publish(Events.UserStatusChanged, {
      userId,
      from: previousStatus,
      to: dto.status,
      reason: dto.reason,
      actorId,
    });

    /* Security kind: a member always learns that their access or funds changed. */
    await this.notifications.notify({
      userId,
      kind: "security",
      title: statusTitle(dto.status),
      body: dto.reason,
      href: "/support",
      dedupeKey: `status:${userId}:${dto.status}:${Date.now()}`,
    });

    return { userId, status: dto.status, previousStatus };
  }

  /* ==================================================================== *
   * RBAC
   * ==================================================================== */

  async permissionMatrix(): Promise<RolePermissionResponse[]> {
    const rows = await this.permissions.find({ order: { role: "ASC", module: "ASC" } });
    return rows.map((p) => ({
      role: p.role,
      module: p.module,
      canRead: p.canRead,
      canWrite: p.canWrite,
      canApprove: p.canApprove,
    }));
  }

  /**
   * Sets one cell of the permission matrix.
   *
   * Granting `canApprove` is the significant one: it decides who can be the
   * second pair of eyes, so the audit entry records it explicitly.
   */
  async setPermission(
    dto: SetRolePermissionRequest,
    actorId: string,
    ip: string | null,
  ): Promise<RolePermissionResponse> {
    const existing = await this.permissions.findOne({
      where: { role: dto.role, module: dto.module },
    });
    const before = existing
      ? { canRead: existing.canRead, canWrite: existing.canWrite, canApprove: existing.canApprove }
      : null;

    const row = existing ?? this.permissions.create({ role: dto.role, module: dto.module });
    row.canRead = dto.canRead;
    row.canWrite = dto.canWrite;
    row.canApprove = dto.canApprove;
    const saved = await this.permissions.save(row);

    await this.audit.recordOrThrow({
      actorId,
      action: "rbac.permission.set",
      targetType: "role_permission",
      targetId: saved.id,
      before,
      after: {
        role: dto.role, module: dto.module,
        canRead: dto.canRead, canWrite: dto.canWrite,
        /* Called out: this is who can be the second pair of eyes. */
        canApprove: dto.canApprove,
      },
      reason: dto.reason,
      ip,
    });

    if (dto.canApprove && !before?.canApprove) {
      this.log.warn(`role ${dto.role} can now APPROVE in ${dto.module}`);
    }

    return {
      role: saved.role,
      module: saved.module,
      canRead: saved.canRead,
      canWrite: saved.canWrite,
      canApprove: saved.canApprove,
    };
  }

  /* ==================================================================== *
   * Audit trail
   * ==================================================================== */

  /**
   * Reads the audit trail.
   *
   * Read-only by construction: this service has no update or delete path for
   * `audit_logs`, and the production grant is INSERT/SELECT only. An audit trail
   * an operator can edit is not evidence of anything.
   */
  async auditTrail(q: AuditQuery): Promise<Paginated<AuditEntryResponse>> {
    const qb = this.auditLogs.createQueryBuilder("l");
    if (q.actorId) qb.andWhere("l.actorId = :actorId", { actorId: q.actorId });
    if (q.action) qb.andWhere("l.action LIKE :action", { action: `${q.action}%` });
    if (q.targetType) qb.andWhere("l.targetType = :targetType", { targetType: q.targetType });
    if (q.targetId) qb.andWhere("l.targetId = :targetId", { targetId: q.targetId });
    if (q.fourEyesOnly) qb.andWhere("l.requiredSecondApproval = true");

    const [rows, total] = await qb
      .orderBy("l.createdAt", "DESC")
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();

    return paginate(
      rows.map((l) => ({
        ref: l.ref,
        actorId: l.actorId ?? null,
        actorRole: l.actorRole ?? null,
        action: l.action,
        targetType: l.targetType ?? null,
        targetId: l.targetId ?? null,
        before: l.before ?? null,
        after: l.after ?? null,
        reason: l.reason ?? null,
        requiredSecondApproval: l.requiredSecondApproval,
        approvedById: l.approvedById ?? null,
        ip: l.ip ?? null,
        createdAt: l.createdAt.toISOString(),
      })),
      total,
      q,
    );
  }

  /* ==================================================================== *
   * Dashboard
   * ==================================================================== */

  /**
   * The operations dashboard.
   *
   * `attentionRequired` is the point of it: a list of counts tells an operator
   * nothing about what to do next, so the service names the things that need a
   * human today rather than leaving them to spot a number that looks wrong.
   */
  async kpis(): Promise<PlatformKpisResponse> {
    /* One read of v_admin_kpis. This was thirteen statements — six counts, three
     * more queries, and a four-query solvency check — on every dashboard load,
     * and one of them (active members in the last 30 days) scanned the whole
     * users table for want of an index. */
    const k = await this.routines.adminKpis();
    /* Coerced through Number: a COUNT over a view arrives from the driver as a
     * string, and a response that mixes 4 with "0" sorts as text in the browser. */
    const members = Number(k.members);
    const activeMembers30d = Number(k.activeMembers30d);
    const kycVerified = Number(k.kycVerified);
    const frozen = Number(k.frozenAccounts);
    const withdrawalsInReview = Number(k.withdrawalsInReview);
    const openFraudAlerts = Number(k.openFraudAlerts);
    const pendingApprovals = Number(k.pendingApprovals);
    const breachedTickets = Number(k.breachedTickets);

    /* The invariant itself, from the service that owns it — rather than a second,
     * possibly-divergent calculation here. */
    const solvency = await this.commission.fundingAvailable();

    /* The dashboard's tiles and charts. Six index-backed reads in parallel: the
     * alternative was a second endpoint, and a dashboard assembled from two
     * responses shows an operator a half-updated screen — which is precisely the
     * mistake this page exists to catch. */
    const [
      liability, ratio, treasury, activeToday, activeYesterday, active30dPrior,
      points30d, pendingWithdrawals, openKyc, openTickets,
    ] = await Promise.all([
        this.routines.mttLiability(),
        this.routines.payoutRatio(monthKey()),
        this.routines.treasuryPeriod(monthKey()),
        this.activeMembersToday(),
        this.activeMembersOnDay(1),
        this.activeMembersInWindow(60, 30),
        this.pointsIssuedSince(30),
        this.pendingWithdrawalTotals(),
        this.kycSubmissions.count({ where: [{ status: "pending" }, { status: "in_review" }] }),
        this.tickets.count({
          where: [{ status: "open" }, { status: "pending_user" }, { status: "escalated" }],
        }),
      ]);

    const queuedCommissionMtt = toDbAmount(k.queuedCommissionMtt);

    const attentionRequired: string[] = [];
    if (withdrawalsInReview > 0) {
      attentionRequired.push(`${withdrawalsInReview} withdrawals awaiting compliance review`);
    }
    if (openFraudAlerts > 0) attentionRequired.push(`${openFraudAlerts} open fraud alerts`);
    if (breachedTickets > 0) {
      attentionRequired.push(`${breachedTickets} support tickets past their SLA with no reply`);
    }
    if (pendingApprovals > 0) {
      attentionRequired.push(`${pendingApprovals} approval requests waiting for a second approver`);
    }
    if (Number(queuedCommissionMtt) > 0) {
      attentionRequired.push(
        `${queuedCommissionMtt} MTT of commission is calculated but unfunded — the pool needs a transfer`,
      );
    }
    if (frozen > 0) attentionRequired.push(`${frozen} accounts are frozen and holding funds`);
    if (!solvency.solvent) {
      /* First in the list would be better, but being present at all is the point:
       * released commission exceeding confirmed funding is a release blocker. */
      attentionRequired.unshift(
        "COMMISSION POOL INSOLVENT: released commission exceeds confirmed Treasury funding",
      );
    }

    return {
      members,
      activeMembers30d,
      kycVerified,
      frozen,
      withdrawalsInReview,
      openFraudAlerts,
      breachedTickets,
      pendingApprovals,
      queuedCommissionMtt,
      /* Reported as a boolean because it is a yes/no question with a release
       * blocker attached, not a metric to trend. */
      commissionSolvent: solvency.solvent,
      attentionRequired,

      activeMembersToday: activeToday,
      pointsIssued30d: points30d,
      mttLiability: toDbAmount(liability.totalLiabilityMtt),
      mttStaked: toDbAmount(liability.stakedMtt),
      treasuryHeadroomMtt: toDbAmount(solvency.availableMtt),
      pendingWithdrawals: pendingWithdrawals.count,
      pendingWithdrawalsMtt: pendingWithdrawals.amount,
      openKycQueue: openKyc,
      openTickets,
      commissionPayoutRatioPct: this.bpsToPct(ratio.commissionRatioBps),
      outflowRatioPct: this.bpsToPct(ratio.outflowRatioBps),
      revenueFundedPct: this.fundedPct(solvency),
      activeTodayDeltaPct: this.deltaPct(activeToday, activeYesterday),
      active30dDeltaPct: this.deltaPct(activeMembers30d, active30dPrior),
      stakingOutflowRatioPct: this.shareOf(treasury.stakingPoolOut, treasury.reconciledInflow),
    };
  }

  /* ==================================================================== *
   * Dashboard support reads
   * ==================================================================== */

  /**
   * Members with a session validated today, UTC.
   *
   * `lastActiveAt` rather than a session row count: one member with four devices
   * is one active member, and counting sessions would have made a security
   * incident look like growth.
   */
  private async activeMembersToday(): Promise<number> {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    return this.users.createQueryBuilder("u")
      .where("u.lastActiveAt >= :start", { start })
      .andWhere("u.isStaff = 0")
      .getCount();
  }

  /**
   * Members active on a single day, `daysAgo` days back.
   *
   * A closed interval, not "since": comparing today-so-far against a whole
   * yesterday would show a decline every morning and a recovery every evening.
   */
  private async activeMembersOnDay(daysAgo: number): Promise<number> {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - daysAgo);
    const end = new Date(start.getTime() + 86_400_000);
    return this.users.createQueryBuilder("u")
      .where("u.lastActiveAt >= :start", { start })
      .andWhere("u.lastActiveAt < :end", { end })
      .andWhere("u.isStaff = 0")
      .getCount();
  }

  /**
   * Members active in a window that ENDED `endDaysAgo` days ago.
   *
   * Note the limit this figure carries: `lastActiveAt` records only the most
   * recent visit, so a member active in both windows counts once — in the later
   * one. The prior-window count is therefore a floor, and the delta it feeds is
   * conservative rather than flattering. Measuring it properly needs the session
   * table, which is a heavier read than a dashboard tile justifies.
   */
  private async activeMembersInWindow(startDaysAgo: number, endDaysAgo: number): Promise<number> {
    const now = Date.now();
    return this.users.createQueryBuilder("u")
      .where("u.lastActiveAt >= :start", { start: new Date(now - startDaysAgo * 86_400_000) })
      .andWhere("u.lastActiveAt < :end", { end: new Date(now - endDaysAgo * 86_400_000) })
      .andWhere("u.isStaff = 0")
      .getCount();
  }

  /**
   * Percentage change, or null when there is no basis.
   *
   * Zero-to-something is not "infinite growth" and not "0%"; it is a comparison
   * that cannot be made, and the dashboard renders null as no delta at all.
   */
  private deltaPct(current: number, prior: number): number | null {
    if (prior <= 0) return null;
    return Number((((current - prior) / prior) * 100).toFixed(1));
  }

  /** One decimal share of a total, or null when the total is zero. */
  private shareOf(part: string, total: string): number | null {
    const t = dec(total);
    if (t.lte(0)) return null;
    return Number(dec(part).div(t).mul(100).toFixed(1));
  }

  /** Points credited — not net — over a trailing window. Debits are conversions out. */
  private async pointsIssuedSince(days: number): Promise<string> {
    const since = new Date(Date.now() - days * 86_400_000);
    const row = await this.pointsLedger.createQueryBuilder("p")
      .select("SUM(p.amount)", "total")
      .where("p.createdAt >= :since", { since })
      .andWhere("p.amount > 0")
      .getRawOne<{ total: string | null }>();
    return toDbAmount(row?.total ?? 0);
  }

  /**
   * Withdrawals in flight, by count and value.
   *
   * "In flight" is every non-terminal state, not just `review`: a member's money
   * is committed from the moment they ask, and a dashboard that counts only the
   * ones a human has looked at understates the platform's obligations.
   */
  private async pendingWithdrawalTotals(): Promise<{ count: number; amount: string }> {
    const row = await this.withdrawals.createQueryBuilder("w")
      .select("COUNT(*)", "count")
      .addSelect("SUM(w.amountMtt)", "amount")
      .where("w.status NOT IN (:...done)", {
        done: ["completed", "rejected", "cancelled", "failed"],
      })
      .getRawOne<{ count: string; amount: string | null }>();
    return { count: Number(row?.count ?? 0), amount: toDbAmount(row?.amount ?? 0) };
  }

  private bpsToPct(bps: number | null): number | null {
    if (bps === null || bps === undefined) return null;
    return Number(dec(bps).div(100).toFixed(1));
  }

  /**
   * Share of committed commission covered by confirmed funding.
   *
   * Capped at 100. The pool is routinely funded ahead of commitments and
   * "312% funded" invites the reading that members are owed three times what
   * they earned.
   */
  private fundedPct(solvency: { poolFundedMtt: string; committedMtt: string }): number | null {
    const committed = dec(solvency.committedMtt);
    if (committed.lte(0)) return null;
    const pct = dec(solvency.poolFundedMtt).div(committed).mul(100);
    return Number(pct.gt(100) ? "100.0" : pct.toFixed(1));
  }

  /* ==================================================================== *
   * Directories
   * ==================================================================== */

  /**
   * Who is operating the back-office, and what they may do.
   *
   * The approver list is computed HERE rather than filtered in the browser. The
   * client asking "who can second-approve me" and the server deciding "may this
   * person second-approve that request" have to agree, and the only way to
   * guarantee that is for one of them to be the single source. A UI that offers
   * an ineligible approver produces a rejected submission and a confused
   * operator; a UI that offers the requester themselves is a control failure.
   */
  async staffIdentity(actorId: string): Promise<StaffIdentityResponse> {
    const me = await this.users.findOne({ where: { id: actorId, isStaff: true } });
    if (!me) throw new NotFoundException("No staff record for the current session");

    const [colleagues, modules] = await Promise.all([
      this.users.find({
        where: { isStaff: true },
        order: { fullName: "ASC" },
        take: 200,
      }),
      this.permissionMatrix(),
    ]);

    const mine = modules.filter((m) => m.role === me.role);

    return {
      me: this.toStaff(me),
      permissions: this.permissionStrings(mine),
      modules: mine,
      approvers: colleagues
        .filter((c) => c.id !== me.id && c.status === "active" && c.twoFaEnabledAt !== null)
        .map((c) => this.toStaff(c)),
      /* The operator's clock is not authoritative for an SLA countdown. */
      serverTime: new Date().toISOString(),
    };
  }

  /** The staff directory. Small by nature, so it is not paginated. */
  async listStaff(): Promise<StaffMemberResponse[]> {
    const rows = await this.users.find({
      where: { isStaff: true },
      order: { role: "ASC", fullName: "ASC" },
      take: 200,
    });
    return rows.map((r) => this.toStaff(r));
  }

  /**
   * The member directory.
   *
   * Contact details are masked in every row. An operator confirming they have
   * the right account is served by a mask; reading ten thousand addresses off a
   * list is not a support task, and the unmasked value is on the member's own
   * record where the read is attributable to one person and one reason.
   *
   * Deliberately carries no balances. A directory row with money on it would put
   * every member's holdings behind one search box.
   */
  async listMembers(q: MemberQuery): Promise<Paginated<MemberSummaryResponse>> {
    const qb = this.users.createQueryBuilder("u").where("u.isStaff = 0");

    if (q.status) qb.andWhere("u.status = :status", { status: q.status });
    if (q.kycTier) qb.andWhere("u.kycTier = :tier", { tier: q.kycTier });
    if (q.country) qb.andWhere("u.country = :country", { country: q.country.toUpperCase() });
    if (q.minRiskScore !== undefined) {
      qb.andWhere("u.riskScore >= :risk", { risk: q.minRiskScore });
    }
    if (q.from) qb.andWhere("u.createdAt >= :from", { from: new Date(q.from) });
    if (q.to) qb.andWhere("u.createdAt <= :to", { to: new Date(q.to) });

    /* Search is on `ref`, `displayName` and `referralCode` only. Not on email or
     * phone: those columns are stored hashed for exactly this reason, and a LIKE
     * over a member's plaintext contact details is the query an operator should
     * not be able to run casually. Looking up a known address goes through the
     * hash, which is an equality match on one person. */
    if (q.q) {
      const term = q.q.trim();
      qb.andWhere(
        "(u.ref LIKE :like OR u.displayName LIKE :like OR u.referralCode = :exact)",
        { like: `%${term}%`, exact: term.toUpperCase() },
      );
    }

    const sortBy = safeSort(q.sortBy, [...MEMBER_SORTS], "createdAt");
    const [rows, total] = await qb
      .orderBy(`u.${sortBy}`, q.sortDir)
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();

    return paginate(rows.map((r) => this.toMemberSummary(r)), total, q);
  }

  /* ------------------------------- mappers -------------------------------- */

  private toStaff(u: User): StaffMemberResponse {
    return {
      id: u.id,
      name: u.fullName ?? u.displayName,
      email: u.email,
      role: u.role,
      twoFactorEnabled: u.twoFaEnabledAt !== null,
      lastActiveAt: u.lastActiveAt?.toISOString() ?? null,
      active: u.status === "active",
    };
  }

  private toMemberSummary(u: User): MemberSummaryResponse {
    return {
      id: u.id,
      ref: u.ref,
      displayName: u.displayName,
      email: this.maskEmail(u.email),
      phone: this.maskPhone(u.phone ?? null),
      country: u.country ?? null,
      status: u.status,
      kycTier: u.kycTier,
      twoFactorEnabled: u.twoFaEnabledAt !== null,
      walletAddress: this.truncateAddress(u.walletAddress ?? null),
      walletType: u.walletType ?? null,
      referralCode: u.referralCode,
      /* Whether, not by whom. The sponsor's identity is another member's data and
       * belongs on the referral screen, behind its own permission. */
      wasReferred: u.referredById !== null,
      joinedAt: u.createdAt.toISOString(),
      lastActiveAt: u.lastActiveAt?.toISOString() ?? null,
      riskScore: u.riskScore,
      riskFlags: u.riskFlags ?? [],
    };
  }

  /** `alice@example.com` → `a•••@example.com`. The domain stays: it is often the tell. */
  private maskEmail(email: string | null): string {
    if (!email) return "—";
    const at = email.indexOf("@");
    if (at <= 0) return "•••";
    return `${email[0]}•••${email.slice(at)}`;
  }

  private maskPhone(phone: string | null): string | null {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 4) return "•••";
    return `•••• ${digits.slice(-2)}`;
  }

  private truncateAddress(address: string | null): string | null {
    if (!address) return null;
    return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
  }

  /**
   * Flattens the module matrix into the permission strings the guard checks.
   *
   * The UI needs to know whether to render a button; the guard decides whether
   * the request is allowed. Both read this same list, so a hidden button and a
   * 403 can never disagree.
   */
  private permissionStrings(modules: RolePermissionResponse[]): string[] {
    const perms: string[] = [];
    for (const m of modules) {
      if (m.canRead) perms.push(`${m.module}:read`);
      if (m.canWrite) perms.push(`${m.module}:write`);
      if (m.canApprove) perms.push(`${m.module}:approve`);
    }
    return perms.sort();
  }
}

/* --------------------------------- helpers -------------------------------- */

function statusTitle(status: UserStatus): string {
  if (status === "frozen") return "Your account is on hold";
  if (status === "suspended") return "Your account has been suspended";
  if (status === "closed") return "Your account has been closed";
  return "Your account has been reactivated";
}

function toApprovalView(a: ApprovalRequest): ApprovalResponse {
  return {
    ref: a.ref,
    kind: a.kind,
    targetId: a.targetId ?? null,
    payload: a.payload,
    reason: a.reason,
    requestedById: a.requestedById,
    approverId: a.approverId ?? null,
    status: a.status,
    decisionNote: a.decisionNote ?? null,
    decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
    appliedAt: a.appliedAt ? a.appliedAt.toISOString() : null,
    expiresAt: a.expiresAt.toISOString(),
    expired: a.status === "pending" && a.expiresAt.getTime() <= Date.now(),
    requiresHardwareKey: a.requiresHardwareKey,
    createdAt: a.createdAt.toISOString(),
  };
}
