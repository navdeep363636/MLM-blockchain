import { BadRequestException, ConflictException, Logger } from "@nestjs/common";
import { QueryFailedError } from "typeorm";
import { AllExceptionsFilter, type ErrorBody } from "./all-exceptions.filter";

/* ============================================================================
 * One error shape for the whole API, and one rule: internal detail never
 * reaches the client. The cases below are the ones that have gone wrong —
 * a driver message leaking a column name, and a library rejection arriving as a
 * 500 because it was not an HttpException.
 * ========================================================================== */

function run(exception: unknown): { status: number; body: ErrorBody } {
  const filter = new AllExceptionsFilter();
  let status = 0;
  let body = {} as ErrorBody;

  const res = {
    status: (s: number) => {
      status = s;
      return { json: (b: ErrorBody) => { body = b; } };
    },
  };
  const req = { id: "req-1", method: "POST", originalUrl: "/api/v1/thing", url: "/api/v1/thing" };

  filter.catch(exception, {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as never);

  return { status, body };
}

describe("AllExceptionsFilter", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("keeps the service's machine-readable code and message", () => {
    const { status, body } = run(
      new ConflictException({ code: "INSUFFICIENT_BALANCE", message: "Insufficient available MTT balance" }),
    );
    expect(status).toBe(409);
    expect(body.code).toBe("INSUFFICIENT_BALANCE");
    expect(body.message).toBe("Insufficient available MTT balance");
  });

  it("surfaces extra hints as details, which the UI needs for its timers", () => {
    const { body } = run(
      new BadRequestException({ code: "OTP_INVALID", message: "That code is not valid", attemptsRemaining: 3 }),
    );
    expect(body.details).toEqual({ attemptsRemaining: 3 });
  });

  it("collapses a validation array into details with a stable message", () => {
    const { body } = run(new BadRequestException({ message: ["email must be an email", "phone is required"] }));
    expect(body.message).toBe("Validation failed");
    expect(body.details).toEqual(["email must be an email", "phone is required"]);
  });

  it("maps an oversized body to 413, not 500", () => {
    /* body-parser throws an http-error, not an HttpException — nothing wraps it,
     * so before this mapping existed the client got "500 INTERNAL_ERROR" for its
     * own mistake, and an operator got paged. */
    const tooLarge = Object.assign(new Error("request entity too large"), {
      status: 413, statusCode: 413, type: "entity.too.large", expose: true,
    });
    const { status, body } = run(tooLarge);
    expect(status).toBe(413);
    expect(body.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("maps malformed JSON to 400", () => {
    const bad = Object.assign(new SyntaxError("Unexpected token } in JSON"), {
      status: 400, type: "entity.parse.failed", expose: true,
    });
    const { status, body } = run(bad);
    expect(status).toBe(400);
    expect(body.code).toBe("MALFORMED_BODY");
    /* And the parser's message, which quotes the request body, stays out. */
    expect(body.message).not.toMatch(/Unexpected token/);
  });

  it("does NOT trust a library's 5xx as a client error", () => {
    const upstream = Object.assign(new Error("socket hang up"), { status: 502 });
    const { status, body } = run(upstream);
    expect(status).toBe(500);
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.message).not.toMatch(/socket/);
  });

  it("translates a duplicate-key violation without naming the index", () => {
    const dup = new QueryFailedError("INSERT INTO users", [], Object.assign(new Error("Duplicate entry 'a@b' for key 'uq_users_emailHash'"), { code: "ER_DUP_ENTRY" }));
    const { status, body } = run(dup);
    expect(status).toBe(409);
    expect(body.code).toBe("DUPLICATE");
    expect(JSON.stringify(body)).not.toMatch(/uq_users_emailHash|a@b/);
  });

  it("maps a guard trigger's refusal to a 409 with its own code", () => {
    /* The database enforces the platform's invariants too — an append-only
     * ledger, a non-negative balance. Unmapped, those refusals surfaced as
     * "500 DATABASE_ERROR": no use to the caller, and a page for an operator
     * over what is usually a caller error. */
    const refused = new QueryFailedError("UPDATE points_ledger", [], Object.assign(
      new Error("LEDGER_IMMUTABLE: points_ledger rows cannot be updated. Post a reversal entry instead."),
      {
        errno: 1644,
        sqlState: "45000",
        sqlMessage: "LEDGER_IMMUTABLE: points_ledger rows cannot be updated. Post a reversal entry instead.",
      },
    ));

    const { status, body } = run(refused);

    expect(status).toBe(409);
    expect(body.code).toBe("LEDGER_IMMUTABLE");
    expect(body.message).toContain("Post a reversal entry instead");
  });

  it("falls back to a generic code when a trigger message has no code prefix", () => {
    const refused = new QueryFailedError("UPDATE x", [], Object.assign(new Error("nope"), {
      errno: 1644, sqlState: "45000", sqlMessage: "nope",
    }));
    const { status, body } = run(refused);
    expect(status).toBe(409);
    expect(body.code).toBe("INVARIANT_VIOLATION");
  });

  it("hides any other database error entirely", () => {
    const broken = new QueryFailedError("SELECT * FROM users", [], Object.assign(new Error("Unknown column 'users.secret_column'"), { code: "ER_BAD_FIELD_ERROR" }));
    const { status, body } = run(broken);
    expect(status).toBe(500);
    expect(body.code).toBe("DATABASE_ERROR");
    expect(JSON.stringify(body)).not.toMatch(/secret_column/);
  });

  it("stamps every error with the request id and path, so a report can be traced", () => {
    const { body } = run(new ConflictException({ code: "X", message: "y" }));
    expect(body.requestId).toBe("req-1");
    expect(body.path).toBe("/api/v1/thing");
    expect(Date.parse(body.timestamp)).not.toBeNaN();
  });
});
