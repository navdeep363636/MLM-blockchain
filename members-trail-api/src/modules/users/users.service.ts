import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, IsNull, Repository } from "typeorm";
import {
  LegalDocument, LoginHistory, NotificationPreference, Ticket, User,
  VerificationToken,
} from "@/database/entities";
import { CryptoService } from "@/common/crypto/crypto.service";
import { EventBusService, Events } from "@/events";
import { Ref, maskEmail, maskPhone } from "@/common/utils";
import { PaginationQuery, paginate, type Paginated } from "@/common/dto";
import { AuditService } from "@/modules/audit/audit.service";
import { OtpService } from "@/modules/auth/otp.service";
import { SessionService } from "@/modules/auth/session.service";
import { defaultNotificationMatrix } from "@/modules/auth/auth.service";
import { normaliseEmail, normalisePhone } from "@/modules/auth/auth.constants";
import type { RequestContext } from "@/modules/auth/auth.service";
import {
  CONFIGURABLE_NOTIFICATION_KINDS, type AccountDeletionRequestDto,
  type ContactChangeStartedResponse, type DataExportRequestDto,
  type LegalAcceptanceResponse, type LifecycleRequestResponse, type MeResponse,
  type NotificationPreferencesResponse, type SecurityOverviewResponse,
  type UpdateNotificationPreferencesDto, type UpdateProfileDto,
} from "./dto/users.dto";

/* ============================================================================
 * Profile, preferences, security overview and account lifecycle
 * (FRD D-02, D-03).
 *
 * Two rules shape this module:
 *
 *  1. A contact detail is never changed by a PATCH. Email and phone are
 *     recovery channels and 2FA destinations, so an attacker inside a session
 *     must not be able to redirect them with one request. The new value is
 *     proven first, and only then written.
 *
 *  2. Security notifications are not a preference. The matrix physically has no
 *     "security" key, so "someone signed into your account" cannot be muted.
 * ========================================================================== */

/** Days the platform has to fulfil a data-subject request (GDPR Art. 12(3)). */
export const DSR_FULFILMENT_DAYS = 30;

/** Cooling-off before a deletion request is actioned, so it can be recalled. */
export const DELETION_GRACE_DAYS = 14;

const ALWAYS_ON_NOTIFICATIONS = ["security"];

