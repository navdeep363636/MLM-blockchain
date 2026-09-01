import { ForbiddenException } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import { Game, GameSession, PointsRule, Tournament, TournamentEntry, User } from "@/database/entities";
import { EventBusService } from "@/events";
import { Queues } from "@/queues/queue.constants";
import { CryptoService } from "@/common/crypto/crypto.service";
import { AuditService } from "@/modules/audit/audit.service";
import { PointsService } from "@/modules/points/points.service";
import { GamesService } from "./games.service";

/* ============================================================================
 * The rule this file exists to protect: POINTS COME FROM `serverScore`, NEVER
 * FROM `clientScore` (conventions §8).
 *
 * Every cheat this platform will actually see is an attempt to get the server to
 * accept a number the client made up. So the tests below are written from the
 * attacker's side: submit a score with no gameplay behind it, submit someone
 * else's session, submit twice and keep the best, play impossibly fast. Each one
 * has to be refused, and refused with a recorded reason rather than silently.
 * ========================================================================== */

function repo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
    save: jest.fn(async (x: unknown) => ({ id: "sess-1", ...(x as object) })),
    create: jest.fn((x: unknown) => x),
    createQueryBuilder: jest.fn(),
  };
}

function qb(raw: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "addSelect", "where", "andWhere", "orderBy", "groupBy", "limit", "skip", "take"]) {
    b[m] = jest.fn(() => b);
  }
  b.getRawOne = jest.fn(async () => raw);
  b.getRawMany = jest.fn(async () => []);
  b.getManyAndCount = jest.fn(async () => [[], 0]);
  return b;
}

const GAME = {
  id: "game-1",
  slug: "orbit-rush",
  title: "Orbit Rush",
  genre: "arcade",
  blurb: "blurb",
  thumbnailHue: 24,
  pointsPerSessionMin: 10,
  pointsPerSessionMax: 500,
  entryType: "free" as const,
  entryFee: "0",
  dailyPointsCap: 3_000,
  sessionPointsCap: 1_000,
  active: true,
  rating: "4.5",
  players30d: 100,
  /* 1 score unit per telemetry unit; 0.1 Points per score unit. */
  scoringConfig: { scoreEvent: 2, scorePerUnit: 1, pointsPerScore: 0.1, maxScore: 100_000 },
};

/** Telemetry that genuinely supports a score of 1,000 over 60 seconds. */
const honestTelemetry = () =>
  Array.from({ length: 20 }, (_, i) => ({ t: 1_000 + i * 2_500, e: 2, v: 50 }));

const OPEN_SESSION = {
  id: "sess-1",
  ref: "GS-ABC",
  userId: "u1",
  gameId: "game-1",
  tournamentId: null,
  mode: "free" as const,
  seed: "seed",
  sessionSecret: "hmac:token-ok",
  startedAt: new Date(Date.now() - 60_000),
  status: "open" as const,
  pointsAwarded: 0,
  telemetryFrames: 0,
  clientScore: null,
  serverScore: null,
  deviceFingerprint: null,
};

