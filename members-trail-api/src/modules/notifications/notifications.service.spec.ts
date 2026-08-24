import { getQueueToken } from "@nestjs/bullmq";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import {
  Notification, NotificationDelivery, NotificationPreference, User,
} from "@/database/entities";
import { Queues } from "@/queues/queue.constants";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import { NotificationsService } from "./notifications.service";

/* ============================================================================
 * The rule under test: A SECURITY NOTIFICATION CANNOT BE MUTED.
 *
 * "Someone signed into your account" is the notification an attacker silences
 * first. So the preferences model has no key for it, the send path does not read
 * preferences for it, and an attempt to store a mute for it is dropped rather
 * than saved — three independent places, because one would be enough to forget.
 * ========================================================================== */

function repo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
    save: jest.fn(async (x: unknown) => ({ id: "row-1", ...(x as object) })),
    create: jest.fn((x: unknown) => x),
    count: jest.fn(async (..._a: unknown[]) => 0),
    remove: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

const USER = {
  id: "u1",
  email: "member@example.com",
  phone: "+911234567890",
  status: "active" as const,
};

describe("NotificationsService", () => {
  let svc: NotificationsService;
  let notifications: ReturnType<typeof repo>;
  let deliveries: ReturnType<typeof repo>;
  let prefs: ReturnType<typeof repo>;
  let users: ReturnType<typeof repo>;
  let queue: { add: jest.Mock };
  /* Reads and prunes are single statements now; the SQL is exercised against a
   * real database in the e2e suite. */
  let routines: {
    markNotificationsRead: jest.Mock;
    markAllNotificationsRead: jest.Mock;
    pruneReadNotifications: jest.Mock;
  };

  beforeEach(async () => {
    notifications = repo();
    deliveries = repo();
    prefs = repo();
    users = repo();
    queue = { add: jest.fn() };

    routines = {
      markNotificationsRead: jest.fn(async (_userId: string, ids: string[]) => ids.length),
      markAllNotificationsRead: jest.fn(async () => 0),
      pruneReadNotifications: jest.fn(async () => 0),
    };

    const mod = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(Notification), useValue: notifications },
        { provide: getRepositoryToken(NotificationDelivery), useValue: deliveries },
        { provide: getRepositoryToken(NotificationPreference), useValue: prefs },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getQueueToken(Queues.Notification), useValue: queue },
        { provide: DbRoutinesService, useValue: routines },
      ],
    }).compile();

    svc = mod.get(NotificationsService);
    users.findOne.mockResolvedValue({ ...USER });
    prefs.findOne.mockResolvedValue(null);
    notifications.findOne.mockResolvedValue(null);
  });

  const channelsQueued = () =>
    deliveries.save.mock.calls.map((c) => (c[0] as { channel: string }).channel);

  /* ==================================================================== *
   * The unmutable rule
   * ==================================================================== */

  describe("security notifications", () => {
    it("delivers on EVERY channel even when the member muted everything", async () => {
      prefs.findOne.mockResolvedValue({
        userId: "u1",
        channels: { security: { email: false, sms: false, push: false } },
        marketingOptIn: false,
      });

      await svc.notify({
        userId: "u1", kind: "security",
        title: "New sign-in", body: "A new device signed in.",
      });

      expect(channelsQueued()).toEqual(["email", "sms", "push"]);
    });

    it("does not even read preferences for a security notification", async () => {
      await svc.notify({ userId: "u1", kind: "security", title: "t", body: "b" });
      expect(prefs.findOne).not.toHaveBeenCalled();
    });

    it("omits SMS only when there is no phone number to send to", async () => {
      users.findOne.mockResolvedValue({ ...USER, phone: null });
      await svc.notify({ userId: "u1", kind: "security", title: "t", body: "b" });
      expect(channelsQueued()).toEqual(["email", "push"]);
    });

    it("DROPS an attempt to store a mute for security, rather than saving it", async () => {
      await svc.updatePreferences("u1", {
        channels: { security: { email: false, sms: false, push: false } },
      });

      const saved = prefs.save.mock.calls[0]?.[0] as { channels: Record<string, unknown> };
      expect(saved.channels.security).toBeUndefined();
    });

    it("tells the client which kinds cannot be muted", async () => {
      const p = await svc.preferences("u1");
      expect(p.alwaysDelivered).toEqual(["security"]);
      expect(p.channels.security).toBeUndefined();
      expect(p.note).toContain("cannot be muted");
    });
  });

  /* ==================================================================== *
   * Ordinary kinds
   * ==================================================================== */

  describe("channel preferences", () => {
    it("respects a muted channel for a mutable kind", async () => {
      prefs.findOne.mockResolvedValue({
        userId: "u1",
        channels: { transaction: { email: false, sms: false, push: true } },
        marketingOptIn: true,
      });

      await svc.notify({ userId: "u1", kind: "transaction", title: "t", body: "b" });

      expect(channelsQueued()).toEqual(["push"]);
    });

    it("still writes the in-app record when every channel is muted", async () => {
      prefs.findOne.mockResolvedValue({
        userId: "u1",
        channels: { transaction: { email: false, sms: false, push: false } },
        marketingOptIn: true,
      });

      const n = await svc.notify({ userId: "u1", kind: "transaction", title: "t", body: "b" });

      /* A member who muted email still needs to find "your withdrawal was
       * rejected" somewhere. */
      expect(n).not.toBeNull();
      expect(notifications.save).toHaveBeenCalled();
      expect(deliveries.save).not.toHaveBeenCalled();
    });

    it("uses sensible defaults when the member has never set preferences", async () => {
      await svc.notify({ userId: "u1", kind: "transaction", title: "t", body: "b" });
      expect(channelsQueued()).toEqual(["email", "push"]);
    });

    it("suppresses promotional sends for a member who withdrew marketing consent", async () => {
      prefs.findOne.mockResolvedValue({
        userId: "u1",
        channels: { promo: { email: true, sms: true, push: true } },
        marketingOptIn: false,
      });

      await svc.notify({ userId: "u1", kind: "promo", title: "t", body: "b" });

      /* Consent withdrawn beats a channel toggle. */
      expect(deliveries.save).not.toHaveBeenCalled();
    });

    it("skips SMS when the member has no phone, even if enabled", async () => {
      users.findOne.mockResolvedValue({ ...USER, phone: null });
      prefs.findOne.mockResolvedValue({
        userId: "u1",
        channels: { transaction: { email: true, sms: true, push: true } },
        marketingOptIn: true,
      });

      await svc.notify({ userId: "u1", kind: "transaction", title: "t", body: "b" });

      expect(channelsQueued()).toEqual(["email", "push"]);
    });
  });

  /* ==================================================================== *
   * Delivery mechanics
   * ==================================================================== */

  describe("notify", () => {
    it("queues one job per channel with a deterministic id", async () => {
      await svc.notify({ userId: "u1", kind: "transaction", title: "t", body: "b" });
      expect(queue.add).toHaveBeenCalledWith(
        "send-notification",
        expect.objectContaining({ deliveryId: expect.any(String) }),
        expect.objectContaining({ jobId: expect.stringContaining("notify-") }),
      );
    });

    it("sends nothing to a closed account", async () => {
      users.findOne.mockResolvedValue({ ...USER, status: "closed" });
      const n = await svc.notify({ userId: "u1", kind: "transaction", title: "t", body: "b" });
      expect(n).toBeNull();
      expect(notifications.save).not.toHaveBeenCalled();
    });

    it("is idempotent on a dedupe key, so a retried publish does not notify twice", async () => {
      notifications.findOne.mockResolvedValue({
        id: "n1", kind: "transaction", data: { dedupeKey: "withdrawal:w1" },
      });

      await svc.notify({
        userId: "u1", kind: "transaction", title: "t", body: "b", dedupeKey: "withdrawal:w1",
      });

      expect(notifications.save).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it("stores the dedupe key so the next attempt can recognise it", async () => {
      await svc.notify({
        userId: "u1", kind: "transaction", title: "t", body: "b", dedupeKey: "withdrawal:w1",
      });
      const saved = notifications.save.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(saved.data.dedupeKey).toBe("withdrawal:w1");
    });

    it("keeps a broadcast going when one recipient fails", async () => {
      users.findOne.mockImplementation(async (opts: { where: { id: string } }) =>
        opts.where.id === "bad" ? null : { ...USER, id: opts.where.id },
      );

      const sent = await svc.notifyMany(["u1", "bad", "u2"], {
        kind: "system", title: "t", body: "b",
      });

      expect(sent).toBe(2);
    });

    it("deduplicates the recipient list", async () => {
      const sent = await svc.notifyMany(["u1", "u1", "u1"], { kind: "system", title: "t", body: "b" });
      expect(sent).toBe(1);
    });
  });

  describe("recordDelivery", () => {
    it("stamps a successful send and clears the error", async () => {
      deliveries.findOne.mockResolvedValue({
        id: "d1", channel: "email", target: "member@example.com", attempts: 0, lastError: "old",
      });

      await svc.recordDelivery({ deliveryId: "d1", status: "sent", providerMessageId: "msg-1" });

      expect(deliveries.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "sent", attempts: 1, providerMessageId: "msg-1", lastError: null,
        }),
      );
    });

    it("records the error on a failure, so it is visible rather than inferred", async () => {
      deliveries.findOne.mockResolvedValue({
        id: "d1", channel: "email", target: "member@example.com", attempts: 1,
      });

      await svc.recordDelivery({ deliveryId: "d1", status: "failed", error: "550 mailbox unavailable" });

      expect(deliveries.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", lastError: "550 mailbox unavailable" }),
      );
    });

    it("is a no-op for an unknown delivery rather than throwing in a worker", async () => {
      deliveries.findOne.mockResolvedValue(null);
      await expect(svc.recordDelivery({ deliveryId: "gone", status: "sent" })).resolves.toBeUndefined();
    });
  });

  /* ==================================================================== *
   * Reads
   * ==================================================================== */

  describe("markRead", () => {
    it("marks read in ONE statement, scoped to the owner", async () => {
      /* The "only unread rows" and "stamp readAt" parts are now in the UPDATE's
       * WHERE and SET, exercised against a real database in the e2e suite. What
       * matters here: the caller's own id is passed, so ids belonging to another
       * member's inbox cannot match, and there is no per-row save. */
      routines.markNotificationsRead.mockResolvedValue(1);

      const updated = await svc.markRead("u1", ["n1", "n2"]);

      expect(updated).toBe(1);
      expect(routines.markNotificationsRead).toHaveBeenCalledWith("u1", ["n1", "n2"]);
      expect(notifications.save).not.toHaveBeenCalled();
    });

    it("caps a single mark-read call, so one request cannot rewrite an entire inbox", async () => {
      const many = Array.from({ length: 900 }, (_, i) => `n${i}`);
      await svc.markRead("u1", many);
      const [, ids] = routines.markNotificationsRead.mock.calls[0] as [string, string[]];
      expect(ids).toHaveLength(500);
    });

    it("does nothing for an empty list", async () => {
      expect(await svc.markRead("u1", [])).toBe(0);
      expect(notifications.find).not.toHaveBeenCalled();
    });
  });

  describe("updatePreferences", () => {
    it("keeps unknown kinds out of storage", async () => {
      await svc.updatePreferences("u1", {
        channels: { not_a_kind: { email: true, sms: true, push: true } },
      });
      const saved = prefs.save.mock.calls[0]?.[0] as { channels: Record<string, unknown> };
      expect(saved.channels.not_a_kind).toBeUndefined();
    });

    it("stores a mutable kind's settings", async () => {
      await svc.updatePreferences("u1", {
        channels: { commission: { email: false, sms: true, push: false } },
        marketingOptIn: false,
      });
      const saved = prefs.save.mock.calls[0]?.[0] as {
        channels: Record<string, unknown>; marketingOptIn: boolean;
      };
      expect(saved.channels.commission).toEqual({ email: false, sms: true, push: false });
      expect(saved.marketingOptIn).toBe(false);
    });
  });
});
