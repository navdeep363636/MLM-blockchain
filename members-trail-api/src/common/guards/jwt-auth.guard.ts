import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Inject } from "@nestjs/common";
import type { Request } from "express";
import { authConfig, type AuthConfig } from "@/config/configuration";
import { RedisService } from "@/common/redis/redis.service";
import { CacheKeys } from "@/common/redis/cache.keys";
import {
  IS_PUBLIC, KYC_TIER_KEY, PERMS_KEY, ROLES_KEY, type AnyRole, type AuthUser,
} from "@/common/decorators";

export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: AnyRole;
  kyc: 0 | 1 | 2;
  st: string;
  sid: string;
  perms?: string[];
  staff?: boolean;
}

/**
 * Global guard. Applied app-wide in AppModule, so every route is protected
 * unless it carries @Public(). It also enforces @Roles, @RequirePermissions and
 * @RequireKyc in the same pass, which keeps the authorization decision in one
 * auditable place rather than scattered across three guards.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    @Inject(authConfig.KEY) private readonly cfg: AuthConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // WebSocket handshakes authenticate in the gateway, not here.
    if (ctx.getType() !== "http") return true;

    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = this.extractToken(req);

    if (isPublic) {
      // Still attach the user when a token is present: public endpoints such as
      // the games catalog personalise their response when the caller is known.
      if (token) await this.tryAttach(req, token);
      return true;
    }

    if (!token) throw new UnauthorizedException("Authentication required");

    const user = await this.attach(req, token);

    /* ------------------------------- roles ------------------------------- */
    const roles = this.reflector.getAllAndOverride<AnyRole[]>(ROLES_KEY, targets);
    if (roles?.length && !roles.includes(user.role)) {
      throw new ForbiddenException("Your role does not have access to this resource");
    }

    /* ---------------------------- permissions --------------------------- */
    const perms = this.reflector.getAllAndOverride<string[]>(PERMS_KEY, targets);
    if (perms?.length) {
      const missing = perms.filter((p) => !user.permissions.includes(p));
      if (missing.length) {
        throw new ForbiddenException(`Missing permission: ${missing.join(", ")}`);
      }
    }

    /* -------------------------------- KYC -------------------------------- */
    const tier = this.reflector.getAllAndOverride<1 | 2>(KYC_TIER_KEY, targets);
    if (tier && user.kycTier < tier) {
      throw new ForbiddenException({
        message: `KYC Tier ${tier} verification is required for this action`,
        code: "KYC_REQUIRED",
        requiredTier: tier,
        currentTier: user.kycTier,
      });
    }

    /* ----------------------------- account state ------------------------- */
    if (user.status === "suspended" || user.status === "frozen") {
      throw new ForbiddenException({
        message: `Your account is ${user.status}. Contact support.`,
        code: "ACCOUNT_" + user.status.toUpperCase(),
      });
    }

    return true;
  }

  private extractToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) return header.slice(7).trim();
    // Cookie fallback supports the browser flow without exposing the token to JS.
    const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.access_token;
    return cookie ?? null;
  }

  private async attach(req: Request & { user?: AuthUser }, token: string): Promise<AuthUser> {
    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, { secret: this.cfg.accessSecret });
    } catch (e) {
      const msg = e instanceof Error && e.name === "TokenExpiredError" ? "Access token expired" : "Invalid access token";
      throw new UnauthorizedException(msg);
    }

    /* Revocation check. Logging out, revoking a session or a password reset
     * deletes the session key, so a still-valid JWT stops working immediately
     * rather than lingering until it expires. */
    const alive = await this.redis.client.exists(CacheKeys.session(claims.sid));
    if (!alive) throw new UnauthorizedException("Session has been revoked. Please sign in again.");

    const user: AuthUser = {
      id: claims.sub,
      email: claims.email,
      role: claims.role,
      kycTier: claims.kyc,
      status: claims.st,
      sessionId: claims.sid,
      permissions: claims.perms ?? [],
      isStaff: claims.staff === true,
    };
    req.user = user;
    return user;
  }

  private async tryAttach(req: Request & { user?: AuthUser }, token: string): Promise<void> {
    try {
      await this.attach(req, token);
    } catch {
      /* Optional auth: an invalid token on a public route is simply anonymous. */
    }
  }
}