@Injectable()
export class UsersService {
  private readonly log = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(NotificationPreference)
    private readonly prefs: Repository<NotificationPreference>,
    @InjectRepository(LoginHistory) private readonly logins: Repository<LoginHistory>,
    @InjectRepository(VerificationToken) private readonly tokens: Repository<VerificationToken>,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(LegalDocument) private readonly legal: Repository<LegalDocument>,
    private readonly crypto: CryptoService,
    private readonly bus: EventBusService,
    private readonly audit: AuditService,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
  ) {}

  /* ==================================================================== *
   * Profile
   * ==================================================================== */

  async me(userId: string): Promise<MeResponse> {
    const user = await this.require(userId);
    return this.toMe(user);
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
    ctx: RequestContext,
  ): Promise<MeResponse> {
    const user = await this.require(userId);

    const before = {
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      locale: user.locale,
      timezone: user.timezone,
    };

    if (dto.displayName !== undefined) user.displayName = dto.displayName.trim();
    if (dto.avatarUrl !== undefined) user.avatarUrl = dto.avatarUrl;
    if (dto.locale !== undefined) user.locale = dto.locale;
    if (dto.timezone !== undefined) user.timezone = dto.timezone;

    await this.users.save(user);

    await this.audit.record({
      actorId: userId,
      action: "user.profile.update",
      targetType: "user",
      targetId: userId,
      before,
      after: {
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        locale: user.locale,
        timezone: user.timezone,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return this.toMe(user);
  }

  /* ==================================================================== *
   * Contact change (re-verification, never a direct patch)
   * ==================================================================== */

  async startEmailChange(
    userId: string,
    newEmail: string,
    ctx: RequestContext,
  ): Promise<ContactChangeStartedResponse> {
    const user = await this.require(userId);
    const email = normaliseEmail(newEmail);
    const emailHash = this.crypto.hmac(email);

    if (emailHash === user.emailHash) {
      throw new BadRequestException({
        message: "That is already your email address",
        code: "EMAIL_UNCHANGED",
      });
    }
    if (await this.users.exists({ where: { emailHash } })) {
      throw new ConflictException({
        message: "That email address is already in use",
        code: "EMAIL_IN_USE",
      });
    }

    /* One pending change at a time: a second request supersedes the first so a
     * stale code cannot later move the address somewhere unexpected. */
    await this.tokens.delete({ userId, purpose: "email_change" });

    const issued = await this.otp.issue({
      userId,
      channel: "email",
      target: email,
      purpose: "email_change",
      ip: ctx.ip,
      template: "verify.email_change",
    });

    await this.audit.record({
      actorId: userId,
      action: "user.email.change_requested",
      targetType: "user",
      targetId: userId,
      before: { email: maskEmail(user.email) },
      after: { email: maskEmail(email) },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { ok: true, sentTo: issued.sentTo, resendAfter: issued.resendAfter, pending: true };
  }

  async confirmEmailChange(
    userId: string,
    code: string,
    ctx: RequestContext,
  ): Promise<MeResponse> {
    const user = await this.require(userId);
    const pending = await this.tokens.findOne({
      where: { userId, purpose: "email_change", consumedAt: IsNull() },
      order: { createdAt: "DESC" },
    });
    if (!pending?.target) {
      throw new BadRequestException({
        message: "No email change is pending. Start again.",
        code: "NO_PENDING_CHANGE",
      });
    }

    await this.otp.verify({
      channel: "email",
      target: pending.target,
      code,
      purpose: "email_change",
    });

    const emailHash = this.crypto.hmac(pending.target);
    /* Re-checked after the code is proven: the address may have been claimed by
     * someone else in the window between request and confirmation. */
    if (await this.users.exists({ where: { emailHash } })) {
      throw new ConflictException({
        message: "That email address is already in use",
        code: "EMAIL_IN_USE",
      });
    }

    const before = { email: maskEmail(user.email) };
    user.email = pending.target;
    user.emailHash = emailHash;
    user.emailVerifiedAt = new Date();
    await this.users.save(user);

    await this.audit.recordOrThrow({
      actorId: userId,
      action: "user.email.changed",
      targetType: "user",
      targetId: userId,
      before,
      after: { email: maskEmail(user.email) },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    /* The email is a recovery channel, so changing it is a security event: other
     * devices are signed out in case the change was not the owner's doing. */
    await this.sessions.revokeAll(userId, "email_changed", ctx.sessionJti);

    return this.toMe(user);
  }

  async startPhoneChange(
    userId: string,
    newPhone: string,
    ctx: RequestContext,
  ): Promise<ContactChangeStartedResponse> {
    const user = await this.require(userId);
    const phone = normalisePhone(newPhone);
    const phoneHash = this.crypto.hmac(phone);

    if (phoneHash === user.phoneHash) {
      throw new BadRequestException({
        message: "That is already your phone number",
        code: "PHONE_UNCHANGED",
      });
    }
    if (await this.users.exists({ where: { phoneHash } })) {
      throw new ConflictException({
        message: "That phone number is already in use",
        code: "PHONE_IN_USE",
      });
    }

    const issued = await this.otp.issue({
      userId,
      channel: "phone",
      target: phone,
      purpose: "phone_verify",
      ip: ctx.ip,
      template: "verify.phone_change",
    });

    await this.audit.record({
      actorId: userId,
      action: "user.phone.change_requested",
      targetType: "user",
      targetId: userId,
      before: { phone: user.phone ? maskPhone(user.phone) : null },
      after: { phone: maskPhone(phone) },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { ok: true, sentTo: issued.sentTo, resendAfter: issued.resendAfter, pending: true };
  }

  async confirmPhoneChange(
    userId: string,
    code: string,
    ctx: RequestContext,
  ): Promise<MeResponse> {
    const user = await this.require(userId);
    const pending = await this.tokens.findOne({
      where: { userId, purpose: "phone_verify", consumedAt: IsNull() },
      order: { createdAt: "DESC" },
    });
    if (!pending?.target) {
      throw new BadRequestException({
        message: "No phone change is pending. Start again.",
        code: "NO_PENDING_CHANGE",
      });
    }

    await this.otp.verify({ channel: "phone", target: pending.target, code });

    const phoneHash = this.crypto.hmac(pending.target);
    if (phoneHash !== user.phoneHash && (await this.users.exists({ where: { phoneHash } }))) {
      throw new ConflictException({
        message: "That phone number is already in use",
        code: "PHONE_IN_USE",
      });
    }

    const before = { phone: user.phone ? maskPhone(user.phone) : null };
    const wasTwoFaDestination = user.twoFaMethod === "sms";

    user.phone = pending.target;
    user.phoneHash = phoneHash;
    user.phoneVerifiedAt = new Date();
    await this.users.save(user);

    await this.audit.recordOrThrow({
      actorId: userId,
      action: "user.phone.changed",
      targetType: "user",
      targetId: userId,
      before,
      after: { phone: maskPhone(user.phone), wasTwoFaDestination },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    if (wasTwoFaDestination) {
      await this.sessions.revokeAll(userId, "two_fa_destination_changed", ctx.sessionJti);
    }

    return this.toMe(user);
  }

  /* ==================================================================== *
   * Notification preferences
   * ==================================================================== */

  async notificationPreferences(userId: string): Promise<NotificationPreferencesResponse> {
    const row = await this.ensurePreferences(userId);
    return {
      channels: this.withoutAlwaysOn(row.channels),
      marketingOptIn: row.marketingOptIn,
      alwaysOn: [...ALWAYS_ON_NOTIFICATIONS],
    };
  }

  async updateNotificationPreferences(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
    ctx: RequestContext,
  ): Promise<NotificationPreferencesResponse> {
    const row = await this.ensurePreferences(userId);
    const before = this.withoutAlwaysOn(row.channels);

    const next = { ...row.channels };
    for (const kind of CONFIGURABLE_NOTIFICATION_KINDS) {
      const toggle = dto[kind];
      if (toggle) {
        next[kind] = { email: toggle.email, sms: toggle.sms, push: toggle.push };
      }
    }

    /* Belt and braces. The DTO already makes an unknown key a 400, but the
     * matrix is also scrubbed here so no future caller of this service can
     * introduce a mutable security preference. */
    row.channels = this.withoutAlwaysOn(next);
    if (dto.marketingOptIn !== undefined) row.marketingOptIn = dto.marketingOptIn;
    await this.prefs.save(row);

    await this.audit.record({
      actorId: userId,
      action: "user.notification_preferences.update",
      targetType: "notification_preference",
      targetId: row.id,
      before,
      after: row.channels,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return {
      channels: row.channels,
      marketingOptIn: row.marketingOptIn,
      alwaysOn: [...ALWAYS_ON_NOTIFICATIONS],
    };
  }

  /* ==================================================================== *
   * Security overview (D-03)
   * ==================================================================== */

  async securityOverview(
    userId: string,
    currentSessionJti: string,
    q: PaginationQuery,
  ): Promise<SecurityOverviewResponse> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: ["id", "twoFaMethod", "twoFaEnabledAt", "twoFaRecoveryCodes", "passwordChangedAt"],
    });
    if (!user) throw new NotFoundException("Account not found");

    const [sessions, history] = await Promise.all([
      this.sessions.listActive(userId, currentSessionJti),
      this.loginHistory(userId, q),
    ]);

    return {
      twoFaMethod: user.twoFaMethod,
      twoFaEnabledAt: user.twoFaEnabledAt,
      /* The count, never the codes. */
      recoveryCodesRemaining: user.twoFaRecoveryCodes?.length ?? 0,
      passwordChangedAt: user.passwordChangedAt,
      sessions,
      loginHistory: history,
    };
  }

  async loginHistory(userId: string, q: PaginationQuery): Promise<Paginated<LoginHistory>> {
    const [rows, total] = await this.logins.findAndCount({
      where: { userId },
      order: { createdAt: "DESC" },
      skip: q.skip,
      take: q.limit,
    });
    return paginate(rows, total, q);
  }

  /* ==================================================================== *
   * Data-subject requests
   * ==================================================================== */

  /**
   * Both of these create a record and publish; neither acts synchronously.
   * An export has to walk a dozen tables and a deletion has to be reconciled
   * against financial retention obligations — doing either inside a request
   * would either time out or delete something the AML policy requires us to
   * keep.
   */
  async requestDataExport(
    userId: string,
    dto: DataExportRequestDto,
    ctx: RequestContext,
  ): Promise<LifecycleRequestResponse> {
    const user = await this.require(userId);
    const dueAt = new Date(Date.now() + DSR_FULFILMENT_DAYS * 86_400_000);

    const existing = await this.tickets.findOne({
      where: {
        userId,
        category: "account",
        status: In(["open", "pending_user", "escalated"]),
        disputedRef: "data_export",
      },
    });
    if (existing) {
      throw new ConflictException({
        message: "A data export request is already in progress",
        code: "EXPORT_ALREADY_REQUESTED",
        reference: existing.ref,
      });
    }

    const ticket = await this.tickets.save(
      this.tickets.create({
        ref: Ref.ticket(),
        userId,
        subject: `Data export request — ${user.ref}`,
        category: "account",
        status: "open",
        priority: "normal",
        financialDispute: false,
        slaDueAt: dueAt,
        disputedRef: "data_export",
      }),
    );

    await this.audit.recordOrThrow({
      actorId: userId,
      action: "user.data_export.requested",
      targetType: "ticket",
      targetId: ticket.id,
      after: { format: dto.format ?? "json", dueAt: dueAt.toISOString() },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    await this.bus.publish(
      Events.TicketCreated,
      {
        ticketId: ticket.id,
        ref: ticket.ref,
        userId,
        category: "account",
        kind: "data_export",
        format: dto.format ?? "json",
        dueAt: dueAt.toISOString(),
      },
      { actorId: userId },
    );

    return {
      ok: true,
      reference: ticket.ref,
      status: "open",
      dueAt,
      message:
        `Your data export has been requested. We will contact you within ` +
        `${DSR_FULFILMENT_DAYS} days.`,
    };
  }

  async requestAccountDeletion(
    userId: string,
    dto: AccountDeletionRequestDto,
    ctx: RequestContext,
  ): Promise<LifecycleRequestResponse> {
    if (!dto.confirm) {
      throw new BadRequestException({
        message: "Confirm the deletion request to continue",
        code: "CONFIRMATION_REQUIRED",
      });
    }

    const user = await this.require(userId);
    const dueAt = new Date(Date.now() + DELETION_GRACE_DAYS * 86_400_000);

    const existing = await this.tickets.findOne({
      where: {
        userId,
        category: "account",
        status: In(["open", "pending_user", "escalated"]),
        disputedRef: "account_deletion",
      },
    });
    if (existing) {
      throw new ConflictException({
        message: "An account deletion request is already in progress",
        code: "DELETION_ALREADY_REQUESTED",
        reference: existing.ref,
      });
    }

    const ticket = await this.tickets.save(
      this.tickets.create({
        ref: Ref.ticket(),
        userId,
        subject: `Account deletion request — ${user.ref}`,
        category: "account",
        status: "open",
        priority: "high",
        /* Routed as a financial matter: a balance, an open withdrawal or an
         * AML retention hold all have to be resolved before anything is
         * erased. */
        financialDispute: true,
        slaDueAt: dueAt,
        disputedRef: "account_deletion",
      }),
    );

    await this.audit.recordOrThrow({
      actorId: userId,
      action: "user.account_deletion.requested",
      targetType: "ticket",
      targetId: ticket.id,
      reason: dto.reason ?? null,
      after: { graceDays: DELETION_GRACE_DAYS, dueAt: dueAt.toISOString() },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    await this.bus.publish(
      Events.TicketCreated,
      {
        ticketId: ticket.id,
        ref: ticket.ref,
        userId,
        category: "account",
        kind: "account_deletion",
        graceDays: DELETION_GRACE_DAYS,
        dueAt: dueAt.toISOString(),
      },
      { actorId: userId },
    );

    return {
      ok: true,
      reference: ticket.ref,
      status: "open",
      dueAt,
      message:
        `Your deletion request has been recorded. You have ${DELETION_GRACE_DAYS} days to ` +
        `cancel it by contacting support. Balances and records the AML policy requires us ` +
        `to retain are settled before any data is removed.`,
    };
  }

  /* ==================================================================== *
   * Legal acceptance
   * ==================================================================== */

  async legalAcceptance(userId: string): Promise<LegalAcceptanceResponse> {
    const user = await this.require(userId);
    const accepted = user.acceptedLegalVersions ?? {};

    const published = await this.legal.find({
      where: { status: "published" },
      order: { publishedAt: "DESC" },
    });

    /* One row per slug — the most recently published version wins. */
    const latest = new Map<string, LegalDocument>();
    for (const doc of published) {
      if (!latest.has(doc.slug)) latest.set(doc.slug, doc);
    }

    const documents = [...latest.values()].map((doc) => {
      const acceptedVersion = accepted[doc.slug] ?? null;
      const upToDate = acceptedVersion === doc.version;
      return {
        slug: doc.slug,
        title: doc.title,
        currentVersion: doc.version,
        acceptedVersion,
        upToDate,
        /* A material change forces re-acceptance (FRD AD-11); a typo fix does
         * not, so an editorial republish is not an interruption. */
        reacceptanceRequired: !upToDate && doc.materialChange,
      };
    });

    return { documents, allAccepted: documents.every((d) => d.upToDate) };
  }

  async acceptLegalVersion(
    userId: string,
    slug: string,
    version: string,
    ctx: RequestContext,
  ): Promise<LegalAcceptanceResponse> {
    const doc = await this.legal.findOne({ where: { slug, version, status: "published" } });
    if (!doc) {
      throw new BadRequestException({
        message: "That document version is not published",
        code: "LEGAL_VERSION_UNKNOWN",
      });
    }

    const user = await this.require(userId);
    const before = { ...(user.acceptedLegalVersions ?? {}) };

    user.acceptedLegalVersions = {
      ...before,
      [slug]: version,
      [`${slug}:acceptedAt`]: new Date().toISOString(),
    };
    await this.users.save(user);

    /* Recorded rather than merely stored: proof of which version was accepted,
     * when and from where is the whole point of the acceptance record. */
    await this.audit.recordOrThrow({
      actorId: userId,
      action: "user.legal.accept",
      targetType: "legal_document",
      targetId: doc.id,
      before: { previousVersion: before[slug] ?? null },
      after: { slug, version },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return this.legalAcceptance(userId);
  }

  /* ==================================================================== *
   * Internals
   * ==================================================================== */

  private async require(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("Account not found");
    return user;
  }

  private async ensurePreferences(userId: string): Promise<NotificationPreference> {
    const existing = await this.prefs.findOne({ where: { userId } });
    if (existing) return existing;

    /* Registration creates this row; a missing one means an account predates the
     * preference table, so it is backfilled with the defaults rather than 404ing
     * a settings page. */
    return this.prefs.save(
      this.prefs.create({
        userId,
        channels: defaultNotificationMatrix(),
        marketingOptIn: false,
      }),
    );
  }

  private withoutAlwaysOn(
    channels: Record<string, { email: boolean; sms: boolean; push: boolean }>,
  ): Record<string, { email: boolean; sms: boolean; push: boolean }> {
    const out: Record<string, { email: boolean; sms: boolean; push: boolean }> = {};
    for (const [k, v] of Object.entries(channels ?? {})) {
      if (!ALWAYS_ON_NOTIFICATIONS.includes(k)) out[k] = v;
    }
    return out;
  }

  private toMe(user: User): MeResponse {
    return {
      ref: user.ref,
      email: user.email,
      emailVerified: Boolean(user.emailVerifiedAt),
      phone: user.phone ?? null,
      phoneVerified: Boolean(user.phoneVerifiedAt),
      fullName: user.fullName,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl ?? null,
      country: user.country,
      locale: user.locale,
      timezone: user.timezone,
      status: user.status,
      kycTier: user.kycTier,
      role: user.role,
      referralCode: user.referralCode,
      referralDepth: user.referralDepth,
      lastLoginAt: user.lastLoginAt ?? null,
      createdAt: user.createdAt,
      acceptedLegalVersions: user.acceptedLegalVersions ?? {},
    };
  }
}
