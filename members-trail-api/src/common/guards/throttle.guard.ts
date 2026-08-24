import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard, ThrottlerException } from "@nestjs/throttler";
import type { Request } from "express";
import type { AuthUser } from "@/common/decorators";

/**
 * Rate limiting keyed by authenticated user when available, falling back to IP.
 *
 * Keying on the user matters: several players behind one corporate NAT should
 * not throttle each other, and an attacker rotating IPs should still be capped
 * on their account.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Request & { user?: AuthUser }): Promise<string> {
    if (req.user?.id) return `u:${req.user.id}`;
    // Only trust forwarded headers when Express is configured to (TRUST_PROXY).
    return `ip:${req.ip ?? req.socket?.remoteAddress ?? "unknown"}`;
  }

  protected override async throwThrottlingException(): Promise<void> {
    throw new ThrottlerException("Too many requests. Please slow down and try again shortly.");
  }

  protected override getRequestResponse(ctx: ExecutionContext) {
    return super.getRequestResponse(ctx);
  }
}
