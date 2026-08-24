import {
  applyDecorators, createParamDecorator, ExecutionContext, SetMetadata, } from "@nestjs/common";
import { ApiBearerAuth } from "@nestjs/swagger";
import type { Request } from "express";

/* ============================================================================
 * Route metadata. Authorization is deny-by-default: the global JwtAuthGuard
 * protects everything, and @Public() is the only way out. That way a new
 * endpoint is secure unless someone explicitly opts out, which is visible in
 * review.
 * ========================================================================== */

export const IS_PUBLIC = "auth:public";
export const ROLES_KEY = "auth:roles";
export const PERMS_KEY = "auth:perms";
export const KYC_TIER_KEY = "auth:kycTier";
export const IDEMPOTENT_KEY = "http:idempotent";

export const Public = () => SetMetadata(IS_PUBLIC, true);

/* --------------------------------- roles ---------------------------------- */

export type UserRole = "player";
export type StaffRole = "support" | "compliance" | "finance_admin" | "super_admin";
export type AnyRole = UserRole | StaffRole;

export const Roles = (...roles: AnyRole[]) => SetMetadata(ROLES_KEY, roles);

/** Fine-grained RBAC, e.g. `treasury:approve`. Checked against the staff role's
 *  permission matrix so a role can be re-scoped without touching controllers. */
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMS_KEY, perms);

/** Blocks the route unless the caller holds at least this KYC tier. */
export const RequireKyc = (tier: 1 | 2) => SetMetadata(KYC_TIER_KEY, tier);

/**
 * Marks a mutating endpoint as requiring an `Idempotency-Key` header. The
 * interceptor short-circuits a replay instead of double-charging.
 */
export const Idempotent = (scope: string) => SetMetadata(IDEMPOTENT_KEY, scope);

/* ------------------------------ current user ------------------------------ */

export interface AuthUser {
  id: string;
  email: string;
  role: AnyRole;
  kycTier: 0 | 1 | 2;
  status: string;
  sessionId: string;
  permissions: string[];
  isStaff: boolean;
}

export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | AuthUser[keyof AuthUser] => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user as AuthUser;
    return field ? user?.[field] : user;
  },
);

/** Client IP honouring the proxy chain when TRUST_PROXY is on. */
export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.ip ?? req.socket?.remoteAddress ?? "0.0.0.0";
});

export const UserAgent = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return (req.headers["user-agent"] as string) ?? "unknown";
});

/* ------------------------------- composites ------------------------------- */

const ALL_STAFF: StaffRole[] = ["support", "compliance", "finance_admin", "super_admin"];

/** Staff-only route, with Swagger security annotated in the same place. */
export function StaffOnly(...roles: StaffRole[]) {
  return applyDecorators(Roles(...(roles.length ? roles : ALL_STAFF)), ApiBearerAuth());
}

/** Player route that also needs a KYC tier — the common money-path shape. */
export function PlayerKyc(tier: 1 | 2) {
  return applyDecorators(RequireKyc(tier), ApiBearerAuth());
}
