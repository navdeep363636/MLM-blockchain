import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { getQueueToken } from "@nestjs/bullmq";
import { VerificationToken } from "@/database/entities";
import { CryptoService } from "@/common/crypto/crypto.service";
import { RedisService } from "@/common/redis/redis.service";
import { CacheKeys } from "@/common/redis/cache.keys";
import { Queues } from "@/queues/queue.constants";
import { authConfig } from "@/config/configuration";
import { OtpService } from "./otp.service";

/* ============================================================================
 * OTP attempt limiting and resend cooldown (FRD A-02).
 *
 * A six-digit code has a million possibilities, which is nothing without an
 * attempt cap: at 10 requests/second an unlimited endpoint is brute-forced in
 * under a day, and far faster in practice because codes are re-issued.
 * ========================================================================== */

const TTL = 600;
const MAX_ATTEMPTS = 5;
const COOLDOWN = 60;

describe("OtpService", () => {
  let service: OtpService;
  let tokens: {
    rows: Partial<VerificationToken>[];
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
  };
  let redis: {
    ttl: jest.Mock;
    del: jest.Mock;
    incrWithTtl: jest.Mock;
    client: { set: jest.Mock };
  };
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    const rows: Partial<VerificationToken>[] = [];
    tokens = {
      rows,
      create: jest.fn((x: Partial<VerificationToken>) => ({ ...x })),
      save: jest.fn(async (x: Partial<VerificationToken>) => {
        if (!x.id) x.id = `vt-${rows.length + 1}`;
        const i = rows.findIndex((r) => r.id === x.id);
        if (i >= 0) rows[i] = x;
        else rows.push(x);
        return x;
      }),
      findOne: jest.fn(async ({ where }: { where: { tokenHash?: string } }) =>
        rows.find((r) => r.tokenHash === where.tokenHash) ?? null,
      ),
      delete: jest.fn(async () => ({ affected: 1 })),
    };

    redis = {
      ttl: jest.fn(async () => -2),
      del: jest.fn(async () => 1),
      incrWithTtl: jest.fn(async () => 1),
      client: { set: jest.fn(async () => "OK") },
    };
    queue = { add: jest.fn(async () => ({ id: "job-1" })) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: getRepositoryToken(VerificationToken), useValue: tokens },
        {
          provide: CryptoService,
          useValue: {
            hmac: jest.fn((v: string) => `hmac(${v})`),
            sha256: jest.fn((v: string) => `sha(${v})`),
            numericOtp: jest.fn(() => "123456"),
          },
        },
        { provide: RedisService, useValue: redis },
        { provide: getQueueToken(Queues.Notification), useValue: queue },
        {
          provide: authConfig.KEY,
          useValue: {
            otpTtl: TTL,
            otpMaxAttempts: MAX_ATTEMPTS,
            otpResendCooldown: COOLDOWN,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(OtpService);
  });

  /* ------------------------------- issuing -------------------------------- */

  it("stores only the HMAC of the code and queues delivery", async () => {
    const res = await service.issue({
      userId: "u1", channel: "email", target: "ada@example.com",
    });

    expect(res.resendAfter).toBe(COOLDOWN);
    expect(tokens.rows).toHaveLength(1);
    expect(tokens.rows[0].tokenHash).toBe("hmac(otp:email_verify:ada@example.com:123456)");
    expect(Object.values(tokens.rows[0])).not.toContain("123456");
    /* Delivery is a retried job, not a fire-and-forget event: a lost
     * verification code is a support ticket. */
    expect(queue.add).toHaveBeenCalled();
  });

  it("supersedes any previous code for the same target", async () => {
    await service.issue({ userId: "u1", channel: "email", target: "ada@example.com" });
    expect(tokens.delete).toHaveBeenCalledWith({
      purpose: "email_verify",
      target: "ada@example.com",
    });
  });

  it("refuses a resend inside the cooldown window and reports the wait", async () => {
    redis.ttl.mockResolvedValueOnce(42);

    await expect(
      service.issue({ userId: "u1", channel: "phone", target: "+441632960961" }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "OTP_COOLDOWN", retryAfter: 42 }),
    });

    expect(queue.add).not.toHaveBeenCalled();
  });

  /* ------------------------------ verifying ------------------------------- */

  it("accepts the correct code and consumes it so it cannot be replayed", async () => {
    await service.issue({ userId: "u1", channel: "email", target: "ada@example.com" });

    const row = await service.verify({
      channel: "email", target: "ada@example.com", code: "123456",
    });

    expect(row.consumedAt).toBeInstanceOf(Date);
    expect(redis.del).toHaveBeenCalledWith(
      CacheKeys.otpAttempts("email", "ada@example.com"),
      CacheKeys.otp("email", "ada@example.com"),
    );

    /* Second presentation of the same code is refused. */
    await expect(
      service.verify({ channel: "email", target: "ada@example.com", code: "123456" }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "OTP_INVALID" }),
    });
  });

  it("counts a wrong guess and reports the remaining budget", async () => {
    await service.issue({ userId: "u1", channel: "email", target: "ada@example.com" });
    redis.incrWithTtl.mockResolvedValueOnce(2);

    await expect(
      service.verify({ channel: "email", target: "ada@example.com", code: "000000" }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "OTP_INVALID", attemptsRemaining: 3 }),
    });

    expect(redis.incrWithTtl).toHaveBeenCalledWith(
      CacheKeys.otpAttempts("email", "ada@example.com"),
      TTL,
    );
  });

  it("counts an attempt even when no code exists for the target", async () => {
    /* Otherwise the cap is trivially bypassed: guess against a target with no
     * live code, then switch to one that has. */
    await expect(
      service.verify({ channel: "email", target: "nobody@example.com", code: "000000" }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "OTP_INVALID" }),
    });

    expect(redis.incrWithTtl).toHaveBeenCalled();
  });

  it("burns the code once the attempt budget is exhausted", async () => {
    await service.issue({ userId: "u1", channel: "email", target: "ada@example.com" });
    tokens.delete.mockClear();
    redis.incrWithTtl.mockResolvedValueOnce(MAX_ATTEMPTS + 1);

    await expect(
      service.verify({ channel: "email", target: "ada@example.com", code: "123456" }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: "OTP_ATTEMPTS_EXCEEDED",
        statusCode: 429,
      }),
    });

    /* The correct code is invalidated too — waiting for the attempt counter's
     * TTL to lapse must not hand the budget back. */
    expect(tokens.delete).toHaveBeenCalledWith({
      purpose: "email_verify",
      target: "ada@example.com",
    });
  });

  it("rejects an expired code and removes it", async () => {
    await service.issue({ userId: "u1", channel: "email", target: "ada@example.com" });
    tokens.rows[0].expiresAt = new Date(Date.now() - 1_000);

    await expect(
      service.verify({ channel: "email", target: "ada@example.com", code: "123456" }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "OTP_EXPIRED" }),
    });
  });

  it("scopes the hash to the target so a code cannot be replayed elsewhere", async () => {
    await service.issue({ userId: "u1", channel: "email", target: "ada@example.com" });

    /* Same six digits, different address — different HMAC, so no match. */
    await expect(
      service.verify({ channel: "email", target: "eve@example.com", code: "123456" }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "OTP_INVALID" }),
    });
  });
});
