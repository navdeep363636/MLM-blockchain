import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { BadRequestException } from "@nestjs/common";
import { Game, PointsLedgerEntry } from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { EventBusService, Events } from "@/events";
import { RedisService } from "@/common/redis/redis.service";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import { PointsService } from "./points.service";

/* ============================================================================
 * The cap clamp is the only thing standing between the token emission schedule
 * and an unbounded Points supply, so these tests target the arithmetic and the
 * refusal path rather than the plumbing.
 * ========================================================================== */

interface Sums {
  global: number;
  game: number;
  session: number;
}

interface FakeQb {
  select: jest.Mock;
  addSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  groupBy: jest.Mock;
  limit: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  getRawOne: jest.Mock;
  getMany: jest.Mock;
  getManyAndCount: jest.Mock;
}

/** Query-builder stand-in that answers each SUM according to the filters the
 *  service applied — which is how we assert *which* cap was consulted. */
function makeQueryBuilder(sums: Sums): FakeQb {
  const conditions: string[] = [];
  const qb: FakeQb = {
    select: jest.fn(() => qb),
    addSelect: jest.fn(() => qb),
    where: jest.fn((c: string) => {
      conditions.push(c);
      return qb;
    }),
    andWhere: jest.fn((c: string) => {
      conditions.push(c);
      return qb;
    }),
    orderBy: jest.fn(() => qb),
    groupBy: jest.fn(() => qb),
    limit: jest.fn(() => qb),
    skip: jest.fn(() => qb),
    take: jest.fn(() => qb),
    getRawOne: jest.fn(async () => {
      const joined = conditions.join(" ");
      if (joined.includes("gameSessionId")) return { sum: String(sums.session) };
      if (joined.includes("gameId")) return { sum: String(sums.game) };
      return { sum: String(sums.global) };
    }),
    getMany: jest.fn(async () => []),
    getManyAndCount: jest.fn(async () => [[], 0]),
  };
  return qb;
}

const GAME: Partial<Game> = {
  id: "game-1",
  title: "Trail Runner",
  dailyPointsCap: 3_000,
  sessionPointsCap: 500,
  active: true,
};

