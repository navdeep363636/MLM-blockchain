import {
  Inject, Injectable, Logger, UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { JwtService } from "@nestjs/jwt";
import { IsNull, LessThan, Repository } from "typeorm";
import { randomUUID } from "node:crypto";
import { RolePermission, User, UserSession } from "@/database/entities";
import { CryptoService } from "@/common/crypto/crypto.service";
import { RedisService } from "@/common/redis/redis.service";
import { CacheKeys, Ttl } from "@/common/redis/cache.keys";
import { EventBusService, Events } from "@/events";
import { authConfig, type AuthConfig } from "@/config/configuration";
import type { AccessTokenClaims } from "@/common/guards";
import { AuditService } from "@/modules/audit/audit.service";
import { parseDurationSeconds } from "./auth.constants";
import type { SessionView, TokenPair } from "./dto/auth.dto";

/* ============================================================================
 * Session and token lifecycle.
 *
 * Two token types, deliberately different in kind:
 *
 *  - The ACCESS token is a short-lived JWT. It is verified statelessly by the
 *    global guard, plus one Redis EXISTS on the session key. That single lookup
 *    is what makes logout instant: without it a stolen access token stays valid
 *    until it expires, which is the classic "I revoked the session and nothing
 *    happened" bug.
 *
 *  - The REFRESH token is an opaque random string, never a JWT. Only its HMAC is
 *    stored, so a database dump does not yield usable refresh tokens, and it is
 *    ROTATED on every use with the old value's replacement recorded. Presenting
 *    an already-replaced token is proof that a token leaked, and is handled as a
 *    breach: every session for that user is destroyed.
 * ========================================================================== */

export interface SessionContext {
  ip?: string | null;
  userAgent?: string | null;
  device?: string | null;
  fingerprint?: string | null;
}

export interface IssuedSession {
  tokens: TokenPair;
  session: UserSession;
}

/** Shape of the Redis value behind a live session. */
interface SessionState {
  userId: string;
  role: string;
  ip: string | null;
  issuedAt: string;
}

@Injectable()
export class SessionService {
  private readonly log = new Logger(SessionService.name);

  constructor(
    @InjectRepository(UserSession) private readonly sessions: Repository<UserSession>,
    @InjectRepository(RolePermission) private readonly rolePerms: Repository<RolePermission>,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    private readonly bus: EventBusService,
    private readonly audit: AuditService,
    @Inject(authConfig.KEY) private readonly cfg: AuthConfig,
  ) {}

  get accessTtlSeconds(): number {
    return parseDurationSeconds(this.cfg.accessTtl);
  }

  get refreshTtlSeconds(): number {
    return parseDurationSeconds(this.cfg.refreshTtl);
  }

  /* ------------------------------------------------------------------ *
   * Issue
   * ------------------------------------------------------------------ */

  async issue(user: User, ctx: SessionContext): Promise<IssuedSession> {
    const jti = randomUUID();
    const refreshToken = this.crypto.randomToken(32);
    const refreshTtl = this.refreshTtlSeconds;

    const session = await this.sessions.save(
      this.sessions.create({
        userId: user.id,
        jti,
        refreshTokenHash: this.crypto.hmac(refreshToken),
        device: ctx.device ?? ctx.fingerprint ?? null,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent?.slice(0, 400) ?? null,
        expiresAt: new Date(Date.now() + refreshTtl * 1_000),
        lastActiveAt: new Date(),
      }),
    );

    const accessToken = await this.signAccessToken(user, jti);
    await this.writeSessionKey(jti, user, ctx.ip ?? null, refreshTtl);

    return {
      session,
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: this.accessTtlSeconds,
        refreshExpiresIn: refreshTtl,
        tokenType: "Bearer",
        sessionId: jti,
      },
    };
  }

  /* ------------------------------------------------------------------ *
   * Rotate
   * ------------------------------------------------------------------ */

  /**
   * Exchanges a refresh token for a new pair.
   *
   * Reuse detection is the whole point of the rotation chain: a session row
   * keeps the hash of the token it issued AND the hash of the token that
   * replaced it. Once `replacedByHash` is set, the old token is spent, and
   * anyone presenting it again is either replaying a captured request or holding
   * a stolen token that the legitimate client has already rotated past. Either
   * way the correct response is to assume compromise and destroy every session
   * the user has, not merely reject the request.
   */
  async rotate(
    presentedToken: string,
    ctx: SessionContext,
    resolveUser: (userId: string) => Promise<User | null>,
  ): Promise<IssuedSession> {
    const presentedHash = this.crypto.hmac(presentedToken);

    const existing = await this.sessions.findOne({ where: { refreshTokenHash: presentedHash } });

    if (!existing) {
      throw new UnauthorizedException({
        message: "That refresh token is not recognised. Please sign in again.",
        code: "REFRESH_UNKNOWN",
      });
    }

    /* ------------------------- reuse: treat as breach ------------------- */
    if (existing.replacedByHash) {
      await this.handleReuse(existing, ctx);
      throw new UnauthorizedException({
        message:
          "This session has been ended because a previously used sign-in token was replayed. " +
          "All devices were signed out as a precaution.",
        code: "REFRESH_REUSE_DETECTED",
      });
    }

    if (existing.revokedAt) {
      throw new UnauthorizedException({
        message: "That session was signed out. Please sign in again.",
        code: "REFRESH_REVOKED",
      });
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({
        message: "That session has expired. Please sign in again.",
        code: "REFRESH_EXPIRED",
      });
    }

    const user = await resolveUser(existing.userId);
    if (!user) {
      await this.revokeAll(existing.userId, "user_missing");
      throw new UnauthorizedException({
        message: "Account is no longer available.",
        code: "ACCOUNT_UNAVAILABLE",
      });
    }

    const issued = await this.issue(user, {
      ip: ctx.ip ?? existing.ip,
      userAgent: ctx.userAgent ?? existing.userAgent,
      device: ctx.device ?? existing.device,
      fingerprint: ctx.fingerprint,
    });

    /* Close the old link of the chain. Writing replacedByHash is what makes the
     * next presentation of `presentedToken` detectable as reuse. */
    existing.replacedByHash = issued.session.refreshTokenHash;
    existing.revokedAt = new Date();
    existing.revokedReason = "rotated";
    await this.sessions.save(existing);

    await this.redis.del(CacheKeys.session(existing.jti));

    return issued;
  }

  /* ------------------------------------------------------------------ *
   * Revoke
   * ------------------------------------------------------------------ */

  /** Ends one session. The Redis delete is what stops the live access token. */
  async revoke(jti: string, reason: string): Promise<void> {
    await this.sessions.update(
      { jti, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason.slice(0, 64) },
    );
    await this.redis.del(CacheKeys.session(jti));
  }

  async revokeById(sessionId: string, userId: string, reason: string): Promise<UserSession | null> {
    const row = await this.sessions.findOne({ where: { id: sessionId, userId } });
    if (!row) return null;
    if (!row.revokedAt) {
      row.revokedAt = new Date();
      row.revokedReason = reason.slice(0, 64);
      await this.sessions.save(row);
    }
    await this.redis.del(CacheKeys.session(row.jti));
    await this.bus.publish(Events.SessionRevoked, {
      userId,
      sessionId: row.id,
      reason,
    });
    return row;
  }

  /** Ends every session for a user. Used by logout-all, password reset and
   *  reuse detection — all of which must leave no live token behind. */
  async revokeAll(userId: string, reason: string, exceptJti?: string): Promise<number> {
    const live = await this.sessions.find({ where: { userId, revokedAt: IsNull() } });
    const targets = live.filter((s) => s.jti !== exceptJti);
    if (!targets.length) return 0;

    const now = new Date();
    for (const s of targets) {
      s.revokedAt = now;
      s.revokedReason = reason.slice(0, 64);
    }
    await this.sessions.save(targets);
    await this.redis.del(...targets.map((s) => CacheKeys.session(s.jti)));

    await this.bus.publish(Events.SessionRevoked, {
      userId,
      reason,
      count: targets.length,
      scope: exceptJti ? "others" : "all",
    });

    return targets.length;
  }

  /* ------------------------------------------------------------------ *
   * Read
   * ------------------------------------------------------------------ */

  async listActive(userId: string, currentJti?: string): Promise<SessionView[]> {
    const rows = await this.sessions.find({
      where: { userId, revokedAt: IsNull() },
      order: { lastActiveAt: "DESC", createdAt: "DESC" },
      take: 50,
    });
    const now = Date.now();
    return rows
      .filter((r) => r.expiresAt.getTime() > now)
      .map((r) => ({
        id: r.id,
        device: r.device,
        ip: r.ip,
        location: r.location,
        lastActiveAt: r.lastActiveAt,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        current: r.jti === currentJti,
      }));
  }

  async touch(jti: string): Promise<void> {
    await this.sessions.update({ jti }, { lastActiveAt: new Date() });
  }

  /** Housekeeping for the retention cron. */
  async purgeExpired(before: Date = new Date()): Promise<number> {
    const res = await this.sessions.delete({ expiresAt: LessThan(before) });
    return res.affected ?? 0;
  }

  /* ------------------------------------------------------------------ *
   * Internals
   * ------------------------------------------------------------------ */

  private async handleReuse(session: UserSession, ctx: SessionContext): Promise<void> {
    this.log.warn(`refresh token reuse detected for user ${session.userId}`);

    /* Walk the chain forward so every descendant of the leaked token dies even
     * if it was issued to a different device, then take out the rest of the
     * user's sessions: we cannot tell which side of the chain is the attacker. */
    const family = await this.collectFamily(session);
    const now = new Date();
    for (const s of family) {
      if (!s.revokedAt) {
        s.revokedAt = now;
      }
      s.revokedReason = "refresh_reuse";
    }
    if (family.length) await this.sessions.save(family);

    const revokedCount = await this.revokeAll(session.userId, "refresh_reuse");
    await this.redis.del(...family.map((s) => CacheKeys.session(s.jti)));

    await this.bus.publish(Events.SessionRevoked, {
      userId: session.userId,
      reason: "refresh_token_reuse",
      severity: "critical",
      sessionId: session.id,
      familySize: family.length,
      revokedSessions: revokedCount + family.length,
      ip: ctx.ip ?? null,
    });

    await this.audit.record({
      actorId: session.userId,
      action: "auth.refresh.reuse_detected",
      targetType: "user_session",
      targetId: session.id,
      reason: "A refresh token that had already been rotated was presented again",
      after: { revokedSessions: revokedCount + family.length },
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
  }

  /** Follows replacedByHash forward, bounded so a corrupt chain cannot loop. */
  private async collectFamily(start: UserSession): Promise<UserSession[]> {
    const out: UserSession[] = [start];
    const seen = new Set<string>([start.id]);
    let nextHash = start.replacedByHash;

    for (let depth = 0; depth < 50 && nextHash; depth++) {
      const next: UserSession | null = await this.sessions.findOne({
        where: { refreshTokenHash: nextHash },
      });
      if (!next || seen.has(next.id)) break;
      seen.add(next.id);
      out.push(next);
      nextHash = next.replacedByHash;
    }
    return out;
  }

  private async signAccessToken(user: User, jti: string): Promise<string> {
    const claims: AccessTokenClaims = {
      sub: user.id,
      email: user.email,
      role: user.role,
      kyc: user.kycTier,
      st: user.status,
      sid: jti,
      perms: user.isStaff ? await this.permissionsFor(user.role) : [],
      staff: user.isStaff === true,
    };

    return this.jwt.signAsync(claims, {
      secret: this.cfg.accessSecret,
      expiresIn: this.cfg.accessTtl as `${number}${"s" | "m" | "h" | "d"}`,
      issuer: "members-trail",
      audience: "members-trail-api",
      jwtid: jti,
    });
  }

  /**
   * The session key is what the global guard checks, so its TTL must cover the
   * whole session — not just the access token — otherwise a refresh would
   * resurrect a session the user had already ended.
   */
  private async writeSessionKey(
    jti: string,
    user: User,
    ip: string | null,
    ttlSeconds: number,
  ): Promise<void> {
    const state: SessionState = {
      userId: user.id,
      role: user.role,
      ip,
      issuedAt: new Date().toISOString(),
    };
    await this.redis.set(CacheKeys.session(jti), state, ttlSeconds);
  }

  /**
   * Flattens the RBAC matrix into the `perms` claim, cached briefly so a role
   * change propagates within a minute without a query per token issue.
   */
  private async permissionsFor(role: string): Promise<string[]> {
    const key = CacheKeys.platformConfig(`rbac:${role}`);
    const cached = await this.redis.get<string[]>(key);
    if (cached) return cached;

    const rows = await this.rolePerms.find({ where: { role } });
    const perms: string[] = [];
    for (const r of rows) {
      if (r.canRead) perms.push(`${r.module}:read`);
      if (r.canWrite) perms.push(`${r.module}:write`);
      if (r.canApprove) perms.push(`${r.module}:approve`);
    }
    await this.redis.set(key, perms, Ttl.platformConfig);
    return perms;
  }
}
