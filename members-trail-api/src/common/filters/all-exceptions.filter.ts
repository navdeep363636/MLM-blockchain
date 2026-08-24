import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { QueryFailedError, EntityNotFoundError } from "typeorm";

export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
  timestamp: string;
  path: string;
}

/**
 * Single error shape for the whole API, and the only place errors are logged.
 *
 * Two rules it exists to enforce:
 *  1. Internal detail never reaches the client. Driver messages leak table and
 *     column names, which is reconnaissance for an attacker.
 *  2. Every 5xx is logged with the request id so a user-reported failure can be
 *     traced without guessing.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger("Exception");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();

    const { status, code, message, details } = this.normalize(exception);

    const body: ErrorBody = {
      statusCode: status,
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      requestId: req.id,
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
    };

    if (status >= 500) {
      this.log.error(
        `${req.method} ${body.path} → ${status} ${code} [req:${req.id ?? "-"}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (status === 429 || status === 403 || status === 401) {
      // Security-relevant refusals are worth a line at warn, without a stack.
      this.log.warn(`${req.method} ${body.path} → ${status} ${code} [req:${req.id ?? "-"}]`);
    }

    res.status(status).json(body);
  }

  private normalize(e: unknown): { status: number; code: string; message: string; details?: unknown } {
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const r = e.getResponse();

      if (typeof r === "string") {
        return { status, code: this.codeFor(status), message: r };
      }
      const obj = r as Record<string, unknown>;
      // class-validator returns message as string[]; surface it as details.
      const raw = obj.message;
      const isList = Array.isArray(raw);
      return {
        status,
        code: (obj.code as string) ?? this.codeFor(status),
        message: isList ? "Validation failed" : ((raw as string) ?? e.message),
        details: isList ? raw : obj.details ?? this.rest(obj),
      };
    }

    /* Body-parser rejections arrive as http-errors, not HttpExceptions: an
     * oversized body or malformed JSON never reaches a controller, so Nest never
     * wraps it. Without this branch they became 500s — which tells the client
     * the server is broken when the request was, and pages an operator for a
     * caller's mistake. */
    const httpError = this.asHttpError(e);
    if (httpError) return httpError;

    if (e instanceof EntityNotFoundError) {
      return { status: HttpStatus.NOT_FOUND, code: "NOT_FOUND", message: "The requested resource was not found" };
    }

    if (e instanceof QueryFailedError) {
      const driver = e as QueryFailedError & { code?: string; errno?: number; sqlState?: string };
      // Map only the constraint violations that are genuinely the caller's fault.
      if (driver.code === "ER_DUP_ENTRY" || driver.errno === 1062) {
        return { status: HttpStatus.CONFLICT, code: "DUPLICATE", message: "That record already exists" };
      }
      if (driver.code === "ER_NO_REFERENCED_ROW_2" || driver.errno === 1452) {
        return { status: HttpStatus.BAD_REQUEST, code: "INVALID_REFERENCE", message: "A referenced record does not exist" };
      }
      if (driver.code === "ER_LOCK_WAIT_TIMEOUT" || driver.errno === 1205) {
        return { status: HttpStatus.CONFLICT, code: "LOCK_TIMEOUT", message: "The record is busy. Please retry." };
      }
      if (driver.code === "ER_LOCK_DEADLOCK" || driver.errno === 1213) {
        return { status: HttpStatus.CONFLICT, code: "DEADLOCK", message: "Concurrent update conflict. Please retry." };
      }
      /* A guard trigger refused the write (SQLSTATE 45000 / errno 1644).
       *
       * These are the platform's own invariants enforced at the database — an
       * append-only ledger, a non-negative balance, a commission level inside the
       * plan's depth. Left unmapped they surfaced as "500 DATABASE_ERROR", which
       * tells the caller nothing and pages an operator for what is usually a
       * caller error. The trigger's message is written as `CODE: explanation`
       * precisely so it can be split here — and it is safe to return, because
       * these messages are ours, not the driver's. */
      if (driver.errno === 1644 || driver.sqlState === "45000") {
        const raw = (driver as { sqlMessage?: string }).sqlMessage ?? driver.message ?? "";
        const [code, ...rest] = raw.split(":");
        const detail = rest.join(":").trim();
        return {
          status: HttpStatus.CONFLICT,
          code: /^[A-Z_]+$/.test(code.trim()) ? code.trim() : "INVARIANT_VIOLATION",
          message: detail.length > 0 ? detail : "The database refused this change",
        };
      }
      // Anything else is ours, not theirs — and the driver message stays server-side.
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: "DATABASE_ERROR",
        message: "A database error occurred",
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    };
  }

  /**
   * Recognises the http-errors convention used by body-parser and friends.
   *
   * Only 4xx is mapped: a 5xx from a library is still ours to investigate, and
   * its message stays server-side. The `type` field carries the useful part
   * ("entity.too.large", "entity.parse.failed"), and it is safe to return — it
   * describes the request, not the system.
   */
  private asHttpError(
    e: unknown,
  ): { status: number; code: string; message: string } | null {
    if (typeof e !== "object" || e === null) return null;
    const err = e as { status?: unknown; statusCode?: unknown; type?: unknown; expose?: unknown };
    const status = typeof err.status === "number" ? err.status : typeof err.statusCode === "number" ? err.statusCode : null;
    if (status === null || status < 400 || status >= 500) return null;

    const type = typeof err.type === "string" ? err.type : "";
    const known: Record<string, { code: string; message: string }> = {
      "entity.too.large": {
        code: "PAYLOAD_TOO_LARGE",
        message: "The request body is larger than this endpoint accepts",
      },
      "entity.parse.failed": {
        code: "MALFORMED_BODY",
        message: "The request body is not valid JSON",
      },
      "encoding.unsupported": {
        code: "UNSUPPORTED_ENCODING",
        message: "The request encoding is not supported",
      },
      "charset.unsupported": {
        code: "UNSUPPORTED_CHARSET",
        message: "The request charset is not supported",
      },
    };

    const mapped = known[type];
    return {
      status,
      code: mapped?.code ?? this.codeFor(status),
      message: mapped?.message ?? "The request could not be processed",
    };
  }

  private rest(obj: Record<string, unknown>): unknown {
    const { message, statusCode, code, ...rest } = obj;
    return Object.keys(rest).length ? rest : undefined;
  }

  private codeFor(status: number): string {
    return (
      {
        400: "BAD_REQUEST", 401: "UNAUTHORIZED", 402: "PAYMENT_REQUIRED", 403: "FORBIDDEN",
        404: "NOT_FOUND", 409: "CONFLICT", 410: "GONE", 422: "UNPROCESSABLE", 423: "LOCKED",
        429: "RATE_LIMITED", 500: "INTERNAL_ERROR", 502: "BAD_GATEWAY", 503: "UNAVAILABLE",
      } as Record<number, string>
    )[status] ?? "ERROR";
  }
}
