import {
  BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { LessThan, Repository } from "typeorm";
import { VerificationToken, type VerificationPurpose } from "@/database/entities";
import { CryptoService } from "@/common/crypto/crypto.service";
import { RedisService } from "@/common/redis/redis.service";
import { CacheKeys } from "@/common/redis/cache.keys";
import { Queues, Jobs, jobKey } from "@/queues/queue.constants";
import { authConfig, type AuthConfig } from "@/config/configuration";
import { maskEmail, maskPhone } from "@/common/utils";
import type { OtpChannel } from "./dto/auth.dto";

/* ============================================================================
 * One-time codes (FRD A-02).
 *
 * Source of truth is the `verification_tokens` row: it holds the HMAC of the
 * code, the expiry and the consumption marker, so a Redis flush cannot turn a
 * spent code back into a valid one. Redis holds only the two counters that must
 * be atomic and are worthless after the fact — the attempt count and the resend
 * cooldown.
 *
 * The raw code exists in exactly two places: the outbound message and the
 * caller's request. It is never logged and never returned by an endpoint.
 * ========================================================================== */

export const CHANNEL_PURPOSE: Record<OtpChannel, VerificationPurpose> = {
  email: "email_verify",
  phone: "phone_verify",
};

export interface IssueOtpParams {
  userId?: string | null;
  channel: OtpChannel;
  /** Email address or phone number, already normalised. */
  target: string;
  purpose?: VerificationPurpose;
  ip?: string | null;
  /** Template hint for the notification worker. */
  template?: string;
}

export interface VerifyOtpParams {
  channel: OtpChannel;
  target: string;
  code: string;
  purpose?: VerificationPurpose;
}

/** 429 with a machine-readable retry hint, which the UI needs for its timer. */
function tooMany(message: string, retryAfter: number, code: string): HttpException {
  return new HttpException(
    { statusCode: HttpStatus.TOO_MANY_REQUESTS, message, code, retryAfter },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

@Injectable()
export class OtpService {
  private readonly log = new Logger(OtpService.name);

  constructor(
    @InjectRepository(VerificationToken)
    private readonly tokens: Repository<VerificationToken>,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    @InjectQueue(Queues.Notification) private readonly notifications: Queue,
    @Inject(authConfig.KEY) private readonly cfg: AuthConfig,
  ) {}

  get ttlSeconds(): number {
    return this.cfg.otpTtl;
  }

  get resendCooldown(): number {
    return this.cfg.otpResendCooldown;
  }

  /**
   * Issues a code and hands delivery to the notification queue. Delivery is a
   * job, not an event: a dropped verification code is a support ticket, so it
   * must be retried rather than fire-and-forget.
   */
  async issue(params: IssueOtpParams): Promise<{ resendAfter: number; sentTo: string }> {
    const purpose = params.purpose ?? CHANNEL_PURPOSE[params.channel];
    const cooldownKey = CacheKeys.otpCooldown(params.channel, params.target);

    const remaining = await this.redis.ttl(cooldownKey);
    if (remaining > 0) {
      throw tooMany(
        `Please wait ${remaining}s before requesting another code`,
        remaining,
        "OTP_COOLDOWN",
      );
    }

    /* Supersede any outstanding code for this target. Two live codes for one
     * address doubles an attacker's guessing surface for no user benefit, and
     * removing the row keeps the (purpose, tokenHash) unique index collision
     * free. */
    await this.tokens.delete({ purpose, target: params.target });

    const code = this.crypto.numericOtp(6);
    const expiresAt = new Date(Date.now() + this.cfg.otpTtl * 1_000);

    await this.tokens.save(
      this.tokens.create({
        userId: params.userId ?? null,
        purpose,
        tokenHash: this.hash(purpose, params.target, code),
        target: params.target,
        attempts: 0,
        expiresAt,
        requestedIp: params.ip ?? null,
      }),
    );

    await this.redis.del(CacheKeys.otpAttempts(params.channel, params.target));
    await this.redis.client.set(cooldownKey, "1", "EX", this.cfg.otpResendCooldown);

    await this.enqueueDelivery(params, code);

    return {
      resendAfter: this.cfg.otpResendCooldown,
      sentTo: params.channel === "email" ? maskEmail(params.target) : maskPhone(params.target),
    };
  }

  /**
   * Verifies a code. Attempts are counted before the lookup, so a wrong guess
   * costs an attempt whether or not the code exists — otherwise the counter can
   * be sidestepped by guessing against a target with no live code.
   */
  async verify(params: VerifyOtpParams): Promise<VerificationToken> {
    const purpose = params.purpose ?? CHANNEL_PURPOSE[params.channel];
    const attemptsKey = CacheKeys.otpAttempts(params.channel, params.target);

    const attempts = await this.redis.incrWithTtl(attemptsKey, this.cfg.otpTtl);
    if (attempts > this.cfg.otpMaxAttempts) {
      /* Burn the code: an attacker who has exhausted the attempt budget must
       * not be able to keep guessing simply by waiting for the counter's TTL. */
      await this.invalidate(params.channel, params.target, purpose);
      throw tooMany(
        "Too many incorrect attempts. Request a new code.",
        this.cfg.otpResendCooldown,
        "OTP_ATTEMPTS_EXCEEDED",
      );
    }

    const row = await this.tokens.findOne({
      where: { purpose, tokenHash: this.hash(purpose, params.target, params.code) },
    });

    if (!row || row.consumedAt) {
      throw new BadRequestException({
        message: "That code is not valid. Check the digits or request a new one.",
        code: "OTP_INVALID",
        attemptsRemaining: Math.max(0, this.cfg.otpMaxAttempts - attempts),
      });
    }

    if (row.expiresAt.getTime() <= Date.now()) {
      await this.tokens.delete({ id: row.id });
      throw new BadRequestException({
        message: "That code has expired. Request a new one.",
        code: "OTP_EXPIRED",
      });
    }

    row.consumedAt = new Date();
    row.attempts = attempts;
    await this.tokens.save(row);

    await this.redis.del(attemptsKey, CacheKeys.otp(params.channel, params.target));

    return row;
  }

  /**
   * Queues a password-reset link. Lives here rather than in AuthService so all
   * credential-bearing outbound messages go through one place and none of them
   * can accidentally be logged on the way out.
   */
  async enqueuePasswordReset(
    user: { id: string; email: string },
    token: string,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.notifications.add(
        Jobs.SendNotification,
        {
          channel: "email",
          template: "password.reset",
          target: user.email,
          userId: user.id,
          kind: "security",
          data: { token, expiresInMinutes: Math.round(ttlSeconds / 60) },
        },
        { jobId: jobKey(`pwreset:${this.crypto.sha256(token)}`) },
      );
    } catch (e) {
      /* Swallowed on purpose: the caller must return the same response whether
       * or not the account exists, so a queue failure cannot be allowed to
       * change the reply shape into an enumeration signal. */
      this.log.error(
        "failed to enqueue password reset delivery",
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  /** Drops the live code for a target without consuming an attempt. */
  async invalidate(
    channel: OtpChannel,
    target: string,
    purpose: VerificationPurpose = CHANNEL_PURPOSE[channel],
  ): Promise<void> {
    await this.tokens.delete({ purpose, target });
    await this.redis.del(
      CacheKeys.otp(channel, target),
      CacheKeys.otpAttempts(channel, target),
    );
  }

  /** Housekeeping helper for the retention cron. */
  async purgeExpired(before: Date = new Date()): Promise<number> {
    const res = await this.tokens.delete({ expiresAt: LessThan(before) });
    return res.affected ?? 0;
  }

  private hash(purpose: VerificationPurpose, target: string, code: string): string {
    /* Target and purpose are inside the HMAC so a code minted for one address
     * cannot be replayed against another, and so two users holding the same
     * six digits produce different hashes. */
    return this.crypto.hmac(`otp:${purpose}:${target}:${code}`);
  }

  private async enqueueDelivery(params: IssueOtpParams, code: string): Promise<void> {
    try {
      await this.notifications.add(
        Jobs.SendNotification,
        {
          channel: params.channel === "email" ? "email" : "sms",
          template: params.template ?? `otp.${params.purpose ?? CHANNEL_PURPOSE[params.channel]}`,
          target: params.target,
          userId: params.userId ?? null,
          kind: "security",
          data: { code, expiresInMinutes: Math.round(this.cfg.otpTtl / 60) },
        },
        /* Deterministic job id per issuance window would suppress a legitimate
         * resend, so delivery is keyed by the code's own hash instead. */
        { jobId: jobKey(`otp:${this.crypto.sha256(`${params.target}:${code}`)}`) },
      );
    } catch (e) {
      /* The code is already stored; a queue outage must surface as a failure the
       * user can retry, not as a silently undelivered code. */
      this.log.error(
        `failed to enqueue OTP delivery for ${params.channel}`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: "Could not send the verification code. Please try again shortly.",
          code: "OTP_DELIVERY_UNAVAILABLE",
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
