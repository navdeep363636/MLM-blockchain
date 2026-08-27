/* ============================================================================
 * One error type for everything the API can refuse.
 *
 * The backend answers every failure with the same envelope:
 *
 *   { statusCode, code, message, details?, requestId?, timestamp, path }
 *
 * so the UI can branch on a stable `code` instead of matching on prose. That
 * matters more than it sounds: a message is copy and will be rewritten, while
 * `INSUFFICIENT_BALANCE` is a contract. Anything that reads a message to decide
 * what to do breaks the first time someone improves the wording.
 *
 * `requestId` is carried through to the surface deliberately. When a member says
 * "it said something went wrong", that id is the only thing that connects their
 * screenshot to a line in the server log.
 * ========================================================================== */

export interface ApiErrorBody {
  statusCode?: number;
  code?: string;
  message?: string | string[];
  details?: unknown;
  requestId?: string;
  timestamp?: string;
  path?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;
  /** Seconds to wait, from Retry-After. Only set on a 429. */
  readonly retryAfter?: number;

  constructor(status: number, body: ApiErrorBody, retryAfter?: number) {
    super(ApiError.messageOf(body, status));
    this.name = "ApiError";
    this.status = status;
    this.code = body.code ?? ApiError.codeForStatus(status);
    this.details = body.details;
    this.requestId = body.requestId;
    this.retryAfter = retryAfter;
  }

  /** Validation failures arrive as an array of strings. Join them, don't drop them. */
  private static messageOf(body: ApiErrorBody, status: number): string {
    const { message } = body;
    if (Array.isArray(message)) return message.join(" ");
    if (typeof message === "string" && message.length > 0) return message;
    return `Request failed with status ${status}`;
  }

  private static codeForStatus(status: number): string {
    if (status === 0) return "NETWORK_ERROR";
    if (status === 401) return "UNAUTHENTICATED";
    if (status === 403) return "FORBIDDEN";
    if (status === 404) return "NOT_FOUND";
    if (status === 409) return "CONFLICT";
    if (status === 429) return "RATE_LIMITED";
    return status >= 500 ? "SERVER_ERROR" : "REQUEST_FAILED";
  }

  /* ----------------------------- classification ---------------------------- */

  /** The session is gone or was never there. The caller should sign the user out. */
  get isAuthFailure(): boolean {
    return this.status === 401;
  }

  /** Authenticated, but not allowed. Never retry, and never re-prompt for a password. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** Field-level validation. `fieldProblems` has the detail worth showing. */
  get isValidation(): boolean {
    return this.status === 400 || this.status === 422;
  }

  /**
   * A database guard refused the change — an append-only ledger, a negative
   * balance, a published document being edited. These arrive as 409 with the
   * trigger's own code, and they are not retryable: the answer will be the same
   * next time. Distinguishing them from an ordinary conflict matters because an
   * ordinary conflict often IS retryable after a refresh.
   */
  get isInvariantViolation(): boolean {
    return this.status === 409 && /^[A-Z_]+$/.test(this.code) && this.code !== "CONFLICT";
  }

  /** Worth trying again unattended: transport, rate limit, or a server fault. */
  get isRetryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }

  /**
   * Validation problems as a flat list, whatever shape the server used.
   *
   * Three shapes appear in practice: `details` as an array of strings from the
   * global validation pipe, `details.problems` from the password policy, and a
   * bare `message` array. The UI should not have to know which.
   */
  get fieldProblems(): string[] {
    const out: string[] = [];
    const d = this.details;
    if (Array.isArray(d)) {
      out.push(...d.filter((x): x is string => typeof x === "string"));
    } else if (d && typeof d === "object") {
      const problems = (d as { problems?: unknown }).problems;
      if (Array.isArray(problems)) {
        for (const p of problems) {
          if (typeof p === "string") out.push(p);
          else if (p && typeof p === "object" && typeof (p as { message?: unknown }).message === "string") {
            out.push((p as { message: string }).message);
          }
        }
      }
    }
    return out;
  }
}

/** Type guard, so a catch block can narrow without an instanceof across bundles. */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError || (typeof err === "object" && err !== null && (err as { name?: string }).name === "ApiError");
}

/**
 * The sentence to put in front of a person.
 *
 * The server's message is written for a member and is preferred. The fallbacks
 * exist for the cases where there is no server message at all — a dropped
 * connection has no envelope — and they avoid blaming the user for a fault that
 * is ours.
 */
export function humanMessage(err: unknown): string {
  if (!isApiError(err)) {
    return err instanceof Error && err.message ? err.message : "Something went wrong. Please try again.";
  }
  if (err.status === 0) {
    return "Can't reach the server. Check your connection and try again.";
  }
  if (err.status === 429) {
    const wait = err.retryAfter ? ` Try again in ${err.retryAfter}s.` : "";
    return `Too many attempts.${wait}`;
  }
  if (err.status >= 500) {
    const ref = err.requestId ? ` Reference ${err.requestId}.` : "";
    return `Something went wrong on our side.${ref}`;
  }
  return err.message;
}