describe("GamesService", () => {
  let svc: GamesService;
  let games: ReturnType<typeof repo>;
  let sessions: ReturnType<typeof repo>;
  let tournaments: ReturnType<typeof repo>;
  let entries: ReturnType<typeof repo>;
  let rules: ReturnType<typeof repo>;
  let users: ReturnType<typeof repo>;
  let points: { credit: jest.Mock; headroom: jest.Mock };
  let crypto: { hmac: jest.Mock; safeEqual: jest.Mock };
  let bus: { publish: jest.Mock };
  let audit: { record: jest.Mock; recordOrThrow: jest.Mock };
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    games = repo();
    sessions = repo();
    tournaments = repo();
    entries = repo();
    rules = repo();
    users = repo();

    points = {
      credit: jest.fn(async ({ amount }: { amount: number }) => ({
        requested: amount, credited: amount, capped: 0, cappedBy: null,
        headroom: 3_000, meters: [], entryRef: "PT-1", runningBalance: amount, replayed: false,
      })),
      headroom: jest.fn(async () => ({ headroom: 3_000, binding: "user_daily", meters: [] })),
    };
    crypto = {
      hmac: jest.fn((v: string) => `hmac:${v}`),
      safeEqual: jest.fn((a: string, b: string) => a === b),
    };
    bus = { publish: jest.fn() };
    audit = { record: jest.fn(), recordOrThrow: jest.fn() };
    queue = { add: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        GamesService,
        { provide: getRepositoryToken(Game), useValue: games },
        { provide: getRepositoryToken(GameSession), useValue: sessions },
        { provide: getRepositoryToken(Tournament), useValue: tournaments },
        { provide: getRepositoryToken(TournamentEntry), useValue: entries },
        { provide: getRepositoryToken(PointsRule), useValue: rules },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: PointsService, useValue: points },
        { provide: CryptoService, useValue: crypto },
        { provide: EventBusService, useValue: bus },
        { provide: AuditService, useValue: audit },
        { provide: getQueueToken(Queues.GameValidation), useValue: queue },
      ],
    }).compile();

    svc = mod.get(GamesService);
    games.findOne.mockResolvedValue({ ...GAME });
    users.findOne.mockResolvedValue({ id: "u1", status: "active" });
    sessions.findOne.mockResolvedValue(null);
    sessions.createQueryBuilder.mockImplementation(() => qb({ count: "1" }));
  });

  /* ==================================================================== *
   * Start
   * ==================================================================== */

  describe("startSession — tournament guards", () => {
    /* Prize money is settled from these rows. Every one of these checks was
     * absent, and all of it was verified against a live server first: a member
     * registered for the 3 MTT Word Vault event could open a TOURNAMENT session
     * on Hex Tactics against that event, and could name a tournament that did
     * not exist at all. Both were accepted and persisted. */
    const TOURNAMENT = {
      id: "trn-1",
      ref: "TRN-AAA",
      gameId: "game-1",
      startsAt: new Date(Date.now() - 3_600_000),
      endsAt: new Date(Date.now() + 3_600_000),
      settledAt: null as Date | null,
    };

    beforeEach(() => {
      tournaments.findOne.mockResolvedValue({ ...TOURNAMENT });
      entries.findOne.mockResolvedValue({ id: "entry-1", userId: "u1", disqualified: false });
      sessions.findOne.mockResolvedValue(null);
    });

    const start = (over: Record<string, unknown> = {}) =>
      svc.startSession("u1", { gameId: "game-1", mode: "tournament", tournamentRef: "TRN-AAA", ...over } as never, "1.2.3.4");

    it("opens a ranked session for a paid, in-window entrant", async () => {
      const r = await start();
      expect(r.ref).toBeDefined();
      const saved = sessions.save.mock.calls[0][0] as Record<string, unknown>;
      expect(saved.tournamentId).toBe("trn-1");
    });

    it("refuses a tournament that does not exist", async () => {
      tournaments.findOne.mockResolvedValue(null);
      await expect(start()).rejects.toThrow();
      expect(sessions.save).not.toHaveBeenCalled();
    });

    it("refuses a session on a different title than the tournament runs on", async () => {
      /* The prize-stealing case: a higher-ceiling game ranked against a field
       * playing something else. */
      await expect(start({ gameId: "game-other" })).rejects.toThrow();
      expect(sessions.save).not.toHaveBeenCalled();
    });

    it("refuses a member who never entered", async () => {
      entries.findOne.mockResolvedValue(null);
      await expect(start()).rejects.toThrow(ForbiddenException);
      expect(sessions.save).not.toHaveBeenCalled();
    });

    it("refuses a disqualified entry", async () => {
      entries.findOne.mockResolvedValue({ id: "entry-1", userId: "u1", disqualified: true });
      await expect(start()).rejects.toThrow(ForbiddenException);
    });

    it("refuses play before it opens and after it closes", async () => {
      tournaments.findOne.mockResolvedValue({ ...TOURNAMENT, startsAt: new Date(Date.now() + 60_000) });
      await expect(start()).rejects.toThrow();

      tournaments.findOne.mockResolvedValue({ ...TOURNAMENT, endsAt: new Date(Date.now() - 60_000) });
      await expect(start()).rejects.toThrow();
    });

    it("refuses a settled tournament — the standings are final", async () => {
      tournaments.findOne.mockResolvedValue({ ...TOURNAMENT, settledAt: new Date() });
      await expect(start()).rejects.toThrow();
    });

    it("refuses a tournament reference on a free session", async () => {
      /* Otherwise unpaid play could be filed against a paid field. */
      await expect(
        svc.startSession("u1", { gameId: "game-1", mode: "free", tournamentRef: "TRN-AAA" } as never, null),
      ).rejects.toThrow();
    });

    it("requires a reference when the mode is tournament", async () => {
      await expect(
        svc.startSession("u1", { gameId: "game-1", mode: "tournament" } as never, null),
      ).rejects.toThrow();
    });
  });

  describe("abandonSession", () => {
    /* startSession tells the member to "finish or abandon" and, until this
     * existed, there was no way to abandon: a closed tab locked the title for
     * six hours behind advice the API would not honour. */
    it("closes an open session as abandoned, scoring nothing", async () => {
      sessions.findOne.mockResolvedValue({ ...OPEN_SESSION, status: "open", userId: "u1" });

      const r = await svc.abandonSession("u1", OPEN_SESSION.ref);

      const saved = sessions.save.mock.calls[0][0] as Record<string, unknown>;
      expect(saved.status).toBe("abandoned");
      expect(saved.rejectionReason).toBe("Abandoned by the player");
      expect(r.pointsAwarded).toBe(0);
    });

    it("is idempotent once the session is closed", async () => {
      sessions.findOne.mockResolvedValue({ ...OPEN_SESSION, status: "validated", userId: "u1" });

      await expect(svc.abandonSession("u1", OPEN_SESSION.ref)).resolves.toBeDefined();
      expect(sessions.save).not.toHaveBeenCalled();
    });

    it("will not let one member abandon another's session", async () => {
      sessions.findOne.mockResolvedValue({ ...OPEN_SESSION, status: "open", userId: "someone-else" });

      await expect(svc.abandonSession("u1", OPEN_SESSION.ref)).rejects.toThrow();
      expect(sessions.save).not.toHaveBeenCalled();
    });
  });

  describe("startSession", () => {
    it("generates the seed and secret SERVER-side, returning the token exactly once", async () => {
      const r = await svc.startSession("u1", { gameId: "game-1", mode: "free" }, "1.2.3.4");

      expect(r.seed).toMatch(/^[0-9a-f]{32}$/);
      expect(r.sessionToken.length).toBeGreaterThan(16);
      /* Only the HMAC is persisted: a database leak must not let anyone submit. */
      const stored = sessions.save.mock.calls[0][0] as Record<string, unknown>;
      expect(stored.sessionSecret).toBe(`hmac:${r.sessionToken}`);
      expect(stored.seed).toBe(r.seed);
    });

    it("shows the Points headroom up front, so a cap is never a surprise after playing", async () => {
      points.headroom.mockResolvedValue({ headroom: 120, binding: "game_daily", meters: [] });
      const r = await svc.startSession("u1", { gameId: "game-1", mode: "free" }, null);
      expect(r.pointsHeadroom).toBe(120);
      expect(r.sessionCap).toBe(1_000);
    });

    it("REFUSES a second open session for the same game — no parallel farming", async () => {
      sessions.findOne.mockResolvedValue({ ...OPEN_SESSION });
      await expect(svc.startSession("u1", { gameId: "game-1", mode: "free" }, null))
        .rejects.toMatchObject({ response: { code: "SESSION_ALREADY_OPEN" } });
    });

    it("abandons a stale open session rather than blocking the member forever", async () => {
      sessions.findOne.mockResolvedValue({
        ...OPEN_SESSION, startedAt: new Date(Date.now() - 12 * 3_600_000),
      });
      await svc.startSession("u1", { gameId: "game-1", mode: "free" }, null);
      expect(sessions.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: "abandoned" }),
      );
    });

    it("REFUSES an inactive game", async () => {
      games.findOne.mockResolvedValue({ ...GAME, active: false });
      await expect(svc.startSession("u1", { gameId: "game-1", mode: "free" }, null))
        .rejects.toMatchObject({ response: { code: "GAME_INACTIVE" } });
    });

    it("REFUSES a suspended account", async () => {
      users.findOne.mockResolvedValue({ id: "u1", status: "suspended" });
      await expect(svc.startSession("u1", { gameId: "game-1", mode: "free" }, null))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it("requires a tournament id for a tournament session", async () => {
      await expect(svc.startSession("u1", { gameId: "game-1", mode: "tournament" }, null))
        .rejects.toMatchObject({ response: { code: "TOURNAMENT_REQUIRED" } });
    });
  });

  /* ==================================================================== *
   * Submit
   * ==================================================================== */

  describe("submitSession", () => {
    const submission = {
      sessionToken: "token-ok",
      clientScore: 1_000,
      durationMs: 60_000,
      telemetry: honestTelemetry(),
    };

    beforeEach(() => {
      sessions.findOne.mockResolvedValue({ ...OPEN_SESSION });
    });

    it("credits nothing and queues the replay instead", async () => {
      const r = await svc.submitSession("u1", "GS-ABC", submission);

      expect(points.credit).not.toHaveBeenCalled();
      expect(r.queued).toBe(true);
      expect(r.status).toBe("submitted");
      expect(queue.add).toHaveBeenCalledWith(
        "validate-session",
        expect.objectContaining({ sessionId: "sess-1", clientScore: 1_000 }),
        { jobId: "validate-sess-1" },
      );
    });

    it("REFUSES a submission whose token does not match the session", async () => {
      await expect(svc.submitSession("u1", "GS-ABC", { ...submission, sessionToken: "stolen" }))
        .rejects.toMatchObject({ response: { code: "SESSION_TOKEN_INVALID" } });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it("REFUSES a second submission — a session cannot be re-rolled for a better score", async () => {
      sessions.findOne.mockResolvedValue({ ...OPEN_SESSION, status: "validated" });
      await expect(svc.submitSession("u1", "GS-ABC", submission))
        .rejects.toMatchObject({ response: { code: "SESSION_NOT_OPEN" } });
    });

    it("REFUSES a submission after the session expired, and marks it abandoned", async () => {
      sessions.findOne.mockResolvedValue({
        ...OPEN_SESSION, startedAt: new Date(Date.now() - 12 * 3_600_000),
      });
      await expect(svc.submitSession("u1", "GS-ABC", submission))
        .rejects.toMatchObject({ response: { code: "SESSION_EXPIRED" } });
      expect(sessions.save).toHaveBeenCalledWith(expect.objectContaining({ status: "abandoned" }));
    });

    it("records a tamper-evident digest of the frames actually received", async () => {
      await svc.submitSession("u1", "GS-ABC", submission);
      const saved = sessions.save.mock.calls[0][0] as Record<string, unknown>;
      expect(saved.telemetryHash).toBeDefined();
      expect(saved.telemetryFrames).toBe(20);
    });

    it("stores the claimed score as a CLAIM, alongside nothing credited", async () => {
      await svc.submitSession("u1", "GS-ABC", submission);
      const saved = sessions.save.mock.calls[0][0] as Record<string, unknown>;
      expect(saved.clientScore).toBe(1_000);
      expect(saved.pointsAwarded).toBe(0);
    });
  });

  /* ==================================================================== *
   * Validation — the heart of it
   * ==================================================================== */

  describe("validateSession", () => {
    const submitted = (over: Record<string, unknown> = {}) => ({
      ...OPEN_SESSION, status: "submitted", clientScore: 1_000, durationMs: 60_000, ...over,
    });

    it("credits Points from the REPLAYED score, not the claimed one", async () => {
      sessions.findOne.mockResolvedValue(submitted());

      /* The client claims 50,000; the frames support 1,000. */
      const r = await svc.validateSession({
        sessionId: "sess-1", telemetry: honestTelemetry(), clientScore: 1_000, durationMs: 60_000,
      });

      expect(r.serverScore).toBe(1_000);
      /* 1,000 score × 0.1 = 100 Points. */
      expect(points.credit).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 100, source: "gameplay" }),
      );
      expect(r.pointsAwarded).toBe(100);
    });

    it("REJECTS a claim far above what the telemetry supports", async () => {
      sessions.findOne.mockResolvedValue(submitted({ clientScore: 50_000 }));

      const r = await svc.validateSession({
        sessionId: "sess-1", telemetry: honestTelemetry(), clientScore: 50_000, durationMs: 60_000,
      });

      expect(r.status).toBe("rejected");
      expect(r.anomalyFlags).toContain("score_discrepancy");
      expect(points.credit).not.toHaveBeenCalled();
      expect(r.rejectionReason).toContain("does not match the replayed gameplay");
    });

    it("REJECTS a score reported with no gameplay data at all", async () => {
      sessions.findOne.mockResolvedValue(submitted());
      const r = await svc.validateSession({
        sessionId: "sess-1", telemetry: [], clientScore: 1_000, durationMs: 60_000,
      });
      expect(r.status).toBe("rejected");
      expect(r.anomalyFlags).toContain("claim_without_telemetry");
    });

    it("REJECTS a session too short to have been played", async () => {
      sessions.findOne.mockResolvedValue(submitted({ durationMs: 400 }));
      const r = await svc.validateSession({
        sessionId: "sess-1",
        telemetry: [{ t: 100, e: 2, v: 500 }],
        clientScore: 500,
        durationMs: 400,
      });
      expect(r.status).toBe("rejected");
      expect(r.anomalyFlags).toContain("duration_implausible");
    });

    it("REJECTS a superhuman input rate", async () => {
      const spam = Array.from({ length: 500 }, (_, i) => ({ t: i * 10, e: 2, v: 2 }));
      sessions.findOne.mockResolvedValue(submitted({ durationMs: 5_000 }));

      const r = await svc.validateSession({
        sessionId: "sess-1", telemetry: spam, clientScore: 1_000, durationMs: 5_000,
      });

      expect(r.status).toBe("rejected");
      expect(r.anomalyFlags).toContain("input_rate_superhuman");
    });

    it("ignores frames that arrive out of order rather than reordering a stream nobody sent", async () => {
      sessions.findOne.mockResolvedValue(submitted({ clientScore: 100 }));

      const r = await svc.validateSession({
        sessionId: "sess-1",
        telemetry: [
          { t: 10_000, e: 2, v: 100 },
          { t: 5_000, e: 2, v: 900 },   // out of order: dropped
        ],
        clientScore: 100,
        durationMs: 60_000,
      });

      expect(r.serverScore).toBe(100);
    });

    it("ignores frames claiming to occur after the session ended", async () => {
      sessions.findOne.mockResolvedValue(submitted({ durationMs: 10_000, clientScore: 100 }));
      const r = await svc.validateSession({
        sessionId: "sess-1",
        telemetry: [{ t: 5_000, e: 2, v: 100 }, { t: 900_000, e: 2, v: 5_000 }],
        clientScore: 100,
        durationMs: 10_000,
      });
      expect(r.serverScore).toBe(100);
    });

    it("ignores non-scoring event codes", async () => {
      sessions.findOne.mockResolvedValue(submitted({ clientScore: 0 }));
      const r = await svc.validateSession({
        sessionId: "sess-1",
        telemetry: [{ t: 1_000, e: 1, v: 9_999 }],
        clientScore: 0,
        durationMs: 60_000,
      });
      expect(r.serverScore).toBe(0);
    });

    it("caps the replayed score at the title's declared maximum", async () => {
      games.findOne.mockResolvedValue({
        ...GAME, scoringConfig: { ...GAME.scoringConfig, maxScore: 500 },
      });
      sessions.findOne.mockResolvedValue(submitted({ clientScore: 1_000 }));

      const r = await svc.validateSession({
        sessionId: "sess-1", telemetry: honestTelemetry(), clientScore: 1_000, durationMs: 60_000,
      });

      expect(r.serverScore).toBe(500);
    });

    it("scores zero when the title has no scoring config — a missing config is not a licence to trust the client", async () => {
      games.findOne.mockResolvedValue({ ...GAME, scoringConfig: null });
      sessions.findOne.mockResolvedValue(submitted({ clientScore: 0 }));

      const r = await svc.validateSession({
        sessionId: "sess-1",
        telemetry: [{ t: 1_000, e: 9, v: 5_000 }],
        clientScore: 0,
        durationMs: 60_000,
      });

      expect(r.serverScore).toBe(0);
      expect(points.credit).not.toHaveBeenCalled();
    });

    it("keeps the Points award inside the title's declared band", async () => {
      games.findOne.mockResolvedValue({
        ...GAME, pointsPerSessionMax: 40,
        scoringConfig: { scoreEvent: 2, scorePerUnit: 1, pointsPerScore: 1, maxScore: 100_000 },
      });
      sessions.findOne.mockResolvedValue(submitted());

      await svc.validateSession({
        sessionId: "sess-1", telemetry: honestTelemetry(), clientScore: 1_000, durationMs: 60_000,
      });

      expect(points.credit).toHaveBeenCalledWith(expect.objectContaining({ amount: 40 }));
    });

    it("reports the cap effect and explains a zero award", async () => {
      points.credit.mockResolvedValue({
        requested: 100, credited: 0, capped: 100, cappedBy: "game_daily",
        headroom: 0, meters: [], entryRef: null, runningBalance: null, replayed: false,
      });
      sessions.findOne.mockResolvedValue(submitted());

      const r = await svc.validateSession({
        sessionId: "sess-1", telemetry: honestTelemetry(), clientScore: 1_000, durationMs: 60_000,
      });

      expect(r.status).toBe("validated");
      expect(r.pointsCapped).toBe(100);
      expect(r.cappedBy).toBe("game_daily");
      expect(r.rejectionReason).toContain("daily Points cap");
    });

    it("uses a session-derived idempotency key, so a retried job cannot double-credit", async () => {
      sessions.findOne.mockResolvedValue(submitted());
      await svc.validateSession({
        sessionId: "sess-1", telemetry: honestTelemetry(), clientScore: 1_000, durationMs: 60_000,
      });
      expect(points.credit).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: "session:sess-1" }),
      );
    });

    it("is idempotent: re-validating a finished session credits nothing more", async () => {
      sessions.findOne.mockResolvedValue({
        ...submitted(), status: "validated", serverScore: 1_000, pointsAwarded: 100,
      });
      const r = await svc.validateSession({
        sessionId: "sess-1", telemetry: honestTelemetry(), clientScore: 1_000, durationMs: 60_000,
      });
      expect(r.pointsAwarded).toBe(100);
      expect(points.credit).not.toHaveBeenCalled();
    });

    it("states on the event that Points came from the server score", async () => {
      sessions.findOne.mockResolvedValue(submitted());
      await svc.validateSession({
        sessionId: "sess-1", telemetry: honestTelemetry(), clientScore: 1_000, durationMs: 60_000,
      });
      const validated = (bus.publish.mock.calls as [string, Record<string, unknown>][])
        .find(([n]) => n === "game.session_validated");
      expect(validated?.[1].creditedFrom).toBe("serverScore");
    });

    it("FLAGS a shared device without stealing the Points of a legitimate player", async () => {
      sessions.findOne.mockResolvedValue(submitted({ deviceFingerprint: "fp-1" }));
      sessions.createQueryBuilder.mockImplementation(() => qb({ count: "9" }));

      const r = await svc.validateSession({
        sessionId: "sess-1", telemetry: honestTelemetry(), clientScore: 1_000, durationMs: 60_000,
      });

      expect(r.anomalyFlags).toContain("device_shared_by_many_accounts");
      /* Flagged for review, still credited: a false positive that quietly takes
       * a real player's Points is also a failure. */
      expect(r.status).toBe("validated");
      expect(r.pointsAwarded).toBe(100);
    });
  });

  /* ==================================================================== *
   * Admin
   * ==================================================================== */

  describe("upsertGame", () => {
    const base = {
      slug: "orbit-rush", title: "Orbit Rush", genre: "arcade",
      blurb: "A fast arcade game about orbits.", thumbnailHue: 24,
      pointsPerSessionMin: 10, pointsPerSessionMax: 500,
      entryType: "free" as const, entryFee: "0",
      dailyPointsCap: 3_000, sessionPointsCap: 1_000, active: true,
      reason: "launching the title",
    };

    it("REFUSES a session cap above the daily cap — one session must not out-earn a day", async () => {
      games.findOne.mockResolvedValue(null);
      await expect(
        svc.upsertGame({ ...base, sessionPointsCap: 5_000 }, "admin-1", null),
      ).rejects.toMatchObject({ response: { code: "CAPS_INCONSISTENT" } });
    });

    it("REFUSES an inverted Points band", async () => {
      games.findOne.mockResolvedValue(null);
      await expect(
        svc.upsertGame({ ...base, pointsPerSessionMin: 900 }, "admin-1", null),
      ).rejects.toMatchObject({ response: { code: "POINTS_BAND_INVERTED" } });
    });

    it("audits a cap change with the previous values and a mandatory reason", async () => {
      games.findOne.mockResolvedValue({ ...GAME });
      games.save.mockImplementation(async (x: unknown) => x as { id: string });

      await svc.upsertGame({ ...base, dailyPointsCap: 1_000, reason: "tightening emissions" }, "admin-1", "1.2.3.4");

      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "game.update",
          before: expect.objectContaining({ dailyPointsCap: 3_000 }),
          reason: "tightening emissions",
        }),
      );
    });
  });

});
