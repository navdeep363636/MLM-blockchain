import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import { GameSession, LeaderboardSnapshot, User } from "@/database/entities";
import { RedisService } from "@/common/redis/redis.service";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import { LeaderboardService } from "./leaderboard.service";

/* ============================================================================
 * The property that matters here: REDIS IS A CACHE, THE TABLE IS THE RECORD.
 *
 * Prizes and tournament placings are awarded on rank, so a rank has to survive
 * a Redis flush. These tests pin the fallback to the snapshot table, the
 * snapshot-before-prune ordering, and the "always show me my own row" rule that
 * is the whole reason anyone opens a leaderboard.
 * ========================================================================== */

function repo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
    save: jest.fn(async (x: unknown) => x),
    create: jest.fn((x: unknown) => x),
    count: jest.fn(async () => 0),
    createQueryBuilder: jest.fn(() => sessionQb()),
  };
}

/** Enough of a QueryBuilder for the rebuild path, which returns raw rows. */
function sessionQb(rows: { userId: string; total: string }[] = []) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "addSelect", "where", "andWhere", "groupBy", "orderBy", "limit"]) {
    b[m] = jest.fn(() => b);
  }
  b.getRawMany = jest.fn(async () => rows);
  return b;
}

describe("LeaderboardService", () => {
  let svc: LeaderboardService;
  let snapshots: ReturnType<typeof repo>;
  let users: ReturnType<typeof repo>;
  let sessions: ReturnType<typeof repo>;
  let redis: {
    zIncr: jest.Mock; zTop: jest.Mock; zRank: jest.Mock; zScore: jest.Mock;
    zCard: jest.Mock; zAdd: jest.Mock; del: jest.Mock; delByPattern: jest.Mock;
  };
  /* The snapshot is one bulk upsert now; the SQL behind it is exercised against
   * a real database in the e2e suite. */
  let routines: { leaderboardSnapshotUpsert: jest.Mock };

  beforeEach(async () => {
    snapshots = repo();
    users = repo();
    sessions = repo();
    redis = {
      zIncr: jest.fn(async () => 1),
      zTop: jest.fn(async () => [] as { member: string; score: number }[]),
      zRank: jest.fn(async () => null),
      zScore: jest.fn(async () => null),
      zCard: jest.fn(async () => 0),
      zAdd: jest.fn(async () => undefined),
      del: jest.fn(async () => 1),
      delByPattern: jest.fn(async () => 0),
    };

    routines = {
      leaderboardSnapshotUpsert: jest.fn(async (_metric: string, _period: string, rows: unknown[]) => rows.length),
    };

    const mod = await Test.createTestingModule({
      providers: [
        LeaderboardService,
        { provide: getRepositoryToken(LeaderboardSnapshot), useValue: snapshots },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(GameSession), useValue: sessions },
        { provide: RedisService, useValue: redis },
        { provide: DbRoutinesService, useValue: routines },
      ],
    }).compile();

    svc = mod.get(LeaderboardService);
    users.find.mockResolvedValue([
      { id: "u1", displayName: "Ana" },
      { id: "u2", displayName: "Ben" },
      { id: "u3", displayName: "Cleo" },
    ]);
  });

  /* ==================================================================== *
   * Writes
   * ==================================================================== */

  describe("record", () => {
    it("increments every period for the metric, so all four boards stay consistent", async () => {
      await svc.record({ userId: "u1", metric: "points", delta: 50 });
      expect(redis.zIncr).toHaveBeenCalledTimes(4);
      const keys = redis.zIncr.mock.calls.map((c) => c[0] as string);
      expect(keys.some((k) => k.endsWith("all_time"))).toBe(true);
    });

    it("increments rather than sets, so two concurrent sessions both count", async () => {
      await svc.record({ userId: "u1", metric: "score", delta: 900 });
      expect(redis.zIncr).toHaveBeenCalledWith(expect.any(String), 900, "u1");
    });

    it("keeps a per-title board separate from the global one", async () => {
      await svc.record({ userId: "u1", metric: "score", delta: 10, gameId: "abcdef12-0000-0000-0000-000000000000" });
      const keys = redis.zIncr.mock.calls.map((c) => c[0] as string);
      expect(keys.every((k) => k.includes("abcdef12"))).toBe(true);
    });

    it("ignores a non-positive delta", async () => {
      await svc.record({ userId: "u1", metric: "points", delta: 0 });
      expect(redis.zIncr).not.toHaveBeenCalled();
    });
  });

  /* ==================================================================== *
   * Live reads
   * ==================================================================== */

  describe("board — live", () => {
    beforeEach(() => {
      redis.zTop.mockResolvedValue([
        { member: "u2", score: 900 },
        { member: "u1", score: 500 },
      ]);
      redis.zCard.mockResolvedValue(2);
    });

    it("ranks from the live index and labels the caller's row", async () => {
      const r = await svc.board({ metric: "points", period: "weekly" }, "u1");

      expect(r.source).toBe("live");
      expect(r.rows.map((x) => x.rank)).toEqual([1, 2]);
      expect(r.rows[0].displayName).toBe("Ben");
      expect(r.rows[1].isYou).toBe(true);
    });

    it("shows display names — a ranked board is the one place identity is public", async () => {
      const r = await svc.board({ metric: "points", period: "weekly" }, "u1");
      expect(r.rows.map((x) => x.displayName)).toEqual(["Ben", "Ana"]);
    });

    it("returns the caller's own row even when it is outside the visible page", async () => {
      redis.zTop.mockResolvedValue([{ member: "u2", score: 900 }]);
      redis.zRank.mockResolvedValue(41);
      redis.zScore.mockResolvedValue(120);

      const r = await svc.board({ metric: "points", period: "weekly", limit: 1 }, "u1");

      expect(r.rows).toHaveLength(1);
      expect(r.you?.rank).toBe(42);
      expect(r.you?.score).toBe(120);
      expect(r.you?.isYou).toBe(true);
    });

    it("returns no self row for a member who is not ranked", async () => {
      redis.zTop.mockResolvedValue([{ member: "u2", score: 900 }]);
      redis.zRank.mockResolvedValue(null);
      const r = await svc.board({ metric: "points", period: "weekly", limit: 1 }, "u3");
      expect(r.you).toBeNull();
    });

    it("caps the page size regardless of what is asked for", async () => {
      await svc.board({ metric: "points", period: "weekly", limit: 5_000 }, "u1");
      expect(redis.zTop).toHaveBeenCalledWith(expect.any(String), 0, 200);
    });

    it("reports the seconds until a daily board resets", async () => {
      const r = await svc.board({ metric: "points", period: "daily" }, "u1");
      expect(r.resetsInSeconds).toBeGreaterThan(0);
      expect(r.periodKey).toBe(new Date().toISOString().slice(0, 10));
    });

    it("never resets an all-time board", async () => {
      const r = await svc.board({ metric: "points", period: "all_time" }, "u1");
      expect(r.resetsInSeconds).toBe(0);
      expect(r.periodKey).toBe("all_time");
    });
  });

  /* ==================================================================== *
   * Snapshot fallback — the reason the table exists
   * ==================================================================== */

  describe("board — rebuild from sessions", () => {
    /* The claim at the top of the service is that Redis is a cache and the table
     * is the record. That claim was false in one state: a flushed Redis with no
     * snapshot yet taken. The board read empty, the snapshot cron then
     * faithfully persisted nothing, and the period was gone for good. */
    it("reconstructs the live index when Redis and the snapshot table are both empty", async () => {
      redis.zTop
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ member: "u2", score: 900 }, { member: "u1", score: 500 }]);
      snapshots.count.mockResolvedValue(0);
      sessions.createQueryBuilder.mockImplementation(() =>
        sessionQb([{ userId: "u2", total: "900" }, { userId: "u1", total: "500" }]));
      redis.zCard.mockResolvedValue(2);

      const r = await svc.board({ metric: "points", period: "weekly" }, "u1");

      expect(redis.zAdd).toHaveBeenCalledWith(expect.any(String), 900, "u2");
      expect(r.source).toBe("live");
      expect(r.rows.map((x) => x.rank)).toEqual([1, 2]);
    });

    it("prefers a real snapshot over a rebuild — the snapshot is what a dispute settles against", async () => {
      redis.zTop.mockResolvedValue([]);
      snapshots.count.mockResolvedValue(2);
      snapshots.find.mockResolvedValue([{ userId: "u2", score: 900, rank: 1 }]);

      const r = await svc.board({ metric: "points", period: "weekly" }, "u1");

      expect(redis.zAdd).not.toHaveBeenCalled();
      expect(r.source).toBe("snapshot");
    });

    it("does not invent a wins board — nothing durable records a placement yet", async () => {
      expect(await svc.rebuild("wins", "weekly")).toBe(0);
      expect(redis.zAdd).not.toHaveBeenCalled();
    });

    it("skips members whose period total is zero", async () => {
      sessions.createQueryBuilder.mockImplementation(() =>
        sessionQb([{ userId: "u1", total: "0" }, { userId: "u2", total: "40" }]));

      expect(await svc.rebuild("points", "daily")).toBe(1);
      expect(redis.zAdd).toHaveBeenCalledTimes(1);
    });

    it("replaces the key rather than adding to what survived an eviction", async () => {
      /* `record()` increments. A key that came back half-populated would double
       * count everything it still held, so a rebuild owns the whole key. */
      sessions.createQueryBuilder.mockImplementation(() => sessionQb([{ userId: "u1", total: "70" }]));

      await svc.rebuild("points", "weekly");

      expect(redis.del).toHaveBeenCalledTimes(1);
      expect(redis.zAdd).toHaveBeenCalledWith(expect.any(String), 70, "u1");
    });

    it("reconciles every metric and period at boot, and never refuses to start", async () => {
      /* The gap board() alone cannot close: an index that is present, plausible
       * and short by everything that predates the eviction. */
      sessions.createQueryBuilder.mockImplementation(() => sessionQb([{ userId: "u1", total: "70" }]));

      await svc.onApplicationBootstrap();

      /* points, score and sessions across daily/weekly/monthly/all_time. */
      expect(redis.del).toHaveBeenCalledTimes(12);

      redis.del.mockRejectedValueOnce(new Error("redis is down"));
      await expect(svc.onApplicationBootstrap()).resolves.toBeUndefined();
    });

    it("will not snapshot an empty index over a period it can rebuild", async () => {
      redis.zTop
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ member: "u1", score: 70 }]);
      sessions.createQueryBuilder.mockImplementation(() => sessionQb([{ userId: "u1", total: "70" }]));

      const r = await svc.snapshot("points", "weekly");

      expect(r.persisted).toBe(1);
    });
  });

  describe("board — snapshot fallback", () => {
    it("serves the persisted record when the live index is gone", async () => {
      redis.zTop.mockResolvedValue([]);
      snapshots.find.mockResolvedValue([
        { userId: "u2", score: 900, rank: 1 },
        { userId: "u1", score: 500, rank: 2 },
      ]);
      snapshots.count.mockResolvedValue(2);

      const r = await svc.board({ metric: "points", period: "weekly" }, "u1");

      expect(r.source).toBe("snapshot");
      expect(r.rows).toHaveLength(2);
      expect(r.totalRanked).toBe(2);
    });

    it("finds the caller in the snapshot when they are outside the page", async () => {
      redis.zTop.mockResolvedValue([]);
      snapshots.find.mockResolvedValue([{ userId: "u2", score: 900, rank: 1 }]);
      snapshots.findOne.mockResolvedValue({ userId: "u1", score: 120, rank: 42 });

      const r = await svc.board({ metric: "points", period: "weekly", limit: 1 }, "u1");

      expect(r.you?.rank).toBe(42);
    });

    it("returns an empty board rather than failing when neither store has data", async () => {
      redis.zTop.mockResolvedValue([]);
      snapshots.find.mockResolvedValue([]);
      const r = await svc.board({ metric: "points", period: "weekly" }, "u1");
      expect(r.rows).toEqual([]);
      expect(r.you).toBeNull();
    });
  });

  describe("rankFor", () => {
    it("prefers the live index", async () => {
      redis.zRank.mockResolvedValue(2);
      redis.zScore.mockResolvedValue(777);
      const r = await svc.rankFor("u1", "points", "weekly");
      expect(r).toEqual({ rank: 3, score: 777 });
    });

    it("falls back to the persisted record", async () => {
      redis.zRank.mockResolvedValue(null);
      snapshots.findOne.mockResolvedValue({ rank: 9, score: 300 });
      const r = await svc.rankFor("u1", "points", "weekly");
      expect(r).toEqual({ rank: 9, score: 300 });
    });

    it("returns null for a member who has never been ranked", async () => {
      redis.zRank.mockResolvedValue(null);
      snapshots.findOne.mockResolvedValue(null);
      expect(await svc.rankFor("u1", "points", "weekly")).toBeNull();
    });
  });

  /* ==================================================================== *
   * Snapshots
   * ==================================================================== */

  describe("snapshot", () => {
    it("persists the live board with ranks, so the standing survives a Redis flush", async () => {
      redis.zTop.mockResolvedValue([
        { member: "u2", score: 900 },
        { member: "u1", score: 500 },
      ]);

      const r = await svc.snapshot("points", "weekly");

      expect(r.persisted).toBe(2);
      /* One statement for the whole board, with the ranks the live index
       * implied — not one save per row. */
      expect(routines.leaderboardSnapshotUpsert).toHaveBeenCalledWith(
        "points",
        expect.any(String),
        [
          { userId: "u2", score: 900, rank: 1 },
          { userId: "u1", score: 500, rank: 2 },
        ],
      );
      expect(snapshots.save).not.toHaveBeenCalled();
    });

    it("re-runs a period as an upsert rather than duplicating it", async () => {
      /* The uniqueness that prevents duplicates is now the (metric, periodKey,
       * userId) key in the database, exercised by the e2e suite: a second
       * snapshot of the same period corrects the scores in place. What this test
       * pins is that the service no longer reads-then-writes per row, which is
       * where the duplicate risk used to live. */
      redis.zTop.mockResolvedValue([{ member: "u1", score: 900 }]);

      await svc.snapshot("points", "weekly");

      expect(routines.leaderboardSnapshotUpsert).toHaveBeenCalledWith(
        "points",
        expect.any(String),
        [{ userId: "u1", score: 900, rank: 1 }],
      );
      expect(snapshots.find).not.toHaveBeenCalled();
    });

    it("persists nothing when the live board is empty", async () => {
      redis.zTop.mockResolvedValue([]);
      const r = await svc.snapshot("points", "weekly");
      expect(r.persisted).toBe(0);
      expect(snapshots.save).not.toHaveBeenCalled();
    });

    it("bounds the snapshot depth", async () => {
      redis.zTop.mockResolvedValue([]);
      await svc.snapshot("points", "weekly");
      expect(redis.zTop).toHaveBeenCalledWith(expect.any(String), 0, 500);
    });

    it("snapshots every metric in one call for the cron", async () => {
      redis.zTop.mockResolvedValue([]);
      const r = await svc.snapshotAll("daily");
      expect(r.map((x) => x.metric)).toEqual(["points", "score", "sessions", "wins"]);
    });
  });

  describe("pruneClosedPeriods", () => {
    it("drops the live keys of periods that have closed", async () => {
      redis.delByPattern.mockResolvedValue(3);
      const removed = await svc.pruneClosedPeriods(new Date("2026-03-15T12:00:00Z"));

      expect(removed).toBe(9);
      const patterns = redis.delByPattern.mock.calls.map((c) => c[0] as string);
      /* Yesterday's day key, last week's week key, last month's month key. */
      expect(patterns.some((p) => p.includes("2026-03-14"))).toBe(true);
      expect(patterns.some((p) => p.includes("2026-02"))).toBe(true);
    });

    it("never touches the current period's keys", async () => {
      await svc.pruneClosedPeriods(new Date("2026-03-15T12:00:00Z"));
      const patterns = redis.delByPattern.mock.calls.map((c) => c[0] as string);
      expect(patterns.some((p) => p.includes("2026-03-15"))).toBe(false);
    });
  });

  /* ==================================================================== *
   * Event entry point
   * ==================================================================== */

  describe("onSessionValidated", () => {
    it("records sessions, score and points across global and per-title boards", async () => {
      await svc.onSessionValidated({
        userId: "u1", gameId: "abcdef12-0000-0000-0000-000000000000",
        serverScore: 900, pointsAwarded: 90,
      });

      /* sessions global + per-game, score global + per-game, points global:
       * five record() calls × four periods. */
      expect(redis.zIncr).toHaveBeenCalledTimes(20);
    });

    it("records nothing for score or points when a session earned neither", async () => {
      await svc.onSessionValidated({
        userId: "u1", gameId: "abcdef12-0000-0000-0000-000000000000",
        serverScore: 0, pointsAwarded: 0,
      });
      /* Only the two session counters. */
      expect(redis.zIncr).toHaveBeenCalledTimes(8);
    });
  });
});
