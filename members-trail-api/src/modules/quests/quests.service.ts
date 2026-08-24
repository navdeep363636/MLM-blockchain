import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { MoreThanOrEqual, In, Repository } from "typeorm";
import {
  Achievement, GameSession, Quest, UserAchievement, UserQuest,
} from "@/database/entities";
import { EventBusService, Events } from "@/events";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import { RedisService } from "@/common/redis/redis.service";
import {
  dayKey, secondsUntilUtcMidnight, startOfUtcDay, weekKey,
} from "@/common/utils";
import { AuditService } from "@/modules/audit/audit.service";
import { PointsService } from "@/modules/points/points.service";
import type {
  AchievementResponse, AchievementSummaryResponse, ClaimQuestResponse, QuestListResponse,
  QuestMetric, QuestResponse, UpsertQuestRequest,
} from "./dto/quests.dto";

/* ============================================================================
 * Quests and achievements (FRD G-04).
 *
 * The design decisions worth defending:
 *
 *  1. PROGRESS IS SERVER-TRACKED FROM DOMAIN EVENTS. A client never reports
 *     progress. Every increment traces to something the server already
 *     validated — a validated session, a settled tournament, a completed
 *     conversion. A quest that can be progressed by an API call is a quest that
 *     can be farmed.
 *
 *  2. ONE INSTANCE PER PERIOD, ENFORCED BY A UNIQUE INDEX. daily → the UTC day,
 *     weekly → the ISO week, milestone → "lifetime". Periods are UTC because a
 *     quest that rolls over at local midnight is exploitable from a timezone
 *     boundary.
 *
 *  3. REWARDS GO THROUGH PointsService, so the daily caps apply. A quest cannot
 *     be a way around the Points emission ceiling; when a cap intervenes, the
 *     shortfall is reported to the member rather than hidden.
 *
 *  4. CLAIMING IS EXPLICIT AND ONCE. `claimedAt` plus the ledger's idempotency
 *     key on `userQuest.id` mean a double tap cannot pay twice.
 * ========================================================================== */

const CLAIM_LOCK_TTL_SECONDS = 15;

/** Progress increments this service knows how to derive. */
export interface ProgressSignal {
  userId: string;
  metric: QuestMetric;
  amount: number;
  gameId?: string | null;
}

@Injectable()
export class QuestsService {
  private readonly log = new Logger(QuestsService.name);

