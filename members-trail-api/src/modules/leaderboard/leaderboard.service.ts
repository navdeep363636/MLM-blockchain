import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { LeaderboardSnapshot, User } from "@/database/entities";
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

@Injectable()
export class LeaderboardService {
  private readonly log = new Logger(LeaderboardService.name);

  constructor(
    @InjectRepository(LeaderboardSnapshot) private readonly snapshots: Repository<LeaderboardSnapshot>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly redis: RedisService,
    private readonly routines: DbRoutinesService,
  ) {}

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

    /* No live index: serve the persisted record. */
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

    const top = await this.redis.zTop(key, 0, SNAPSHOT_DEPTH);
    if (top.length === 0) {
      return { metric: snapshotMetric, periodKey, persisted: 0 };
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
