import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { authenticator } from "otplib";
import { User } from "@/database/entities";
import { CryptoService } from "@/common/crypto/crypto.service";
import { RedisService } from "@/common/redis/redis.service";
import { appConfig } from "@/config/configuration";
import { AuditService } from "@/modules/audit/audit.service";
import { OtpService } from "./otp.service";
import { RECOVERY_CODE_COUNT, TwoFactorService } from "./two-factor.service";

/* ============================================================================
 * The 2FA disable guard (FRD D-03).
 *
 * Disabling the second factor is the single most valuable action an account
 * takeover can perform, because it removes the control that would stop
 * everything that follows. It therefore requires BOTH factors: knowing the
 * password is not enough, and holding the device is not enough.
 * ========================================================================== */

const SECRET = authenticator.generateSecret();
const ENC = `enc(${SECRET})`;

describe("TwoFactorService — disable guard", () => {
  let service: TwoFactorService;
  let users: {
    row: Partial<User>;
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let audit: { record: jest.Mock; recordOrThrow: jest.Mock };
  let verifyPassword: jest.Mock;
  let otp: { issue: jest.Mock; verify: jest.Mock; ttlSeconds: number };

  const validCode = (): string => authenticator.generate(SECRET);

  beforeEach(async () => {
    const row: Partial<User> = {
      id: "u1",
      email: "ada@example.com",
      phone: "+441632960961",
      passwordHash: "argon2$hash",
      twoFaMethod: "totp",
      twoFaSecretEnc: ENC,
      twoFaRecoveryCodes: ["hmac(recovery:AAAAABBBBB)"],
      twoFaEnabledAt: new Date(),
    };

    users = {
      row,
      findOne: jest.fn(async (): Promise<Partial<User> | null> => row),
      save: jest.fn(async (x: Partial<User>) => x),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    audit = {
      record: jest.fn(async () => undefined),
      recordOrThrow: jest.fn(async () => undefined),
    };
    verifyPassword = jest.fn(async () => true);
    otp = {
      issue: jest.fn(async () => ({ resendAfter: 60, sentTo: "•••61" })),
      verify: jest.fn(async () => ({ id: "vt-1" })),
      ttlSeconds: 600,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TwoFactorService,
        { provide: getRepositoryToken(User), useValue: users },
        {
          provide: CryptoService,
          useValue: {
            verifyPassword,
            /* Mirrors the real encrypt/decrypt round trip without a key. */
            encrypt: jest.fn((v: string) => `enc(${v})`),
            decrypt: jest.fn((v: string) => v.replace(/^enc\(/, "").replace(/\)$/, "")),
            hmac: jest.fn((v: string) => `hmac(${v})`),
            safeEqual: jest.fn((a: string, b: string) => a === b),
            randomToken: jest.fn(() => "AAAAABBBBBCCCCC"),
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(async () => null),
            set: jest.fn(async () => undefined),
            del: jest.fn(async () => 1),
          },
        },
        { provide: OtpService, useValue: otp },
        { provide: AuditService, useValue: audit },
        { provide: appConfig.KEY, useValue: { name: "Members Trail" } },
      ],
    }).compile();

    service = moduleRef.get(TwoFactorService);
  });

  const ctx = { ip: "1.2.3.4", userAgent: "jest" };

  it("refuses without the password, even with a valid code", async () => {
    verifyPassword.mockResolvedValueOnce(false);

    await expect(
      service.disable("u1", { password: "wrong", code: validCode() }, ctx),
    ).rejects.toThrow(UnauthorizedException);

    /* Still enabled. */
    expect(users.save).not.toHaveBeenCalled();
    expect(users.row.twoFaMethod).toBe("totp");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.two_fa.disable_denied",
        reason: "password_incorrect",
      }),
    );
  });

  it("refuses with the password alone — no second factor supplied", async () => {
    await expect(
      service.disable("u1", { password: "correct" }, ctx),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "TWO_FA_CODE_REQUIRED" }),
    });

    expect(users.save).not.toHaveBeenCalled();
    expect(users.row.twoFaMethod).toBe("totp");
  });

  it("refuses with the password and a wrong code", async () => {
    await expect(
      service.disable("u1", { password: "correct", code: "000000" }, ctx),
    ).rejects.toThrow(BadRequestException);

    expect(users.save).not.toHaveBeenCalled();
    expect(users.row.twoFaMethod).toBe("totp");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "second_factor_invalid" }),
    );
  });

  it("refuses with an unrecognised recovery code", async () => {
    await expect(
      service.disable("u1", { password: "correct", recoveryCode: "ZZZZZ-ZZZZZ" }, ctx),
    ).rejects.toThrow(BadRequestException);

    expect(users.row.twoFaMethod).toBe("totp");
  });

  it("disables only when the password AND a current code are both correct", async () => {
    await service.disable("u1", { password: "correct", code: validCode() }, ctx);

    expect(users.save).toHaveBeenCalled();
    expect(users.row.twoFaMethod).toBe("none");
    /* The secret and the recovery codes go with it — leaving them would let a
     * later re-enable silently resurrect an attacker's enrolled device. */
    expect(users.row.twoFaSecretEnc).toBeNull();
    expect(users.row.twoFaRecoveryCodes).toBeNull();
    expect(users.row.twoFaEnabledAt).toBeNull();

    /* Compliance-grade audit: this one must not be best-effort. */
    expect(audit.recordOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.two_fa.disabled",
        reason: "confirmed_with_current_code",
      }),
    );
  });

  it("accepts a valid recovery code in place of the live code", async () => {
    await service.disable(
      "u1",
      { password: "correct", recoveryCode: "AAAAA-BBBBB" },
      ctx,
    );

    expect(users.row.twoFaMethod).toBe("none");
    expect(audit.recordOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "confirmed_with_recovery_code" }),
    );
  });

  it("refuses when 2FA is not enabled at all", async () => {
    users.row.twoFaMethod = "none";

    await expect(
      service.disable("u1", { password: "correct", code: "123456" }, ctx),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "TWO_FA_NOT_ENABLED" }),
    });
  });

  it("issues an enrolment code under the two_fa purpose", async () => {
    /* `issue` supersedes any live code for the same (purpose, target). Sharing
     * phone_verify here would cancel a pending phone verification the moment a
     * member started 2FA enrolment. */
    users.row.twoFaMethod = "none";
    users.row.twoFaEnabledAt = null;
    /* SMS 2FA requires a verified phone — enrolling with an unproven number
     * would let an attacker point the second factor at their own handset. */
    users.row.phoneVerifiedAt = new Date();

    await service.setup("u1", "sms", "1.2.3.4");

    expect(otp.issue).toHaveBeenCalledWith(expect.objectContaining({ purpose: "two_fa" }));
  });

  it("verifies an SMS second factor under the two_fa purpose, not phone_verify", async () => {
    /* The purpose matters: a code minted to prove a phone number must not
     * satisfy a second-factor challenge, and issuing a 2FA code must not cancel
     * a pending phone verification. Both flows send six digits to the same
     * handset, which is exactly why the namespaces have to differ. */
    users.row.twoFaMethod = "sms";
    users.row.twoFaSecretEnc = null;

    await service.disable("u1", { password: "correct", code: "123456" }, ctx);

    expect(otp.verify).toHaveBeenCalledWith({
      channel: "phone",
      target: "+441632960961",
      code: "123456",
      purpose: "two_fa",
    });
    expect(users.row.twoFaMethod).toBe("none");
  });

  it("treats an OTP failure as a wrong second factor, not a crash", async () => {
    users.row.twoFaMethod = "sms";
    otp.verify.mockRejectedValueOnce(new BadRequestException("bad code"));

    await expect(
      service.disable("u1", { password: "correct", code: "999999" }, ctx),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "TWO_FA_CODE_INVALID" }),
    });

    expect(users.row.twoFaMethod).toBe("sms");
  });
});

