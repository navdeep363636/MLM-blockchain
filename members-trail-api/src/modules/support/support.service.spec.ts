import { ConflictException, ForbiddenException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import { Ticket, TicketMessage, User } from "@/database/entities";
import { EventBusService } from "@/events";
import { AuditService } from "@/modules/audit/audit.service";
import { NotificationsService } from "@/modules/notifications/notifications.service";
import { SupportService, isComplianceTrained } from "./support.service";

/* ============================================================================
 * Two properties, both about fairness rather than mechanics:
 *
 *  1  A FINANCIAL DISPUTE IS CLASSIFIED BY THE SERVER. Not by the member (it
 *     would be a queue-jumping button) and not by an agent (an inconvenient
 *     complaint could be reclassified out of compliance's view).
 *
 *  2  THE SLA CLOCK NEVER MOVES. Reassigning or re-prioritising does not reset
 *     it — an SLA that resets when you touch the ticket measures agent activity,
 *     not member experience.
 * ========================================================================== */

const HOUR = 3_600_000;

function repo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
    save: jest.fn(async (x: unknown) => ({ id: "row-1", ...(x as object) })),
    create: jest.fn((x: unknown) => x),
    update: jest.fn(async (..._a: unknown[]) => ({ affected: 1 })),
    count: jest.fn(async (..._a: unknown[]) => 0),
    createQueryBuilder: jest.fn(),
  };
}

function qb(opts: { rawMany?: Record<string, unknown>[]; rawOne?: Record<string, unknown>; count?: number }) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "addSelect", "where", "andWhere", "groupBy", "orderBy", "addOrderBy", "skip", "take"]) {
    b[m] = jest.fn(() => b);
  }
  b.getRawMany = jest.fn(async () => opts.rawMany ?? []);
  b.getRawOne = jest.fn(async () => opts.rawOne ?? {});
  b.getManyAndCount = jest.fn(async () => [[], 0]);
  b.getMany = jest.fn(async () => []);
  b.getCount = jest.fn(async () => opts.count ?? 0);
  return b;
}

