import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { Repository } from "typeorm";
import {
  Notification, NotificationDelivery, NotificationPreference, User,
  type NotificationKind,
} from "@/database/entities";
import { Jobs, Queues, jobKey } from "@/queues/queue.constants";
import { paginate, type Paginated } from "@/common/dto";
import { maskEmail, maskPhone } from "@/common/utils";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import type {
  NotificationListQuery, NotificationResponse, PreferencesResponse, UpdatePreferencesRequest,
} from "./dto/notifications.dto";

/* ============================================================================
 * Notifications (FRD N-01).
 *
 * Three rules, and the first one is the one that matters:
 *
 *  1. SECURITY NOTIFICATIONS CANNOT BE MUTED. "Someone signed into your
 *     account", "your password was changed", "a withdrawal was requested" — a
 *     preference that silences those is a preference an attacker sets first. The
 *     `security` kind bypasses preferences entirely, and the preferences model
 *     has no key for it, so it cannot be turned off by accident either.
 *
 *  2. THE IN-APP RECORD IS ALWAYS WRITTEN. Channel preferences control email,
 *     SMS and push — not whether the member is told at all. A member who muted
 *     email still needs to find "your withdrawal was rejected" somewhere.
 *
 *  3. DELIVERY IS ATTEMPTED OFF THE REQUEST PATH, and each attempt is recorded
 *     per channel. A silent send failure is indistinguishable from a member not
 *     reading their email; a `notification_deliveries` row with an error is not.
 * ========================================================================== */

/** Kinds a member may mute. `security` is deliberately absent. */
export const MUTABLE_KINDS: NotificationKind[] = [
  "transaction", "kyc", "reward", "commission", "tournament", "system", "promo",
];

/** Kinds that are always delivered on every channel available. */
const UNMUTABLE_KINDS = new Set<NotificationKind>(["security"]);

/** Marketing opt-out silences this kind on every channel except in-app. */
const MARKETING_KINDS = new Set<NotificationKind>(["promo"]);

const DEFAULT_CHANNELS = { email: true, sms: false, push: true };

export interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href?: string | null;
  data?: Record<string, unknown> | null;
  /** Domain-derived key. Prevents the same event notifying twice on retry. */
  dedupeKey?: string | null;
}

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(NotificationDelivery) private readonly deliveries: Repository<NotificationDelivery>,
    @InjectRepository(NotificationPreference) private readonly prefs: Repository<NotificationPreference>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectQueue(Queues.Notification) private readonly queue: Queue,
    private readonly routines: DbRoutinesService,
  ) {}

  /* ==================================================================== *
   * Sending
   * ==================================================================== */

  /**
   * Records a notification and queues delivery on the channels the member
   * allows — plus every channel, regardless of preference, for security.
   */
  async notify(input: NotifyInput): Promise<Notification | null> {
    if (input.dedupeKey) {
      const existing = await this.notifications.findOne({
        where: { userId: input.userId, kind: input.kind },
        order: { createdAt: "DESC" },
      });
      /* A dedupe key that matches the most recent notification of this kind
       * within the same domain event is a replay, not a second event. */
      if (existing && (existing.data as { dedupeKey?: string } | null)?.dedupeKey === input.dedupeKey) {
        return existing;
      }
    }

    const user = await this.users.findOne({ where: { id: input.userId } });
    if (!user) throw new NotFoundException("Account not found");
    if (user.status === "closed") {
      /* A closed account gets no notifications; there is nobody to read them. */
      return null;
    }

    /* Rule 2: the in-app record is written regardless of channel preferences. */
    const notification = await this.notifications.save(
      this.notifications.create({
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        href: input.href ?? null,
        read: false,
        data: input.dedupeKey
          ? { ...(input.data ?? {}), dedupeKey: input.dedupeKey }
          : input.data ?? null,
      }),
    );

    const channels = await this.channelsFor(user, input.kind);

    for (const channel of channels) {
      const target = channel === "email" ? user.email : channel === "sms" ? user.phone ?? "" : user.id;
      if (!target) continue;

      const delivery = await this.deliveries.save(
        this.deliveries.create({
          notificationId: notification.id,
          userId: user.id,
          channel,
          target,
          status: "queued",
          attempts: 0,
        }),
      );

      await this.queue.add(
        Jobs.SendNotification,
        { deliveryId: delivery.id, notificationId: notification.id },
        /* Deterministic: a retried publish must not send twice. */
        { jobId: jobKey(`notify:${delivery.id}`) },
      );
    }

    return notification;
  }

  /**
   * Which channels a notification actually goes out on.
   *
   * Rule 1 lives here: for a security notification the preferences are not even
   * read. Everything else respects them, and marketing additionally respects the
   * separate opt-in — a member who unticked marketing has withdrawn consent, not
   * expressed a channel preference.
   */
  private async channelsFor(
    user: User,
    kind: NotificationKind,
  ): Promise<("email" | "sms" | "push")[]> {
    if (UNMUTABLE_KINDS.has(kind)) {
      /* Every channel we have a target for. This is not configurable. */
      return user.phone ? ["email", "sms", "push"] : ["email", "push"];
    }

    const pref = await this.prefs.findOne({ where: { userId: user.id } });

    if (MARKETING_KINDS.has(kind) && pref && !pref.marketingOptIn) {
      /* Consent withdrawn: in-app only. */
      return [];
    }

    const configured = pref?.channels?.[kind] ?? DEFAULT_CHANNELS;
    const out: ("email" | "sms" | "push")[] = [];
    if (configured.email) out.push("email");
    if (configured.sms && user.phone) out.push("sms");
    if (configured.push) out.push("push");
    return out;
  }

  /** Fan-out helper for staff broadcasts. Returns how many were queued. */
  async notifyMany(userIds: string[], input: Omit<NotifyInput, "userId">): Promise<number> {
    let sent = 0;
    for (const userId of [...new Set(userIds)]) {
      try {
        const result = await this.notify({ ...input, userId });
        if (result) sent += 1;
      } catch (e) {
        /* One bad recipient must not abort a broadcast to thousands. */
        this.log.warn(`notify ${userId} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return sent;
  }

  /* ==================================================================== *
   * Delivery — called by the queue processor
   * ==================================================================== */

  /**
   * Marks a delivery attempt.
   *
   * The provider integration itself belongs to the processor; this records the
   * outcome so a failure is visible rather than inferred from a member saying
   * they never got the email.
   */
  async recordDelivery(params: {
    deliveryId: string;
    status: "sent" | "delivered" | "failed" | "suppressed";
    providerMessageId?: string | null;
    error?: string | null;
  }): Promise<void> {
    const row = await this.deliveries.findOne({ where: { id: params.deliveryId } });
    if (!row) return;

    row.status = params.status;
    row.attempts += 1;
    row.providerMessageId = params.providerMessageId ?? row.providerMessageId ?? null;
    row.lastError = params.error ? params.error.slice(0, 1_000) : null;
    if (params.status === "sent" || params.status === "delivered") row.sentAt = new Date();
    await this.deliveries.save(row);

    if (params.status === "failed") {
      this.log.warn(
        `delivery ${row.channel} to ${mask(row.channel, row.target)} failed: ${params.error ?? "unknown"}`,
      );
    }
  }

  /* ==================================================================== *
   * Reads
   * ==================================================================== */

  async list(userId: string, q: NotificationListQuery): Promise<Paginated<NotificationResponse>> {
    const qb = this.notifications.createQueryBuilder("n").where("n.userId = :userId", { userId });
    if (q.kind) qb.andWhere("n.kind = :kind", { kind: q.kind });
    if (q.unreadOnly) qb.andWhere("n.read = false");

    const [rows, total] = await qb
      .orderBy("n.createdAt", "DESC")
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();

    return paginate(rows.map(toView), total, q);
  }

  async unreadCount(userId: string): Promise<{ unread: number; byKind: Record<string, number> }> {
    const rows = await this.notifications
      .createQueryBuilder("n")
      .select("n.kind", "kind")
      .addSelect("COUNT(*)", "count")
      .where("n.userId = :userId", { userId })
      .andWhere("n.read = false")
      .groupBy("n.kind")
      .getRawMany<{ kind: string; count: string }>();

    const byKind: Record<string, number> = {};
    let unread = 0;
    for (const row of rows) {
      const count = Number(row.count ?? 0);
      byKind[row.kind] = count;
      unread += count;
    }
    return { unread, byKind };
  }

  async markRead(userId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    /* One UPDATE, scoped to the owner — this was a SELECT plus up to 500
     * single-row saves, and opening an inbox marks everything visible as read.
     * The user id stays in the WHERE clause: an id from someone else's inbox
     * must not match. */
    return this.routines.markNotificationsRead(userId, ids.slice(0, 500));
  }

  async markAllRead(userId: string): Promise<number> {
    /* Was up to five thousand single-row updates for one tap of "mark all read". */
    return this.routines.markAllNotificationsRead(userId);
  }

  /* ==================================================================== *
   * Preferences
   * ==================================================================== */

  /**
   * The member's channel preferences.
   *
   * `security` is not in the returned map, and the response says why. A UI that
   * renders a toggle for it would be promising something the platform will not
   * honour.
   */
  async preferences(userId: string): Promise<PreferencesResponse> {
    const pref = await this.prefs.findOne({ where: { userId } });
    const channels: Record<string, { email: boolean; sms: boolean; push: boolean }> = {};

    for (const kind of MUTABLE_KINDS) {
      channels[kind] = pref?.channels?.[kind] ?? { ...DEFAULT_CHANNELS };
    }

    return {
      channels,
      marketingOptIn: pref?.marketingOptIn ?? true,
      alwaysDelivered: ["security"],
      note:
        "Security notifications are always delivered on every available channel and cannot be " +
        "muted. Everything else is in-app regardless of these settings.",
    };
  }

  async updatePreferences(
    userId: string,
    dto: UpdatePreferencesRequest,
  ): Promise<PreferencesResponse> {
    const existing = await this.prefs.findOne({ where: { userId } });
    const row = existing ?? this.prefs.create({ userId, channels: {}, marketingOptIn: true });

    const next: Record<string, { email: boolean; sms: boolean; push: boolean }> = {
      ...(row.channels ?? {}),
    };

    for (const [kind, value] of Object.entries(dto.channels ?? {})) {
      /* An unknown or unmutable kind is dropped rather than stored: storing it
       * would imply the platform honours it. */
      if (!MUTABLE_KINDS.includes(kind as NotificationKind)) continue;
      next[kind] = {
        email: Boolean(value.email),
        sms: Boolean(value.sms),
        push: Boolean(value.push),
      };
    }

    row.channels = next;
    if (dto.marketingOptIn !== undefined) row.marketingOptIn = dto.marketingOptIn;
    await this.prefs.save(row);

    return this.preferences(userId);
  }

  /* ==================================================================== *
   * Operations
   * ==================================================================== */

  /** Failed deliveries for the ops dashboard. */
  async failedDeliveries(limit = 100): Promise<NotificationDelivery[]> {
    return this.deliveries.find({
      where: { status: "failed" },
      order: { createdAt: "DESC" },
      take: Math.min(limit, 500),
    });
  }

  /** Deletes read notifications older than the retention window. */
  async pruneRead(olderThanDays = 90): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);

    /* A bounded DELETE rather than loading five thousand entities into memory in
     * order to remove them. The limit stays: retention should nibble, not lock
     * the table for a minute on the first run after a busy quarter. */
    const pruned = await this.routines.pruneReadNotifications(cutoff, 5_000);
    if (pruned > 0) {
      this.log.log(`pruned ${pruned} read notifications older than ${olderThanDays} days`);
    }
    return pruned;
  }
}

/* --------------------------------- helpers -------------------------------- */

/** Masks a delivery target for logs. An email in a log is a data leak. */
function mask(channel: string, target: string): string {
  if (channel === "email") return maskEmail(target);
  if (channel === "sms") return maskPhone(target);
  return target.slice(0, 8);
}

function toView(n: Notification): NotificationResponse {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    href: n.href ?? null,
    read: n.read,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
    data: n.data ?? null,
  };
}
