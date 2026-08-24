import { Test } from "@nestjs/testing";
import { getRepositoryToken, getDataSourceToken } from "@nestjs/typeorm";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import {
  FraudAlert, LoginHistory, NotificationPreference, ReferralEdge, User,
  UserBalance, VerificationToken,
} from "@/database/entities";
import { CryptoService } from "@/common/crypto/crypto.service";
import { RedisService } from "@/common/redis/redis.service";
import { EventBusService, Events } from "@/events";
import { authConfig } from "@/config/configuration";
import { AuditService } from "@/modules/audit/audit.service";
import { AuthService, MAX_LOCKOUT_SECONDS } from "./auth.service";
import { OtpService } from "./otp.service";
import { SessionService } from "./session.service";
import { TwoFactorService } from "./two-factor.service";
import type { RegisterDto } from "./dto/auth.dto";

/* ============================================================================
 * Login lockout and self-referral detection.
 * ========================================================================== */

const MAX_ATTEMPTS = 5;
const LOCKOUT = 900;

function repoMock<T extends object>(rows: T[] = []) {
  return {
    rows,
    create: jest.fn((x: Partial<T>) => ({ ...x })),
    save: jest.fn(async (x: unknown) => {
      const list = Array.isArray(x) ? x : [x];
      for (const item of list as Record<string, unknown>[]) {
        if (!item.id) item.id = `id-${rows.length + 1}`;
        if (!item.createdAt) item.createdAt = new Date();
        const i = rows.findIndex((r) => (r as Record<string, unknown>).id === item.id);
        if (i >= 0) rows[i] = item as T;
        else rows.push(item as T);
      }
      return Array.isArray(x) ? list : list[0];
    }),
    insert: jest.fn(async (x: unknown) => {
      const list = Array.isArray(x) ? x : [x];
      for (const item of list as T[]) rows.push(item);
      return { identifiers: [] };
    }),
    findOne: jest.fn(async (): Promise<T | null> => null),
    findAndCount: jest.fn(async (): Promise<[T[], number]> => [[], 0]),
    exists: jest.fn(async () => false),
    update: jest.fn(async () => ({ affected: 1 })),
    delete: jest.fn(async () => ({ affected: 1 })),
  };
}

const REGISTER: RegisterDto = {
  fullName: "Ada Lovelace",
  email: "Ada@Example.com",
  phone: "+441632960961",
  password: "Str0ng!Passphrase#7",
  dateOfBirth: "1990-04-01",
  country: "GB",
  termsAccepted: true,
};

