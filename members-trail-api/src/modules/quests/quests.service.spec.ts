import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import {
  Achievement, GameSession, Quest, UserAchievement, UserQuest,
} from "@/database/entities";
import { EventBusService } from "@/events";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import { RedisService } from "@/common/redis/redis.service";
import { AuditService } from "@/modules/audit/audit.service";
import { PointsService } from "@/modules/points/points.service";
import { QuestsService, expiryFor, periodKeyFor } from "./quests.service";

/* ============================================================================
 * Two properties this module must never lose:
 *
 *   • PROGRESS IS SERVER-DERIVED. No client input advances a quest.
 *   • REWARDS GO THROUGH THE POINTS CAPS. A quest cannot be a way around the
 *     emission ceiling, and a member who was capped is told so.
 * ========================================================================== */

function repo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
    save: jest.fn(async (x: unknown) => ({ id: "uq-1", ...(x as object) })),
    create: jest.fn((x: unknown) => x),
    count: jest.fn(async () => 0),
    createQueryBuilder: jest.fn(),
  };
}

function qb(raw: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "addSelect", "where", "andWhere", "take"]) {
    b[m] = jest.fn(() => b);
  }
  b.getRawOne = jest.fn(async () => raw);
  b.getMany = jest.fn(async () => []);
  return b;
}

const DAILY_QUEST = {
  id: "q-1",
  title: "Play three games",
  description: "Play three sessions today.",
  kind: "daily" as const,
  gameId: null as string | null,
  objective: { metric: "sessions", value: 3 },
  target: 3,
  rewardPoints: 150,
  active: true,
};

