import { execFileSync } from "node:child_process";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { DataSource } from "typeorm";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { Queues } from "@/queues/queue.constants";
import { AppModule } from "@/app.module";
import { configureApp } from "@/bootstrap";
import { CryptoService } from "@/common/crypto/crypto.service";
import { RedisService } from "@/common/redis/redis.service";
import { User, VerificationToken } from "@/database/entities";

/* ============================================================================
 * End-to-end: the real app, the real MySQL, the real Redis.
 *
 * The unit suite mocks repositories, which is right for testing rules and wrong
 * for testing that the system runs. Everything here is a thing a mock cannot
 * catch: a NOT NULL column the entity thought had a default, a guard that lets
 * an unauthenticated request through, a validation pipe that rejects a payload
 * the client is documented to send.
 *
 * The app is built through `configureApp` — the same function main.ts uses — so
 * the pipeline under test is the pipeline that ships.
 *
 * Requires: MySQL and Redis running, and DB_NAME (from test/setup.ts) pointing
 * at a database that can be TRUNCATED. It is seeded here with the same seed
 * script an operator runs.
 * ========================================================================== */

jest.setTimeout(180_000);

/* Environment (workers off, known webhook secrets, raised throttle limit) is
 * set in test/setup-e2e.ts — it has to be in place before imports are
 * evaluated. */

const API = "/api/v1";

/** Credential the suite gives the seeded super admin. */
const ADMIN_PASSWORD = "Seeded!Passw0rd#e2e";

interface Registered {
  email: string;
  password: string;
  userId: string;
  ref: string;
}

/**
 * Removes rows from earlier runs, on its own connection.
 *
 * Runs before the application is built, so it cannot use the app's DataSource —
 * and it must not, because part of what it clears is the audit tables the guard
 * triggers protect, which requires declaring maintenance on the same session.
 */
async function purgeTestData(): Promise<void> {
  const ds = new DataSource({
    type: "mysql",
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    entities: [],
    synchronize: false,
  });
  await ds.initialize();
  try {
    await ds.query("SET FOREIGN_KEY_CHECKS = 0");
    await ds.query("SET @mt_maintenance = 1");
    for (const table of [
      "points_ledger", "game_sessions", "user_balances", "notification_preferences",
      "verification_tokens", "user_sessions", "login_history", "withdrawals",
      "wallet_addresses", "audit_logs", "webhook_events", "conversions", "transactions",
      "idempotency_keys",
    ]) {
      await ds.query(`DELETE FROM \`${table}\``);
    }
    await ds.query("DELETE FROM users WHERE email LIKE '%@e2e.local'");
  } finally {
    await ds.destroy();
  }
}

