import { createHash } from "node:crypto";
import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard, ThrottlerException } from "@nestjs/throttler";
import type { Request } from "express";
import type { AuthUser } from "@/common/decorators";

/**
 * The refresh cookie. `POST /auth/refresh` is `@Public()`, so there is no
 * `req.user` to key on even though the caller is plainly a known session.
 */
const REFRESH_COOKIE = "mt_rt";

/**
 * Rate limiting keyed by authenticated user when available, falling back to IP.
 *
 * Keying on the user matters: several players behind one corporate NAT should
 * not throttle each other, and an attacker rotating IPs should still be capped
 * on their account.
 *
 * A session cookie counts as an identity for this purpose. Without that step,
 * the one endpoint every browser calls on every page load — `/auth/refresh`,
 * which is public and therefore has no `req.user` — fell back to the IP key and
 * shared a single allowance across an entire office. The symptom was not a
 * rate-limit message: the browser read the 429 as "no session" and bounced the
 * member to the login screen mid-navigation. The cookie is hashed so no token
 * material ends up in a Redis key.
 *
 * That cookie is attacker-controlled, though, and it used to be trusted on its
 * own. Any non-empty string minted a fresh bucket, so sending a new random
 * `mt_rt` per request nullified every limit on the auth surface — login,
 * register, forgot-password, verify-otp, the lot — from a single IP. Two
 * changes close that: the cookie is only an identity on the endpoints that
 * actually need it, and even there it is combined with the IP rather than
 * replacing it. An unauthenticated credential endpoint is always keyed on the
 * IP alone.
 */

/**
 * Paths where a session cookie may soften the IP key.
 *
 * Deliberately narrow. `/auth/refresh` is the case this exists for: every tab
 * calls it, it is public, and one office behind a NAT must not share an
 * allowance. Nothing that takes a credential or an identifier belongs here.
 */
const COOKIE_KEYED_PATHS = ["/auth/refresh", "/auth/sessions"];
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Request & { user?: AuthUser }): Promise<string> {
    if (req.user?.id) return `u:${req.user.id}`;

    // Only trust forwarded headers when Express is configured to (TRUST_PROXY).
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";

    const path = req.path ?? "";
    if (COOKIE_KEYED_PATHS.some((p) => path.endsWith(p))) {
      const jar = (req as Request & { cookies?: Record<string, string> }).cookies;
      const refresh = jar?.[REFRESH_COOKIE];
      if (typeof refresh === "string" && refresh.length > 0) {
        /* IP is still part of the key. The cookie alone was forgeable, so it
         * bought an unlimited number of buckets; combined, a rotating cookie
         * gains nothing an attacker did not already have from their own IP. */
        const fingerprint = createHash("sha256")
          .update(`${ip}|${refresh}`)
          .digest("base64url")
          .slice(0, 32);
        return `s:${fingerprint}`;
      }
    }

    return `ip:${ip}`;
  }

  protected override async throwThrottlingException(): Promise<void> {
    throw new ThrottlerException("Too many requests. Please slow down and try again shortly.");
  }

  protected override getRequestResponse(ctx: ExecutionContext) {
    return super.getRequestResponse(ctx);
  }
}