describe("SupportService", () => {
  let svc: SupportService;
  let tickets: ReturnType<typeof repo>;
  let messages: ReturnType<typeof repo>;
  let users: ReturnType<typeof repo>;
  let notifications: { notify: jest.Mock };
  let bus: { publish: jest.Mock };
  let audit: { record: jest.Mock; recordOrThrow: jest.Mock };

  beforeEach(async () => {
    tickets = repo();
    messages = repo();
    users = repo();
    notifications = { notify: jest.fn() };
    bus = { publish: jest.fn() };
    audit = { record: jest.fn(), recordOrThrow: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        SupportService,
        { provide: getRepositoryToken(Ticket), useValue: tickets },
        { provide: getRepositoryToken(TicketMessage), useValue: messages },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: NotificationsService, useValue: notifications },
        { provide: EventBusService, useValue: bus },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    svc = mod.get(SupportService);
    users.findOne.mockResolvedValue({ id: "u1", status: "active" });
    messages.createQueryBuilder.mockImplementation(() => qb({}));
    tickets.createQueryBuilder.mockImplementation(() => qb({}));
    /* create() returns the ticket; detail() then re-reads it. */
    tickets.save.mockImplementation(async (x: unknown) => ({
      id: "t1", createdAt: new Date("2026-02-01T00:00:00Z"), ...(x as object),
    }));
  });

  const savedTicket = () => tickets.save.mock.calls[0][0] as Record<string, unknown>;

  /* ==================================================================== *
   * Property 1 — server-side classification
   * ==================================================================== */

  describe("create — classification", () => {
    beforeEach(() => {
      tickets.findOne.mockImplementation(async () => ({
        id: "t1", ref: "TK-ABC", userId: "u1", subject: "s",
        category: "withdrawal", status: "open", priority: "high",
        financialDispute: true, slaDueAt: new Date(Date.now() + 4 * HOUR),
        createdAt: new Date(), firstResponseAt: null, resolvedAt: null,
        disputedRef: null, satisfactionRating: null,
      }));
    });

    it.each([
      ["withdrawal", true],
      ["commission", true],
      ["kyc", true],
      ["gameplay", false],
      ["technical", false],
      ["account", false],
      ["other", false],
    ] as const)("classifies %s as financialDispute=%s", async (category, expected) => {
      await svc.create("u1", { subject: "Help me", category, body: "Something is wrong here." }, null);
      expect(savedTicket().financialDispute).toBe(expected);
    });

    it("gives a financial dispute the tighter 4-hour SLA", async () => {
      const before = Date.now();
      await svc.create("u1", { subject: "s", category: "withdrawal", body: "b".repeat(20) }, null);

      const due = (savedTicket().slaDueAt as Date).getTime();
      expect(due - before).toBeGreaterThan(3.5 * HOUR);
      expect(due - before).toBeLessThan(4.5 * HOUR);
    });

    it("gives an ordinary ticket the 24-hour SLA", async () => {
      const before = Date.now();
      await svc.create("u1", { subject: "s", category: "gameplay", body: "b".repeat(20) }, null);

      const due = (savedTicket().slaDueAt as Date).getTime();
      expect(due - before).toBeGreaterThan(23 * HOUR);
    });

    it("opens compliance categories at an elevated priority", async () => {
      await svc.create("u1", { subject: "s", category: "commission", body: "b".repeat(20) }, null);
      expect(savedTicket().priority).toBe("high");
    });

    it("stores the opening message as a normal thread message", async () => {
      await svc.create("u1", { subject: "s", category: "gameplay", body: "The game crashed." }, null);
      expect(messages.save).toHaveBeenCalledWith(
        expect.objectContaining({ authorRole: "user", body: "The game crashed.", internal: false }),
      );
    });

    it("publishes the classification so downstream routing sees it", async () => {
      await svc.create("u1", { subject: "s", category: "withdrawal", body: "b".repeat(20) }, null);
      const [, payload] = bus.publish.mock.calls[0] as [string, Record<string, unknown>];
      expect(payload.financialDispute).toBe(true);
    });
  });

  /* ==================================================================== *
   * Property 2 — the SLA clock
   * ==================================================================== */

  describe("SLA clock", () => {
    const openTicket = (over: Record<string, unknown> = {}) => ({
      id: "t1", ref: "TK-ABC", userId: "u1", subject: "s", category: "withdrawal",
      status: "open", priority: "high", financialDispute: true,
      slaDueAt: new Date(Date.now() + 2 * HOUR),
      firstResponseAt: null, resolvedAt: null, assigneeId: null,
      disputedRef: null, satisfactionRating: null, createdAt: new Date(),
      ...over,
    });

    it("does NOT move the deadline when a ticket is reassigned", async () => {
      const original = new Date(Date.now() + 2 * HOUR);
      tickets.findOne.mockResolvedValue(openTicket({ slaDueAt: original }));
      users.findOne.mockResolvedValue({ id: "agent-1", isStaff: true, role: "compliance" });

      const r = await svc.assign("TK-ABC", "agent-1", "admin-1");

      expect(r.slaDueAt).toBe(original.toISOString());
    });

    it("does NOT move the deadline when the priority changes", async () => {
      const original = new Date(Date.now() + 2 * HOUR);
      tickets.findOne.mockResolvedValue(openTicket({ slaDueAt: original }));

      const r = await svc.setPriority("TK-ABC", "urgent", "member escalated on social media", "admin-1");

      expect(r.slaDueAt).toBe(original.toISOString());
    });

    it("marks a ticket breached only when there is NO first response", async () => {
      tickets.findOne.mockResolvedValue(
        openTicket({ slaDueAt: new Date(Date.now() - HOUR), firstResponseAt: null }),
      );
      const breached = await svc.setPriority("TK-ABC", "urgent", "past the deadline", "admin-1");
      expect(breached.slaBreached).toBe(true);

      tickets.findOne.mockResolvedValue(
        openTicket({ slaDueAt: new Date(Date.now() - HOUR), firstResponseAt: new Date() }),
      );
      const answered = await svc.setPriority("TK-ABC", "urgent", "already answered", "admin-1");
      expect(answered.slaBreached).toBe(false);
    });

    it("stamps the first response on an agent reply, but NOT on an internal note", async () => {
      tickets.findOne.mockResolvedValue(openTicket());
      messages.find.mockResolvedValue([]);

      await svc.agentReply("TK-ABC", { body: "Looking into it", internal: true }, "agent-1");
      expect(tickets.save).not.toHaveBeenCalled();

      await svc.agentReply("TK-ABC", { body: "Here is what happened" }, "agent-1");
      expect(tickets.save).toHaveBeenCalledWith(
        expect.objectContaining({ firstResponseAt: expect.any(Date), status: "pending_user" }),
      );
    });

    it("notifies the member on a real reply and not on an internal note", async () => {
      tickets.findOne.mockResolvedValue(openTicket());
      messages.find.mockResolvedValue([]);

      await svc.agentReply("TK-ABC", { body: "note", internal: true }, "agent-1");
      expect(notifications.notify).not.toHaveBeenCalled();

      await svc.agentReply("TK-ABC", { body: "reply" }, "agent-1");
      expect(notifications.notify).toHaveBeenCalled();
    });
  });

  /* ==================================================================== *
   * Routing
   * ==================================================================== */

  describe("assign", () => {
    const financial = {
      id: "t1", ref: "TK-ABC", userId: "u1", subject: "s", category: "withdrawal",
      status: "open", priority: "high", financialDispute: true,
      slaDueAt: new Date(Date.now() + HOUR), firstResponseAt: null, resolvedAt: null,
      assigneeId: null, disputedRef: null, satisfactionRating: null, createdAt: new Date(),
    };

    it("REFUSES to assign a financial dispute to staff who are not compliance-trained", async () => {
      tickets.findOne.mockResolvedValue({ ...financial });
      users.findOne.mockResolvedValue({ id: "agent-1", isStaff: true, role: "support" });

      await expect(svc.assign("TK-ABC", "agent-1", "admin-1"))
        .rejects.toMatchObject({ response: { code: "NOT_COMPLIANCE_TRAINED" } });
    });

    it("permits a compliance agent on a financial dispute", async () => {
      tickets.findOne.mockResolvedValue({ ...financial });
      users.findOne.mockResolvedValue({ id: "agent-1", isStaff: true, role: "compliance" });

      const r = await svc.assign("TK-ABC", "agent-1", "admin-1");
      expect(r.ref).toBe("TK-ABC");
    });

    it("permits a support agent on an ordinary ticket", async () => {
      tickets.findOne.mockResolvedValue({ ...financial, financialDispute: false, category: "gameplay" });
      users.findOne.mockResolvedValue({ id: "agent-1", isStaff: true, role: "support" });

      await expect(svc.assign("TK-ABC", "agent-1", "admin-1")).resolves.toBeDefined();
    });

    it("REFUSES to assign to a non-staff account", async () => {
      tickets.findOne.mockResolvedValue({ ...financial });
      users.findOne.mockResolvedValue({ id: "u2", isStaff: false, role: "player" });

      await expect(svc.assign("TK-ABC", "u2", "admin-1")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("names the compliance-trained roles", () => {
      expect(isComplianceTrained("compliance")).toBe(true);
      expect(isComplianceTrained("finance_admin")).toBe(true);
      expect(isComplianceTrained("super_admin")).toBe(true);
      expect(isComplianceTrained("support")).toBe(false);
      expect(isComplianceTrained("player")).toBe(false);
    });
  });

  /* ==================================================================== *
   * Thread privacy
   * ==================================================================== */

  describe("detail", () => {
    it("NEVER returns internal notes on the member-facing path", async () => {
      tickets.findOne.mockResolvedValue({
        id: "t1", ref: "TK-ABC", userId: "u1", subject: "s", category: "gameplay",
        status: "open", priority: "low", financialDispute: false,
        slaDueAt: new Date(), firstResponseAt: null, resolvedAt: null,
        disputedRef: null, satisfactionRating: null, createdAt: new Date(),
      });
      messages.find.mockResolvedValue([
        { id: "m1", authorRole: "user", body: "hello", internal: false, createdAt: new Date() },
      ]);

      await svc.detail("u1", "TK-ABC");

      /* The filter is in the query, not applied after the fact. */
      const [args] = messages.find.mock.calls[0] as [{ where: { internal: boolean } }];
      expect(args.where.internal).toBe(false);
    });

    it("attributes agent replies to \"Support\", never a named person", async () => {
      tickets.findOne.mockResolvedValue({
        id: "t1", ref: "TK-ABC", userId: "u1", subject: "s", category: "gameplay",
        status: "open", priority: "low", financialDispute: false,
        slaDueAt: new Date(), firstResponseAt: null, resolvedAt: null,
        disputedRef: null, satisfactionRating: null, createdAt: new Date(),
      });
      messages.find.mockResolvedValue([
        { id: "m1", authorRole: "agent", authorId: "agent-1", body: "hi", internal: false, createdAt: new Date() },
      ]);

      const d = await svc.detail("u1", "TK-ABC");

      expect(d.messages[0].authorLabel).toBe("Support");
      expect(JSON.stringify(d)).not.toContain("agent-1");
    });
  });

  describe("reply", () => {
    it("reopens a ticket that was waiting on the member", async () => {
      tickets.findOne.mockResolvedValue({
        id: "t1", ref: "TK-ABC", userId: "u1", subject: "s", category: "gameplay",
        status: "pending_user", priority: "low", financialDispute: false,
        slaDueAt: new Date(), firstResponseAt: new Date(), resolvedAt: null,
        disputedRef: null, satisfactionRating: null, createdAt: new Date(),
      });
      messages.find.mockResolvedValue([]);

      await svc.reply("u1", "TK-ABC", "Still broken");

      expect(tickets.save).toHaveBeenCalledWith(expect.objectContaining({ status: "open" }));
    });

    it("REFUSES a reply to a closed ticket, pointing at a new one", async () => {
      tickets.findOne.mockResolvedValue({
        id: "t1", ref: "TK-ABC", userId: "u1", status: "closed",
      });
      await expect(svc.reply("u1", "TK-ABC", "hello"))
        .rejects.toMatchObject({ response: { code: "TICKET_CLOSED" } });
    });
  });

  describe("rate", () => {
    it("REFUSES a rating before the ticket is resolved", async () => {
      tickets.findOne.mockResolvedValue({ id: "t1", ref: "TK-ABC", userId: "u1", status: "open" });
      await expect(svc.rate("u1", "TK-ABC", 5))
        .rejects.toMatchObject({ response: { code: "TICKET_NOT_RESOLVED" } });
    });
  });

  /* ==================================================================== *
   * Escalation and reporting
   * ==================================================================== */

  describe("escalateBreached", () => {
    it("escalates unanswered tickets past their deadline, financial disputes first", async () => {
      const builder = qb({});
      builder.getMany = jest.fn(async () => [
        {
          id: "t1", ref: "TK-1", userId: "u1", category: "withdrawal",
          financialDispute: true, status: "open", priority: "high",
          slaDueAt: new Date(Date.now() - HOUR),
        },
      ]);
      tickets.createQueryBuilder.mockReturnValue(builder);

      const n = await svc.escalateBreached();

      expect(n).toBe(1);
      /* One UPDATE for the batch, not one save per ticket — a backlog must not
       * get more expensive to clear the longer it is. */
      expect(tickets.update).toHaveBeenCalledWith(
        expect.anything(),
        { status: "escalated", priority: "urgent" },
      );
      expect(tickets.save).not.toHaveBeenCalled();
      const [orderCall] = (builder.orderBy as jest.Mock).mock.calls;
      expect(orderCall[0]).toContain("financialDispute");
    });

    it("publishes the escalation with the reason", async () => {
      const builder = qb({});
      builder.getMany = jest.fn(async () => [
        {
          id: "t1", ref: "TK-1", userId: "u1", category: "withdrawal",
          financialDispute: true, status: "open", priority: "high",
          slaDueAt: new Date(Date.now() - HOUR),
        },
      ]);
      tickets.createQueryBuilder.mockReturnValue(builder);

      await svc.escalateBreached();

      const [, payload] = bus.publish.mock.calls[0] as [string, Record<string, unknown>];
      expect(payload.reason).toContain("SLA breached");
    });
  });

  describe("slaReport", () => {
    it("reports the MEDIAN first response, not the mean", async () => {
      tickets.count.mockResolvedValue(3);
      tickets.createQueryBuilder.mockImplementation(() =>
        qb({
          /* One outlier at 10,000 minutes would wreck a mean. */
          rawMany: [{ minutes: 5 }, { minutes: 20 }, { minutes: 10_000 }],
          rawOne: { avg: "4.5" },
          count: 2,
        }),
      );

      const r = await svc.slaReport();

      expect(r.medianFirstResponseMinutes).toBe(20);
      expect(r.breached).toBe(2);
      expect(r.meanSatisfaction).toBe(4.5);
    });

    it("reports null rather than zero when nothing has been answered yet", async () => {
      tickets.createQueryBuilder.mockImplementation(() => qb({ rawMany: [], rawOne: { avg: null } }));
      const r = await svc.slaReport();
      expect(r.medianFirstResponseMinutes).toBeNull();
      expect(r.meanSatisfaction).toBeNull();
      expect(ConflictException).toBeDefined();
    });
  });
});