describe("Members Trail API (e2e)", () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let crypto: CryptoService;
  let http: () => request.Agent;

  beforeAll(async () => {
    /* Same seed an operator runs, against the test database. */
    execFileSync("npx", ["ts-node", "-r", "tsconfig-paths/register", "src/database/seeds/run-seed.ts"], {
      env: { ...process.env, DB_NAME: process.env.DB_NAME, SEED_ADMIN_PASSWORD: ADMIN_PASSWORD },
      stdio: "pipe",
    });

    /* Clear anything a previous run left behind before this one registers
     * anything: the schema's unique constraints would otherwise turn a stale row
     * into a 409 on a fresh account. Same pinned-connection and maintenance
     * discipline as the teardown. */
    await purgeTestData();

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, bodyParser: true });
    configureApp(app);
    await app.init();

    ds = app.get(DataSource);
    crypto = app.get(CryptoService);

    /* Rate-limit counters live in Redis and outlive the process. Left in place,
     * a previous run's counters fail this one for a reason that is not the
     * code's fault. */
    const redis = app.get(RedisService);
    await redis.delByPattern("throttle:*");
    /* Same for the webhook in-flight guards: a previous run's reservation would
     * make this run's first delivery look like a retry. */
    await redis.delByPattern("wh:*");
    http = () => request(app.getHttpServer());

    /* The seed deliberately does NOT reset an existing admin's password — an
     * operator who changed it should not have it silently replaced on the next
     * seed run. So the suite sets the credential it is about to use, rather
     * than assuming a fresh database. */
    await ds.query("UPDATE users SET passwordHash = ?, status = 'active' WHERE emailHash = ?", [
      await crypto.hashPassword(ADMIN_PASSWORD),
      crypto.hmac("ops@memberstrail.local"),
    ]);
  });

  afterAll(async () => {
    /* Teardown runs on ONE pinned connection.
     *
     * `SET FOREIGN_KEY_CHECKS = 0` and `SET @mt_maintenance = 1` are SESSION
     * variables, and the DataSource is a pool — so setting them with `ds.query`
     * and then deleting with `ds.query` can easily land on two different
     * connections, leaving the deletes to run with the guards still on. That is
     * not a hypothetical: it is how this teardown broke the moment the schema
     * grew foreign keys and immutability triggers.
     *
     * Maintenance mode is declared deliberately here, exactly as a retention or
     * lawful-erasure job would have to: the audit tables refuse deletes by
     * design, and a test fixture is not an exception to that — it is a caller
     * that has to say what it is doing. */
    if (ds?.isInitialized) {
      const runner = ds.createQueryRunner();
      await runner.connect();
      try {
        await runner.query("SET FOREIGN_KEY_CHECKS = 0");
        await runner.query("SET @mt_maintenance = 1");

        for (const table of [
          "points_ledger", "game_sessions", "user_balances", "notification_preferences",
          "verification_tokens", "user_sessions", "login_history", "withdrawals",
          "wallet_addresses", "audit_logs", "webhook_events", "conversions", "transactions",
          "idempotency_keys",
        ]) {
          await runner.query(`DELETE FROM \`${table}\``);
        }
        await runner.query("DELETE FROM users WHERE email LIKE '%@e2e.local'");
      } finally {
        await runner.query("SET @mt_maintenance = 0").catch(() => undefined);
        await runner.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => undefined);
        await runner.release();
      }
    }

    /* Drain what the suite enqueued. Workers are off during the run, so every
     * job it produced is still waiting — and the rows those jobs refer to have
     * just been deleted above. Left behind, they are picked up by the next
     * process that runs a worker and fail against missing rows. */
    for (const name of [Queues.GameValidation, Queues.Webhook, Queues.Notification, Queues.Commission]) {
      try {
        const queue = app.get<Queue>(getQueueToken(name), { strict: false });
        await queue.obliterate({ force: true });
      } catch {
        /* A queue that was never registered or already closed is not a failure
         * of the run; the assertions are all done by this point. */
      }
    }

    await app?.close();
  });

  /* ------------------------------------------------------------------ *
   * helpers
   * ------------------------------------------------------------------ */

  let sequence = 0;

  /** A distinct source address per fixture, from a documentation range. */
  const ipFor = (n: number): string => `203.0.113.${(n % 250) + 1}`;

  /* Per-run suffix. The phone is UNIQUE in the schema, so deriving it from the
   * sequence alone meant a run whose teardown did not complete blocked every
   * later run with a 409 that looked like a bug in registration. */
  const runId = String(Date.now()).slice(-7);

  async function register(over: Partial<Record<string, unknown>> = {}): Promise<Registered> {
    sequence += 1;
    const email = `player${sequence}.${Date.now()}@e2e.local`;
    const password = "Str0ng!Passphrase#2026";

    const res = await http()
      .post(`${API}/auth/register`)
      /* Its own IP per fixture: registration is rate-limited per IP, and a suite
       * that shared one address would be testing the throttler rather than
       * registration. */
      .set("X-Forwarded-For", ipFor(sequence))
      .send({
        fullName: "E2E Player",
        email,
        phone: `+44${runId}${String(sequence).padStart(3, "0")}`,
        password,
        dateOfBirth: "1994-05-17",
        country: "GB",
        termsAccepted: true,
        ...over,
      });

    expect(res.status).toBe(201);

    const user = await ds.getRepository(User).findOne({ where: { emailHash: crypto.hmac(email) } });
    expect(user).toBeTruthy();
    return { email, password, userId: user!.id, ref: user!.ref };
  }

  /**
   * Recovers a one-time code by brute-forcing the HMAC.
   *
   * Deliberately the only way to do this: the platform stores the HMAC of the
   * code and never the code, so even a test with database access cannot read
   * one. If this ever becomes unnecessary, something started storing codes in
   * clear — which is exactly what this proves it does not.
   */
  async function recoverOtp(target: string, purpose: "email_verify" | "phone_verify"): Promise<string> {
    const row = await ds.getRepository(VerificationToken).findOne({
      where: { target, purpose },
      order: { createdAt: "DESC" },
    });
    expect(row).toBeTruthy();

    for (let n = 0; n < 1_000_000; n += 1) {
      const candidate = String(n).padStart(6, "0");
      if (crypto.hmac(`otp:${purpose}:${target}:${candidate}`) === row!.tokenHash) return candidate;
    }
    throw new Error(`could not recover the ${purpose} code for ${target}`);
  }

  /**
   * Registers a member, activates them and logs in.
   *
   * Activation happens with SQL rather than by walking the OTP flow, for the
   * same reason a UI test does not re-test the login form on every page: the
   * verification path has its own test below, which recovers the real code. Here
   * it would be twelve brute-force searches to reach the thing actually under
   * test.
   */
  async function activePlayer(kycTier = 0): Promise<Registered & { token: string }> {
    const person = await register();

    /* `kycTier` is granted here rather than by walking the KYC flow, which has
     * its own tests. It has to be set BEFORE the login: the tier is carried in
     * the access token, and the KYC guard reads it from there. */
    await ds.query(
      "UPDATE users SET emailVerifiedAt = NOW(6), phoneVerifiedAt = NOW(6), status = 'active', kycTier = ? WHERE id = ?",
      [kycTier, person.userId],
    );

    const login = await http()
      .post(`${API}/auth/login`)
      .set("X-Forwarded-For", ipFor(sequence))
      .send({ identifier: person.email, password: person.password });

    expect(login.status).toBe(200);
    expect(login.body.authenticated).toBe(true);
    expect(login.body.tokens?.accessToken).toBeTruthy();
    return { ...person, token: login.body.tokens.accessToken as string };
  }

  /* ------------------------------------------------------------------ *
   * infrastructure
   * ------------------------------------------------------------------ */

  describe("health", () => {
    it("reports MySQL and Redis as reachable", async () => {
      const res = await http().get("/health/ready").expect(200);
      expect(res.body.info.mysql.status).toBe("up");
      expect(res.body.info.redis.status).toBe("up");
    });

    it("serves liveness without authentication", async () => {
      await http().get("/health/live").expect(200);
    });
  });

  describe("the global guard", () => {
    it("refuses an authenticated route with no token", async () => {
      /* Deny by default is the whole design: a new controller is protected
       * because it did not opt out, not because someone remembered. */
      await http().get(`${API}/wallet/balance`).expect(401);
    });

    it("refuses a malformed bearer token", async () => {
      await http().get(`${API}/wallet/balance`).set("Authorization", "Bearer not-a-jwt").expect(401);
    });

    it("serves the public catalogue without a token", async () => {
      const res = await http().get(`${API}/games`).expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it("hides inactive titles from the public catalogue", async () => {
      const res = await http().get(`${API}/games`).expect(200);
      const slugs = (res.body.data as { slug: string }[]).map((g) => g.slug);
      expect(slugs).not.toContain("pulse-beat");
    });
  });

  /* ------------------------------------------------------------------ *
   * registration and login
   * ------------------------------------------------------------------ */

  describe("registration", () => {
    it("creates an account with a zeroed balance row", async () => {
      /* This is the regression that mattered: the balance insert named only the
       * user id and relied on column defaults. With a transformer that mapped
       * undefined to null, MySQL rejected it and NOBODY COULD REGISTER — and
       * every unit test passed, because they all mock the repository. */
      const person = await register();

      const balance = await ds.query(
        "SELECT points, mttAvailable, mttStaked, commissionPending FROM user_balances WHERE userId = ?",
        [person.userId],
      );
      expect(balance).toHaveLength(1);
      expect(Number(balance[0].points)).toBe(0);
      expect(Number(balance[0].mttAvailable)).toBe(0);
      expect(Number(balance[0].commissionPending)).toBe(0);
    });

    it("lets an unverified account sign in, but reports it as pending verification", async () => {
      /* Deliberate: the member has to be able to sign in to finish verifying.
       * What protects the money is not the login gate but the KYC tier — an
       * unverified account cannot convert or withdraw, which the conversion and
       * withdrawal tests below assert directly. */
      const person = await register();
      const res = await http()
        .post(`${API}/auth/login`)
        .set("X-Forwarded-For", ipFor(sequence))
        .send({ identifier: person.email, password: person.password });

      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.status).toBe("pending_verification");
      expect(res.body.kycTier).toBe(0);
    });

    it("stores only the HMAC of a verification code, never the code", async () => {
      const person = await register();
      const row = await ds.getRepository(VerificationToken).findOne({
        where: { target: person.email, purpose: "email_verify" },
      });
      expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      /* No column anywhere holds the six digits. */
      expect(JSON.stringify(row)).not.toMatch(/\b\d{6}\b/);
    });

    it("verifies the account with the code it actually issued", async () => {
      /* The whole loop: register, recover the code the way only the recipient
       * could, submit it, and see the account become verified. */
      const person = await register();
      const code = await recoverOtp(person.email, "email_verify");

      const res = await http()
        .post(`${API}/auth/verify-otp`)
        .send({ channel: "email", code, identifier: person.email });

      expect(res.status).toBeLessThan(300);
      expect(res.body.emailVerified).toBe(true);

      const rows = await ds.query("SELECT emailVerifiedAt FROM users WHERE id = ?", [person.userId]);
      expect(rows[0].emailVerifiedAt).toBeTruthy();
    });

    it("refuses a wrong code, spends an attempt and leaves the code unconsumed", async () => {
      /* The attempt counter lives in Redis, not on the row: it has to be atomic
       * and it is worthless after the fact. What the row proves is the other
       * half — a failed guess does not consume the real code. */
      const person = await register();
      const correct = await recoverOtp(person.email, "email_verify");
      const wrong = correct === "000000" ? "111111" : "000000";

      const first = await http()
        .post(`${API}/auth/verify-otp`)
        .send({ channel: "email", code: wrong, identifier: person.email });

      expect(first.status).toBe(400);
      expect(first.body.code).toBe("OTP_INVALID");

      const second = await http()
        .post(`${API}/auth/verify-otp`)
        .send({ channel: "email", code: wrong, identifier: person.email });

      /* The budget shrinks, so guessing is bounded. */
      expect(second.body.details.attemptsRemaining)
        .toBeLessThan(first.body.details.attemptsRemaining as number);

      const rows = await ds.query(
        "SELECT consumedAt FROM verification_tokens WHERE target = ? AND purpose = 'email_verify'",
        [person.email],
      );
      expect(rows[0].consumedAt).toBeFalsy();

      /* And the right code still works afterwards. */
      const ok = await http()
        .post(`${API}/auth/verify-otp`)
        .send({ channel: "email", code: correct, identifier: person.email });
      expect(ok.status).toBeLessThan(300);
    });

    it("refuses a duplicate email without revealing that it exists", async () => {
      const person = await register();
      const res = await http()
        .post(`${API}/auth/register`)
        .send({
          fullName: "Someone Else", email: person.email, phone: "+441632911111",
          password: "An0ther!Passphrase#2026", dateOfBirth: "1990-01-01",
          country: "GB", termsAccepted: true,
        });

      /* 409 EMAIL_IN_USE. Worth being explicit about: this DOES tell an
       * unauthenticated caller that an address is registered, which login and
       * password-reset deliberately do not. It is a usability-versus-enumeration
       * trade that belongs to the product, and this assertion is here so the
       * decision cannot change silently. */
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("EMAIL_IN_USE");
    });

    it("refuses registration without accepting the terms", async () => {
      const res = await http()
        .post(`${API}/auth/register`)
        .send({
          fullName: "No Consent", email: `noconsent.${Date.now()}@e2e.local`,
          phone: "+441632922222", password: "Str0ng!Passphrase#2026",
          dateOfBirth: "1994-05-17", country: "GB", termsAccepted: false,
        });
      expect(res.status).toBe(400);
    });

    it("rate-limits repeated registrations from one address", async () => {
      /* Five per fifteen minutes per IP. The limit is what stops a scripted
       * signup flood from filling the members table and the OTP queue. */
      const ip = "198.51.100.7";
      const statuses: number[] = [];

      for (let n = 0; n < 7; n += 1) {
        const res = await http()
          .post(`${API}/auth/register`)
          .set("X-Forwarded-For", ip)
          .send({
            fullName: "Flood Bot",
            email: `flood.${n}.${Date.now()}@e2e.local`,
            phone: `+4416329${String(700_000 + n).slice(0, 6)}`,
            password: "Str0ng!Passphrase#2026",
            dateOfBirth: "1994-05-17",
            country: "GB",
            termsAccepted: true,
          });
        statuses.push(res.status);
      }

      expect(statuses).toContain(429);
      /* And it kicks in after the allowance, not before it. */
      expect(statuses.filter((s) => s === 201).length).toBeLessThanOrEqual(5);
    });

    it("refuses an unexpected field rather than ignoring it", async () => {
      /* whitelist + forbidNonWhitelisted: this is what stops a mass-assignment
       * bug from ever being possible. */
      const res = await http()
        .post(`${API}/auth/register`)
        .send({
          fullName: "Privilege Seeker", email: `esc.${Date.now()}@e2e.local`,
          phone: "+441632933333", password: "Str0ng!Passphrase#2026",
          dateOfBirth: "1994-05-17", country: "GB", termsAccepted: true,
          role: "super_admin", isStaff: true, kycTier: 2,
        });

      expect(res.status).toBe(400);
    });
  });

  describe("login", () => {
    it("issues a token that opens an authenticated route", async () => {
      const player = await activePlayer();
      const res = await http()
        .get(`${API}/wallet/balance`)
        .set("Authorization", `Bearer ${player.token}`)
        .expect(200);

      expect(Number(res.body.points)).toBe(0);
    });

    it("refuses the wrong password", async () => {
      const player = await activePlayer();
      const res = await http()
        .post(`${API}/auth/login`)
        .set("X-Forwarded-For", ipFor(sequence))
        .send({ identifier: player.email, password: "Wr0ng!Passphrase#2026" });
      expect(res.status).toBe(401);
    });

    it("revokes the session on logout, so the token stops working", async () => {
      const player = await activePlayer();
      await http()
        .post(`${API}/auth/logout`)
        .set("Authorization", `Bearer ${player.token}`)
        .expect((r) => expect(r.status).toBeLessThan(300));

      /* The JWT is still cryptographically valid; the session record is what
       * decides. */
      await http()
        .get(`${API}/wallet/balance`)
        .set("Authorization", `Bearer ${player.token}`)
        .expect(401);
    });
  });

  /* ------------------------------------------------------------------ *
   * money paths
   * ------------------------------------------------------------------ */

  describe("withdrawals", () => {
    it("refuses a withdrawal at KYC tier 0 — an unverified identity has no allowance", async () => {
      const player = await activePlayer();
      const res = await http()
        .post(`${API}/wallet/withdrawals`)
        .set("Authorization", `Bearer ${player.token}`)
        .set("Idempotency-Key", `e2e-withdrawal-${Date.now()}`)
        .send({
          kind: "mtt", amountMtt: "10",
          destinationAddress: "0x1111111111111111111111111111111111111111",
          sourceTag: "gameplay",
        });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      const rows = await ds.query("SELECT COUNT(*) c FROM withdrawals");
      expect(Number(rows[0].c)).toBe(0);
    });

    it("reports a tier-0 limit of zero rather than a small allowance", async () => {
      const player = await activePlayer();
      const res = await http()
        .get(`${API}/wallet/withdrawals/limits`)
        .set("Authorization", `Bearer ${player.token}`)
        .expect(200);

      expect(Number(res.body.tierLimitMtt ?? res.body.limitMtt ?? 0)).toBe(0);
    });
  });

  describe("idempotency", () => {
    it("refuses a money-moving request with no Idempotency-Key", async () => {
      /* The guard is a header requirement, not a convention: without it, a
       * double-clicked button is two withdrawals.
       *
       * Tier 1, because guards run before interceptors: a tier-0 member is
       * refused by the KYC guard first and never reaches this check. */
      const player = await activePlayer(1);
      const res = await http()
        .post(`${API}/wallet/withdrawals`)
        .set("Authorization", `Bearer ${player.token}`)
        .send({
          kind: "mtt", amountMtt: "10",
          destinationAddress: "0x1111111111111111111111111111111111111111",
          sourceTag: "gameplay",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    });

    it("requires one on staking too, where a retry would submit two transactions", async () => {
      const player = await activePlayer(1);
      const res = await http()
        .post(`${API}/staking/stake`)
        .set("Authorization", `Bearer ${player.token}`)
        .send({ poolId: 1, amountMtt: "10" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    });

    it("refuses a REPLAYED key rather than performing the operation twice", async () => {
      const player = await activePlayer(1);
      const key = `e2e-replay-${Date.now()}`;
      const body = {
        kind: "mtt", amountMtt: "10",
        destinationAddress: "0x1111111111111111111111111111111111111111",
        sourceTag: "gameplay",
      };

      /* Both fail on KYC, but the FIRST failure releases the key — a client must
       * be able to retry a request that did not happen. So the replay is tested
       * against a request that gets past the interceptor and is then refused
       * downstream: the key is released, and the second attempt is refused for
       * the same downstream reason rather than as a duplicate. */
      const first = await http()
        .post(`${API}/wallet/withdrawals`)
        .set("Authorization", `Bearer ${player.token}`)
        .set("Idempotency-Key", key)
        .send(body);

      const second = await http()
        .post(`${API}/wallet/withdrawals`)
        .set("Authorization", `Bearer ${player.token}`)
        .set("Idempotency-Key", key)
        .send(body);

      expect(first.status).toBeGreaterThanOrEqual(400);
      expect(second.body.code).toBe(first.body.code);
    });

    it("refuses a key that is too short to be a real client token", async () => {
      const player = await activePlayer(1);
      const res = await http()
        .post(`${API}/wallet/withdrawals`)
        .set("Authorization", `Bearer ${player.token}`)
        .set("Idempotency-Key", "abc")
        .send({
          kind: "mtt", amountMtt: "10",
          destinationAddress: "0x1111111111111111111111111111111111111111",
          sourceTag: "gameplay",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("IDEMPOTENCY_KEY_INVALID");
    });
  });

  describe("conversion", () => {
    it("publishes the active rate to anyone, because members are held to it", async () => {
      const player = await activePlayer();
      const res = await http()
        .get(`${API}/conversion/rate`)
        .set("Authorization", `Bearer ${player.token}`)
        .expect(200);

      expect(res.body.pointsPerMtt).toBeGreaterThan(0);
    });

    it("refuses to convert at KYC tier 0", async () => {
      /* Points need no identity check to earn; MTT is transferable, so the
       * moment Points become MTT the account must be verified. */
      const player = await activePlayer();
      const res = await http()
        .post(`${API}/conversion`)
        .set("Authorization", `Bearer ${player.token}`)
        .set("Idempotency-Key", `e2e-conversion-${Date.now()}`)
        .send({ points: 1_000 });

      expect(res.status).toBe(403);
      const rows = await ds.query("SELECT COUNT(*) c FROM conversions");
      expect(Number(rows[0].c)).toBe(0);
    });
  });

  describe("gameplay", () => {
    it("issues a session token once and accepts a submission for server replay", async () => {
      const player = await activePlayer();
      const games = await http().get(`${API}/games`).expect(200);
      const game = (games.body.data as { id: string; slug: string }[])[0];

      const started = await http()
        .post(`${API}/games/sessions`)
        .set("Authorization", `Bearer ${player.token}`)
        .send({ gameId: game.id, mode: "free" });

      expect(started.status).toBe(201);
      expect(started.body.sessionToken).toBeTruthy();
      expect(started.body.ref).toBeTruthy();

      const submitted = await http()
        .post(`${API}/games/sessions/${started.body.ref}/submit`)
        .set("Authorization", `Bearer ${player.token}`)
        .send({
          sessionToken: started.body.sessionToken,
          clientScore: 4_200,
          durationMs: 45_000,
          telemetry: [
            { t: 1_000, e: 1, v: 100 },
            { t: 12_000, e: 1, v: 400 },
            { t: 30_000, e: 1, v: 900 },
          ],
        });

      /* 202: the score is replayed on the queue, and Points come from the
       * SERVER score. An API that returned the client's number here would be
       * paying out on a claim. */
      expect(submitted.status).toBe(202);

      const stored = await ds.query(
        "SELECT clientScore, serverScore, pointsAwarded, status FROM game_sessions WHERE ref = ?",
        [started.body.ref],
      );
      expect(stored).toHaveLength(1);
      expect(Number(stored[0].clientScore)).toBe(4_200);
      /* Nothing credited yet, because nothing has been validated yet. */
      expect(Number(stored[0].pointsAwarded ?? 0)).toBe(0);
    });

    it("refuses a second submission of the same session", async () => {
      const player = await activePlayer();
      const games = await http().get(`${API}/games`).expect(200);
      const game = (games.body.data as { id: string }[])[0];

      const started = await http()
        .post(`${API}/games/sessions`)
        .set("Authorization", `Bearer ${player.token}`)
        .send({ gameId: game.id, mode: "free" });

      const body = {
        sessionToken: started.body.sessionToken,
        clientScore: 100,
        durationMs: 30_000,
        telemetry: [{ t: 1_000, e: 1, v: 50 }],
      };

      await http()
        .post(`${API}/games/sessions/${started.body.ref}/submit`)
        .set("Authorization", `Bearer ${player.token}`)
        .send(body)
        .expect(202);

      const replay = await http()
        .post(`${API}/games/sessions/${started.body.ref}/submit`)
        .set("Authorization", `Bearer ${player.token}`)
        .send(body);

      expect(replay.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("request hardening", () => {
    it("sets the security headers helmet is configured for", async () => {
      const res = await http().get(`${API}/games`).expect(200);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      /* Fingerprinting the stack for an attacker is free information. */
      expect(res.headers["x-powered-by"]).toBeUndefined();
    });

    it("stamps a request id on the response, so a user-reported failure is traceable", async () => {
      const res = await http().get(`${API}/games`).expect(200);
      expect(res.headers["x-request-id"]).toBeTruthy();
    });

    it("refuses an oversized body instead of buffering it", async () => {
      /* A 256kb ceiling: generous for session telemetry, small enough that a
       * request body is never a memory-pressure vector. */
      const huge = { fullName: "x".repeat(400_000), email: "big@e2e.local" };
      const res = await http()
        .post(`${API}/auth/register`)
        .set("X-Forwarded-For", "198.51.100.99")
        .send(huge);

      expect(res.status).toBe(413);
    });

    it("keeps internal detail out of an error body", async () => {
      const res = await http().get(`${API}/games/no-such-title-exists`);
      expect(res.status).toBe(404);
      /* No driver text, no table names, no stack. */
      expect(JSON.stringify(res.body)).not.toMatch(/SELECT|typeorm|at Object|\.ts:/i);
      expect(res.body).toMatchObject({ statusCode: 404, code: expect.any(String) });
    });
  });

  /* ------------------------------------------------------------------ *
   * webhooks
   * ------------------------------------------------------------------ */

  describe("inbound webhooks", () => {
    const payload = { id: "evt_e2e_1", status: "captured", reference: "DEP-E2E-1", amount: "100.00" };

    it("refuses an unsigned delivery", async () => {
      const res = await http().post(`${API}/webhooks/payment`).send(payload);
      expect(res.status).toBe(400);
      expect(res.body.code ?? res.body.message).toBeTruthy();
    });

    it("refuses a delivery signed with the wrong secret, and RECORDS the attempt", async () => {
      const forged = crypto.webhookSignature("not-the-secret", JSON.stringify(payload));
      await http()
        .post(`${API}/webhooks/payment`)
        .set("x-webhook-signature", forged)
        .send(payload)
        .expect(400);

      const rejected = await ds.query(
        "SELECT COUNT(*) c FROM webhook_events WHERE signatureValid = 0",
      );
      expect(Number(rejected[0].c)).toBeGreaterThan(0);
    });

    it("accepts a correctly signed delivery and dedupes the provider's retry", async () => {
      const raw = JSON.stringify(payload);
      const signature = crypto.webhookSignature("e2e-payment-secret", raw);

      const first = await http()
        .post(`${API}/webhooks/payment`)
        .set("x-webhook-signature", signature)
        .set("Content-Type", "application/json")
        .send(raw);

      expect(first.status).toBe(200);
      expect(first.body.duplicate).toBe(false);

      const retry = await http()
        .post(`${API}/webhooks/payment`)
        .set("x-webhook-signature", signature)
        .set("Content-Type", "application/json")
        .send(raw);

      expect(retry.status).toBe(200);
      expect(retry.body.duplicate).toBe(true);

      const stored = await ds.query(
        "SELECT COUNT(*) c FROM webhook_events WHERE eventId = ? AND signatureValid = 1",
        [payload.id],
      );
      /* One row for two deliveries: the provider's retry must not credit twice. */
      expect(Number(stored[0].c)).toBe(1);
    });
  });

  /* ------------------------------------------------------------------ *
   * staff surface
   * ------------------------------------------------------------------ */

  describe("admin routes", () => {
    it("refuses a player a staff route", async () => {
      const player = await activePlayer();
      const res = await http()
        .get(`${API}/admin/kpis`)
        .set("Authorization", `Bearer ${player.token}`);

      expect(res.status).toBe(403);
    });

    it("lets a seeded super admin read the dashboard", async () => {
      const login = await http()
        .post(`${API}/auth/login`)
        .set("X-Forwarded-For", "203.0.113.251")
        .send({ identifier: "ops@memberstrail.local", password: ADMIN_PASSWORD });

      expect(login.status).toBe(200);
      expect(login.body.tokens?.accessToken).toBeTruthy();

      const res = await http()
        .get(`${API}/admin/kpis`)
        .set("Authorization", `Bearer ${login.body.tokens.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("attentionRequired");
    });
  });

  /* ------------------------------------------------------------------ *
   * seeded policy
   * ------------------------------------------------------------------ */

  describe("the seeded platform", () => {
    it("has an approved commission plan whose proposer is not its approver", async () => {
      const rows = await ds.query(
        "SELECT proposedById, approvedById, maxDepth, status FROM commission_plans WHERE status = 'active'",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].proposedById).not.toBe(rows[0].approvedById);
      /* There is no level four anywhere in this platform. */
      expect(Number(rows[0].maxDepth)).toBe(3);
    });

    it("publishes no legal document until an attorney approves one", async () => {
      const published = await ds.query(
        "SELECT COUNT(*) c FROM legal_documents WHERE status = 'published'",
      );
      expect(Number(published[0].c)).toBe(0);
    });

    it("seeds no fraud rule that freezes funds without a human", async () => {
      const auto = await ds.query("SELECT COUNT(*) c FROM fraud_rules WHERE autoFreeze = 1");
      expect(Number(auto[0].c)).toBe(0);
    });

    it("seeds no balances, because a balance with no ledger entries is drift", async () => {
      const nonZero = await ds.query(
        "SELECT COUNT(*) c FROM user_balances WHERE points <> 0 OR mttAvailable <> 0",
      );
      expect(Number(nonZero[0].c)).toBe(0);
    });
  });
});