  constructor(
    @InjectRepository(Quest) private readonly quests: Repository<Quest>,
    @InjectRepository(UserQuest) private readonly userQuests: Repository<UserQuest>,
    @InjectRepository(Achievement) private readonly achievements: Repository<Achievement>,
    @InjectRepository(UserAchievement) private readonly unlocked: Repository<UserAchievement>,
    @InjectRepository(GameSession) private readonly sessions: Repository<GameSession>,
    private readonly points: PointsService,
    private readonly bus: EventBusService,
    private readonly routines: DbRoutinesService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  /* ==================================================================== *
   * Reads
   * ==================================================================== */

  /** Active quests with this period's progress for one member. */
  async listForUser(userId: string): Promise<QuestListResponse> {
    const quests = await this.quests.find({ where: { active: true }, order: { kind: "ASC" } });
    if (quests.length === 0) {
      return { daily: [], weekly: [], milestones: [], readyToClaim: 0, claimablePoints: 0 };
    }

    const instances = await this.userQuests.find({
      where: { userId, questId: In(quests.map((q) => q.id)) },
    });
    const byKey = new Map(instances.map((i) => [`${i.questId}:${i.periodKey}`, i]));

    const views = quests.map((quest) => {
      const period = periodKeyFor(quest.kind);
      const instance = byKey.get(`${quest.id}:${period}`);
      return toQuestView(quest, instance ?? null, period);
    });

    const ready = views.filter((v) => v.completed && !v.claimed);

    return {
      daily: views.filter((v) => v.kind === "daily"),
      weekly: views.filter((v) => v.kind === "weekly"),
      milestones: views.filter((v) => v.kind === "milestone"),
      readyToClaim: ready.length,
      claimablePoints: ready.reduce((acc, v) => acc + v.rewardPoints, 0),
    };
  }

  /* ==================================================================== *
   * Progress
   * ==================================================================== */

  /**
   * Advances every active quest that matches a signal.
   *
   * Called from the domain-event listener, never from a client route. The
   * increment is applied with a bounded update so a burst of concurrent events
   * cannot overshoot the target in a way that pays more than once — the reward
   * is fixed and paid on claim, so overshoot is harmless to the ledger, but a
   * clean value is what the member sees.
   */
  async track(signal: ProgressSignal): Promise<{ advanced: number; completed: string[] }> {
    if (signal.amount <= 0) return { advanced: 0, completed: [] };

    const candidates = await this.quests.find({ where: { active: true } });
    const completed: string[] = [];
    let advanced = 0;

    for (const quest of candidates) {
      const objective = (quest.objective ?? {}) as { metric?: string; gameId?: string | null };
      if (objective.metric !== signal.metric) continue;

      /* A title-specific quest only counts play of that title. */
      const questGameId = quest.gameId ?? objective.gameId ?? null;
      if (questGameId && questGameId !== (signal.gameId ?? null)) continue;

      const period = periodKeyFor(quest.kind);

      /* One statement: create-or-advance, clamped at the target.
       *
       * This was a read, an add in JavaScript, a clamp and a write back — with a
       * lost-update window between them, so two sessions finishing at the same
       * moment could both read 2, both write 3, and the member would lose a step.
       * The procedure does the clamp inside the UPDATE and reports whether THIS
       * call completed the quest, which is what decides the event below. */
      const result = await this.routines.questProgress({
        userId: signal.userId,
        questId: quest.id,
        periodKey: period,
        amount: signal.amount,
        target: quest.target,
        expiresAt: expiryFor(quest.kind),
      });

      /* Already-complete instances stop counting: further progress would inflate
       * a number that cannot pay again. */
      if (result.isComplete && !result.completed) continue;

      if (result.completed) {
        completed.push(quest.id);
        await this.bus.publish(Events.QuestCompleted, {
          userId: signal.userId,
          questId: quest.id,
          title: quest.title,
          kind: quest.kind,
          periodKey: period,
          rewardPoints: quest.rewardPoints,
          /* The member still has to claim it; nothing has been credited yet. */
          claimRequired: true,
        });
      }
      advanced += 1;
    }

    return { advanced, completed };
  }

  /** Creates this period's instance on demand, or returns the existing one. */
  private async instanceFor(userId: string, quest: Quest, period: string): Promise<UserQuest> {
    const found = await this.userQuests.findOne({
      where: { userId, questId: quest.id, periodKey: period },
    });
    if (found) return found;

    return this.userQuests.save(
      this.userQuests.create({
        userId,
        questId: quest.id,
        periodKey: period,
        progress: 0,
        pointsAwarded: 0,
        expiresAt: expiryFor(quest.kind),
      }),
    );
  }

  /* ==================================================================== *
   * Claim
   * ==================================================================== */

  /**
   * Claims a completed quest's reward.
   *
   * The Points go through PointsService, so the per-game and per-day ceilings
   * apply exactly as they do to gameplay. A cap is reported, not hidden: the
   * member sees the promised reward and what was actually credited.
   */
  async claim(userId: string, questId: string): Promise<ClaimQuestResponse> {
    const result = await this.redis.withLock(
      `quest:claim:${userId}:${questId}`,
      CLAIM_LOCK_TTL_SECONDS,
      () => this.claimUnderLock(userId, questId),
    );
    if (result === null) {
      throw new ConflictException({
        code: "CLAIM_IN_FLIGHT",
        message: "This reward is already being claimed",
      });
    }
    return result;
  }

  private async claimUnderLock(userId: string, questId: string): Promise<ClaimQuestResponse> {
    const quest = await this.quests.findOne({ where: { id: questId } });
    if (!quest) throw new NotFoundException("Quest not found");

    const period = periodKeyFor(quest.kind);
    const instance = await this.userQuests.findOne({
      where: { userId, questId, periodKey: period },
    });

    if (!instance || !instance.completedAt) {
      throw new ConflictException({
        code: "QUEST_NOT_COMPLETE",
        message: "This quest is not complete yet",
        progress: instance?.progress ?? 0,
        target: quest.target,
      });
    }
    if (instance.claimedAt) {
      throw new ConflictException({
        code: "ALREADY_CLAIMED",
        message: "This reward has already been claimed",
        pointsAwarded: instance.pointsAwarded,
      });
    }
    if (instance.expiresAt && instance.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException({
        code: "QUEST_EXPIRED",
        message: "This quest's period has closed and the reward can no longer be claimed",
      });
    }

    const credit = await this.points.credit({
      userId,
      amount: quest.rewardPoints,
      source: "quest",
      /* Derived from the instance, so a retried claim resolves to the same
       * ledger row rather than paying twice. */
      idempotencyKey: `quest:${instance.id}`,
      gameId: quest.gameId ?? null,
      note: `Quest reward: ${quest.title}`,
    });

    instance.claimedAt = new Date();
    instance.pointsAwarded = credit.credited;
    await this.userQuests.save(instance);

    return {
      questId,
      title: quest.title,
      rewardPoints: quest.rewardPoints,
      pointsAwarded: credit.credited,
      pointsCapped: credit.capped,
      cappedBy: credit.cappedBy,
      periodKey: period,
    };
  }

  /* ==================================================================== *
   * Achievements
   * ==================================================================== */

  /** Achievements with progress, unlocked state and what each awarded. */
  async achievementsFor(userId: string): Promise<AchievementSummaryResponse> {
    const all = await this.achievements.find({ where: { active: true }, order: { tier: "ASC" } });
    const mine = await this.unlocked.find({ where: { userId } });
    const byId = new Map(mine.map((m) => [m.achievementId, m]));
    const stats = await this.stats(userId);

    const views: AchievementResponse[] = all.map((a) => {
      const criteria = (a.criteria ?? {}) as { metric?: string; value?: number };
      const target = criteria.value ?? 0;
      const got = byId.get(a.id);
      return {
        id: a.id,
        code: a.code,
        title: a.title,
        description: a.description,
        tier: a.tier,
        rewardPoints: a.rewardPoints,
        unlocked: Boolean(got),
        unlockedAt: got ? got.unlockedAt.toISOString() : null,
        progress: Math.min(target, stats[criteria.metric ?? ""] ?? 0),
        target,
        pointsAwarded: got?.pointsAwarded ?? 0,
      };
    });

    return {
      achievements: views,
      unlockedCount: views.filter((v) => v.unlocked).length,
      totalCount: views.length,
      pointsEarned: mine.reduce((acc, m) => acc + m.pointsAwarded, 0),
    };
  }

  /**
   * Unlocks any achievement whose criteria the member now meets.
   *
   * Idempotent through UNIQUE(userId, achievementId): an achievement already
   * unlocked is skipped, so re-evaluating after every session is cheap and safe.
   */
  async evaluateAchievements(userId: string): Promise<{ unlocked: string[]; pointsAwarded: number }> {
    const all = await this.achievements.find({ where: { active: true } });
    if (all.length === 0) return { unlocked: [], pointsAwarded: 0 };

    const already = new Set(
      (await this.unlocked.find({ where: { userId } })).map((m) => m.achievementId),
    );
    const stats = await this.stats(userId);

    const newlyUnlocked: string[] = [];
    let pointsAwarded = 0;

    for (const achievement of all) {
      if (already.has(achievement.id)) continue;
      const criteria = (achievement.criteria ?? {}) as { metric?: string; value?: number };
      const target = criteria.value ?? 0;
      const current = stats[criteria.metric ?? ""] ?? 0;
      if (target <= 0 || current < target) continue;

      let credited = 0;
      if (achievement.rewardPoints > 0) {
        const credit = await this.points.credit({
          userId,
          amount: achievement.rewardPoints,
          source: "achievement",
          idempotencyKey: `achievement:${userId}:${achievement.id}`,
          note: `Achievement unlocked: ${achievement.title}`,
        });
        credited = credit.credited;
      }

      await this.unlocked.save(
        this.unlocked.create({
          userId,
          achievementId: achievement.id,
          unlockedAt: new Date(),
          pointsAwarded: credited,
        }),
      );

      newlyUnlocked.push(achievement.code);
      pointsAwarded += credited;

      await this.bus.publish(Events.AchievementUnlocked, {
        userId,
        code: achievement.code,
        title: achievement.title,
        tier: achievement.tier,
        pointsAwarded: credited,
      });
    }

    return { unlocked: newlyUnlocked, pointsAwarded };
  }

  /**
   * The metrics achievements are measured against.
   *
   * Counted from validated sessions only — an unvalidated or rejected session
   * says nothing about whether someone played.
   */
  private async stats(userId: string): Promise<Record<string, number>> {
    const raw = await this.sessions
      .createQueryBuilder("s")
      .select("COUNT(*)", "sessions")
      .addSelect("COALESCE(SUM(s.pointsAwarded), 0)", "points")
      .addSelect("COALESCE(MAX(s.serverScore), 0)", "bestScore")
      .addSelect("COUNT(DISTINCT s.gameId)", "games")
      .where("s.userId = :userId", { userId })
      .andWhere("s.status = :status", { status: "validated" })
      .getRawOne<{ sessions: string; points: string; bestScore: string; games: string }>();

    /* Today's sessions, with a date filter — this counted EVERY validated
     * session, so `sessions_today` equalled `sessions_total` and any achievement
     * keyed on a daily count unlocked on the member's first ever session.
     * The boundary is UTC, like every other period in this platform. */
    const today = await this.sessions.count({
      where: { userId, status: "validated", createdAt: MoreThanOrEqual(startOfUtcDay()) },
    });

    return {
      sessions_total: Number(raw?.sessions ?? 0),
      points_total: Number(raw?.points ?? 0),
      best_score: Number(raw?.bestScore ?? 0),
      games_played: Number(raw?.games ?? 0),
      sessions_today: today,
    };
  }

  /* ==================================================================== *
   * Event entry points
   * ==================================================================== */

  /**
   * Advances quests from a validated session, then re-evaluates achievements.
   *
   * The two are separate concerns but always happen together: an achievement is
   * a milestone over the same validated history the quest counted.
   */
  async onSessionValidated(payload: {
    userId: string;
    gameId: string;
    serverScore: number;
    pointsAwarded: number;
  }): Promise<void> {
    await this.track({ userId: payload.userId, metric: "sessions", amount: 1, gameId: payload.gameId });
    if (payload.serverScore > 0) {
      await this.track({
        userId: payload.userId, metric: "score", amount: payload.serverScore, gameId: payload.gameId,
      });
    }
    if (payload.pointsAwarded > 0) {
      await this.track({
        userId: payload.userId, metric: "points", amount: payload.pointsAwarded, gameId: payload.gameId,
      });
    }
    await this.evaluateAchievements(payload.userId);
  }

  /** Expires yesterday's unclaimed daily quests. Run by the daily cron. */
  async expireStale(): Promise<number> {
    const cutoff = startOfUtcDay();

    /* A COUNT, and nothing else.
     *
     * Expiry here is DERIVED, not stored: an instance with `expiresAt` in the
     * past and no `claimedAt` is expired by definition, and the claim path
     * already refuses it. So there is no state to write — which is why the
     * previous version, which loaded five thousand entities and then logged
     * their length, was doing work for no reason and reporting it as if rows had
     * been changed.
     *
     * Nothing is deleted either: an expired instance is history, and a member
     * asking "what happened to yesterday's quest?" deserves an answer. */
    const stale = await this.userQuests
      .createQueryBuilder("uq")
      .where("uq.claimedAt IS NULL")
      .andWhere("uq.expiresAt IS NOT NULL")
      .andWhere("uq.expiresAt < :cutoff", { cutoff })
      .getCount();

    if (stale > 0) {
      this.log.log(`${stale} quest instances lapsed unclaimed before ${dayKey(cutoff)}`);
    }
    return stale;
  }

  /* ==================================================================== *
   * Admin
   * ==================================================================== */

  async upsertQuest(dto: UpsertQuestRequest, actorId: string, ip: string | null): Promise<QuestResponse> {
    if (dto.rewardPoints <= 0) throw new BadRequestException("A quest must award Points");

    const existing = dto.id ? await this.quests.findOne({ where: { id: dto.id } }) : null;
    if (dto.id && !existing) throw new NotFoundException("Quest not found");

    const before = existing
      ? { title: existing.title, target: existing.target, rewardPoints: existing.rewardPoints }
      : null;

    const row = existing ?? this.quests.create({});
    row.title = dto.title;
    row.description = dto.description;
    row.kind = dto.kind;
    row.gameId = dto.gameId ?? null;
    row.objective = { metric: dto.metric, value: dto.target, gameId: dto.gameId ?? null };
    row.target = dto.target;
    row.rewardPoints = dto.rewardPoints;
    row.active = true;
    const saved = await this.quests.save(row);

    await this.audit.recordOrThrow({
      actorId,
      action: existing ? "quest.update" : "quest.create",
      targetType: "quest",
      targetId: saved.id,
      before,
      after: { title: dto.title, metric: dto.metric, target: dto.target, rewardPoints: dto.rewardPoints },
      reason: dto.reason,
      ip,
    });

    return toQuestView(saved, null, periodKeyFor(saved.kind));
  }

  async setQuestActive(
    id: string,
    active: boolean,
    reason: string,
    actorId: string,
  ): Promise<QuestResponse> {
    const row = await this.quests.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Quest not found");

    row.active = active;
    await this.quests.save(row);

    await this.audit.recordOrThrow({
      actorId,
      action: "quest.set_active",
      targetType: "quest",
      targetId: id,
      after: { active },
      reason,
    });

    return toQuestView(row, null, periodKeyFor(row.kind));
  }
}

/* --------------------------------- helpers -------------------------------- */

/** UTC period key for a quest kind. Local-time periods are exploitable. */
export function periodKeyFor(kind: Quest["kind"]): string {
  if (kind === "daily") return dayKey();
  if (kind === "weekly") return weekKey();
  return "lifetime";
}

/** When this period's instance stops being claimable. Milestones never expire. */
export function expiryFor(kind: Quest["kind"]): Date | null {
  if (kind === "daily") return new Date(Date.now() + secondsUntilUtcMidnight() * 1_000);
  if (kind === "weekly") {
    /* End of the ISO week: Sunday 23:59:59 UTC. */
    const now = new Date();
    const dow = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
    const daysLeft = 7 - dow;
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysLeft, 23, 59, 59),
    );
    return end;
  }
  return null;
}

function toQuestView(quest: Quest, instance: UserQuest | null, period: string): QuestResponse & { kind: Quest["kind"] } {
  const objective = (quest.objective ?? {}) as { metric?: string };
  const progress = instance?.progress ?? 0;
  const expiresAt = instance?.expiresAt ?? expiryFor(quest.kind);

  return {
    id: quest.id,
    title: quest.title,
    description: quest.description,
    kind: quest.kind,
    gameId: quest.gameId ?? null,
    metric: objective.metric ?? "unknown",
    target: quest.target,
    progress,
    progressPct: quest.target > 0 ? Math.min(100, Math.floor((progress / quest.target) * 100)) : 0,
    rewardPoints: quest.rewardPoints,
    completed: Boolean(instance?.completedAt),
    claimed: Boolean(instance?.claimedAt),
    pointsAwarded: instance?.pointsAwarded ?? 0,
    periodKey: period,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    expiresInSeconds: expiresAt ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 1_000)) : 0,
  };
}
