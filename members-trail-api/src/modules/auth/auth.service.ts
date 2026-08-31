import {
  BadRequestException, ConflictException, ForbiddenException, HttpException,
  HttpStatus, Inject, Injectable, Logger, NotFoundException, UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository, InjectDataSource } from "@nestjs/typeorm";
import { DataSource, In, IsNull, Repository, type EntityManager } from "typeorm";
import {
  FraudAlert, LoginHistory, NotificationPreference, ReferralEdge, User,
  UserBalance, VerificationToken, type FraudAlertStatus,
} from "@/database/entities";
import { CryptoService } from "@/common/crypto/crypto.service";
import { RedisService } from "@/common/redis/redis.service";
import { CacheKeys } from "@/common/redis/cache.keys";
import { EventBusService, Events } from "@/events";
import { authConfig, type AuthConfig } from "@/config/configuration";
import { Ref, maskEmail, maskPhone } from "@/common/utils";
import { PaginationQuery, paginate, type OkResponse, type Paginated } from "@/common/dto";
import { AuditService } from "@/modules/audit/audit.service";
import { OtpService } from "./otp.service";
import { SessionService, type SessionContext } from "./session.service";
import { TwoFactorService } from "./two-factor.service";
import {
  RISK_WEIGHTS, ageInYears, checkPassword, isEmailIdentifier,
  isRestrictedJurisdiction, minimumAgeFor, normaliseEmail, normalisePhone,
} from "./auth.constants";
import type {
  ForgotPasswordDto, LoginDto, LoginResponse, RegisterDto, RegisterResponse,
  ResendOtpResponse, ResetPasswordDto, SessionView, TwoFaLoginDto,
  VerifyOtpResponse, OtpChannel,
} from "./dto/auth.dto";

/* ============================================================================
 * Registration, sign-in and credential recovery (FRD A-01 … A-04).
 * ========================================================================== */

/** Failures after which the UI must present a CAPTCHA (FRD A-03). */
export const CAPTCHA_AFTER_FAILURES = 3;

/** Upper bound on the progressive lockout window, so a locked-out legitimate
 *  user is never locked out forever by someone else guessing their address. */
export const MAX_LOCKOUT_SECONDS = 24 * 60 * 60;

/** Fields loaded when a password or second factor has to be checked. */
const AUTH_SELECT = [
  "id", "ref", "email", "emailHash", "emailVerifiedAt", "phone", "phoneHash",
  "phoneVerifiedAt", "passwordHash", "passwordChangedAt", "twoFaMethod",
  "twoFaSecretEnc", "twoFaRecoveryCodes", "fullName", "displayName", "country",
  "locale", "timezone", "status", "kycTier", "role", "isStaff", "statusReason",
  "referralCode", "referredById", "sponsorPath", "referralDepth", "riskScore",
  "riskFlags", "signupFingerprint", "signupIp", "acceptedLegalVersions",
  "lastLoginAt", "createdAt",
] as const;

export interface RequestContext extends SessionContext {
  /** Country resolved from the request IP by the edge, when available. */
  ipCountry?: string | null;
  requestId?: string | null;
  /** jti of the session making the request, when authenticated. Lets a caller
   *  revoke every OTHER session without signing itself out. */
  sessionJti?: string;
}