describe("AuthService", () => {
  let service: AuthService;
  let users: ReturnType<typeof repoMock<User>>;
  let logins: ReturnType<typeof repoMock<LoginHistory>>;
  let balances: ReturnType<typeof repoMock<UserBalance>>;
  let prefs: ReturnType<typeof repoMock<NotificationPreference>>;
  let edges: ReturnType<typeof repoMock<ReferralEdge>>;
  let alerts: ReturnType<typeof repoMock<FraudAlert>>;
  let redis: {
    client: { get: jest.Mock; expire: jest.Mock; set: jest.Mock };
    ttl: jest.Mock;
    del: jest.Mock;
    incrWithTtl: jest.Mock;
  };
  let bus: { publish: jest.Mock };
  let sessionSvc: { issue: jest.Mock; rotate: jest.Mock; revokeAll: jest.Mock; listActive: jest.Mock };
  let otp: { issue: jest.Mock; verify: jest.Mock; enqueuePasswordReset: jest.Mock };
  let twoFa: { openChallenge: jest.Mock; readChallenge: jest.Mock; verifyChallengeCode: jest.Mock; closeChallenge: jest.Mock };
  let verifyPassword: jest.Mock;

  beforeEach(async () => {
    users = repoMock<User>([]);
    logins = repoMock<LoginHistory>([]);
    balances = repoMock<UserBalance>([]);
    prefs = repoMock<NotificationPreference>([]);
    edges = repoMock<ReferralEdge>([]);
    alerts = repoMock<FraudAlert>([]);
    const tokens = repoMock<VerificationToken>([]);

    redis = {
      client: {
        get: jest.fn(async () => null),
        expire: jest.fn(async () => 1),
        set: jest.fn(async () => "OK"),
      },
      ttl: jest.fn(async () => LOCKOUT),
      del: jest.fn(async () => 1),
      incrWithTtl: jest.fn(async () => 1),
    };
    bus = { publish: jest.fn(async () => undefined) };
    verifyPassword = jest.fn(async () => true);

    sessionSvc = {
      issue: jest.fn(async () => ({
        session: { id: "sess-1", jti: "jti-1" },
        tokens: {
          accessToken: "access", refreshToken: "refresh", expiresIn: 900,
          refreshExpiresIn: 2_592_000, tokenType: "Bearer", sessionId: "jti-1",
        },
      })),
      rotate: jest.fn(),
      revokeAll: jest.fn(async () => 0),
      listActive: jest.fn(async () => []),
    };
    otp = {
      issue: jest.fn(async () => ({ resendAfter: 60, sentTo: "a•••@example.com" })),
      verify: jest.fn(async () => ({ id: "vt-1" })),
      enqueuePasswordReset: jest.fn(async () => undefined),
    };
    twoFa = {
      openChallenge: jest.fn(async () => ({ challengeId: "chal-1", expiresIn: 300 })),
      readChallenge: jest.fn(),
      verifyChallengeCode: jest.fn(async () => true),
      closeChallenge: jest.fn(async () => undefined),
    };

    /* The transaction callback runs against these in-memory repositories, so
     * register() can be exercised without a database. */
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === User) return users;
        if (entity === UserBalance) return balances;
        if (entity === NotificationPreference) return prefs;
        if (entity === ReferralEdge) return edges;
        if (entity === FraudAlert) return alerts;
        throw new Error("unexpected repository requested in transaction");
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(LoginHistory), useValue: logins },
        { provide: getRepositoryToken(VerificationToken), useValue: tokens },
        {
          provide: getDataSourceToken(),
          useValue: {
            transaction: jest.fn(
              async (cb: (m: typeof manager) => Promise<unknown>) => cb(manager),
            ),
          },
        },
        {
          provide: CryptoService,
          useValue: {
            hmac: jest.fn((v: string) => `hmac(${v})`),
            hashPassword: jest.fn(async () => "argon2$hash"),
            verifyPassword,
            needsRehash: jest.fn(() => false),
            referralCode: jest.fn(() => "MTT-ABC234"),
            randomToken: jest.fn(() => "reset-token"),
            numericOtp: jest.fn(() => "123456"),
          },
        },
        { provide: RedisService, useValue: redis },
        { provide: EventBusService, useValue: bus },
        {
          provide: AuditService,
          useValue: { record: jest.fn(async () => undefined), recordOrThrow: jest.fn(async () => undefined) },
        },
        { provide: OtpService, useValue: otp },
        { provide: SessionService, useValue: sessionSvc },
        { provide: TwoFactorService, useValue: twoFa },
        {
          provide: authConfig.KEY,
          useValue: {
            loginMaxAttempts: MAX_ATTEMPTS,
            loginLockoutSeconds: LOCKOUT,
            otpResendCooldown: 60,
            otpTtl: 600,
            otpMaxAttempts: 5,
            passwordResetTtl: 1800,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  /* ==================================================================== *
   * Login lockout (A-03)
   * ==================================================================== */

  describe("login lockout", () => {
    const creds = { identifier: "ada@example.com", password: "whatever" };

    it("refuses to even check the password once the budget is spent", async () => {
      redis.client.get.mockResolvedValueOnce(String(MAX_ATTEMPTS));
      redis.ttl.mockResolvedValueOnce(420);

      await expect(service.login(creds, {})).rejects.toMatchObject({
        response: expect.objectContaining({
          code: "LOGIN_LOCKED_OUT",
          retryAfter: 420,
          captchaRequired: true,
        }),
      });

      /* Short-circuited before the expensive Argon2 verify and before any
       * account lookup — otherwise the lockout is also a CPU amplifier. */
      expect(users.findOne).not.toHaveBeenCalled();
      expect(verifyPassword).not.toHaveBeenCalled();
    });

    it("records a failure for an account that does not exist", async () => {
      users.findOne.mockResolvedValueOnce(null);
      redis.incrWithTtl.mockResolvedValueOnce(1);

      await expect(service.login(creds, { ip: "1.2.3.4" })).rejects.toThrow(UnauthorizedException);

      expect(logins.rows).toHaveLength(1);
      expect(logins.rows[0]).toMatchObject({
        userId: null,
        identifier: "ada@example.com",
        success: false,
        failureReason: "unknown_account",
        ip: "1.2.3.4",
      });
      expect(bus.publish).toHaveBeenCalledWith(
        Events.UserLoginFailed,
        expect.objectContaining({ reason: "unknown_account" }),
      );
    });

    it("gives the same message for a wrong password as for an unknown account", async () => {
      const capture = async (): Promise<string> => {
        try {
          await service.login(creds, {});
          throw new Error("expected login to fail");
        } catch (e) {
          const body = (e as UnauthorizedException).getResponse() as { message: string };
          return body.message;
        }
      };

      /* Wrong password against a real account. */
      users.findOne.mockResolvedValueOnce({
        id: "u1", email: "ada@example.com", passwordHash: "argon2$hash",
        status: "active", twoFaMethod: "none", role: "player", kycTier: 0,
      } as User);
      verifyPassword.mockResolvedValueOnce(false);
      const wrongPassword = await capture();

      /* No such account. */
      users.findOne.mockResolvedValueOnce(null);
      const unknownAccount = await capture();

      /* Identical, or the login form becomes an account-enumeration oracle. */
      expect(wrongPassword).toBe(unknownAccount);
      expect(wrongPassword).toBe("Those sign-in details are not correct");
    });

    it("flags CAPTCHA from the third failure", async () => {
      users.findOne.mockResolvedValue(null);
      redis.incrWithTtl.mockResolvedValueOnce(3);

      await service.login(creds, {}).catch((e: UnauthorizedException) => {
        expect(e.getResponse()).toMatchObject({ captchaRequired: true, attemptsRemaining: 2 });
      });
    });

    it("escalates the lockout window as failures accumulate", async () => {
      users.findOne.mockResolvedValue(null);

      /* Attempt 5 = first lockout tier: the base window. */
      redis.incrWithTtl.mockResolvedValueOnce(MAX_ATTEMPTS);
      await service.login(creds, {}).catch(() => undefined);
      expect(redis.client.expire).toHaveBeenLastCalledWith(expect.any(String), LOCKOUT);

      /* Attempt 10 = second tier: double. */
      redis.incrWithTtl.mockResolvedValueOnce(MAX_ATTEMPTS * 2);
      await service.login(creds, {}).catch(() => undefined);
      expect(redis.client.expire).toHaveBeenLastCalledWith(expect.any(String), LOCKOUT * 2);

      /* Attempt 20 = fourth tier: eight times the base. */
      redis.incrWithTtl.mockResolvedValueOnce(MAX_ATTEMPTS * 4);
      await service.login(creds, {}).catch(() => undefined);
      expect(redis.client.expire).toHaveBeenLastCalledWith(expect.any(String), LOCKOUT * 8);
    });

    it("caps the escalation so a targeted lockout cannot be permanent", async () => {
      users.findOne.mockResolvedValue(null);
      redis.incrWithTtl.mockResolvedValueOnce(MAX_ATTEMPTS * 1_000);

      await service.login(creds, {}).catch(() => undefined);

      expect(redis.client.expire).toHaveBeenLastCalledWith(
        expect.any(String),
        MAX_LOCKOUT_SECONDS,
      );
    });

    it("clears the budget on a successful sign-in and issues tokens", async () => {
      users.findOne.mockResolvedValueOnce({
        id: "u1", email: "ada@example.com", passwordHash: "argon2$hash",
        status: "active", twoFaMethod: "none", role: "player", kycTier: 0,
      } as User);

      const res = await service.login(creds, { ip: "1.2.3.4" });

      expect(res.authenticated).toBe(true);
      expect(res.tokens?.accessToken).toBe("access");
      expect(redis.del).toHaveBeenCalled();
      expect(logins.rows.at(-1)).toMatchObject({ success: true, userId: "u1" });
    });

    it("returns a 2FA challenge instead of tokens when a second factor is enrolled", async () => {
      users.findOne.mockResolvedValueOnce({
        id: "u1", email: "ada@example.com", passwordHash: "argon2$hash",
        status: "active", twoFaMethod: "totp", role: "player", kycTier: 0,
      } as User);

      const res = await service.login(creds, {});

      expect(res.authenticated).toBe(false);
      expect(res.tokens).toBeUndefined();
      expect(res.challengeId).toBe("chal-1");
      expect(sessionSvc.issue).not.toHaveBeenCalled();
    });

    it("refuses a frozen account without issuing tokens", async () => {
      users.findOne.mockResolvedValueOnce({
        id: "u1", email: "ada@example.com", passwordHash: "argon2$hash",
        status: "frozen", statusReason: "Compliance review in progress",
        twoFaMethod: "none", role: "player", kycTier: 0,
      } as User);

      await expect(service.login(creds, {})).rejects.toThrow(ForbiddenException);
      expect(sessionSvc.issue).not.toHaveBeenCalled();
      expect(logins.rows.at(-1)).toMatchObject({ failureReason: "account_frozen" });
    });
  });

  /* ==================================================================== *
   * Self-referral detection (A-01)
   * ==================================================================== */

  describe("self-referral detection", () => {
    const sponsor = {
      id: "sponsor-1",
      ref: "USR-SPONSOR",
      status: "active",
      referralCode: "MTT-SPONSOR",
      referralDepth: 0,
      sponsorPath: null,
      signupFingerprint: "fp-abc",
      signupIp: "203.0.113.7",
    } as User;

    it("flags a matching device fingerprint", () => {
      const result = service.assessSelfReferral(sponsor, { fingerprint: "fp-abc", ip: "9.9.9.9" });
      expect(result).toEqual({ suspected: true, signals: ["same_signup_fingerprint"] });
    });

    it("flags a matching signup IP", () => {
      const result = service.assessSelfReferral(sponsor, { fingerprint: "fp-other", ip: "203.0.113.7" });
      expect(result).toEqual({ suspected: true, signals: ["same_signup_ip"] });
    });

    it("reports both signals when device and network both match", () => {
      const result = service.assessSelfReferral(sponsor, { fingerprint: "fp-abc", ip: "203.0.113.7" });
      expect(result.suspected).toBe(true);
      expect(result.signals).toEqual(["same_signup_fingerprint", "same_signup_ip"]);
    });

    it("does not flag an unrelated device and network", () => {
      const result = service.assessSelfReferral(sponsor, { fingerprint: "fp-x", ip: "198.51.100.4" });
      expect(result).toEqual({ suspected: false, signals: [] });
    });

    it("does not flag on absent context — a missing fingerprint is not evidence", () => {
      expect(service.assessSelfReferral(sponsor, {})).toEqual({ suspected: false, signals: [] });
      expect(
        service.assessSelfReferral(
          { ...sponsor, signupFingerprint: null, signupIp: null },
          { fingerprint: "fp-abc", ip: "203.0.113.7" },
        ),
      ).toEqual({ suspected: false, signals: [] });
    });

    it("withholds the referral edges and raises a fraud alert on a flagged signup", async () => {
      users.findOne.mockResolvedValue(sponsor);

      const res = await service.register(
        { ...REGISTER, referralCode: "MTT-SPONSOR" },
        { ip: "203.0.113.7", fingerprint: "fp-abc" },
      );

      expect(res.underReview).toBe(true);
      expect(res.referralAttached).toBe(false);

      /* The relationship is recorded for the investigation, but no commission
       * edge exists — so nothing can be earned off it while it is reviewed. */
      const created = users.rows.find((u) => u.ref !== "USR-SPONSOR");
      expect(created?.referredById).toBe("sponsor-1");
      expect(created?.riskFlags).toContain("self_referral_suspected");
      expect(created?.riskScore).toBeGreaterThanOrEqual(60);
      expect(edges.rows).toHaveLength(0);

      expect(alerts.rows).toHaveLength(1);
      expect(alerts.rows[0]).toMatchObject({
        kind: "self_referral_ring",
        severity: "high",
        affectedUserIds: expect.arrayContaining(["sponsor-1"]),
      });

      expect(bus.publish).toHaveBeenCalledWith(
        Events.UserRegistered,
        expect.objectContaining({ underReview: true, referralAttached: false }),
        expect.anything(),
      );
    });

    it("builds levels 1-3 for a clean referral", async () => {
      users.findOne.mockResolvedValue({
        ...sponsor,
        sponsorPath: "grandparent-id/parent-id",
        referralDepth: 2,
      });

      const res = await service.register(
        { ...REGISTER, referralCode: "MTT-SPONSOR" },
        { ip: "198.51.100.4", fingerprint: "fp-clean" },
      );

      expect(res.referralAttached).toBe(true);
      expect(res.underReview).toBe(false);
      expect(alerts.rows).toHaveLength(0);

      /* Root-first path, capped at the three levels the plan pays. */
      const created = users.rows.find((u) => u.ref !== "USR-SPONSOR");
      expect(created?.sponsorPath).toBe("grandparent-id/parent-id/sponsor-1");
      expect(created?.referralDepth).toBe(3);

      expect(edges.rows).toEqual([
        expect.objectContaining({ ancestorId: "sponsor-1", level: 1 }),
        expect.objectContaining({ ancestorId: "parent-id", level: 2 }),
        expect.objectContaining({ ancestorId: "grandparent-id", level: 3 }),
      ]);
    });

    it("never materialises a level 4", async () => {
      users.findOne.mockResolvedValue({
        ...sponsor,
        sponsorPath: "l4-id/l3-id/l2-id",
        referralDepth: 3,
      });

      await service.register(
        { ...REGISTER, referralCode: "MTT-SPONSOR" },
        { ip: "198.51.100.4" },
      );

      expect(edges.rows).toHaveLength(3);
      expect(edges.rows.map((e) => e.level)).toEqual([1, 2, 3]);
      expect(edges.rows.map((e) => e.ancestorId)).not.toContain("l4-id");
    });
  });

  /* ==================================================================== *
   * Registration guards (A-01)
   * ==================================================================== */

  describe("registration guards", () => {
    it("refuses a restricted jurisdiction", async () => {
      await expect(service.register({ ...REGISTER, country: "IR" }, {})).rejects.toMatchObject({
        response: expect.objectContaining({ code: "JURISDICTION_RESTRICTED" }),
      });
    });

    it("refuses when the request IP resolves to a restricted country", async () => {
      await expect(
        service.register(REGISTER, { ipCountry: "KP" }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "JURISDICTION_RESTRICTED_IP" }),
      });
    });

    it("flags — but allows — a declared country that differs from the IP country", async () => {
      const res = await service.register(REGISTER, { ipCountry: "FR" });
      expect(res.userRef).toBeDefined();
      const created = users.rows[0];
      expect(created.riskFlags).toContain("country_mismatch");
    });

    it("refuses an applicant under the jurisdiction minimum age", async () => {
      const sixteen = new Date();
      sixteen.setUTCFullYear(sixteen.getUTCFullYear() - 16);

      await expect(
        service.register(
          { ...REGISTER, dateOfBirth: sixteen.toISOString().slice(0, 10) },
          {},
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "UNDERAGE", minimumAge: 18 }),
      });
    });

    it("applies a higher jurisdiction minimum age", async () => {
      const nineteen = new Date();
      nineteen.setUTCFullYear(nineteen.getUTCFullYear() - 19);

      await expect(
        service.register(
          { ...REGISTER, country: "JP", dateOfBirth: nineteen.toISOString().slice(0, 10) },
          {},
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "UNDERAGE", minimumAge: 20 }),
      });
    });

    it("rejects a breached password", async () => {
      await expect(
        service.register({ ...REGISTER, password: "Password1234" }, {}),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "PASSWORD_REJECTED" }),
      });
    });

    it("rejects an invalid referral code rather than silently dropping it", async () => {
      users.findOne.mockResolvedValueOnce(null);

      await expect(
        service.register({ ...REGISTER, referralCode: "MTT-NOPE99" }, {}),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "REFERRAL_CODE_INVALID" }),
      });
    });

    it("creates the balance and notification preference rows alongside the account", async () => {
      await service.register(REGISTER, {});

      expect(balances.rows).toHaveLength(1);
      expect(prefs.rows).toHaveLength(1);
      /* Security notifications are not representable as a preference. */
      expect(Object.keys(prefs.rows[0].channels)).not.toContain("security");
    });

    it("issues both verification codes", async () => {
      await service.register(REGISTER, {});

      expect(otp.issue).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "email", target: "ada@example.com" }),
      );
      expect(otp.issue).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "phone", target: "+441632960961" }),
      );
    });
  });
});
