import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { GameSession, LeaderboardSnapshot, User } from "@/database/entities";
import { RedisService } from "@/common/redis/redis.service";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import { CacheKeys } from "@/common/redis/cache.keys";
import {
  dayKey, monthKey, secondsUntilUtcMidnight, secondsUntilUtcMonthEnd, weekKey,
} from "@/common/utils";
import type {
  LeaderboardMetric, LeaderboardPeriod, LeaderboardQuery, LeaderboardResponse, LeaderboardRow,
  SnapshotResultResponse,
} from "./dto/leaderboard.dto";

/* ============================================================================
 * Leaderboards (FRD G-05).
 *
 * Two stores, on purpose:
 *
 *  • REDIS SORTED SETS serve live reads. A leaderboard is read constantly and
 *    written on every validated session; doing that with SQL aggregation on each
 *    request is how the database falls over at peak.
 *
 *  • `leaderboard_snapshots` IS THE RECORD. Redis is a cache that can be
 *    flushed, evicted or lost. A prize was awarded for a rank, so that rank has
 *    to survive a Redis restart — the snapshot table is what a dispute is
 *    settled against, and what a period's history is read from once the live key
 *    has expired.
 *
 * Every score that lands here is derived from something the server already
 * validated. A leaderboard fed by client-reported numbers is just a scoreboard
 * of who is best at editing requests.
 * ========================================================================== */

/** Rows persisted per snapshot. Beyond this, a rank has no prize meaning. */
const SNAPSHOT_DEPTH = 500;

/** Members reinstated into a rebuilt live index. Same reasoning as the depth. */
const REBUILD_DEPTH = 500;

@Injectable()
export class LeaderboardService implements OnApplicationBootstrap {
  private readonly log = new Logger(LeaderboardService.name);

  constructor(
    @InjectRepository(LeaderboardSnapshot) private readonly snapshots: Repository<LeaderboardSnapshot>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(GameSession) private readonly sessions: Repository<GameSession>,
    private readonly redis: RedisService,
    private readonly routines: DbRoutinesService,
  ) {}