describe("QuestsService", () => {
  let svc: QuestsService;
  let quests: ReturnType<typeof repo>;
  let userQuests: ReturnType<typeof repo>;
  let achievements: ReturnType<typeof repo>;
  let unlocked: ReturnType<typeof repo>;
  let sessions: ReturnType<typeof repo>;
  let points: { credit: jest.Mock };
  let bus: { publish: jest.Mock };
  /* Quest progress is one conditional upsert now. The clamp and the
   * "completed by THIS call" semantics live in sp_quest_progress and are
   * asserted against a real database in the e2e suite; here the procedure is a
   * fixture so these tests stay about which quests a signal matches. */
  let routines: { questProgress: jest.Mock };
  let questState: { progress: number; target: number; complete: boolean };
  let redis: { withLock: jest.Mock };
  let audit: { record: jest.Mock; recordOrThrow: jest.Mock };

  beforeEach(async () => {
    quests = repo();
    userQuests = repo();
    achievements = repo();
    unlocked = repo();
    sessions = repo();

    points = {
      credit: jest.fn(async ({ amount }: { amount: number }) => ({
        requested: amount, credited: amount, capped: 0, cappedBy: null,
        headroom: 3_000, meters: [], entryRef: "PT-1", runningBalance: amount, replayed: false,
      })),
    };
    bus = { publish: jest.fn() };
    redis = { withLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()) };
    audit = { record: jest.fn(), recordOrThrow: jest.fn() };

    questState = { progress: 0, target: 3, complete: false };
    routines = {
      questProgress: jest.fn(async (params: { amount: number; target: number }) => {
        const before = questState.complete;
        questState.target = params.target;
        questState.progress = Math.min(params.target, questState.progress + params.amount);
        questState.complete = questState.progress >= params.target;
        return {
          progress: questState.progress,
          completed: questState.complete && !before,
          isComplete: questState.complete,
        };
      }),
    };

    const mod = await Test.createTestingModule({
      providers: [
        QuestsService,
        { provide: getRepositoryToken(Quest), useValue: quests },
        { provide: getRepositoryToken(UserQuest), useValue: userQuests },
        { provide: getRepositoryToken(Achievement), useValue: achievements },
        { provide: getRepositoryToken(UserAchievement), useValue: unlocked },
        { provide: getRepositoryToken(GameSession), useValue: sessions },
        { provide: PointsService, useValue: points },
        { provide: EventBusService, useValue: bus },
        { provide: DbRoutinesService, useValue: routines },
        { provide: RedisService, useValue: redis },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    svc = mod.get(QuestsService);
    sessions.createQueryBuilder.mockImplementation(() =>
      qb({ sessions: "0", points: "0", bestScore: "0", games: "0" }),
    );
  });

  /* ==================================================================== *
   * Periods
   * ==================================================================== */

  describe("period keys", () => {
    it("uses a UTC day key for daily quests, so a timezone cannot reset them early", () => {
      expect(periodKeyFor("daily")).toBe(new Date().toISOString().slice(0, 10));
    });

    it("uses an ISO week key for weekly quests", () => {
      expect(periodKeyFor("weekly")).toMatch(/^\d{4}-W\d{2}$/);
    });

    it("uses a single lifetime bucket for milestones", () => {
      expect(periodKeyFor("milestone")).toBe("lifetime");
    });

    it("expires a daily quest at UTC midnight and never expires a milestone", () => {
      const daily = expiryFor("daily");
      expect(daily?.getTime()).toBeGreaterThan(Date.now());
      expect(expiryFor("milestone")).toBeNull();
    });
  });

  /* ==================================================================== *
   * Progress
   * ==================================================================== */

  describe("track", () => {
    beforeEach(() => {
      quests.find.mockResolvedValue([{ ...DAILY_QUEST }]);
      userQuests.findOne.mockResolvedValue(null);
    });

    it("creates this period's instance on demand and advances it", async () => {
      const r = await svc.track({ userId: "u1", metric: "sessions", amount: 1 });

      expect(r.advanced).toBe(1);
      expect(routines.questProgress).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u1", questId: "q-1", amount: 1, target: 3 }),
      );
      /* No read-modify-write: the create-or-advance is one statement. */
      expect(userQuests.save).not.toHaveBeenCalled();
    });

    it("ignores a signal for a different metric", async () => {
      const r = await svc.track({ userId: "u1", metric: "score", amount: 5 });
      expect(r.advanced).toBe(0);
    });

    it("only counts play of the quest's own title when it is title-specific", async () => {
      quests.find.mockResolvedValue([{ ...DAILY_QUEST, gameId: "game-a" }]);
      const wrong = await svc.track({ userId: "u1", metric: "sessions", amount: 1, gameId: "game-b" });
      expect(wrong.advanced).toBe(0);

      const right = await svc.track({ userId: "u1", metric: "sessions", amount: 1, gameId: "game-a" });
      expect(right.advanced).toBe(1);
    });

    it("clamps progress at the target rather than overshooting", async () => {
      questState.progress = 2;

      const r = await svc.track({ userId: "u1", metric: "sessions", amount: 99 });

      /* The clamp is now inside the UPDATE — which is also what closes the
       * lost-update window two concurrent sessions used to race through. */
      expect(questState.progress).toBe(3);
      expect(r.completed).toEqual(["q-1"]);
    });

    it("marks the quest complete and says a claim is still required", async () => {
      questState.progress = 2;

      const r = await svc.track({ userId: "u1", metric: "sessions", amount: 1 });

      expect(r.completed).toEqual(["q-1"]);
      const [, payload] = bus.publish.mock.calls[0] as [string, Record<string, unknown>];
      expect(payload.claimRequired).toBe(true);
      /* Nothing is credited by progress alone. */
      expect(points.credit).not.toHaveBeenCalled();
    });

    it("stops counting an already-completed instance", async () => {
      /* Completed on an earlier call, so this signal must neither count nor
       * re-publish the completion event. */
      questState.progress = 3;
      questState.complete = true;

      const r = await svc.track({ userId: "u1", metric: "sessions", amount: 1 });

      expect(r.advanced).toBe(0);
      expect(r.completed).toEqual([]);
      expect(bus.publish).not.toHaveBeenCalled();
    });

    it("ignores a non-positive signal", async () => {
      const r = await svc.track({ userId: "u1", metric: "sessions", amount: 0 });
      expect(r.advanced).toBe(0);
      expect(quests.find).not.toHaveBeenCalled();
    });
  });

  /* ==================================================================== *
   * Claim
   * ==================================================================== */

  describe("claim", () => {
    const completed = {
      id: "uq-1", userId: "u1", questId: "q-1", periodKey: periodKeyFor("daily"),
      progress: 3, completedAt: new Date(), claimedAt: null, pointsAwarded: 0,
      expiresAt: new Date(Date.now() + 3_600_000),
    };

    beforeEach(() => {
      quests.findOne.mockResolvedValue({ ...DAILY_QUEST });
      userQuests.findOne.mockResolvedValue({ ...completed });
    });

    it("credits the reward through PointsService, so the daily caps apply", async () => {
      const r = await svc.claim("u1", "q-1");

      expect(points.credit).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 150, source: "quest" }),
      );
      expect(r.pointsAwarded).toBe(150);
    });

    it("reports the cap effect rather than hiding it", async () => {
      points.credit.mockResolvedValue({
        requested: 150, credited: 40, capped: 110, cappedBy: "user_daily",
        headroom: 40, meters: [], entryRef: "PT-1", runningBalance: 40, replayed: false,
      });

      const r = await svc.claim("u1", "q-1");

      expect(r.rewardPoints).toBe(150);
      expect(r.pointsAwarded).toBe(40);
      expect(r.pointsCapped).toBe(110);
      expect(r.cappedBy).toBe("user_daily");
    });

    it("keys the credit on the instance, so a retry cannot pay twice", async () => {
      await svc.claim("u1", "q-1");
      expect(points.credit).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: "quest:uq-1" }),
      );
    });

    it("REFUSES to claim an incomplete quest", async () => {
      userQuests.findOne.mockResolvedValue({ ...completed, completedAt: null, progress: 1 });
      await expect(svc.claim("u1", "q-1"))
        .rejects.toMatchObject({ response: { code: "QUEST_NOT_COMPLETE", progress: 1, target: 3 } });
      expect(points.credit).not.toHaveBeenCalled();
    });

    it("REFUSES a second claim", async () => {
      userQuests.findOne.mockResolvedValue({ ...completed, claimedAt: new Date(), pointsAwarded: 150 });
      await expect(svc.claim("u1", "q-1"))
        .rejects.toMatchObject({ response: { code: "ALREADY_CLAIMED" } });
    });

    it("REFUSES a claim after the period closed", async () => {
      userQuests.findOne.mockResolvedValue({
        ...completed, expiresAt: new Date(Date.now() - 1_000),
      });
      await expect(svc.claim("u1", "q-1"))
        .rejects.toMatchObject({ response: { code: "QUEST_EXPIRED" } });
    });

    it("serialises claims so a double tap cannot pay twice", async () => {
      redis.withLock.mockResolvedValue(null);
      await expect(svc.claim("u1", "q-1"))
        .rejects.toMatchObject({ response: { code: "CLAIM_IN_FLIGHT" } });
    });

    it("does NOT silently destroy the reward when the daily cap is fully consumed", async () => {
      /* The exact scenario the comment on this branch warns about: claimedAt
       * used to be stamped unconditionally, so a fully-capped claim burned the
       * quest for zero Points — every retry then hit ALREADY_CLAIMED, and a
       * daily instance expires before the cap resets. The member never got
       * the reward. */
      points.credit.mockResolvedValue({
        requested: 150, credited: 0, capped: 150, cappedBy: "user_daily",
        headroom: 0, meters: [], entryRef: null, runningBalance: null, replayed: false,
      });

      await expect(svc.claim("u1", "q-1"))
        .rejects.toMatchObject({ response: { code: "POINTS_CAP_REACHED", rewardPoints: 150 } });

      /* The instance is saved with zero pointsAwarded, NOT claimedAt — so a
       * retry once the cap resets can still succeed rather than hitting
       * ALREADY_CLAIMED for a reward it never actually received. */
      expect(userQuests.save).toHaveBeenCalledWith(
        expect.objectContaining({ pointsAwarded: 0, claimedAt: null }),
      );
    });
  });

  /* ==================================================================== *
   * Achievements
   * ==================================================================== */

  describe("evaluateAchievements", () => {
    const achievement = {
      id: "a-1", code: "FIRST_10", title: "Ten sessions", description: "Play ten sessions",
      tier: "bronze" as const, rewardPoints: 200,
      criteria: { metric: "sessions_total", value: 10 }, active: true,
    };

    it("unlocks and awards when the metric is met", async () => {
      achievements.find.mockResolvedValue([achievement]);
      sessions.createQueryBuilder.mockImplementation(() =>
        qb({ sessions: "12", points: "500", bestScore: "900", games: "3" }),
      );

      const r = await svc.evaluateAchievements("u1");

      expect(r.unlocked).toEqual(["FIRST_10"]);
      expect(r.pointsAwarded).toBe(200);
      expect(unlocked.save).toHaveBeenCalledWith(
        expect.objectContaining({ achievementId: "a-1", pointsAwarded: 200 }),
      );
    });

    it("does not unlock before the metric is met", async () => {
      achievements.find.mockResolvedValue([achievement]);
      sessions.createQueryBuilder.mockImplementation(() =>
        qb({ sessions: "4", points: "100", bestScore: "100", games: "1" }),
      );
      const r = await svc.evaluateAchievements("u1");
      expect(r.unlocked).toEqual([]);
      expect(points.credit).not.toHaveBeenCalled();
    });

    it("is idempotent: an already-unlocked achievement is skipped", async () => {
      achievements.find.mockResolvedValue([achievement]);
      unlocked.find.mockResolvedValue([{ achievementId: "a-1", pointsAwarded: 200 }]);
      sessions.createQueryBuilder.mockImplementation(() =>
        qb({ sessions: "99", points: "999", bestScore: "999", games: "9" }),
      );

      const r = await svc.evaluateAchievements("u1");

      expect(r.unlocked).toEqual([]);
      expect(unlocked.save).not.toHaveBeenCalled();
    });

    it("counts VALIDATED sessions only", async () => {
      const builder = qb({ sessions: "12", points: "0", bestScore: "0", games: "1" });
      achievements.find.mockResolvedValue([achievement]);
      sessions.createQueryBuilder.mockReturnValue(builder);

      await svc.evaluateAchievements("u1");

      const statusFilter = (builder.andWhere as jest.Mock).mock.calls.find(
        (c) => typeof c[0] === "string" && (c[0]).includes("s.status"),
      );
      expect(statusFilter?.[1]).toEqual({ status: "validated" });
    });

    it("keys the achievement award per member and achievement", async () => {
      achievements.find.mockResolvedValue([achievement]);
      sessions.createQueryBuilder.mockImplementation(() =>
        qb({ sessions: "12", points: "0", bestScore: "0", games: "1" }),
      );

      await svc.evaluateAchievements("u1");

      expect(points.credit).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: "achievement:u1:a-1" }),
      );
    });

    it("unlocks a zero-reward achievement without touching the ledger", async () => {
      achievements.find.mockResolvedValue([{ ...achievement, rewardPoints: 0 }]);
      sessions.createQueryBuilder.mockImplementation(() =>
        qb({ sessions: "12", points: "0", bestScore: "0", games: "1" }),
      );

      const r = await svc.evaluateAchievements("u1");

      expect(r.unlocked).toEqual(["FIRST_10"]);
      expect(points.credit).not.toHaveBeenCalled();
    });

    it("treats a concurrent unlock (unique-constraint race) as a no-op, not a crash", async () => {
      /* No lock guards this method — two validated sessions for the same user
       * finishing close together can both pass the already-unlocked check
       * before either writes. The loser must not throw the DB's raw
       * duplicate-key error out of an event handler. */
      achievements.find.mockResolvedValue([achievement]);
      sessions.createQueryBuilder.mockImplementation(() =>
        qb({ sessions: "12", points: "0", bestScore: "0", games: "1" }),
      );
      const dupError = Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" });
      unlocked.save.mockRejectedValueOnce(dupError);

      await expect(svc.evaluateAchievements("u1")).resolves.toEqual({ unlocked: [], pointsAwarded: 0 });
    });

    it("still throws a non-duplicate-key error from the unlock write", async () => {
      achievements.find.mockResolvedValue([achievement]);
      sessions.createQueryBuilder.mockImplementation(() =>
        qb({ sessions: "12", points: "0", bestScore: "0", games: "1" }),
      );
      unlocked.save.mockRejectedValueOnce(new Error("connection reset"));

      await expect(svc.evaluateAchievements("u1")).rejects.toThrow("connection reset");
    });
  });

  /* ==================================================================== *
   * Event entry point
   * ==================================================================== */

  describe("onSessionValidated", () => {
    it("advances the session, score and points metrics from one validated session", async () => {
      quests.find.mockResolvedValue([
        { ...DAILY_QUEST, id: "q-sessions", objective: { metric: "sessions" } },
        { ...DAILY_QUEST, id: "q-score", objective: { metric: "score" }, target: 5_000 },
        { ...DAILY_QUEST, id: "q-points", objective: { metric: "points" }, target: 500 },
      ]);
      await svc.onSessionValidated({
        userId: "u1", gameId: "game-1", serverScore: 900, pointsAwarded: 90,
      });

      /* One validated session feeds three metrics: a session count, the score
       * and the Points awarded — each to its own quest, each by the right
       * amount. */
      const advanced = routines.questProgress.mock.calls.map(
        (c) => c[0] as { questId: string; amount: number },
      );
      expect(advanced).toEqual(expect.arrayContaining([
        expect.objectContaining({ questId: "q-sessions", amount: 1 }),
        expect.objectContaining({ questId: "q-score", amount: 900 }),
        expect.objectContaining({ questId: "q-points", amount: 90 }),
      ]));
    });

    it("skips the score and points metrics when the session earned neither", async () => {
      quests.find.mockResolvedValue([{ ...DAILY_QUEST, objective: { metric: "score" } }]);
      await svc.onSessionValidated({
        userId: "u1", gameId: "game-1", serverScore: 0, pointsAwarded: 0,
      });
      expect(userQuests.save).not.toHaveBeenCalled();
    });
  });

  describe("listForUser", () => {
    it("groups quests by kind and totals what is claimable", async () => {
      quests.find.mockResolvedValue([
        { ...DAILY_QUEST },
        { ...DAILY_QUEST, id: "q-2", kind: "weekly", rewardPoints: 500 },
      ]);
      userQuests.find.mockResolvedValue([
        {
          questId: "q-1", periodKey: periodKeyFor("daily"), progress: 3,
          completedAt: new Date(), claimedAt: null, pointsAwarded: 0, expiresAt: null,
        },
      ]);

      const r = await svc.listForUser("u1");

      expect(r.daily).toHaveLength(1);
      expect(r.weekly).toHaveLength(1);
      expect(r.readyToClaim).toBe(1);
      expect(r.claimablePoints).toBe(150);
    });

    it("reports progress as a clamped percentage", async () => {
      quests.find.mockResolvedValue([{ ...DAILY_QUEST }]);
      userQuests.find.mockResolvedValue([
        {
          questId: "q-1", periodKey: periodKeyFor("daily"), progress: 2,
          completedAt: null, claimedAt: null, pointsAwarded: 0, expiresAt: null,
        },
      ]);

      const r = await svc.listForUser("u1");
      expect(r.daily[0].progressPct).toBe(66);
    });

    it("returns empty groups when no quests are configured", async () => {
      quests.find.mockResolvedValue([]);
      const r = await svc.listForUser("u1");
      expect(r).toEqual({ daily: [], weekly: [], milestones: [], readyToClaim: 0, claimablePoints: 0 });
      expect(ConflictException).toBeDefined();
    });
  });

  /* ==================================================================== *
   * Achievements — read side
   * ==================================================================== */

  describe("achievementsFor", () => {
    const ach = {
      id: "a-1", code: "FIRST_10", title: "Ten sessions", description: "Play ten sessions",
      tier: "bronze" as const, rewardPoints: 200,
      criteria: { metric: "sessions_total", value: 10 }, active: true,
    };

    it("reports progress toward a not-yet-unlocked achievement, clamped to its target", async () => {
      achievements.find.mockResolvedValue([ach]);
      unlocked.find.mockResolvedValue([]);
      sessions.createQueryBuilder.mockImplementation(() =>
        qb({ sessions: "4", points: "0", bestScore: "0", games: "1" }),
      );

      const r = await svc.achievementsFor("u1");

      expect(r.achievements).toEqual([
        expect.objectContaining({ id: "a-1", unlocked: false, progress: 4, target: 10, pointsAwarded: 0 }),
      ]);
      expect(r.unlockedCount).toBe(0);
      expect(r.totalCount).toBe(1);
      expect(r.pointsEarned).toBe(0);
    });

    it("reports an unlocked achievement with its award and unlock time", async () => {
      const unlockedAt = new Date("2026-01-01T00:00:00Z");
      achievements.find.mockResolvedValue([ach]);
      unlocked.find.mockResolvedValue([{ achievementId: "a-1", unlockedAt, pointsAwarded: 200 }]);
      sessions.createQueryBuilder.mockImplementation(() =>
        qb({ sessions: "12", points: "0", bestScore: "0", games: "1" }),
      );

      const r = await svc.achievementsFor("u1");

      expect(r.achievements[0]).toEqual(
        expect.objectContaining({
          unlocked: true, unlockedAt: unlockedAt.toISOString(), pointsAwarded: 200, progress: 10,
        }),
      );
      expect(r.unlockedCount).toBe(1);
      expect(r.pointsEarned).toBe(200);
    });
  });

  /* ==================================================================== *
   * Admin
   * ==================================================================== */

  describe("upsertQuest", () => {
    const dto = {
      title: "Play five games", description: "Play five sessions this week.",
      kind: "weekly" as const, metric: "sessions" as const, target: 5, rewardPoints: 300,
      reason: "New weekly objective for the season launch",
    };

    it("REFUSES a quest that awards no Points", async () => {
      await expect(svc.upsertQuest({ ...dto, rewardPoints: 0 }, "admin-1", "1.2.3.4"))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(quests.save).not.toHaveBeenCalled();
    });

    it("creates a new quest and audits it with the given reason", async () => {
      const r = await svc.upsertQuest(dto, "admin-1", "1.2.3.4");

      expect(quests.save).toHaveBeenCalledWith(
        expect.objectContaining({ title: dto.title, target: 5, rewardPoints: 300, active: true }),
      );
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: "admin-1", action: "quest.create", reason: dto.reason, ip: "1.2.3.4",
        }),
      );
      expect(r.title).toBe(dto.title);
    });

    it("REFUSES to update a quest that does not exist", async () => {
      quests.findOne.mockResolvedValue(null);
      await expect(svc.upsertQuest({ ...dto, id: "missing" }, "admin-1", null))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it("audits an update with the before/after values, not just the after", async () => {
      quests.findOne.mockResolvedValue({ ...DAILY_QUEST, id: "q-1" });

      await svc.upsertQuest({ ...dto, id: "q-1" }, "admin-1", null);

      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "quest.update",
          before: expect.objectContaining({ title: DAILY_QUEST.title, target: DAILY_QUEST.target }),
          after: expect.objectContaining({ title: dto.title, target: dto.target }),
        }),
      );
    });
  });

  describe("setQuestActive", () => {
    it("REFUSES to (de)activate a quest that does not exist", async () => {
      quests.findOne.mockResolvedValue(null);
      await expect(svc.setQuestActive("missing", true, "cleaning up the seasonal list", "admin-1"))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it("flips active and audits the change with the given reason", async () => {
      quests.findOne.mockResolvedValue({ ...DAILY_QUEST, active: true });

      await svc.setQuestActive("q-1", false, "seasonal event ended", "admin-1");

      expect(quests.save).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: "admin-1", action: "quest.set_active", reason: "seasonal event ended",
          after: { active: false },
        }),
      );
    });
  });

  describe("expireStale", () => {
    it("counts lapsed unclaimed instances without deleting or loading them", async () => {
      const builder = qb({});
      builder.getCount = jest.fn(async () => 7);
      userQuests.createQueryBuilder.mockReturnValue(builder);

      const n = await svc.expireStale();

      expect(n).toBe(7);
      expect(userQuests.save).not.toHaveBeenCalled();
    });

    it("returns zero without logging when nothing has lapsed", async () => {
      const builder = qb({});
      builder.getCount = jest.fn(async () => 0);
      userQuests.createQueryBuilder.mockReturnValue(builder);

      await expect(svc.expireStale()).resolves.toBe(0);
    });
  });
});