describe("TwoFactorService — enrolment", () => {
  let service: TwoFactorService;
  let users: { row: Partial<User>; findOne: jest.Mock; save: jest.Mock; update: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    const row: Partial<User> = {
      id: "u1",
      email: "ada@example.com",
      phone: "+441632960961",
      twoFaMethod: "none",
      phoneVerifiedAt: new Date(),
    };
    users = {
      row,
      findOne: jest.fn(async (): Promise<Partial<User> | null> => row),
      save: jest.fn(async (x: Partial<User>) => x),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    redis = {
      get: jest.fn(async () => ({ userId: "u1", method: "totp", secretEnc: ENC })),
      set: jest.fn(async () => undefined),
      del: jest.fn(async () => 1),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TwoFactorService,
        { provide: getRepositoryToken(User), useValue: users },
        {
          provide: CryptoService,
          useValue: {
            verifyPassword: jest.fn(async () => true),
            encrypt: jest.fn((v: string) => `enc(${v})`),
            decrypt: jest.fn((v: string) => v.replace(/^enc\(/, "").replace(/\)$/, "")),
            hmac: jest.fn((v: string) => `hmac(${v})`),
            safeEqual: jest.fn((a: string, b: string) => a === b),
            randomToken: jest.fn(() => "K7QX2M9ZP4TR8WVN"),
          },
        },
        { provide: RedisService, useValue: redis },
        {
          provide: OtpService,
          useValue: {
            issue: jest.fn(async () => ({ resendAfter: 60, sentTo: "•••61" })),
            verify: jest.fn(async () => ({ id: "vt-1" })),
            ttlSeconds: 600,
          },
        },
        {
          provide: AuditService,
          useValue: { record: jest.fn(async () => undefined), recordOrThrow: jest.fn(async () => undefined) },
        },
        { provide: appConfig.KEY, useValue: { name: "Members Trail" } },
      ],
    }).compile();

    service = moduleRef.get(TwoFactorService);
  });

  it("returns an otpauth URI and a QR image, and never a bare secret", async () => {
    redis.get.mockResolvedValueOnce(null);

    const res = await service.setup("u1", "totp", "1.2.3.4");

    expect(res.method).toBe("totp");
    expect(res.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(res.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(res as unknown as Record<string, unknown>).not.toHaveProperty("secret");

    /* The pending secret is held encrypted, and only in Redis until confirmed. */
    expect(redis.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ secretEnc: expect.stringMatching(/^enc\(/) }),
      expect.any(Number),
    );
    expect(users.save).not.toHaveBeenCalled();
  });

  it("mints ten single-use recovery codes on enable and stores them hashed", async () => {
    const res = await service.enable("u1", authenticator.generate(SECRET), {
      ip: "1.2.3.4", userAgent: "jest",
    });

    expect(res.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(users.row.twoFaMethod).toBe("totp");
    expect(users.row.twoFaRecoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);

    /* Stored hashed, so a database read cannot bypass the second factor. */
    for (const stored of users.row.twoFaRecoveryCodes ?? []) {
      expect(stored).toMatch(/^hmac\(recovery:/);
      expect(res.recoveryCodes).not.toContain(stored);
    }
  });

  it("refuses to enable on a wrong confirmation code", async () => {
    await expect(
      service.enable("u1", "000000", { ip: null, userAgent: null }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "TWO_FA_CODE_INVALID" }),
    });

    expect(users.row.twoFaMethod).toBe("none");
  });

  it("refuses to enable when the enrolment window has lapsed", async () => {
    redis.get.mockResolvedValueOnce(null);

    await expect(
      service.enable("u1", "123456", { ip: null, userAgent: null }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "TWO_FA_SETUP_EXPIRED" }),
    });
  });
});