  /**
   * Reconciles every live index against the sessions on disk, once, at startup.
   *
   * `board()` rebuilds an index it finds EMPTY, which covers a clean flush. It
   * cannot cover the more common state: a flush or eviction followed by a few
   * validated sessions, which leaves a key that is present, plausible and short
   * by everything that came before. Nothing reads as broken, the numbers are
   * simply wrong, and they stay wrong for the life of the period.
   *
   * Boot is the one moment when a full recount is both safe and cheap - twelve
   * aggregates over an indexed table, with no live reads racing them - so that is
   * where it happens. Afterwards the increments carry on from a known-correct
   * base.
   *
   * Failure here is logged, not thrown: a leaderboard that is briefly stale must
   * not be the reason an API instance refuses to start.
   */
  async onApplicationBootstrap(): Promise<void> {
    const metrics: LeaderboardMetric[] = ["points", "score", "sessions"];
    const periods: LeaderboardPeriod[] = ["daily", "weekly", "monthly", "all_time"];
    let total = 0;
    try {
      for (const metric of metrics) {
        for (const period of periods) {
          total += await this.rebuild(metric, period);
        }
      }
      this.log.log(`leaderboard indexes reconciled from sessions at boot: ${total} rows`);
    } catch (e) {
      this.log.warn(
        `leaderboard boot reconciliation failed, serving whatever the index holds: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  /* ==================================================================== *
   * Writes
   * ==================================================================== */

  /**
   * Adds to a member's score across every period of a metric.
   *
   * Called from the domain-event listener after a session is validated or Points
   * are credited — never from a client route. Increments rather than sets, so two
   * concurrent sessions both count.
   */
  async record(params: {
    userId: string;
    metric: LeaderboardMetric;
    delta: number;
    gameId?: string | null;
  }): Promise<void> {
    if (params.delta <= 0) return;

    for (const period of ["daily", "weekly", "monthly", "all_time"] as LeaderboardPeriod[]) {
      const key = this.liveKey(params.metric, period, params.gameId ?? null);
      await this.redis.zIncr(key, params.delta, params.userId);
    }
  }

  /* ==================================================================== *
   * Reads
   * ==================================================================== */

  /**
   * A page of the board plus the caller's own row.
   *
   * The caller's row is always resolved separately, because "where am I?" is the
   * question a leaderboard is actually asked, and scrolling 4,000 rows to find
   * out is not an answer.
   *
   * Falls back to the persisted snapshot when the live index has nothing — that
   * is the normal state for a past period, and it is also what makes a Redis
   * flush a performance event rather than a data-loss event.
   */
  async board(q: LeaderboardQuery, userId: string | null): Promise<LeaderboardResponse> {
    const metric = q.metric ?? "points";
    const period = q.period ?? "weekly";
    const limit = Math.min(q.limit ?? 50, 200);
    const gameId = q.gameId ?? null;
    const key = this.liveKey(metric, period, gameId);
    const periodKey = this.periodKey(period);

    const live = await this.redis.zTop(key, 0, limit);

    if (live.length > 0) {
      const rows = await this.decorate(
        live.map((e, i) => ({ userId: e.member, score: Math.floor(e.score), rank: i + 1 })),
        userId,
      );

      const total = await this.redis.zCard(key);
      const you = await this.selfRowLive(key, userId, rows);

      return {
        metric, period, periodKey, rows, you,
        totalRanked: total,
        resetsInSeconds: this.resetsIn(period),
        source: "live",
      };
    }

    /* No live index. The persisted record is the next place to look - but if
     * that is empty too, the board is not actually empty, it is unbuilt: Redis
     * was flushed or evicted before any snapshot had been taken. Left alone,
     * that state is permanent, because the snapshot cron snapshots the live
     * index and would faithfully persist nothing, forever. So reconstruct the
     * index from the sessions that produced it and read again. */
    if (!(await this.hasSnapshot(metric, gameId, periodKey))) {
      const restored = await this.rebuild(metric, period, gameId);
      if (restored > 0) {
        const rebuilt = await this.redis.zTop(key, 0, limit);
        const rows = await this.decorate(
          rebuilt.map((e, i) => ({ userId: e.member, score: Math.floor(e.score), rank: i + 1 })),
          userId,
        );
        return {
          metric, period, periodKey, rows,
          you: await this.selfRowLive(key, userId, rows),
          totalRanked: await this.redis.zCard(key),
          resetsInSeconds: this.resetsIn(period),
          source: "live",
        };
      }
    }

    /* Nothing to rebuild from either: serve the persisted record. */
    const snapshot = await this.snapshots.find({
      where: { metric: this.snapshotMetric(metric, gameId), periodKey },
      order: { rank: "ASC" },
      take: limit,
    });

    const rows = await this.decorate(
      snapshot.map((s) => ({ userId: s.userId, score: s.score, rank: s.rank })),
      userId,
    );

    const total = await this.snapshots.count({
      where: { metric: this.snapshotMetric(metric, gameId), periodKey },
    });
    const you = userId ? await this.selfRowSnapshot(metric, gameId, periodKey, userId, rows) : null;

    return {
      metric, period, periodKey, rows, you,
      totalRanked: total,
      resetsInSeconds: this.resetsIn(period),
      source: "snapshot",
    };
  }

  /** The caller's rank in one board, or null when they are not ranked. */
  async rankFor(
    userId: string,
    metric: LeaderboardMetric,
    period: LeaderboardPeriod,
    gameId: string | null = null,
  ): Promise<{ rank: number; score: number } | null> {
    const key = this.liveKey(metric, period, gameId);
    const rank = await this.redis.zRank(key, userId);
    if (rank !== null) {
      const score = await this.redis.zScore(key, userId);
      return { rank: rank + 1, score: Math.floor(score ?? 0) };
    }

    const row = await this.snapshots.findOne({
      where: {
        metric: this.snapshotMetric(metric, gameId),
        periodKey: this.periodKey(period),
        userId,
      },
    });
    return row ? { rank: row.rank, score: row.score } : null;
  }

  /* ==================================================================== *
   * Snapshots
   * ==================================================================== */

  /**
   * Persists the current live board.
   *
   * Run by the cron shortly before a period closes and again just after, so the
   * final standings are recorded even if Redis is lost immediately afterwards.
   * Idempotent through UNIQUE(metric, periodKey, userId): re-running updates the
   * rows rather than duplicating them.
   */
  async snapshot(
    metric: LeaderboardMetric,
    period: LeaderboardPeriod,
    gameId: string | null = null,
  ): Promise<SnapshotResultResponse> {
    const key = this.liveKey(metric, period, gameId);
    const periodKey = this.periodKey(period);
    const snapshotMetric = this.snapshotMetric(metric, gameId);

    let top = await this.redis.zTop(key, 0, SNAPSHOT_DEPTH);

    /* An empty live index is ambiguous: either nobody has played this period, or
     * Redis was lost. Persisting nothing is correct for the first and destructive
     * for the second - it would write an authoritative "no standings" over a
     * period that had them. Rebuild from the sessions first and let the answer
     * come from disk. */
    if (top.length === 0) {
      const restored = await this.rebuild(metric, period, gameId);
      if (restored === 0) return { metric: snapshotMetric, periodKey, persisted: 0 };
      top = await this.redis.zTop(key, 0, SNAPSHOT_DEPTH);
      if (top.length === 0) return { metric: snapshotMetric, periodKey, persisted: 0 };
    }

    /* One statement for the whole board.
     *
     * This was a SELECT of the existing rows plus one save per entry — up to 500
     * round trips per metric, and the cron snapshots four metrics across three
     * periods, so a tick could be six thousand. The unique key
     * (metric, periodKey, userId) makes it an upsert, so re-running a period
     * corrects the standings instead of duplicating them. */
    const persisted = await this.routines.leaderboardSnapshotUpsert(
      snapshotMetric,
      periodKey,
      top.map((entry, index) => ({
        userId: entry.member,
        score: Math.floor(entry.score),
        rank: index + 1,
      })),
    );

    this.log.log(`snapshot ${snapshotMetric} ${periodKey}: ${persisted} rows persisted`);
    return { metric: snapshotMetric, periodKey, persisted };
  }

  /** Snapshots every metric for a period. The cron's single entry point. */
  async snapshotAll(period: LeaderboardPeriod): Promise<SnapshotResultResponse[]> {
    const results: SnapshotResultResponse[] = [];
    for (const metric of ["points", "score", "sessions", "wins"] as LeaderboardMetric[]) {
      results.push(await this.snapshot(metric, period));
    }
    return results;
  }

  /**
   * Drops live keys for periods that have closed.
   *
   * The live key embeds its period, so a closed period's key is simply never
   * read again — but left alone it would sit in Redis forever. The cron calls
   * this AFTER snapshotting, so the record is persisted before the cache goes:
   * pruning first would lose a period's final standings if Redis were the only
   * copy.
   */
  async pruneClosedPeriods(now: Date = new Date()): Promise<number> {
    const yesterday = new Date(now.getTime() - 86_400_000);
    const lastWeek = new Date(now.getTime() - 7 * 86_400_000);
    const lastMonth = new Date(now.getTime() - 32 * 86_400_000);

    const stale = [dayKey(yesterday), weekKey(lastWeek), monthKey(lastMonth)];

    let removed = 0;
    for (const periodKey of stale) {
      /* Pattern over the metric segment only: `lb:<metric>:<periodKey>`. */
      removed += await this.redis.delByPattern(CacheKeys.leaderboard("*", periodKey));
    }
    if (removed > 0) this.log.log(`pruned ${removed} closed leaderboard keys`);
    return removed;
  }

  /* ==================================================================== *
   * Event entry point
   * ==================================================================== */

  /** Records a validated session against the boards it affects. */
  async onSessionValidated(payload: {
    userId: string;
    gameId: string;
    serverScore: number;
    pointsAwarded: number;
  }): Promise<void> {
    await this.record({ userId: payload.userId, metric: "sessions", delta: 1 });
    await this.record({ userId: payload.userId, metric: "sessions", delta: 1, gameId: payload.gameId });

    if (payload.serverScore > 0) {
      await this.record({ userId: payload.userId, metric: "score", delta: payload.serverScore });
      await this.record({
        userId: payload.userId, metric: "score", delta: payload.serverScore, gameId: payload.gameId,
      });
    }
    if (payload.pointsAwarded > 0) {
      await this.record({ userId: payload.userId, metric: "points", delta: payload.pointsAwarded });
    }
  }

  /* ------------------------------------------------------------------ */

  /** Live key, derived from the shared leaderboard key family. */
  private liveKey(metric: LeaderboardMetric, period: LeaderboardPeriod, gameId: string | null): string {
    return CacheKeys.leaderboard(this.snapshotMetric(metric, gameId), this.periodKey(period));
  }

  /** A per-title board is a distinct metric, not a filter on a global one. */
  private snapshotMetric(metric: LeaderboardMetric, gameId: string | null): string {
    return gameId ? `${metric}:${gameId.slice(0, 8)}` : metric;
  }

  private periodKey(period: LeaderboardPeriod): string {
    if (period === "daily") return dayKey();
    if (period === "weekly") return weekKey();
    if (period === "monthly") return monthKey();
    return "all_time";
  }

  private resetsIn(period: LeaderboardPeriod): number {
    if (period === "daily") return secondsUntilUtcMidnight();
    if (period === "monthly") return secondsUntilUtcMonthEnd();
    if (period === "weekly") {
      /* End of the ISO week, in UTC. */
      const now = new Date();
      const dow = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
      const daysLeft = 7 - dow;
      return daysLeft * 86_400 + secondsUntilUtcMidnight();
    }
    return 0;
  }

  /**
   * Attaches display names.
   *
   * A leaderboard is the one surface where a member's chosen display name is
   * shown to others — playing a ranked mode is the opt-in. Nothing else about
   * the account is read, so nothing else can leak.
   */
  private async decorate(
    entries: { userId: string; score: number; rank: number }[],
    viewerId: string | null,
  ): Promise<LeaderboardRow[]> {
    if (entries.length === 0) return [];

    const users = await this.users.find({ where: { id: In(entries.map((e) => e.userId)) } });
    const byId = new Map(users.map((u) => [u.id, u.displayName]));

    return entries.map((e) => ({
      rank: e.rank,
      displayName: byId.get(e.userId) ?? "Player",
      score: e.score,
      isYou: e.userId === viewerId,
    }));
  }

  private async selfRowLive(
    key: string,
    userId: string | null,
    visible: LeaderboardRow[],
  ): Promise<LeaderboardRow | null> {
    if (!userId) return null;
    const already = visible.find((r) => r.isYou);
    if (already) return already;

    const rank = await this.redis.zRank(key, userId);
    if (rank === null) return null;
    const score = await this.redis.zScore(key, userId);
    const [row] = await this.decorate([{ userId, score: Math.floor(score ?? 0), rank: rank + 1 }], userId);
    return row ?? null;
  }

  private async hasSnapshot(
    metric: LeaderboardMetric,
    gameId: string | null,
    periodKey: string,
  ): Promise<boolean> {
    const count = await this.snapshots.count({
      where: { metric: this.snapshotMetric(metric, gameId), periodKey },
    });
    return count > 0;
  }

  /**
   * Reconstructs a live index from the validated sessions behind it.
   *
   * This is the piece that makes the "Redis is a cache" claim at the top of this
   * file true. Every score the index holds was derived from a `game_sessions`
   * row that is still on disk, so the index is reproducible - and a board that
   * can be reproduced is never lost, only cold.
   *
   * `wins` has no durable source yet (nothing writes a tournament placement), so
   * it rebuilds to nothing rather than to a guess.
   */
  async rebuild(
    metric: LeaderboardMetric,
    period: LeaderboardPeriod,
    gameId: string | null = null,
  ): Promise<number> {
    if (metric === "wins") return 0;

    const since = this.periodStart(period);
    const qb = this.sessions
      .createQueryBuilder("s")
      .select("s.userId", "userId")
      .where("s.status = :status", { status: "validated" });

    if (since) qb.andWhere("s.createdAt >= :since", { since });
    if (gameId) qb.andWhere("s.gameId = :gameId", { gameId });

    if (metric === "points") qb.addSelect("SUM(s.pointsAwarded)", "total");
    else if (metric === "score") qb.addSelect("SUM(s.serverScore)", "total");
    else qb.addSelect("COUNT(s.id)", "total");

    const rows = await qb
      .groupBy("s.userId")
      .orderBy("total", "DESC")
      .limit(REBUILD_DEPTH)
      .getRawMany<{ userId: string; total: string | null }>();

    const key = this.liveKey(metric, period, gameId);

    /* Replace rather than merge. `record()` increments, so a key that survived
     * partially - the usual state after an eviction - would end up double
     * counting whatever it still held. The aggregate below is the whole truth
     * for this period, so it becomes the whole key. */
    await this.redis.del(key);

    let written = 0;
    for (const r of rows) {
      const score = Math.floor(Number(r.total) || 0);
      if (score <= 0) continue;
      await this.redis.zAdd(key, score, r.userId);
      written += 1;
    }

    if (written > 0) {
      this.log.log(
        `rebuilt ${this.snapshotMetric(metric, gameId)} ${this.periodKey(period)} from sessions: ${written} rows`,
      );
    }
    return written;
  }

  /** Start of the current period in UTC, or null for all time. */
  private periodStart(period: LeaderboardPeriod): Date | null {
    const now = new Date();
    if (period === "all_time") return null;
    if (period === "daily") {
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    }
    if (period === "monthly") {
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    }
    /* ISO week: Monday is day 1, and Sunday reads as 7 rather than 0. */
    const dow = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - (dow - 1));
    return monday;
  }

  private async selfRowSnapshot(
    metric: LeaderboardMetric,
    gameId: string | null,
    periodKey: string,
    userId: string,
    visible: LeaderboardRow[],
  ): Promise<LeaderboardRow | null> {
    const already = visible.find((r) => r.isYou);
    if (already) return already;

    const row = await this.snapshots.findOne({
      where: { metric: this.snapshotMetric(metric, gameId), periodKey, userId },
    });
    if (!row) return null;
    const [decorated] = await this.decorate(
      [{ userId, score: row.score, rank: row.rank }],
      userId,
    );
    return decorated ?? null;
  }
}

/** Re-exported so the snapshot cron can state the depth it relies on. */
export { SNAPSHOT_DEPTH };
