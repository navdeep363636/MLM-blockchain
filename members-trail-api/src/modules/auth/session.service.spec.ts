import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { JwtService } from "@nestjs/jwt";
import { UnauthorizedException } from "@nestjs/common";
import { RolePermission, User, UserSession } from "@/database/entities";
import { CryptoService } from "@/common/crypto/crypto.service";
import { RedisService } from "@/common/redis/redis.service";
import { CacheKeys } from "@/common/redis/cache.keys";
import { EventBusService, Events } from "@/events";
import { authConfig } from "@/config/configuration";
import { AuditService } from "@/modules/audit/audit.service";
import { SessionService } from "./session.service";

/* ============================================================================
 * Refresh-token rotation and reuse detection.
 *
 * This is the security property with the least forgiving failure mode in the
 * module: if reuse is not detected, a refresh token captured once grants
 * indefinite access, because every rotation mints a fresh access token.
 * ========================================================================== */

type Row = Partial<UserSession> & { id: string } & Record<string, unknown>;

function makeSessionRepo() {
  const rows: Row[] = [];
  let seq = 0;

  const matches = (row: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && "type" in (v)) {
        /* Only IsNull() is used by the service. */
        return row[k] == null;
      }
      return row[k] === v;
    });

  return {
    rows,
    create: jest.fn((x: Partial<UserSession>) => ({ ...x }) as Row),
    save: jest.fn(async (input: Row | Row[]) => {
      const list = Array.isArray(input) ? input : [input];
      for (const item of list) {
        if (!item.id) item.id = `sess-${++seq}`;
        if (!item.createdAt) item.createdAt = new Date();
        const idx = rows.findIndex((r) => r.id === item.id);
        if (idx >= 0) rows[idx] = item;
        else rows.push(item);
      }
      return Array.isArray(input) ? list : list[0];
    }),
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.find((r) => matches(r, where)) ?? null,
    ),
    find: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter((r) => matches(r, where)),
    ),
    update: jest.fn(async () => ({ affected: 1 })),
    delete: jest.fn(async () => ({ affected: 0 })),
  };
}

function user(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "ada@example.com",
    role: "player",
    kycTier: 0,
    status: "active",
    isStaff: false,
    ...overrides,
  } as User;
}

