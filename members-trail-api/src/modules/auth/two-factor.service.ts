import {
  BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { authenticator } from "otplib";
import * as QRCode from "qrcode";
import { randomUUID } from "node:crypto";
import { User } from "@/database/entities";
import { CryptoService } from "@/common/crypto/crypto.service";
import { RedisService } from "@/common/redis/redis.service";
import { CacheKeys } from "@/common/redis/cache.keys";
import { appConfig, type AppConfig } from "@/config/configuration";
import { maskPhone } from "@/common/utils";
import { AuditService } from "@/modules/audit/audit.service";
import { OtpService } from "./otp.service";
import type {
  TwoFaDisableDto, TwoFaEnableResponse, TwoFaSetupResponse,
} from "./dto/auth.dto";

/* ============================================================================
 * Two-factor authentication (FRD A-03, D-03).
 *
 * TOTP secrets are stored AES-256-GCM encrypted, never hashed: verification
 * needs the secret back. They are on a `select: false` column and are never
 * returned by any endpoint — the enrolment response hands out an otpauth URI and
 * a QR image and nothing else.
 *
 * Recovery codes are the opposite: single-use, so they are stored HMAC'd and the
 * plaintext is shown exactly once at enrolment.
 * ========================================================================== */

/** Number of single-use recovery codes minted at enrolment. */
export const RECOVERY_CODE_COUNT = 10;

/** Seconds a login 2FA challenge stays open. */
export const TWO_FA_CHALLENGE_TTL = 300;

/** Seconds an enrolment (pre-confirmation) secret stays pending. */
export const TWO_FA_SETUP_TTL = 900;

export interface TwoFaChallenge {
  userId: string;
  method: "sms" | "totp";
  ip: string | null;
  createdAt: string;
}

interface PendingSetup {
  userId: string;
  method: "sms" | "totp";
  /** Encrypted secret; the plaintext never touches Redis. */
  secretEnc?: string;
}

@Injectable()
export class TwoFactorService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  /* ------------------------------------------------------------------ *
   * Enrolment
   * ------------------------------------------------------------------ */

  async setup(
    userId: string,
    method: "totp" | "sms",
    ip: string | null,
  ): Promise<TwoFaSetupResponse> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: ["id", "email", "phone", "phoneVerifiedAt", "twoFaMethod"],
    });
    if (!user) throw new NotFoundException("Account not found");

    if (user.twoFaMethod !== "none") {
      throw new BadRequestException({
        message: "Two-factor authentication is already enabled. Disable it first to change method.",
        code: "TWO_FA_ALREADY_ENABLED",
      });
    }

    if (method === "sms") {
      if (!user.phone || !user.phoneVerifiedAt) {
        throw new BadRequestException({
          message: "Verify your phone number before using SMS two-factor authentication",
          code: "PHONE_NOT_VERIFIED",
        });
      }
      await this.redis.set(
        this.setupKey(userId),
        { userId, method } satisfies PendingSetup,
        TWO_FA_SETUP_TTL,
      );
      const sent = await this.otp.issue({
        userId,
        channel: "phone",
        target: user.phone,
        /* Its own purpose: see the note on VerificationPurpose. A 2FA code and a
         * phone-verification code must never satisfy each other. */
        purpose: "two_fa",
        ip,
        template: "two_fa.enrol",
      });
      return {
        method: "sms",
        sentTo: sent.sentTo,
        expiresIn: this.otp.ttlSeconds,
      };
    }

    const secret = authenticator.generateSecret();
    const otpauthUri = authenticator.keyuri(user.email, this.app.name, secret);

    /* The secret is held encrypted, pending confirmation. Writing it to the user
     * row before the first correct code is verified would leave an account whose
     * stored method says "none" but whose secret is live. */
    await this.redis.set(
      this.setupKey(userId),
      { userId, method: "totp", secretEnc: this.crypto.encrypt(secret) } satisfies PendingSetup,
      TWO_FA_SETUP_TTL,
    );

    return {
      method: "totp",
      otpauthUri,
      qrDataUrl: await QRCode.toDataURL(otpauthUri, { margin: 1, width: 240 }),
      expiresIn: TWO_FA_SETUP_TTL,
    };
  }

  async enable(
    userId: string,
    code: string,
    ctx: { ip: string | null; userAgent: string | null },
  ): Promise<TwoFaEnableResponse> {
    const pending = await this.redis.get<PendingSetup>(this.setupKey(userId));
    if (!pending) {
      throw new BadRequestException({
        message: "Start two-factor setup again — the enrolment window has expired",
        code: "TWO_FA_SETUP_EXPIRED",
      });
    }

    const user = await this.users.findOne({
      where: { id: userId },
      select: ["id", "email", "phone", "twoFaMethod"],
    });
    if (!user) throw new NotFoundException("Account not found");

    if (pending.method === "totp") {
      if (!pending.secretEnc) {
        throw new BadRequestException({ message: "Enrolment is incomplete", code: "TWO_FA_SETUP_INVALID" });
      }
      const ok = this.verifyTotpCode(pending.secretEnc, code);
      if (!ok) throw this.badCode();
      user.twoFaSecretEnc = pending.secretEnc;
      user.twoFaMethod = "totp";
    } else {
      if (!user.phone) throw new BadRequestException("No phone number on file");
      await this.otp.verify({ channel: "phone", target: user.phone, code, purpose: "two_fa" });
      user.twoFaSecretEnc = null;
      user.twoFaMethod = "sms";
    }

    const { plain, hashed } = this.mintRecoveryCodes();
    user.twoFaRecoveryCodes = hashed;
    user.twoFaEnabledAt = new Date();
    await this.users.save(user);
    await this.redis.del(this.setupKey(userId));

    await this.audit.record({
      actorId: userId,
      action: "auth.two_fa.enabled",
      targetType: "user",
      targetId: userId,
      after: { method: user.twoFaMethod, recoveryCodes: RECOVERY_CODE_COUNT },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { method: user.twoFaMethod === "sms" ? "sms" : "totp", recoveryCodes: plain };
  }

  /**
   * Disabling 2FA requires password AND a current second factor (FRD D-03).
   *
   * This is the check that matters most in the whole module: an attacker who has
   * only the password must not be able to strip the control that is stopping
   * them, and an attacker who has only the device must not either. A recovery
   * code is accepted in place of the live code because a lost authenticator is
   * the legitimate reason to be here — it is still a second factor.
   */
  async disable(
    userId: string,
    dto: TwoFaDisableDto,
    ctx: { ip: string | null; userAgent: string | null },
  ): Promise<void> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: [
        "id", "email", "phone", "passwordHash", "twoFaMethod",
        "twoFaSecretEnc", "twoFaRecoveryCodes",
      ],
    });
    if (!user) throw new NotFoundException("Account not found");

    if (user.twoFaMethod === "none") {
      throw new BadRequestException({
        message: "Two-factor authentication is not enabled",
        code: "TWO_FA_NOT_ENABLED",
      });
    }

    const passwordOk = await this.crypto.verifyPassword(user.passwordHash, dto.password);
    if (!passwordOk) {
      await this.audit.record({
        actorId: userId,
        action: "auth.two_fa.disable_denied",
        targetType: "user",
        targetId: userId,
        reason: "password_incorrect",
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw new UnauthorizedException({
        message: "Password is incorrect",
        code: "PASSWORD_INVALID",
      });
    }

    if (!dto.code && !dto.recoveryCode) {
      throw new ForbiddenException({
        message: "A current two-factor code (or a recovery code) is required to disable 2FA",
        code: "TWO_FA_CODE_REQUIRED",
      });
    }

    const secondFactorOk = dto.recoveryCode
      ? await this.consumeRecoveryCode(user, dto.recoveryCode)
      : await this.verifySecondFactor(user, dto.code ?? "");

    if (!secondFactorOk) {
      await this.audit.record({
        actorId: userId,
        action: "auth.two_fa.disable_denied",
        targetType: "user",
        targetId: userId,
        reason: "second_factor_invalid",
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw this.badCode();
    }

    const before = { method: user.twoFaMethod };
    user.twoFaMethod = "none";
    user.twoFaSecretEnc = null;
    user.twoFaRecoveryCodes = null;
    user.twoFaEnabledAt = null;
    await this.users.save(user);

    await this.audit.recordOrThrow({
      actorId: userId,
      action: "auth.two_fa.disabled",
      targetType: "user",
      targetId: userId,
      before,
      after: { method: "none" },
      reason: dto.recoveryCode ? "confirmed_with_recovery_code" : "confirmed_with_current_code",
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  /* ------------------------------------------------------------------ *
   * Login challenge
   * ------------------------------------------------------------------ */

  async openChallenge(
    user: User,
    ip: string | null,
  ): Promise<{ challengeId: string; expiresIn: number; sentTo?: string }> {
    const challengeId = randomUUID();
    const method: "sms" | "totp" = user.twoFaMethod === "sms" ? "sms" : "totp";

    await this.redis.set(
      CacheKeys.twoFaChallenge(challengeId),
      { userId: user.id, method, ip, createdAt: new Date().toISOString() } satisfies TwoFaChallenge,
      TWO_FA_CHALLENGE_TTL,
    );

    if (method === "sms" && user.phone) {
      await this.otp.issue({
        userId: user.id,
        channel: "phone",
        target: user.phone,
        purpose: "two_fa",
        ip,
        template: "two_fa.login",
      });
      return { challengeId, expiresIn: TWO_FA_CHALLENGE_TTL, sentTo: maskPhone(user.phone) };
    }

    return { challengeId, expiresIn: TWO_FA_CHALLENGE_TTL };
  }

  async readChallenge(challengeId: string): Promise<TwoFaChallenge> {
    const challenge = await this.redis.get<TwoFaChallenge>(CacheKeys.twoFaChallenge(challengeId));
    if (!challenge) {
      throw new UnauthorizedException({
        message: "That sign-in attempt has expired. Start again.",
        code: "TWO_FA_CHALLENGE_EXPIRED",
      });
    }
    return challenge;
  }

  async closeChallenge(challengeId: string): Promise<void> {
    await this.redis.del(CacheKeys.twoFaChallenge(challengeId));
  }

  /**
   * Verifies the second factor presented against a login challenge. Returns
   * false rather than throwing so the caller can count the failure against the
   * login lockout budget.
   */
  async verifyChallengeCode(
    challenge: TwoFaChallenge,
    user: User,
    input: { code?: string; recoveryCode?: string },
  ): Promise<boolean> {
    if (input.recoveryCode) return this.consumeRecoveryCode(user, input.recoveryCode);
    if (!input.code) return false;
    if (challenge.method === "sms") {
      if (!user.phone) return false;
      try {
        await this.otp.verify({ channel: "phone", target: user.phone, code: input.code, purpose: "two_fa" });
        return true;
      } catch {
        return false;
      }
    }
    return this.verifyTotpCode(user.twoFaSecretEnc, input.code);
  }

  /* ------------------------------------------------------------------ *
   * Internals
   * ------------------------------------------------------------------ */

  /**
   * Verifies a second factor for a sensitive action outside the login flow.
   *
   * Exists because changing the email or phone is as consequential as
   * disabling 2FA — both channels feed account recovery — and the guard only
   * proves a token was presented, not that the holder is the account owner.
   */
  async verifyForSensitiveAction(userId: string, code: string): Promise<boolean> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: {
        id: true, twoFaMethod: true, twoFaEnabledAt: true,
        twoFaSecretEnc: true, phone: true, email: true,
      },
    });
    if (!user) return false;
    if (!user.twoFaEnabledAt) return true;
    return this.verifySecondFactor(user, code);
  }

  private async verifySecondFactor(user: User, code: string): Promise<boolean> {
    if (user.twoFaMethod === "sms") {
      if (!user.phone) return false;
      try {
        await this.otp.verify({ channel: "phone", target: user.phone, code, purpose: "two_fa" });
        return true;
      } catch {
        return false;
      }
    }
    return this.verifyTotpCode(user.twoFaSecretEnc, code);
  }

  private verifyTotpCode(secretEnc: string | null | undefined, code: string): boolean {
    if (!secretEnc) return false;
    try {
      return authenticator.check(code, this.crypto.decrypt(secretEnc));
    } catch {
      /* Malformed ciphertext or a non-numeric code reads as "wrong code". */
      return false;
    }
  }

  /**
   * Consumes a recovery code. Stored hashed, so the comparison is over HMACs;
   * the matching entry is removed on use so the same slip of paper cannot be
   * replayed.
   */
  private async consumeRecoveryCode(user: User, presented: string): Promise<boolean> {
    const stored = user.twoFaRecoveryCodes ?? [];
    if (!stored.length) return false;

    const hash = this.crypto.hmac(this.normaliseRecoveryCode(presented));
    const match = stored.find((s) => this.crypto.safeEqual(s, hash));
    if (!match) return false;

    await this.users.update(
      { id: user.id },
      { twoFaRecoveryCodes: stored.filter((s) => s !== match) },
    );
    user.twoFaRecoveryCodes = stored.filter((s) => s !== match);
    return true;
  }

  private mintRecoveryCodes(): { plain: string[]; hashed: string[] } {
    const plain: string[] = [];
    const hashed: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      /* Grouped for legibility when copied off a screen by hand. */
      const raw = this.crypto.randomToken(24).replace(/[^a-zA-Z0-9]/g, "").slice(0, 10).toUpperCase();
      const formatted = `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
      plain.push(formatted);
      hashed.push(this.crypto.hmac(this.normaliseRecoveryCode(formatted)));
    }
    return { plain, hashed };
  }

  private normaliseRecoveryCode(code: string): string {
    return `recovery:${code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
  }

  private setupKey(userId: string): string {
    /* Derived from an existing key family rather than inventing one in
     * CacheKeys, which this module does not own. */
    return CacheKeys.twoFaChallenge(`setup:${userId}`);
  }

  private badCode(): BadRequestException {
    return new BadRequestException({
      message: "That two-factor code is not valid",
      code: "TWO_FA_CODE_INVALID",
    });
  }
}