export interface SelfReferralAssessment {
  suspected: boolean;
  signals: string[];
}

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(LoginHistory) private readonly logins: Repository<LoginHistory>,
    @InjectRepository(VerificationToken) private readonly tokens: Repository<VerificationToken>,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    private readonly bus: EventBusService,
    private readonly audit: AuditService,
    private readonly otp: OtpService,
    private readonly sessionSvc: SessionService,
    private readonly twoFa: TwoFactorService,
    @Inject(authConfig.KEY) private readonly cfg: AuthConfig,
  ) {}

  /* ==================================================================== *
   * A-01  Registration
   * ==================================================================== */

  async register(dto: RegisterDto, ctx: RequestContext): Promise<RegisterResponse> {
    const email = normaliseEmail(dto.email);
    const phone = normalisePhone(dto.phone);
    const country = dto.country.trim().toUpperCase();

    /* ------------------------- jurisdiction (A-01) ---------------------- */
    if (isRestrictedJurisdiction(country)) {
      throw new ForbiddenException({
        message: "We are unable to offer accounts in your country of residence",
        code: "JURISDICTION_RESTRICTED",
        country,
      });
    }

    const ipCountry = ctx.ipCountry ? ctx.ipCountry.trim().toUpperCase() : null;
    const riskFlags: string[] = [];
    let riskScore = 0;

    /* The declared country is self-reported, so it is cross-checked against the
     * network location. A restricted network location is refused outright — that
     * is the case the sanctions rule exists for. A mere mismatch is a risk
     * signal, not a rejection: travel and VPNs are legitimate. */
    if (ipCountry && isRestrictedJurisdiction(ipCountry)) {
      throw new ForbiddenException({
        message: "We are unable to offer accounts from your current location",
        code: "JURISDICTION_RESTRICTED_IP",
      });
    }
    if (ipCountry && ipCountry !== country) {
      riskFlags.push("country_mismatch");
      riskScore += RISK_WEIGHTS.countryMismatch;
    }

    /* ------------------------------ age (A-01) -------------------------- */
    const minAge = minimumAgeFor(country);
    const age = ageInYears(dto.dateOfBirth);
    if (!Number.isFinite(age)) {
      throw new BadRequestException({ message: "Date of birth is not a valid date", code: "DOB_INVALID" });
    }
    if (age < minAge) {
      throw new ForbiddenException({
        message: `You must be at least ${minAge} to open an account`,
        code: "UNDERAGE",
        minimumAge: minAge,
      });
    }
    if (age > 120) {
      throw new BadRequestException({ message: "Date of birth is not plausible", code: "DOB_INVALID" });
    }

    /* --------------------------- password (A-01) ------------------------ */
    this.assertPasswordAcceptable(dto.password, { email, fullName: dto.fullName });

    /* ---------------------------- uniqueness ---------------------------- */
    const emailHash = this.crypto.hmac(email);
    const phoneHash = this.crypto.hmac(phone);

    if (await this.users.exists({ where: { emailHash } })) {
      throw new ConflictException({
        message: "An account already exists for that email address",
        code: "EMAIL_IN_USE",
      });
    }
    if (await this.users.exists({ where: { phoneHash } })) {
      throw new ConflictException({
        message: "An account already exists for that phone number",
        code: "PHONE_IN_USE",
      });
    }

    /* ----------------------------- referral ----------------------------- */
    /* A holder rather than a plain `let`: the assignment happens inside the
       transaction callback, and TypeScript's flow analysis does not follow an
       assignment made in a callback — it would narrow the variable back to null
       for the code after it. Published once the transaction commits; see below. */
    const raised: { value: { alert: FraudAlert; isNew: boolean } | null } = { value: null };
    let sponsor: User | null = null;
    if (dto.referralCode?.trim()) {
      sponsor = await this.resolveSponsor(dto.referralCode.trim());
    }

    const selfReferral = sponsor
      ? this.assessSelfReferral(sponsor, ctx)
      : { suspected: false, signals: [] };

    if (selfReferral.suspected) {
      riskFlags.push("self_referral_suspected", ...selfReferral.signals);
      riskScore += RISK_WEIGHTS.selfReferralSuspected;
    }

    const passwordHash = await this.crypto.hashPassword(dto.password);

    /* -------------------------- persist the account --------------------- */
    const created = await this.ds.transaction(async (m) => {
      const userRepo = m.getRepository(User);
      const referralCode = await this.mintReferralCode(userRepo);

      /* Ancestor path is the sponsor's path plus the sponsor, trimmed to the
       * three levels the compensation plan pays. There is no level 4 by
       * design, so nothing deeper is materialised. */
      const ancestors = sponsor
        ? [...(sponsor.sponsorPath ? sponsor.sponsorPath.split("/").filter(Boolean) : []), sponsor.id]
            .slice(-3)
        : [];

      const user = await userRepo.save(
        userRepo.create({
          ref: Ref.user(),
          email,
          emailHash,
          phone,
          phoneHash,
          passwordHash,
          fullName: dto.fullName.trim(),
          displayName: this.deriveDisplayName(dto.fullName),
          dateOfBirth: dto.dateOfBirth,
          country,
          locale: dto.locale ?? "en",
          timezone: dto.timezone ?? "UTC",
          status: "pending_verification",
          kycTier: 0,
          role: "player",
          isStaff: false,
          referralCode,
          referredById: sponsor?.id ?? null,
          sponsorPath: ancestors.length ? ancestors.join("/") : null,
          referralDepth: sponsor ? sponsor.referralDepth + 1 : 0,
          riskScore,
          riskFlags: riskFlags.length ? riskFlags : null,
          signupFingerprint: ctx.fingerprint ?? null,
          signupIp: ctx.ip ?? null,
          acceptedLegalVersions: { termsAcceptedAt: new Date().toISOString() },
        }),
      );

      /* The balance row is created empty here so every later read has a row to
       * lock. Its VALUES are only ever changed by LedgerService. */
      await m.getRepository(UserBalance).insert(
        m.getRepository(UserBalance).create({ userId: user.id }),
      );

      await m.getRepository(NotificationPreference).insert(
        m.getRepository(NotificationPreference).create({
          userId: user.id,
          channels: defaultNotificationMatrix(),
          marketingOptIn: false,
        }),
      );

      /* A suspected self-referral attaches the relationship for investigation
       * but NOT the commission edges. Commission calculation reads
       * referral_edges, so withholding them means nothing can be earned off the
       * flagged relationship while a reviewer looks at it — as opposed to
       * paying out now and clawing back later. */
      if (sponsor && ancestors.length && !selfReferral.suspected) {
        const edgeRepo = m.getRepository(ReferralEdge);
        const rows = ancestors
          .slice()
          .reverse()
          .map((ancestorId, idx) =>
            edgeRepo.create({ userId: user.id, ancestorId, level: (idx + 1) as 1 | 2 | 3 }),
          );
        await edgeRepo.insert(rows);
      }

      if (sponsor && selfReferral.suspected) {
        raised.value = await this.raiseSelfReferralAlert(m, user, sponsor, selfReferral, ctx);
      }

      return user;
    });

    /* ------------------- side effects, after the commit ----------------- */

    /*
     * Announce the alert, if one was raised.
     *
     * This has to happen out here rather than beside the insert: publishing from
     * inside the transaction would tell the admin console about an alert that a
     * rollback could still take away. And it has to happen at all — the realtime
     * gateway is subscribed to FraudAlertRaised, so without this the ONE fraud
     * signal that fires at signup was the one that never reached the dashboard
     * live. Only a newly-created alert is announced; a merge into an open case is
     * not new information arriving.
     */
    if (raised.value?.isNew) {
      const { alert } = raised.value;
      try {
        await this.bus.publish(Events.FraudAlertRaised, {
          ref: alert.ref,
          kind: alert.kind,
          severity: alert.severity,
          riskScore: alert.riskScore,
          affectedUserIds: alert.affectedUserIds,
          signals: alert.signals,
        });
      } catch (e) {
        /* The alert is committed and visible in the queue either way. A broker
         * outage must not fail a registration that already succeeded. */
        this.log.error(
          `failed to publish self-referral alert ${alert.ref}`,
          e instanceof Error ? e.stack : String(e),
        );
      }
    }

    let resendAfter = this.cfg.otpResendCooldown;
    try {
      const emailIssue = await this.otp.issue({
        userId: created.id, channel: "email", target: email, ip: ctx.ip, template: "verify.email",
      });
      resendAfter = emailIssue.resendAfter;
      await this.otp.issue({
        userId: created.id, channel: "phone", target: phone, ip: ctx.ip, template: "verify.phone",
      });
    } catch (e) {
      /* The account exists; the user can ask for another code. Failing the whole
       * registration here would leave them unable to retry, because the email
       * is now taken. */
      this.log.error(
        `registration OTP dispatch failed for ${maskEmail(email)}`,
        e instanceof Error ? e.stack : String(e),
      );
    }

    await this.audit.record({
      actorId: created.id,
      action: "auth.register",
      targetType: "user",
      targetId: created.id,
      after: {
        ref: created.ref,
        country,
        referredById: created.referredById,
        riskFlags,
        riskScore,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });

    await this.bus.publish(
      Events.UserRegistered,
      {
        userId: created.id,
        ref: created.ref,
        country,
        referredById: created.referredById ?? null,
        referralDepth: created.referralDepth,
        referralAttached: Boolean(sponsor) && !selfReferral.suspected,
        underReview: selfReferral.suspected,
        riskFlags,
      },
      { actorId: created.id, correlationId: ctx.requestId ?? undefined },
    );

    return {
      userRef: created.ref,
      status: created.status,
      email: maskEmail(email),
      phone: maskPhone(phone),
      resendAfter,
      underReview: selfReferral.suspected,
      referralAttached: Boolean(sponsor) && !selfReferral.suspected,
    };
  }

  /**
   * Self-referral detection (FRD A-01).
   *
   * A member creating accounts under their own code is the cheapest attack on a
   * referral programme, so the signals are checked at the only moment we can see
   * both parties' device and network context at once. Deliberately conservative:
   * a shared household IP is a real false positive, which is why the outcome is
   * "flag for review and withhold the edges", not "reject the signup".
   */
  assessSelfReferral(sponsor: User, ctx: RequestContext): SelfReferralAssessment {
    const signals: string[] = [];

    if (ctx.fingerprint && sponsor.signupFingerprint && ctx.fingerprint === sponsor.signupFingerprint) {
      signals.push("same_signup_fingerprint");
    }
    if (ctx.ip && sponsor.signupIp && ctx.ip === sponsor.signupIp) {
      signals.push("same_signup_ip");
    }

    return { suspected: signals.length > 0, signals };
  }

  /* ==================================================================== *
   * A-02  Verification
   * ==================================================================== */

  async verifyOtp(
    channel: OtpChannel,
    code: string,
    identifier: string | undefined,
    authenticatedUserId: string | undefined,
    ctx: RequestContext,
  ): Promise<VerifyOtpResponse> {
    const user = await this.resolveVerificationSubject(channel, identifier, authenticatedUserId);
    const target = channel === "email" ? user.email : user.phone;
    if (!target) {
      throw new BadRequestException({
        message: `No ${channel} on file for this account`,
        code: "CHANNEL_MISSING",
      });
    }

    await this.otp.verify({ channel, target, code });

    const now = new Date();
    if (channel === "email") user.emailVerifiedAt = user.emailVerifiedAt ?? now;
    else user.phoneVerifiedAt = user.phoneVerifiedAt ?? now;

    const bothVerified = Boolean(user.emailVerifiedAt && user.phoneVerifiedAt);
    const previousStatus = user.status;

    /* Both channels verified moves the account out of pending_verification —
     * it is contactable, but still cannot touch real money until KYC. */
    if (bothVerified && user.status === "pending_verification") {
      user.status = "verified_kyc_pending";
    }
    await this.users.save(user);

    await this.audit.record({
      actorId: user.id,
      action: `auth.verify.${channel}`,
      targetType: "user",
      targetId: user.id,
      before: { status: previousStatus },
      after: { status: user.status, channel },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    if (bothVerified && previousStatus === "pending_verification") {
      await this.bus.publish(
        Events.UserVerified,
        { userId: user.id, ref: user.ref, status: user.status },
        { actorId: user.id },
      );
      await this.bus.publish(
        Events.UserStatusChanged,
        { userId: user.id, from: previousStatus, to: user.status, reason: "contact_verified" },
        { actorId: user.id },
      );
    }

    return {
      emailVerified: Boolean(user.emailVerifiedAt),
      phoneVerified: Boolean(user.phoneVerifiedAt),
      status: user.status,
      nextStep: bothVerified ? "kyc_tier1" : channel === "email" ? "verify_phone" : "verify_email",
    };
  }

  /**
   * Resends a code. The response is identical for a known and an unknown
   * identifier — a resend endpoint that says "no such account" is an account
   * enumeration oracle.
   */
  async resendOtp(
    channel: OtpChannel,
    identifier: string,
    ctx: RequestContext,
  ): Promise<ResendOtpResponse> {
    const target = channel === "email" ? normaliseEmail(identifier) : normalisePhone(identifier);
    const where = channel === "email"
      ? { emailHash: this.crypto.hmac(target) }
      : { phoneHash: this.crypto.hmac(target) };

    const user = await this.users.findOne({ where });

    if (!user) {
      /* Burn the cooldown anyway so probing does not become a free channel. */
      await this.redis.client.set(
        CacheKeys.otpCooldown(channel, target),
        "1",
        "EX",
        this.cfg.otpResendCooldown,
      );
      return { ok: true, resendAfter: this.cfg.otpResendCooldown };
    }

    const alreadyVerified = channel === "email" ? user.emailVerifiedAt : user.phoneVerifiedAt;
    if (alreadyVerified) {
      return { ok: true, resendAfter: this.cfg.otpResendCooldown };
    }

    const issued = await this.otp.issue({
      userId: user.id,
      channel,
      target,
      ip: ctx.ip,
      template: channel === "email" ? "verify.email" : "verify.phone",
    });

    return { ok: true, resendAfter: issued.resendAfter };
  }

  /* ==================================================================== *
   * A-03  Login
   * ==================================================================== */

  async login(dto: LoginDto, ctx: RequestContext): Promise<LoginResponse> {
    const identifier = dto.identifier.trim();
    const isEmail = isEmailIdentifier(identifier);
    const normalised = isEmail ? normaliseEmail(identifier) : normalisePhone(identifier);

    await this.assertNotLockedOut(normalised);

    const user = await this.users.findOne({
      where: isEmail
        ? { emailHash: this.crypto.hmac(normalised) }
        : { phoneHash: this.crypto.hmac(normalised) },
      select: [...AUTH_SELECT],
    });

    /* An unknown identifier is still recorded. Without this row a credential
     * stuffing run against addresses that do not exist here is invisible, which
     * is exactly the reconnaissance phase we most want to see. */
    if (!user) {
      await this.recordAttempt({
        userId: null, identifier: normalised, success: false,
        failureReason: "unknown_account", ctx,
      });
      const attempts = await this.registerFailure(normalised);
      await this.bus.publish(Events.UserLoginFailed, {
        identifier: isEmail ? maskEmail(normalised) : maskPhone(normalised),
        reason: "unknown_account",
        ip: ctx.ip ?? null,
        attempts,
      });
      throw this.invalidCredentials(attempts);
    }

    const passwordOk = await this.crypto.verifyPassword(user.passwordHash, dto.password);

    if (!passwordOk) {
      await this.recordAttempt({
        userId: user.id, identifier: normalised, success: false,
        failureReason: "bad_password", ctx,
      });
      const attempts = await this.registerFailure(normalised);
      await this.bus.publish(Events.UserLoginFailed, {
        userId: user.id, reason: "bad_password", ip: ctx.ip ?? null, attempts,
      });
      throw this.invalidCredentials(attempts);
    }

    if (user.status === "closed") {
      await this.recordAttempt({
        userId: user.id, identifier: normalised, success: false,
        failureReason: "account_closed", ctx,
      });
      throw new ForbiddenException({
        message: "This account has been closed. Contact support if you believe this is an error.",
        code: "ACCOUNT_CLOSED",
      });
    }

    if (user.status === "suspended" || user.status === "frozen") {
      await this.recordAttempt({
        userId: user.id, identifier: normalised, success: false,
        failureReason: `account_${user.status}`, ctx,
      });
      throw new ForbiddenException({
        message: `Your account is ${user.status}. Contact support.`,
        code: `ACCOUNT_${user.status.toUpperCase()}`,
        reason: user.statusReason ?? null,
      });
    }

    /* Credentials are good — clear the lockout budget before the second factor,
     * so a slow 2FA entry does not eventually lock the account out. */
    await this.clearFailures(normalised);

    /* Transparent upgrade when the stored hash predates a parameter change.
     * Done here because this is the only moment the plaintext is available. */
    if (this.crypto.needsRehash(user.passwordHash)) {
      const rehashed = await this.crypto.hashPassword(dto.password);
      await this.users.update({ id: user.id }, { passwordHash: rehashed });
    }

    if (user.twoFaMethod !== "none") {
      const challenge = await this.twoFa.openChallenge(user, ctx.ip ?? null);
      return {
        authenticated: false,
        challengeId: challenge.challengeId,
        twoFaMethod: user.twoFaMethod === "sms" ? "sms" : "totp",
        challengeExpiresIn: challenge.expiresIn,
        status: user.status,
      };
    }

    return this.completeLogin(user, normalised, ctx, "password");
  }

  async loginTwoFa(dto: TwoFaLoginDto, ctx: RequestContext): Promise<LoginResponse> {
    const challenge = await this.twoFa.readChallenge(dto.challengeId);

    const user = await this.users.findOne({
      where: { id: challenge.userId },
      select: [...AUTH_SELECT],
    });
    if (!user) throw new UnauthorizedException("Account not found");

    const identifier = user.emailHash;
    await this.assertNotLockedOut(identifier);

    const ok = await this.twoFa.verifyChallengeCode(challenge, user, {
      code: dto.code,
      recoveryCode: dto.recoveryCode,
    });

    if (!ok) {
      await this.recordAttempt({
        userId: user.id, identifier: user.email, success: false,
        failureReason: "bad_two_fa", ctx,
      });
      const attempts = await this.registerFailure(identifier);
      await this.bus.publish(Events.UserLoginFailed, {
        userId: user.id, reason: "bad_two_fa", ip: ctx.ip ?? null, attempts,
      });
      throw new UnauthorizedException({
        message: "That two-factor code is not valid",
        code: "TWO_FA_CODE_INVALID",
        attemptsRemaining: Math.max(0, this.cfg.loginMaxAttempts - attempts),
      });
    }

    await this.twoFa.closeChallenge(dto.challengeId);
    await this.clearFailures(identifier);

    return this.completeLogin(
      user,
      user.email,
      ctx,
      dto.recoveryCode ? "two_fa_recovery_code" : "two_fa",
    );
  }

  /* ==================================================================== *
   * Tokens
   * ==================================================================== */

  async refresh(refreshToken: string, ctx: RequestContext): Promise<LoginResponse> {
    const issued = await this.sessionSvc.rotate(refreshToken, ctx, (userId) =>
      this.users.findOne({ where: { id: userId } }),
    );

    return { authenticated: true, tokens: issued.tokens };
  }

  async logout(sessionId: string, userId: string, ctx: RequestContext): Promise<OkResponse> {
    await this.sessionSvc.revoke(sessionId, "logout");
    await this.audit.record({
      actorId: userId,
      action: "auth.logout",
      targetType: "user_session",
      targetId: sessionId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: true, message: "Signed out" };
  }

  async logoutAll(userId: string, ctx: RequestContext): Promise<OkResponse> {
    const count = await this.sessionSvc.revokeAll(userId, "logout_all");
    await this.audit.record({
      actorId: userId,
      action: "auth.logout_all",
      targetType: "user",
      targetId: userId,
      after: { revokedSessions: count },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: true, message: `Signed out of ${count} session(s)` };
  }

  listSessions(userId: string, currentSessionId: string): Promise<SessionView[]> {
    return this.sessionSvc.listActive(userId, currentSessionId);
  }

  async revokeSession(
    userId: string,
    sessionId: string,
    ctx: RequestContext,
  ): Promise<OkResponse> {
    const revoked = await this.sessionSvc.revokeById(sessionId, userId, "user_revoked");
    if (!revoked) throw new NotFoundException("Session not found");

    await this.audit.record({
      actorId: userId,
      action: "auth.session.revoke",
      targetType: "user_session",
      targetId: sessionId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: true, message: "Session revoked" };
  }

  /* ==================================================================== *
   * A-04  Password recovery
   * ==================================================================== */

  /**
   * Always returns the same response. The one thing this endpoint must not do is
   * tell a caller whether an address is registered — so the timing-sensitive
   * work (token mint, queue write) happens only for a real account, but the
   * shape and message of the reply never varies.
   */
  async forgotPassword(dto: ForgotPasswordDto, ctx: RequestContext): Promise<OkResponse> {
    const generic: OkResponse = {
      ok: true,
      message: "If an account matches those details, a reset link is on its way.",
    };

    const identifier = dto.identifier.trim();
    const isEmail = isEmailIdentifier(identifier);
    const normalised = isEmail ? normaliseEmail(identifier) : normalisePhone(identifier);

    const user = await this.users.findOne({
      where: isEmail
        ? { emailHash: this.crypto.hmac(normalised) }
        : { phoneHash: this.crypto.hmac(normalised) },
    });
    if (!user) return generic;

    const token = this.crypto.randomToken(32);
    const tokenHash = this.crypto.hmac(token);
    const expiresAt = new Date(Date.now() + this.cfg.passwordResetTtl * 1_000);

    /* Superseding outstanding tokens means a stolen older link stops working the
     * moment the user asks for a new one. */
    await this.tokens.delete({ userId: user.id, purpose: "password_reset" });
    await this.tokens.save(
      this.tokens.create({
        userId: user.id,
        purpose: "password_reset",
        tokenHash,
        target: isEmail ? normalised : user.email,
        expiresAt,
        requestedIp: ctx.ip ?? null,
      }),
    );
    await this.redis.client.set(
      CacheKeys.passwordReset(tokenHash),
      user.id,
      "EX",
      this.cfg.passwordResetTtl,
    );

    await this.otp.enqueuePasswordReset(user, token, this.cfg.passwordResetTtl);

    await this.audit.record({
      actorId: user.id,
      action: "auth.password.reset_requested",
      targetType: "user",
      targetId: user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return generic;
  }

  async resetPassword(dto: ResetPasswordDto, ctx: RequestContext): Promise<OkResponse> {
    const tokenHash = this.crypto.hmac(dto.token);

    const row = await this.tokens.findOne({
      where: { purpose: "password_reset", tokenHash, consumedAt: IsNull() },
    });
    if (!row || !row.userId) {
      throw new BadRequestException({
        message: "That reset link is invalid or has already been used",
        code: "RESET_TOKEN_INVALID",
      });
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      await this.tokens.delete({ id: row.id });
      throw new BadRequestException({
        message: "That reset link has expired. Request a new one.",
        code: "RESET_TOKEN_EXPIRED",
      });
    }

    const user = await this.users.findOne({
      where: { id: row.userId },
      select: [...AUTH_SELECT],
    });
    if (!user) throw new BadRequestException("Account not found");

    this.assertPasswordAcceptable(dto.password, { email: user.email, fullName: user.fullName });

    if (await this.crypto.verifyPassword(user.passwordHash, dto.password)) {
      throw new BadRequestException({
        message: "Choose a password you have not used before",
        code: "PASSWORD_REUSED",
      });
    }

    user.passwordHash = await this.crypto.hashPassword(dto.password);
    user.passwordChangedAt = new Date();
    await this.users.save(user);

    row.consumedAt = new Date();
    await this.tokens.save(row);
    await this.redis.del(CacheKeys.passwordReset(tokenHash));

    /* Every session dies. A password reset is the remedy for a compromised
     * account, and it is worthless if the attacker's session survives it. */
    const revoked = await this.sessionSvc.revokeAll(user.id, "password_reset");
    await this.clearFailures(user.email);
    await this.clearFailures(user.emailHash);

    await this.audit.recordOrThrow({
      actorId: user.id,
      action: "auth.password.reset",
      targetType: "user",
      targetId: user.id,
      after: { revokedSessions: revoked },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    await this.bus.publish(
      Events.PasswordChanged,
      { userId: user.id, method: "reset", revokedSessions: revoked, ip: ctx.ip ?? null },
      { actorId: user.id },
    );

    return { ok: true, message: "Password updated. Sign in with your new password." };
  }

  /** Password change by an authenticated user. Keeps the current session alive
   *  and drops the others, which is what a user expects after changing it. */
  async changePassword(
    userId: string,
    currentSessionId: string,
    currentPassword: string,
    newPassword: string,
    ctx: RequestContext,
  ): Promise<OkResponse> {
    const user = await this.users.findOne({ where: { id: userId }, select: [...AUTH_SELECT] });
    if (!user) throw new NotFoundException("Account not found");

    if (!(await this.crypto.verifyPassword(user.passwordHash, currentPassword))) {
      throw new UnauthorizedException({
        message: "Current password is incorrect",
        code: "PASSWORD_INVALID",
      });
    }

    this.assertPasswordAcceptable(newPassword, { email: user.email, fullName: user.fullName });

    if (await this.crypto.verifyPassword(user.passwordHash, newPassword)) {
      throw new BadRequestException({
        message: "Choose a password you have not used before",
        code: "PASSWORD_REUSED",
      });
    }

    user.passwordHash = await this.crypto.hashPassword(newPassword);
    user.passwordChangedAt = new Date();
    await this.users.save(user);

    const revoked = await this.sessionSvc.revokeAll(user.id, "password_changed", currentSessionId);

    await this.audit.recordOrThrow({
      actorId: user.id,
      action: "auth.password.change",
      targetType: "user",
      targetId: user.id,
      after: { revokedSessions: revoked },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    await this.bus.publish(
      Events.PasswordChanged,
      { userId: user.id, method: "change", revokedSessions: revoked, ip: ctx.ip ?? null },
      { actorId: user.id },
    );

    return { ok: true, message: "Password updated. Other devices were signed out." };
  }

  /* ==================================================================== *
   * Login history
   * ==================================================================== */

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
   * Internals
   * ==================================================================== */

  private async completeLogin(
    user: User,
    identifier: string,
    ctx: RequestContext,
    method: string,
  ): Promise<LoginResponse> {
    const issued = await this.sessionSvc.issue(user, ctx);

    user.lastLoginAt = new Date();
    user.lastActiveAt = user.lastLoginAt;
    await this.users.update(
      { id: user.id },
      { lastLoginAt: user.lastLoginAt, lastActiveAt: user.lastActiveAt },
    );

    await this.recordAttempt({
      userId: user.id, identifier, success: true, failureReason: null, ctx,
    });

    await this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      action: "auth.login.success",
      targetType: "user",
      targetId: user.id,
      after: { method, sessionId: issued.tokens.sessionId },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });

    await this.bus.publish(
      Events.UserLoggedIn,
      {
        userId: user.id,
        method,
        sessionId: issued.tokens.sessionId,
        ip: ctx.ip ?? null,
        device: ctx.device ?? ctx.fingerprint ?? null,
      },
      { actorId: user.id, correlationId: ctx.requestId ?? undefined },
    );

    return {
      authenticated: true,
      tokens: issued.tokens,
      status: user.status,
      kycTier: user.kycTier,
      legalReacceptanceRequired: false,
    };
  }

  private assertPasswordAcceptable(
    password: string,
    context: { email?: string; fullName?: string },
  ): void {
    const problems = checkPassword(password, context);
    if (problems.length) {
      throw new BadRequestException({
        message: problems[0].message,
        code: "PASSWORD_REJECTED",
        problems,
      });
    }
  }

  /* --------------------------- lockout budget ------------------------- */

  /** Keyed on the HMAC of the identifier so a Redis dump does not enumerate
   *  which addresses are being attacked. */
  private lockoutKey(identifier: string): string {
    return CacheKeys.loginAttempts(this.crypto.hmac(`login:${identifier.toLowerCase()}`));
  }

  private async assertNotLockedOut(identifier: string): Promise<void> {
    const key = this.lockoutKey(identifier);
    const raw = await this.redis.client.get(key);
    const attempts = raw ? Number(raw) : 0;

    if (attempts >= this.cfg.loginMaxAttempts) {
      const retryAfter = Math.max(1, await this.redis.ttl(key));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Too many sign-in attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
          code: "LOGIN_LOCKED_OUT",
          retryAfter,
          captchaRequired: true,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Counts a failure and escalates the lockout window.
   *
   * Progressive rather than fixed: a fixed 15-minute window lets a patient
   * attacker grind five guesses every quarter of an hour forever. Each further
   * block of failures doubles the wait, capped so a targeted lockout cannot
   * permanently deny a legitimate user their account.
   */
  private async registerFailure(identifier: string): Promise<number> {
    const key = this.lockoutKey(identifier);
    const attempts = await this.redis.incrWithTtl(key, this.cfg.loginLockoutSeconds);

    if (attempts >= this.cfg.loginMaxAttempts) {
      const tier = Math.floor(attempts / this.cfg.loginMaxAttempts);
      const window = Math.min(
        this.cfg.loginLockoutSeconds * 2 ** Math.max(0, tier - 1),
        MAX_LOCKOUT_SECONDS,
      );
      await this.redis.client.expire(key, window);
    }
    return attempts;
  }

  private async clearFailures(identifier: string): Promise<void> {
    await this.redis.del(this.lockoutKey(identifier));
  }

  private invalidCredentials(attempts: number): UnauthorizedException {
    /* One message for "no such account" and "wrong password": distinguishing
     * them turns the login form into an account enumeration oracle. */
    return new UnauthorizedException({
      message: "Those sign-in details are not correct",
      code: "INVALID_CREDENTIALS",
      attemptsRemaining: Math.max(0, this.cfg.loginMaxAttempts - attempts),
      captchaRequired: attempts >= CAPTCHA_AFTER_FAILURES,
    });
  }

  private async recordAttempt(params: {
    userId: string | null;
    identifier: string;
    success: boolean;
    failureReason: string | null;
    ctx: RequestContext;
  }): Promise<void> {
    try {
      await this.logins.insert(
        this.logins.create({
          userId: params.userId,
          identifier: params.identifier.slice(0, 320),
          success: params.success,
          failureReason: params.failureReason?.slice(0, 64) ?? null,
          ip: params.ctx.ip ?? null,
          userAgent: params.ctx.userAgent?.slice(0, 400) ?? null,
          fingerprint: params.ctx.fingerprint ?? null,
        }),
      );
    } catch (e) {
      this.log.error(
        "failed to write login history",
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  /* ----------------------------- referral ----------------------------- */

  private async resolveSponsor(code: string): Promise<User> {
    const sponsor = await this.users.findOne({ where: { referralCode: code } });

    /* An unusable code must not silently become "no referral": the new member
     * believes they were referred, and the sponsor believes they referred. */
    if (!sponsor) {
      throw new BadRequestException({
        message: "That referral code is not valid",
        code: "REFERRAL_CODE_INVALID",
      });
    }
    if (["suspended", "frozen", "closed"].includes(sponsor.status)) {
      throw new BadRequestException({
        message: "That referral code is no longer active",
        code: "REFERRAL_CODE_INACTIVE",
      });
    }
    return sponsor;
  }

  private async mintReferralCode(repo: Repository<User>): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const code = this.crypto.referralCode();
      if (!(await repo.exists({ where: { referralCode: code } }))) return code;
    }
    throw new ConflictException("Could not allocate a referral code, please retry");
  }

  /**
   * Raises — or merges into — the self-referral case for this sponsor.
   *
   * Runs inside the registration transaction on purpose: an alert that says
   * "these edges were withheld" must commit with the registration that withheld
   * them, or a rollback leaves a case pointing at a user who does not exist.
   *
   * That is also why it cannot call `FraudService.raise()`, which uses its own
   * repository outside this transaction — and why the dedupe rule that service
   * documents has to be repeated here. It was NOT repeated here before, so the
   * comment below promised one case per (sponsor, signal set) while the code
   * inserted one per registration: a ring signing up two hundred accounts off one
   * address produced two hundred identical open high-severity alerts, which
   * buries the pattern it is meant to expose rather than surfacing it. The index
   * on `dedupeKey` is not unique, so nothing at the schema level caught it.
   *
   * Merging matches the service: an OPEN or INVESTIGATING case absorbs the new
   * signup. Once a reviewer has decided, a recurrence raises a fresh case,
   * because the pattern returning after a decision is itself information.
   */
  private async raiseSelfReferralAlert(
    m: EntityManager,
    user: User,
    sponsor: User,
    assessment: SelfReferralAssessment,
    ctx: RequestContext,
  ): Promise<{ alert: FraudAlert; isNew: boolean }> {
    const repo = m.getRepository(FraudAlert);
    const dedupeKey = `self_referral:${sponsor.id}:${assessment.signals.slice().sort().join(",")}`;
    const summary =
      `Registration ${user.ref} used ${sponsor.ref}'s referral code from the same ` +
      `device or network. Referral edges were withheld pending review.`;
    const evidence = {
      sponsorRef: sponsor.ref,
      newUserRef: user.ref,
      ip: ctx.ip ?? null,
      fingerprintMatched: assessment.signals.includes("same_signup_fingerprint"),
      ipMatched: assessment.signals.includes("same_signup_ip"),
    };

    const existing = await repo.findOne({
      where: {
        dedupeKey,
        status: In(["open", "investigating"] as FraudAlertStatus[]),
      },
    });

    if (existing) {
      /* Every flagged signup is named, so a reviewer sees the size of the
         cluster instead of one arbitrary member of it. */
      existing.affectedUserIds = [...new Set([...existing.affectedUserIds, user.id, sponsor.id])];
      existing.signals = [...new Set([...existing.signals, ...assessment.signals])];
      const seen = ((existing.evidence?.signups as unknown[]) ?? []) as unknown[];
      existing.evidence = {
        ...(existing.evidence ?? {}),
        ...evidence,
        signups: [...seen, { userRef: user.ref, ip: ctx.ip ?? null, at: new Date().toISOString() }],
      };
      existing.summary = summary;
      await repo.save(existing);
      return { alert: existing, isNew: false };
    }

    const alert = await repo.save(
      repo.create({
        ref: Ref.alert(),
        kind: "self_referral_ring",
        severity: "high",
        riskScore: RISK_WEIGHTS.selfReferralSuspected,
        affectedUserIds: [user.id, sponsor.id],
        summary,
        signals: assessment.signals,
        evidence: {
          ...evidence,
          signups: [{ userRef: user.ref, ip: ctx.ip ?? null, at: new Date().toISOString() }],
        },
        status: "open",
        dedupeKey,
      }),
    );
    return { alert, isNew: true };
  }

  private async resolveVerificationSubject(
    channel: OtpChannel,
    identifier: string | undefined,
    authenticatedUserId: string | undefined,
  ): Promise<User> {
    if (authenticatedUserId) {
      const user = await this.users.findOne({ where: { id: authenticatedUserId } });
      if (!user) throw new NotFoundException("Account not found");
      return user;
    }
    if (!identifier) {
      throw new BadRequestException({
        message: "An email address or phone number is required",
        code: "IDENTIFIER_REQUIRED",
      });
    }
    const target = channel === "email" ? normaliseEmail(identifier) : normalisePhone(identifier);
    const user = await this.users.findOne({
      where: channel === "email"
        ? { emailHash: this.crypto.hmac(target) }
        : { phoneHash: this.crypto.hmac(target) },
    });

    /* Same message as a wrong code: this endpoint must not confirm that an
     * address is registered. */
    if (!user) {
      throw new BadRequestException({
        message: "That code is not valid. Check the digits or request a new one.",
        code: "OTP_INVALID",
      });
    }
    return user;
  }

  private deriveDisplayName(fullName: string): string {
    const first = fullName.trim().split(/\s+/)[0] ?? "Member";
    return first.slice(0, 60);
  }
}

/**
 * Default notification matrix. `security` is absent on purpose — security
 * notifications are always delivered and must not be representable as a
 * preference, or a user (or an attacker inside their account) could mute
 * "someone signed into your account".
 */
export function defaultNotificationMatrix(): Record<
  string,
  { email: boolean; sms: boolean; push: boolean }
> {
  return {
    transaction: { email: true, sms: false, push: true },
    kyc: { email: true, sms: false, push: true },
    reward: { email: false, sms: false, push: true },
    commission: { email: true, sms: false, push: true },
    tournament: { email: false, sms: false, push: true },
    system: { email: true, sms: false, push: false },
    promo: { email: false, sms: false, push: false },
  };
}
