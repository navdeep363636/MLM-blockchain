import {
  ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import {
  Ticket, TicketMessage, User, type TicketCategory, type TicketPriority, type TicketStatus,
} from "@/database/entities";
import { EventBusService, Events } from "@/events";
import { paginate, type Paginated } from "@/common/dto";
import { Ref, addHours } from "@/common/utils";
import { AuditService } from "@/modules/audit/audit.service";
import { NotificationsService } from "@/modules/notifications/notifications.service";
import type {
  AdminTicketQuery, AgentReplyRequest, CreateTicketRequest, SlaReportResponse, TicketDetailResponse,
  TicketQuery, TicketResponse,
} from "./dto/support.dto";

/* ============================================================================
 * Support (FRD N-02).
 *
 * Two rules that are about fairness rather than mechanics:
 *
 *  1. A FINANCIAL DISPUTE IS CLASSIFIED BY THE SERVER, FROM THE CATEGORY —
 *     never by the member and never by an agent's judgement. Withdrawal, KYC and
 *     commission tickets are financial disputes, they get the tighter SLA, and
 *     they route to compliance-trained agents. Letting a member set the flag
 *     would make it a queue-jumping button; letting an agent clear it would let
 *     an inconvenient complaint be reclassified out of compliance's view.
 *
 *  2. THE SLA CLOCK IS SET AT CREATION AND NEVER MOVED. Reassigning, reopening
 *     or re-prioritising a ticket does not reset it. An SLA that can be reset by
 *     touching the ticket measures agent activity, not member experience.
 *
 * Agent identities are not exposed to members: replies are attributed to
 * "Support". A named agent invites the member to pursue an individual over a
 * decision the platform made.
 * ========================================================================== */

/** Categories that are financial disputes by definition. */
const FINANCIAL_CATEGORIES = new Set<TicketCategory>(["withdrawal", "commission", "kyc"]);

/** First-response SLA in hours, by whether the ticket is a financial dispute. */
const SLA_HOURS = { financial: 4, standard: 24 } as const;

/** Priority a category opens at. Compliance categories start elevated. */
const DEFAULT_PRIORITY: Record<TicketCategory, TicketPriority> = {
  withdrawal: "high",
  commission: "high",
  kyc: "high",
  account: "normal",
  technical: "normal",
  gameplay: "low",
  other: "low",
};

/** Statuses a member may still write to. */
const MEMBER_WRITABLE: TicketStatus[] = ["open", "pending_user", "escalated"];

@Injectable()
export class SupportService {
  private readonly log = new Logger(SupportService.name);

  constructor(
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(TicketMessage) private readonly messages: Repository<TicketMessage>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly notifications: NotificationsService,
    private readonly bus: EventBusService,
    private readonly audit: AuditService,
  ) {}

  /* ==================================================================== *
   * Member actions
   * ==================================================================== */

  /**
   * Opens a ticket.
   *
   * Classification and the SLA deadline are both computed here, from the
   * category — see rule 1. The opening message is stored as a normal message so
   * the thread has a single shape from the start.
   */
  async create(userId: string, dto: CreateTicketRequest, ip: string | null): Promise<TicketDetailResponse> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("Account not found");

    /* Rule 1: derived, not accepted from the client. */
    const financialDispute = FINANCIAL_CATEGORIES.has(dto.category);
    const slaHours = financialDispute ? SLA_HOURS.financial : SLA_HOURS.standard;

    const ticket = await this.tickets.save(
      this.tickets.create({
        ref: Ref.ticket(),
        userId,
        subject: dto.subject,
        category: dto.category,
        status: "open",
        priority: DEFAULT_PRIORITY[dto.category],
        financialDispute,
        /* Rule 2: set once, here. */
        slaDueAt: addHours(new Date(), slaHours),
        disputedRef: dto.disputedRef ?? null,
      }),
    );

    await this.messages.save(
      this.messages.create({
        ticketId: ticket.id,
        authorId: userId,
        authorRole: "user",
        body: dto.body,
        internal: false,
      }),
    );

    await this.audit.record({
      actorId: userId,
      action: "support.ticket.create",
      targetType: "ticket",
      targetId: ticket.id,
      after: { category: dto.category, financialDispute, disputedRef: dto.disputedRef ?? null },
      ip,
    });

    await this.bus.publish(Events.TicketCreated, {
      userId,
      ref: ticket.ref,
      category: dto.category,
      financialDispute,
      priority: ticket.priority,
      slaDueAt: ticket.slaDueAt.toISOString(),
      disputedRef: dto.disputedRef ?? null,
    });

    this.log.log(
      `ticket ${ticket.ref} opened (${dto.category}${financialDispute ? ", financial dispute" : ""})`,
    );

    return this.detail(userId, ticket.ref);
  }

  async list(userId: string, q: TicketQuery): Promise<Paginated<TicketResponse>> {
    const qb = this.tickets.createQueryBuilder("t").where("t.userId = :userId", { userId });
    if (q.status) qb.andWhere("t.status = :status", { status: q.status });
    if (q.category) qb.andWhere("t.category = :category", { category: q.category });

    const [rows, total] = await qb
      .orderBy("t.createdAt", "DESC")
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();

    const counts = await this.messageCounts(rows.map((r) => r.id));
    return paginate(rows.map((r) => toView(r, counts.get(r.id) ?? 0)), total, q);
  }

  /**
   * One ticket with its thread.
   *
   * Internal notes are filtered out here rather than at the controller: a
   * member-facing read path that could ever return them is one refactor away
   * from doing so.
   */
  async detail(userId: string, ref: string): Promise<TicketDetailResponse> {
    const ticket = await this.tickets.findOne({ where: { ref, userId } });
    if (!ticket) throw new NotFoundException("Ticket not found");

    const messages = await this.messages.find({
      where: { ticketId: ticket.id, internal: false },
      order: { createdAt: "ASC" },
    });

    return {
      ...toView(ticket, messages.length),
      messages: messages.map((m) => ({
        id: m.id,
        authorRole: m.authorRole,
        /* Agents are "Support": naming them invites pursuing an individual over
         * a decision the platform made. */
        authorLabel: m.authorRole === "user" ? "You" : m.authorRole === "agent" ? "Support" : "System",
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  /** Adds a member reply and reopens a ticket that was waiting on them. */
  async reply(userId: string, ref: string, body: string): Promise<TicketDetailResponse> {
    const ticket = await this.tickets.findOne({ where: { ref, userId } });
    if (!ticket) throw new NotFoundException("Ticket not found");
    if (!MEMBER_WRITABLE.includes(ticket.status)) {
      throw new ConflictException({
        code: "TICKET_CLOSED",
        message: `This ticket is ${ticket.status}. Open a new one and reference ${ticket.ref}.`,
      });
    }

    await this.messages.save(
      this.messages.create({
        ticketId: ticket.id,
        authorId: userId,
        authorRole: "user",
        body,
        internal: false,
      }),
    );

    if (ticket.status === "pending_user") {
      ticket.status = "open";
      await this.tickets.save(ticket);
    }

    return this.detail(userId, ref);
  }

  /** Records a satisfaction rating on a resolved ticket. */
  async rate(userId: string, ref: string, rating: number): Promise<TicketResponse> {
    const ticket = await this.tickets.findOne({ where: { ref, userId } });
    if (!ticket) throw new NotFoundException("Ticket not found");
    if (ticket.status !== "resolved" && ticket.status !== "closed") {
      throw new ConflictException({
        code: "TICKET_NOT_RESOLVED",
        message: "You can rate a ticket once it has been resolved",
      });
    }

    ticket.satisfactionRating = rating;
    await this.tickets.save(ticket);
    return toView(ticket, await this.countMessages(ticket.id));
  }

  /* ==================================================================== *
   * Agent actions
   * ==================================================================== */

  async adminList(q: AdminTicketQuery): Promise<Paginated<TicketResponse & { userId: string }>> {
    const qb = this.tickets.createQueryBuilder("t");
    if (q.userId) qb.andWhere("t.userId = :userId", { userId: q.userId });
    if (q.assigneeId) qb.andWhere("t.assigneeId = :assigneeId", { assigneeId: q.assigneeId });
    if (q.status) qb.andWhere("t.status = :status", { status: q.status });
    if (q.category) qb.andWhere("t.category = :category", { category: q.category });
    if (q.financialOnly) qb.andWhere("t.financialDispute = true");
    if (q.breachedOnly) {
      qb.andWhere("t.firstResponseAt IS NULL")
        .andWhere("t.slaDueAt < :now", { now: new Date() })
        .andWhere("t.status NOT IN (:...done)", { done: ["resolved", "closed"] });
    }

    const [rows, total] = await qb
      /* Financial disputes first, then by SLA urgency: the queue orders itself
       * by what is most at risk of a breach. */
      .orderBy("t.financialDispute", "DESC")
      .addOrderBy("t.slaDueAt", "ASC")
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();

    const counts = await this.messageCounts(rows.map((r) => r.id));
    return paginate(
      rows.map((r) => ({ ...toView(r, counts.get(r.id) ?? 0), userId: r.userId })),
      total,
      q,
    );
  }

  /** The full thread including internal notes. Staff only. */
  async adminDetail(ref: string): Promise<TicketDetailResponse & { userId: string; assigneeId: string | null }> {
    const ticket = await this.tickets.findOne({ where: { ref } });
    if (!ticket) throw new NotFoundException("Ticket not found");

    const messages = await this.messages.find({
      where: { ticketId: ticket.id },
      order: { createdAt: "ASC" },
    });

    return {
      ...toView(ticket, messages.length),
      userId: ticket.userId,
      assigneeId: ticket.assigneeId ?? null,
      messages: messages.map((m) => ({
        id: m.id,
        authorRole: m.authorRole,
        authorLabel: m.internal ? "Internal note" : m.authorRole === "user" ? "Member" : "Support",
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  /**
   * An agent reply.
   *
   * The first non-internal reply stamps `firstResponseAt`, which is what the SLA
   * is measured against. An internal note deliberately does not: writing a note
   * to yourself is not a response to the member.
   */
  async agentReply(
    ref: string,
    dto: AgentReplyRequest,
    agentId: string,
  ): Promise<TicketDetailResponse & { userId: string; assigneeId: string | null }> {
    const ticket = await this.tickets.findOne({ where: { ref } });
    if (!ticket) throw new NotFoundException("Ticket not found");

    const internal = dto.internal ?? false;

    await this.messages.save(
      this.messages.create({
        ticketId: ticket.id,
        authorId: agentId,
        authorRole: "agent",
        body: dto.body,
        internal,
      }),
    );

    if (!internal) {
      if (!ticket.firstResponseAt) ticket.firstResponseAt = new Date();
      ticket.status = "pending_user";
      await this.tickets.save(ticket);

      await this.notifications.notify({
        userId: ticket.userId,
        kind: "system",
        title: `Support replied to ${ticket.ref}`,
        body: ticket.subject,
        href: `/support/${ticket.ref}`,
        dedupeKey: `ticket-reply:${ticket.id}:${Date.now()}`,
      });
    }

    return this.adminDetail(ref);
  }

  async assign(ref: string, assigneeId: string, actorId: string): Promise<TicketResponse> {
    const ticket = await this.tickets.findOne({ where: { ref } });
    if (!ticket) throw new NotFoundException("Ticket not found");

    const assignee = await this.users.findOne({ where: { id: assigneeId } });
    if (!assignee || !assignee.isStaff) {
      throw new ForbiddenException({
        code: "NOT_STAFF",
        message: "A ticket can only be assigned to a staff account",
      });
    }
    /* A financial dispute may only be handled by compliance-trained staff. */
    if (ticket.financialDispute && !isComplianceTrained(assignee.role)) {
      throw new ForbiddenException({
        code: "NOT_COMPLIANCE_TRAINED",
        message:
          "This is a financial dispute and can only be assigned to compliance or finance staff",
        requiredRoles: ["compliance", "finance_admin", "super_admin"],
      });
    }

    const before = { assigneeId: ticket.assigneeId ?? null };
    ticket.assigneeId = assigneeId;
    /* Rule 2: assignment does NOT move slaDueAt. */
    await this.tickets.save(ticket);

    await this.audit.record({
      actorId,
      action: "support.ticket.assign",
      targetType: "ticket",
      targetId: ticket.id,
      before,
      after: { assigneeId },
    });

    return toView(ticket, await this.countMessages(ticket.id));
  }

  /** Escalates a ticket and records why. */
  async escalate(ref: string, reason: string, actorId: string): Promise<TicketResponse> {
    const ticket = await this.tickets.findOne({ where: { ref } });
    if (!ticket) throw new NotFoundException("Ticket not found");

    ticket.status = "escalated";
    if (ticket.priority !== "urgent") ticket.priority = "urgent";
    await this.tickets.save(ticket);

    await this.messages.save(
      this.messages.create({
        ticketId: ticket.id,
        authorId: actorId,
        authorRole: "system",
        body: `Escalated: ${reason}`,
        internal: true,
      }),
    );

    await this.audit.recordOrThrow({
      actorId,
      action: "support.ticket.escalate",
      targetType: "ticket",
      targetId: ticket.id,
      after: { status: "escalated", priority: ticket.priority },
      reason,
    });

    await this.bus.publish(Events.TicketEscalated, {
      ref: ticket.ref,
      userId: ticket.userId,
      category: ticket.category,
      financialDispute: ticket.financialDispute,
      reason,
    });

    return toView(ticket, await this.countMessages(ticket.id));
  }

  async resolve(ref: string, resolution: string, actorId: string): Promise<TicketResponse> {
    const ticket = await this.tickets.findOne({ where: { ref } });
    if (!ticket) throw new NotFoundException("Ticket not found");
    if (ticket.status === "resolved" || ticket.status === "closed") {
      throw new ConflictException({
        code: "ALREADY_RESOLVED",
        message: `This ticket is already ${ticket.status}`,
      });
    }

    await this.messages.save(
      this.messages.create({
        ticketId: ticket.id,
        authorId: actorId,
        authorRole: "agent",
        body: resolution,
        internal: false,
      }),
    );

    if (!ticket.firstResponseAt) ticket.firstResponseAt = new Date();
    ticket.status = "resolved";
    ticket.resolvedAt = new Date();
    await this.tickets.save(ticket);

    await this.audit.record({
      actorId,
      action: "support.ticket.resolve",
      targetType: "ticket",
      targetId: ticket.id,
      after: { status: "resolved" },
      reason: resolution.slice(0, 500),
    });

    await this.notifications.notify({
      userId: ticket.userId,
      kind: "system",
      title: `${ticket.ref} resolved`,
      body: ticket.subject,
      href: `/support/${ticket.ref}`,
      dedupeKey: `ticket-resolved:${ticket.id}`,
    });

    return toView(ticket, await this.countMessages(ticket.id));
  }

  async setPriority(
    ref: string,
    priority: TicketPriority,
    reason: string,
    actorId: string,
  ): Promise<TicketResponse> {
    const ticket = await this.tickets.findOne({ where: { ref } });
    if (!ticket) throw new NotFoundException("Ticket not found");

    const before = { priority: ticket.priority };
    ticket.priority = priority;
    /* Rule 2 again: re-prioritising does not move the SLA deadline. */
    await this.tickets.save(ticket);

    await this.audit.record({
      actorId,
      action: "support.ticket.priority",
      targetType: "ticket",
      targetId: ticket.id,
      before,
      after: { priority },
      reason,
    });

    return toView(ticket, await this.countMessages(ticket.id));
  }

  /* ==================================================================== *
   * Reporting
   * ==================================================================== */

  /**
   * The SLA dashboard.
   *
   * `breached` counts open tickets past their deadline with NO first response —
   * the only definition that measures what the member experienced rather than
   * what the queue looks like now.
   */
  async slaReport(): Promise<SlaReportResponse> {
    const now = new Date();

    const [open, escalated, openFinancial] = await Promise.all([
      this.tickets.count({ where: { status: "open" } }),
      this.tickets.count({ where: { status: "escalated" } }),
      this.tickets.count({ where: { status: In(["open", "escalated"] as TicketStatus[]), financialDispute: true } }),
    ]);

    const breached = await this.tickets
      .createQueryBuilder("t")
      .where("t.firstResponseAt IS NULL")
      .andWhere("t.slaDueAt < :now", { now })
      .andWhere("t.status NOT IN (:...done)", { done: ["resolved", "closed"] })
      .getCount();

    const since = new Date(now.getTime() - 30 * 86_400_000);

    const responded = await this.tickets
      .createQueryBuilder("t")
      .select("TIMESTAMPDIFF(MINUTE, t.createdAt, t.firstResponseAt)", "minutes")
      .where("t.firstResponseAt IS NOT NULL")
      .andWhere("t.createdAt >= :since", { since })
      .orderBy("minutes", "ASC")
      .getRawMany<{ minutes: number }>();

    /* Median rather than mean: one ticket that sat for a week would drag a mean
     * into uselessness, and the typical experience is what a target is set on. */
    const median = responded.length > 0
      ? Number(responded[Math.floor(responded.length / 2)].minutes)
      : null;

    const satisfaction = await this.tickets
      .createQueryBuilder("t")
      .select("AVG(t.satisfactionRating)", "avg")
      .where("t.satisfactionRating IS NOT NULL")
      .andWhere("t.createdAt >= :since", { since })
      .getRawOne<{ avg: string | null }>();

    return {
      open,
      escalated,
      breached,
      openFinancialDisputes: openFinancial,
      medianFirstResponseMinutes: median,
      meanSatisfaction: satisfaction?.avg ? Number(Number(satisfaction.avg).toFixed(2)) : null,
    };
  }

  /**
   * Escalates tickets that have breached their SLA with no response.
   *
   * Run by the cron. Escalating automatically matters most for the financial
   * disputes: those are the tickets where silence has a regulatory cost, not
   * just an unhappy member.
   */
  async escalateBreached(limit = 200): Promise<number> {
    const rows = await this.tickets
      .createQueryBuilder("t")
      .where("t.firstResponseAt IS NULL")
      .andWhere("t.slaDueAt < :now", { now: new Date() })
      .andWhere("t.status = :status", { status: "open" })
      .orderBy("t.financialDispute", "DESC")
      .addOrderBy("t.slaDueAt", "ASC")
      .take(Math.min(limit, 1_000))
      .getMany();

    if (rows.length === 0) return 0;

    /* One UPDATE for the batch, then the events.
     *
     * The rows are still selected, because each escalation publishes an event
     * carrying that ticket's reference — but the writes are no longer one per
     * ticket, which is what made a backlog expensive to clear exactly when it
     * mattered most. */
    await this.tickets.update(
      { id: In(rows.map((t) => t.id)) },
      { status: "escalated", priority: "urgent" },
    );

    for (const ticket of rows) {
      await this.bus.publish(Events.TicketEscalated, {
        ref: ticket.ref,
        userId: ticket.userId,
        category: ticket.category,
        financialDispute: ticket.financialDispute,
        reason: "SLA breached with no first response",
        slaDueAt: ticket.slaDueAt.toISOString(),
      });
    }

    if (rows.length > 0) {
      this.log.warn(`auto-escalated ${rows.length} tickets past their SLA with no response`);
    }
    return rows.length;
  }

  /* ------------------------------------------------------------------ */

  private async countMessages(ticketId: string): Promise<number> {
    return this.messages.count({ where: { ticketId } });
  }

  private async messageCounts(ticketIds: string[]): Promise<Map<string, number>> {
    if (ticketIds.length === 0) return new Map();
    const rows = await this.messages
      .createQueryBuilder("m")
      .select("m.ticketId", "ticketId")
      .addSelect("COUNT(*)", "count")
      .where("m.ticketId IN (:...ids)", { ids: ticketIds })
      .groupBy("m.ticketId")
      .getRawMany<{ ticketId: string; count: string }>();
    return new Map(rows.map((r) => [r.ticketId, Number(r.count ?? 0)]));
  }
}

/* --------------------------------- helpers -------------------------------- */

/** Roles trained to handle a financial dispute. */
export function isComplianceTrained(role: string): boolean {
  return role === "compliance" || role === "finance_admin" || role === "super_admin";
}

function toView(t: Ticket, messageCount: number): TicketResponse {
  return {
    ref: t.ref,
    subject: t.subject,
    category: t.category,
    status: t.status,
    priority: t.priority,
    financialDispute: t.financialDispute,
    slaDueAt: t.slaDueAt.toISOString(),
    slaBreached:
      !t.firstResponseAt &&
      t.slaDueAt.getTime() < Date.now() &&
      t.status !== "resolved" &&
      t.status !== "closed",
    firstResponseAt: t.firstResponseAt ? t.firstResponseAt.toISOString() : null,
    resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
    disputedRef: t.disputedRef ?? null,
    satisfactionRating: t.satisfactionRating ?? null,
    createdAt: t.createdAt.toISOString(),
    messageCount,
  };
}