describe("PointsService.credit — cap clamp", () => {
  let service: PointsService;
  let sums: Sums;
  let mutatePoints: jest.Mock;
  let publish: jest.Mock;
  let findOne: jest.Mock;

  const build = async (overrides: { caps?: Partial<{ dailyGlobal: number; perGameDailyDefault: number; perSessionDefault: number }> } = {}) => {
    sums = { global: 0, game: 0, session: 0 };
    mutatePoints = jest.fn(async (m: { amount: number }) => ({
      row: { ref: "PT-TEST", runningBalance: m.amount, amount: m.amount },
      replayed: false,
    }));
    publish = jest.fn(async () => undefined);
    /* No prior entry for this idempotencyKey unless a test says otherwise —
     * the normal, first-time-credit case. */
    findOne = jest.fn(async () => null);

    const entriesRepo = { createQueryBuilder: jest.fn(() => makeQueryBuilder(sums)), findOne };
    const gamesRepo = {
      findOne: jest.fn(async () => GAME as Game),
      find: jest.fn(async () => [GAME as Game]),
    };

    const module = await Test.createTestingModule({
      providers: [
        PointsService,
        { provide: getRepositoryToken(PointsLedgerEntry), useValue: entriesRepo },
        { provide: getRepositoryToken(Game), useValue: gamesRepo },
        {
          provide: LedgerService,
          useValue: { mutatePoints, getBalance: jest.fn(async () => ({ points: 0 })) },
        },
        { provide: EventBusService, useValue: { publish } },
        {
          provide: RedisService,
          useValue: {
            /* Run the critical section inline: the lock's job is exclusion, and
             * a unit test has no concurrency to exclude. */
            withLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()),
          },
        },
        {
          provide: EconomyConfigService,
          useValue: {
            pointsCaps: jest.fn(async () => ({
              dailyGlobal: 25_000,
              perGameDailyDefault: 3_000,
              perSessionDefault: 1_000,
              ...(overrides.caps ?? {}),
            })),
          },
        },
      ],
    }).compile();

    service = module.get(PointsService);
  };

  beforeEach(() => build());

  it("credits the full amount when every cap has headroom", async () => {
    const res = await service.credit({
      userId: "u1", amount: 250, source: "gameplay",
      idempotencyKey: "session:s1", gameId: "game-1", gameSessionId: "s1",
    });

    expect(res.credited).toBe(250);
    expect(res.capped).toBe(0);
    expect(res.cappedBy).toBeNull();
    expect(mutatePoints).toHaveBeenCalledWith(expect.objectContaining({ amount: 250 }));
    expect(publish).not.toHaveBeenCalledWith(Events.PointsCapReached, expect.anything());
  });

  it("clamps to the remaining game-daily headroom instead of rejecting the credit", async () => {
    sums.game = 2_900;   // 100 left of the 3,000 daily cap for this title

    const res = await service.credit({
      userId: "u1", amount: 400, source: "gameplay",
      idempotencyKey: "session:s2", gameId: "game-1", gameSessionId: "s2",
    });

    expect(res.credited).toBe(100);
    expect(res.capped).toBe(300);
    expect(res.cappedBy).toBe("game_daily");
    expect(mutatePoints).toHaveBeenCalledWith(expect.objectContaining({ amount: 100 }));
  });

  it("lets the per-session cap bind when it is the tightest constraint", async () => {
    sums.session = 480;  // 20 left of the 500 session cap

    const res = await service.credit({
      userId: "u1", amount: 300, source: "gameplay",
      idempotencyKey: "session:s3", gameId: "game-1", gameSessionId: "s3",
    });

    expect(res.credited).toBe(20);
    expect(res.capped).toBe(280);
    expect(res.cappedBy).toBe("session");
  });

  it("lets the global per-user daily cap bind across sources", async () => {
    await build({ caps: { dailyGlobal: 1_000 } });
    sums.global = 950;   // 50 left overall, even though the game cap is untouched

    const res = await service.credit({
      userId: "u1", amount: 500, source: "quest", idempotencyKey: "quest:q1",
    });

    expect(res.credited).toBe(50);
    expect(res.capped).toBe(450);
    expect(res.cappedBy).toBe("user_daily");
  });

  it("writes no ledger row at all when the cap is fully consumed", async () => {
    sums.game = 3_000;   // exhausted

    const res = await service.credit({
      userId: "u1", amount: 120, source: "gameplay",
      idempotencyKey: "session:s4", gameId: "game-1",
    });

    expect(res.credited).toBe(0);
    expect(res.capped).toBe(120);
    expect(mutatePoints).not.toHaveBeenCalled();
  });

  it("publishes PointsCapReached with the refused amount and no carry-over", async () => {
    sums.game = 2_950;

    await service.credit({
      userId: "u1", amount: 200, source: "gameplay",
      idempotencyKey: "session:s5", gameId: "game-1",
    });

    expect(publish).toHaveBeenCalledWith(
      Events.PointsCapReached,
      expect.objectContaining({
        userId: "u1",
        cap: "game_daily",
        requested: 200,
        refused: 150,
        carriedOver: false,
      }),
    );
  });

  it("never exceeds a cap even when several apply at once", async () => {
    await build({ caps: { dailyGlobal: 1_000 } });
    sums.global = 900;   // 100
    sums.game = 2_950;   // 50   ← tightest
    sums.session = 400;  // 100

    const res = await service.credit({
      userId: "u1", amount: 10_000, source: "gameplay",
      idempotencyKey: "session:s6", gameId: "game-1", gameSessionId: "s6",
    });

    expect(res.credited).toBe(50);
    expect(res.headroom).toBe(50);
    expect(res.credited).toBeLessThanOrEqual(res.headroom);
  });

  it("refuses fractional and non-positive amounts", async () => {
    await expect(
      service.credit({ userId: "u1", amount: 1.5, source: "gameplay", idempotencyKey: "k1" }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.credit({ userId: "u1", amount: -10, source: "gameplay", idempotencyKey: "k2" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  /* ==================================================================== *
   * Idempotency — a retry has to resolve to the row already on the ledger,
   * not be re-evaluated against headroom that already reflects it.
   * ==================================================================== */

  describe("replay", () => {
    it("returns the ORIGINAL credited amount on retry, even once headroom is now fully consumed", async () => {
      /* First call: 100 headroom, credits 100. */
      const res1 = await service.credit({
        userId: "u1", amount: 100, source: "gameplay", idempotencyKey: "session:s1",
      });
      expect(res1.credited).toBe(100);
      expect(res1.replayed).toBe(false);

      /* The retry arrives after the day's cap is now fully consumed by other
       * activity (including this very credit). Before the fix, headroom was
       * computed BEFORE the idempotency check, clamped the retry to 0, and
       * returned as if nothing had ever been credited — even though the
       * ledger already held the row. */
      findOne.mockResolvedValue({ ref: "PT-TEST", amount: 100, runningBalance: 100 });
      sums.global = 25_000; // global cap now fully saturated

      const res2 = await service.credit({
        userId: "u1", amount: 100, source: "gameplay", idempotencyKey: "session:s1",
      });

      expect(res2.replayed).toBe(true);
      expect(res2.credited).toBe(100);
      expect(res2.entryRef).toBe("PT-TEST");
      expect(mutatePoints).toHaveBeenCalledTimes(1); // never re-invoked for the retry
    });

    it("reports capped as requested-minus-actually-credited on replay, not a re-clamp against current headroom", async () => {
      /* Original request asked for 400, was clamped to 100 (300 capped) and
       * persisted as amount=100. */
      findOne.mockResolvedValue({ ref: "PT-TEST", amount: 100, runningBalance: 100 });

      const res = await service.credit({
        userId: "u1", amount: 400, source: "gameplay", idempotencyKey: "session:s2",
      });

      expect(res.replayed).toBe(true);
      expect(res.credited).toBe(100);
      expect(res.capped).toBe(300);
      expect(mutatePoints).not.toHaveBeenCalled();
    });

    it("does not publish PointsCredited or PointsCapReached again for a replay", async () => {
      findOne.mockResolvedValue({ ref: "PT-TEST", amount: 100, runningBalance: 100 });

      await service.credit({
        userId: "u1", amount: 100, source: "gameplay", idempotencyKey: "session:s3",
      });

      expect(publish).not.toHaveBeenCalled();
    });
  });
});