describe("SessionService — refresh rotation", () => {
  let service: SessionService;
  let sessions: ReturnType<typeof makeSessionRepo>;
  let redis: { set: jest.Mock; del: jest.Mock; get: jest.Mock; client: { exists: jest.Mock } };
  let bus: { publish: jest.Mock };
  let audit: { record: jest.Mock; recordOrThrow: jest.Mock };
  let tokenCounter: number;

  beforeEach(async () => {
    sessions = makeSessionRepo();
    tokenCounter = 0;

    redis = {
      set: jest.fn(async () => undefined),
      del: jest.fn(async () => 1),
      get: jest.fn(async () => null),
      client: { exists: jest.fn(async () => 1) },
    };
    bus = { publish: jest.fn(async () => undefined) };
    audit = { record: jest.fn(async () => undefined), recordOrThrow: jest.fn(async () => undefined) };

    const crypto = {
      /* Deterministic so a test can predict the stored hash of a token. */
      hmac: jest.fn((v: string) => `hmac(${v})`),
      randomToken: jest.fn(() => `refresh-${++tokenCounter}`),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: getRepositoryToken(UserSession), useValue: sessions },
        { provide: getRepositoryToken(RolePermission), useValue: { find: jest.fn(async () => []) } },
        { provide: JwtService, useValue: { signAsync: jest.fn(async () => "access.jwt") } },
        { provide: CryptoService, useValue: crypto },
        { provide: RedisService, useValue: redis },
        { provide: EventBusService, useValue: bus },
        { provide: AuditService, useValue: audit },
        {
          provide: authConfig.KEY,
          useValue: {
            accessSecret: "a".repeat(32),
            refreshSecret: "b".repeat(32),
            accessTtl: "15m",
            refreshTtl: "30d",
          },
        },
      ],
    }).compile();

    service = moduleRef.get(SessionService);
  });

  const resolveUser = async () => user();

  it("issues an access token plus an opaque refresh token, storing only its HMAC", async () => {
    const issued = await service.issue(user(), { ip: "1.2.3.4", userAgent: "jest" });

    expect(issued.tokens.refreshToken).toBe("refresh-1");
    expect(sessions.rows[0].refreshTokenHash).toBe("hmac(refresh-1)");
    /* The raw token must not be persisted in any column — only its HMAC. */
    expect(Object.values(sessions.rows[0])).not.toContain(issued.tokens.refreshToken);
    expect(redis.set).toHaveBeenCalledWith(
      CacheKeys.session(issued.tokens.sessionId),
      expect.objectContaining({ userId: "user-1" }),
      30 * 86_400,
    );
  });

  it("rotates: the old token is retired, replacedByHash points at the new one", async () => {
    const first = await service.issue(user(), { ip: "1.2.3.4" });
    const second = await service.rotate(first.tokens.refreshToken, { ip: "1.2.3.4" }, resolveUser);

    expect(second.tokens.refreshToken).not.toBe(first.tokens.refreshToken);

    const old = sessions.rows.find((r) => r.refreshTokenHash === "hmac(refresh-1)");
    expect(old?.replacedByHash).toBe("hmac(refresh-2)");
    expect(old?.revokedAt).toBeInstanceOf(Date);
    expect(old?.revokedReason).toBe("rotated");

    /* The retired session's Redis key goes immediately, so its access token
     * cannot outlive the rotation. */
    expect(redis.del).toHaveBeenCalledWith(CacheKeys.session(first.tokens.sessionId));
  });

  it("detects reuse of an already-rotated token and destroys every session", async () => {
    const first = await service.issue(user(), { ip: "1.2.3.4" });
    const second = await service.rotate(first.tokens.refreshToken, { ip: "1.2.3.4" }, resolveUser);
    /* A third, unrelated device — it must also be signed out, because we cannot
     * tell which holder is the attacker. */
    const other = await service.issue(user(), { ip: "9.9.9.9" });

    await expect(
      service.rotate(first.tokens.refreshToken, { ip: "5.6.7.8" }, resolveUser),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "REFRESH_REUSE_DETECTED" }),
    });

    const live = sessions.rows.filter((r) => !r.revokedAt);
    expect(live).toHaveLength(0);

    for (const row of sessions.rows) {
      expect(row.revokedReason).toBe("refresh_reuse");
    }

    /* del() is variadic, so the assertion is over every key it was asked to
     * remove across all calls. */
    const deletedKeys = redis.del.mock.calls.flat();
    expect(deletedKeys).toContain(CacheKeys.session(second.tokens.sessionId));
    expect(deletedKeys).toContain(CacheKeys.session(other.tokens.sessionId));

    /* A security event and an audit row: this is a breach signal, not a 401. */
    expect(bus.publish).toHaveBeenCalledWith(
      Events.SessionRevoked,
      expect.objectContaining({ reason: "refresh_token_reuse", severity: "critical" }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.refresh.reuse_detected" }),
    );
  });

  it("revokes the descendants of a leaked token, not just the presented link", async () => {
    const first = await service.issue(user(), {});
    const second = await service.rotate(first.tokens.refreshToken, {}, resolveUser);
    const third = await service.rotate(second.tokens.refreshToken, {}, resolveUser);

    await expect(service.rotate(first.tokens.refreshToken, {}, resolveUser)).rejects.toThrow(
      UnauthorizedException,
    );

    const newest = sessions.rows.find((r) => r.jti === third.tokens.sessionId);
    expect(newest?.revokedAt).toBeInstanceOf(Date);
    expect(newest?.revokedReason).toBe("refresh_reuse");
  });

  it("rejects a token that was never issued", async () => {
    await expect(service.rotate("not-a-token", {}, resolveUser)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "REFRESH_UNKNOWN" }),
    });
  });

  it("rejects a token whose session was revoked without being rotated", async () => {
    const issued = await service.issue(user(), {});
    await service.revoke(issued.tokens.sessionId, "logout");
    /* revoke() goes through update(), which the fake does not apply — set the
     * field the way the database would so the branch under test is reached. */
    sessions.rows[0].revokedAt = new Date();

    await expect(
      service.rotate(issued.tokens.refreshToken, {}, resolveUser),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "REFRESH_REVOKED" }),
    });
  });

  it("rejects an expired refresh token", async () => {
    const issued = await service.issue(user(), {});
    sessions.rows[0].expiresAt = new Date(Date.now() - 1_000);

    await expect(
      service.rotate(issued.tokens.refreshToken, {}, resolveUser),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "REFRESH_EXPIRED" }),
    });
  });

  it("revokeAll leaves the excepted session alive", async () => {
    const keep = await service.issue(user(), {});
    await service.issue(user(), {});
    await service.issue(user(), {});

    const count = await service.revokeAll("user-1", "logout_all", keep.tokens.sessionId);

    expect(count).toBe(2);
    expect(sessions.rows.filter((r) => !r.revokedAt)).toHaveLength(1);
    expect(sessions.rows.find((r) => !r.revokedAt)?.jti).toBe(keep.tokens.sessionId);
  });
});
