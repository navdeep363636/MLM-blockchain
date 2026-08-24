import {
  BadRequestException, CallHandler, ConflictException, ExecutionContext, Injectable,
  Logger, NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, catchError, tap, throwError } from "rxjs";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { RedisService } from "@/common/redis/redis.service";
import { CacheKeys, Ttl } from "@/common/redis/cache.keys";
import { IDEMPOTENT_KEY, type AuthUser } from "@/common/decorators";

/** Stamps a request id on every request/response so logs and client error
 *  reports can be correlated. */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== "http") return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { id?: string }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const incoming = req.headers["x-request-id"];
    req.id = (typeof incoming === "string" && incoming.length <= 64 ? incoming : null) ?? randomUUID();
    res.setHeader("X-Request-Id", req.id);
    return next.handle();
  }
}

/**
 * Idempotency for mutating endpoints marked @Idempotent(scope).
 *
 * Without this, a client retrying a timed-out POST /conversions can convert
 * twice. The key is reserved atomically before the handler runs; a replay is
 * refused rather than re-executed.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (ctx.getType() !== "http") return next.handle();

    const scope = this.reflector.getAllAndOverride<string>(IDEMPOTENT_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (!scope) return next.handle();

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers["idempotency-key"];
    const key = typeof header === "string" ? header.trim() : "";

    if (!key) {
      throw new BadRequestException({
        message: "An Idempotency-Key header is required for this operation",
        code: "IDEMPOTENCY_KEY_REQUIRED",
      });
    }
    if (key.length < 8 || key.length > 128) {
      throw new BadRequestException({
        message: "Idempotency-Key must be between 8 and 128 characters",
        code: "IDEMPOTENCY_KEY_INVALID",
      });
    }

    // Scope by user so one client's key can never collide with another's.
    const scoped = CacheKeys.idempotency(scope, `${req.user?.id ?? "anon"}:${key}`);
    const fresh = await this.redis.reserve(scoped, Ttl.idempotency);

    if (!fresh) {
      throw new ConflictException({
        message: "This request has already been submitted",
        code: "DUPLICATE_REQUEST",
      });
    }

    return next.handle().pipe(
      catchError((err) => {
        /* Release on failure so the client can legitimately retry. A successful
         * request keeps the key for 24h, which is what makes the retry safe. */
        void this.redis.del(scoped);
        return throwError(() => err);
      }),
    );
  }
}

/** Logs slow handlers. A p95 budget only helps if breaches are visible. */
@Injectable()
export class TimingInterceptor implements NestInterceptor {
  private readonly log = new Logger("Timing");
  /** FRD §10.2: p95 < 300ms read, < 800ms write. Warn above the write budget. */
  private readonly slowMs = 800;

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== "http") return next.handle();
    const started = process.hrtime.bigint();
    const req = ctx.switchToHttp().getRequest<Request & { id?: string }>();

    return next.handle().pipe(
      tap(() => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        if (ms > this.slowMs) {
          this.log.warn(`SLOW ${req.method} ${req.originalUrl ?? req.url} ${ms.toFixed(0)}ms [req:${req.id ?? "-"}]`);
        }
      }),
    );
  }
}
