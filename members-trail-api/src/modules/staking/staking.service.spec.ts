import { NotFoundException } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import {
  StakingAprHistory, StakingPool, StakingPosition, StakingReward,
} from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { EventBusService } from "@/events";
import { Queues } from "@/queues/queue.constants";
import { chainConfig } from "@/config/configuration";
import { RedisService } from "@/common/redis/redis.service";
import { AuditService } from "@/modules/audit/audit.service";
import { StakingService, daysInPeriod } from "./staking.service";

/* ============================================================================
 * The defining property of this module: the EARLY-EXIT PENALTY APPLIES TO
 * UNCLAIMED REWARDS ONLY, NEVER TO PRINCIPAL.
 *
 * A product that can return less principal than was staked is a fundamentally
 * different financial instrument from one that forfeits unearned yield — with
 * different disclosure obligations and a different licence. The tests below pin
 * that boundary, plus the mirror discipline that keeps this module from becoming
 * a second, disagreeing source of truth alongside the chain.
 * ========================================================================== */

const DAY = 86_400_000;

function repo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(async (): Promise<unknown[]> => []),
    save: jest.fn(async (x: unknown) => x),
    create: jest.fn((x: unknown) => x),
    createQueryBuilder: jest.fn(),
  };
}

function qb(raw: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "where", "andWhere", "orderBy", "skip", "take"]) {
    b[m] = jest.fn(() => b);
  }
  b.getRawOne = jest.fn(async () => raw);
  b.getManyAndCount = jest.fn(async () => [[], 0]);
  b.getMany = jest.fn(async () => []);
  return b;
}

const POOL = {
  id: "pool-uuid",
  poolId: 1,
  name: "90-day lock",
  lockDays: 90,
  rewardsDurationDays: 90,
  earlyPenaltyBps: 2_500, // 25% of unclaimed rewards
  active: true,
  totalStaked: "10000.000000000000000000",
  totalRewardsFunded: "1000.000000000000000000",
  totalRewardsPaid: "200.000000000000000000",
  currentApr: "12.5000",
  lastSyncedBlock: 1_000,
  updatedAt: new Date(),
};

/** Locked for another 30 days, with 100 MTT of unclaimed rewards. */
const LOCKED_POSITION = {
  id: "pos-1",
  userId: "u1",
  poolId: 1,
  amount: "1000.000000000000000000",
  pendingRewards: "100.000000000000000000",
  stakedAt: new Date(Date.now() - 60 * DAY),
  lockEnd: new Date(Date.now() + 30 * DAY),
  lastSyncedBlock: 1_000,
};

describe("StakingService", () => {
  let svc: StakingService;
  let pools: ReturnType<typeof repo>;
  let positions: ReturnType<typeof repo>;
  let rewards: ReturnType<typeof repo>;
  let aprHistory: ReturnType<typeof repo>;
  let ledger: { getBalance: jest.Mock; transferBucket: jest.Mock; mutateMtt: jest.Mock };
  let bus: { publish: jest.Mock };
  let redis: { withLock: jest.Mock };
  let audit: { record: jest.Mock; recordOrThrow: jest.Mock };
  let txQueue: { add: jest.Mock };

  beforeEach(async () => {
    pools = repo();
    positions = repo();
    rewards = repo();
    aprHistory = repo();

    ledger = {
      getBalance: jest.fn(async () => ({ mttAvailable: "5000.000000000000000000" })),
      transferBucket: jest.fn(async () => ({ row: {}, replayed: false })),
      mutateMtt: jest.fn(async () => ({ row: {}, replayed: false })),
    };
    bus = { publish: jest.fn() };
    redis = { withLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()) };
    audit = { record: jest.fn(), recordOrThrow: jest.fn() };
    txQueue = { add: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        StakingService,
        { provide: getRepositoryToken(StakingPool), useValue: pools },
        { provide: getRepositoryToken(StakingPosition), useValue: positions },
        { provide: getRepositoryToken(StakingReward), useValue: rewards },
        { provide: getRepositoryToken(StakingAprHistory), useValue: aprHistory },
        { provide: LedgerService, useValue: ledger },
        { provide: EventBusService, useValue: bus },
        { provide: RedisService, useValue: redis },
        { provide: AuditService, useValue: audit },
        {
          provide: chainConfig.KEY,
          useValue: { contracts: { staking: "0xStaking" }, chainId: 97 },
        },
        { provide: getQueueToken(Queues.ChainTx), useValue: txQueue },
      ],
    }).compile();

    svc = mod.get(StakingService);
    pools.findOne.mockResolvedValue({ ...POOL });
    positions.findOne.mockResolvedValue({ ...LOCKED_POSITION });
    rewards.createQueryBuilder.mockImplementation(() => qb({ sum: "0" }));
  });

  /* ==================================================================== *
   * THE penalty rule
   * ==================================================================== */

  describe("previewUnstake — the penalty boundary", () => {
    it("applies the penalty to unclaimed REWARDS and returns principal IN FULL", async () => {
      const p = await svc.previewUnstake("u1", 1);

      /* 25% of 100 MTT rewards = 25 MTT forfeited. */
      expect(p.penaltyMtt).toBe("25.000000000000000000");
      expect(p.rewardsPayable).toBe("75.000000000000000000");
      /* Principal is untouched — this is the line that must never move. */
      expect(p.principal).toBe("1000.000000000000000000");
      expect(p.totalReceived).toBe("1075.000000000000000000");
    });

    it("never takes a penalty from principal even at a 100% penalty rate", async () => {
      pools.findOne.mockResolvedValue({ ...POOL, earlyPenaltyBps: 10_000 });
      const p = await svc.previewUnstake("u1", 1);
      expect(p.penaltyMtt).toBe("100.000000000000000000");
      expect(p.rewardsPayable).toBe("0.000000000000000000");
      expect(p.principal).toBe("1000.000000000000000000");
      expect(p.totalReceived).toBe("1000.000000000000000000");
    });

    it("charges nothing at all once the lock has expired", async () => {
      positions.findOne.mockResolvedValue({ ...LOCKED_POSITION, lockEnd: new Date(Date.now() - DAY) });
      const p = await svc.previewUnstake("u1", 1);
      expect(p.early).toBe(false);
      expect(p.penaltyBps).toBe(0);
      expect(p.penaltyMtt).toBe("0.000000000000000000");
      expect(p.rewardsPayable).toBe("100.000000000000000000");
    });

    it("treats a flexible position with no lock as never early", async () => {
      positions.findOne.mockResolvedValue({ ...LOCKED_POSITION, lockEnd: null });
      const p = await svc.previewUnstake("u1", 1);
      expect(p.early).toBe(false);
      expect(p.penaltyFreeAt).toBeNull();
    });

    it("charges nothing when there are no rewards to forfeit, however early", async () => {
      positions.findOne.mockResolvedValue({ ...LOCKED_POSITION, pendingRewards: "0" });
      const p = await svc.previewUnstake("u1", 1);
      expect(p.early).toBe(true);
      expect(p.penaltyMtt).toBe("0.000000000000000000");
      expect(p.totalReceived).toBe("1000.000000000000000000");
    });

    it("tells the member when the penalty would disappear", async () => {
      const p = await svc.previewUnstake("u1", 1);
      expect(p.penaltyFreeAt).toBe(LOCKED_POSITION.lockEnd.toISOString());
    });

    it("404s rather than inventing a zero position", async () => {
      positions.findOne.mockResolvedValue(null);
      await expect(svc.previewUnstake("u1", 1)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  /* ==================================================================== *
   * Intents
   * ==================================================================== */

  describe("requestStake", () => {
    it("reserves the MTT and queues a transaction — it does NOT create a position", async () => {
      const r = await svc.requestStake("u1", { poolId: 1, amountMtt: "500" });

      expect(ledger.transferBucket).toHaveBeenCalledWith(
        expect.objectContaining({ from: "available", to: "staked", amount: "500.000000000000000000" }),
      );
      expect(txQueue.add).toHaveBeenCalledWith(
        "submit-tx",
        expect.objectContaining({ kind: "stake", poolId: 1, contract: "0xStaking" }),
        expect.objectContaining({ jobId: expect.stringContaining("stake-") }),
      );
      /* The position is written by the indexer, never here. */
      expect(positions.save).not.toHaveBeenCalled();
      expect(r.status).toBe("queued");
    });

    it("derives the reservation's ledger key from the intent ref, so a retry cannot reserve twice", async () => {
      await svc.requestStake("u1", { poolId: 1, amountMtt: "500" });
      const [args] = ledger.transferBucket.mock.calls[0] as [{ idempotencyKey: string }];
      expect(args.idempotencyKey).toMatch(/^stake-intent:TX-/);
    });

    it("REFUSES when the spendable balance is short, reserving and queueing nothing", async () => {
      ledger.getBalance.mockResolvedValue({ mttAvailable: "100.000000000000000000" });
      await expect(svc.requestStake("u1", { poolId: 1, amountMtt: "500" }))
        .rejects.toMatchObject({ response: { code: "INSUFFICIENT_BALANCE" } });
      expect(ledger.transferBucket).not.toHaveBeenCalled();
      expect(txQueue.add).not.toHaveBeenCalled();
    });

    it("refuses a closed pool", async () => {
      pools.findOne.mockResolvedValue({ ...POOL, active: false });
      await expect(svc.requestStake("u1", { poolId: 1, amountMtt: "500" }))
        .rejects.toMatchObject({ response: { code: "POOL_CLOSED" } });
    });

    it("refuses a non-positive amount", async () => {
      await expect(svc.requestStake("u1", { poolId: 1, amountMtt: "0" })).rejects.toThrow();
    });

    it("serialises intents per member and pool, so two taps cannot both reserve", async () => {
      redis.withLock.mockResolvedValue(null);
      await expect(svc.requestStake("u1", { poolId: 1, amountMtt: "500" }))
        .rejects.toMatchObject({ response: { code: "STAKING_INTENT_IN_FLIGHT" } });
    });
  });

  describe("requestUnstake", () => {
    it("REFUSES an early exit unless the penalty is explicitly accepted", async () => {
      await expect(svc.requestUnstake("u1", { poolId: 1, acceptPenalty: false }))
        .rejects.toMatchObject({
          response: {
            code: "PENALTY_NOT_ACCEPTED",
            penaltyMtt: "25.000000000000000000",
            principalReturnedInFull: true,
          },
        });
      expect(txQueue.add).not.toHaveBeenCalled();
    });

    it("queues the exit with the accepted penalty snapshotted onto the job", async () => {
      const r = await svc.requestUnstake("u1", { poolId: 1, acceptPenalty: true });

      expect(txQueue.add).toHaveBeenCalledWith(
        "submit-tx",
        expect.objectContaining({
          kind: "unstake",
          amountMtt: "1000.000000000000000000",
          penaltyMtt: "25.000000000000000000",
          early: true,
        }),
        expect.anything(),
      );
      expect(r.penaltyMtt).toBe("25.000000000000000000");
    });

    it("needs no acceptance once the lock has expired", async () => {
      positions.findOne.mockResolvedValue({ ...LOCKED_POSITION, lockEnd: new Date(Date.now() - DAY) });
      const r = await svc.requestUnstake("u1", { poolId: 1, acceptPenalty: false });
      expect(r.penaltyMtt).toBe("0.000000000000000000");
    });

    it("refuses when there is no principal staked", async () => {
      positions.findOne.mockResolvedValue({ ...LOCKED_POSITION, amount: "0" });
      await expect(svc.requestUnstake("u1", { poolId: 1, acceptPenalty: true }))
        .rejects.toMatchObject({ response: { code: "NO_POSITION" } });
    });
  });

  describe("requestClaim", () => {
    it("queues a claim for the unclaimed rewards", async () => {
      const r = await svc.requestClaim("u1", { poolId: 1 });
      expect(r.amountMtt).toBe("100.000000000000000000");
      expect(txQueue.add).toHaveBeenCalledWith(
        "submit-tx", expect.objectContaining({ kind: "claim" }), expect.anything(),
      );
    });

    it("refuses when there is nothing to claim, rather than queueing a no-op transaction", async () => {
      positions.findOne.mockResolvedValue({ ...LOCKED_POSITION, pendingRewards: "0" });
      await expect(svc.requestClaim("u1", { poolId: 1 }))
        .rejects.toMatchObject({ response: { code: "NO_REWARDS" } });
      expect(txQueue.add).not.toHaveBeenCalled();
    });
  });

  /* ==================================================================== *
   * Mirror
   * ==================================================================== */

  describe("mirrorUnstake", () => {
    it("returns principal to the spendable balance IN FULL, penalty notwithstanding", async () => {
      await svc.mirrorUnstake({
        userId: "u1", poolId: 1,
        principalMtt: "1000", rewardsPaidMtt: "75", penaltyMtt: "25",
        blockNumber: 1_100, txHash: "0xabc",
      });

      const [principalMove] = ledger.transferBucket.mock.calls[0] as [Record<string, unknown>];
      expect(principalMove.from).toBe("staked");
      expect(principalMove.to).toBe("available");
      expect(principalMove.amount).toBe("1000.000000000000000000");

      /* Rewards net of the penalty are credited separately. */
      expect(ledger.mutateMtt).toHaveBeenCalledWith(
        expect.objectContaining({ amountMtt: "75.000000000000000000", type: "reward_claim" }),
      );
    });

    it("records on the event that the penalty applied to rewards, not principal", async () => {
      await svc.mirrorUnstake({
        userId: "u1", poolId: 1,
        principalMtt: "1000", rewardsPaidMtt: "75", penaltyMtt: "25",
        blockNumber: 1_100, txHash: "0xabc",
      });
      const [, payload] = bus.publish.mock.calls[0] as [string, Record<string, unknown>];
      expect(payload.penaltyAppliedTo).toBe("unclaimed_rewards");
    });

    it("keys the ledger movement on the tx hash, so a re-indexed event cannot double-credit", async () => {
      await svc.mirrorUnstake({
        userId: "u1", poolId: 1,
        principalMtt: "1000", rewardsPaidMtt: "0", penaltyMtt: "0",
        blockNumber: 1_100, txHash: "0xabc",
      });
      const [move] = ledger.transferBucket.mock.calls[0] as [{ idempotencyKey: string }];
      expect(move.idempotencyKey).toBe("unstake:0xabc:1");
    });

    it("credits no reward transaction when the exit paid no rewards", async () => {
      await svc.mirrorUnstake({
        userId: "u1", poolId: 1,
        principalMtt: "1000", rewardsPaidMtt: "0", penaltyMtt: "100",
        blockNumber: 1_100, txHash: "0xabc",
      });
      expect(ledger.mutateMtt).not.toHaveBeenCalled();
    });

    it("never lets the mirrored position or TVL go negative", async () => {
      positions.findOne.mockResolvedValue({ ...LOCKED_POSITION, amount: "500" });
      await svc.mirrorUnstake({
        userId: "u1", poolId: 1,
        principalMtt: "1000", rewardsPaidMtt: "0", penaltyMtt: "0",
        blockNumber: 1_100, txHash: "0xabc",
      });
      expect(positions.save).toHaveBeenCalledWith(
        expect.objectContaining({ amount: "0.000000000000000000" }),
      );
    });
  });

  describe("mirrorStake", () => {
    it("adds to the position and the pool TVL, stamping the synced block", async () => {
      positions.findOne.mockResolvedValue({ ...LOCKED_POSITION });
      await svc.mirrorStake({
        userId: "u1", poolId: 1, amountMtt: "500",
        lockEnd: null, blockNumber: 1_200, txHash: "0xdef",
      });

      expect(positions.save).toHaveBeenCalledWith(
        expect.objectContaining({ amount: "1500.000000000000000000", lastSyncedBlock: 1_200 }),
      );
      expect(pools.save).toHaveBeenCalledWith(
        expect.objectContaining({ totalStaked: "10500.000000000000000000" }),
      );
    });
  });

  describe("syncPendingRewards", () => {
    it("ASSIGNS the chain's figure rather than accumulating — accumulation double-counts", async () => {
      positions.findOne.mockResolvedValue({ ...LOCKED_POSITION });
      await svc.syncPendingRewards({
        userId: "u1", poolId: 1, pendingRewardsMtt: "140", blockNumber: 1_300,
      });
      expect(positions.save).toHaveBeenCalledWith(
        expect.objectContaining({ pendingRewards: "140.000000000000000000" }),
      );
    });
  });

  describe("revertStakeIntent", () => {
    it("returns the reservation in full, keyed on the intent so a repeat cannot pay twice", async () => {
      await svc.revertStakeIntent({
        userId: "u1", intentRef: "TX-ABC", amountMtt: "500", reason: "gas price ceiling exceeded",
      });
      expect(ledger.transferBucket).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "staked", to: "available",
          amount: "500.000000000000000000",
          idempotencyKey: "stake-revert:TX-ABC",
        }),
      );
    });
  });

  /* ==================================================================== *
   * APR
   * ==================================================================== */

  describe("recomputeApr", () => {
    it("annualises inflow over TVL: 100 into 10,000 in a 31-day month ≈ 11.77%", async () => {
      rewards.createQueryBuilder.mockImplementation(() => qb({ sum: "100" }));
      const r = await svc.recomputeApr(1, "2026-01");
      /* 100/10000 × (365/31) × 100 = 11.7741… truncated to 4dp. */
      expect(r?.apr).toBe("11.7741");
      expect(r?.tvl).toBe("10000.000000000000000000");
    });

    it("records NO observation for a pool with no TVL — 0% would imply a measurement", async () => {
      pools.findOne.mockResolvedValue({ ...POOL, totalStaked: "0" });
      const r = await svc.recomputeApr(1, "2026-01");
      expect(r).toBeNull();
      expect(aprHistory.save).not.toHaveBeenCalled();
    });

    it("updates an existing period rather than duplicating it", async () => {
      rewards.createQueryBuilder.mockImplementation(() => qb({ sum: "100" }));
      aprHistory.findOne.mockResolvedValue({ id: "apr-1", poolId: 1, periodKey: "2026-01" });
      await svc.recomputeApr(1, "2026-01");
      expect(aprHistory.save).toHaveBeenCalledWith(expect.objectContaining({ id: "apr-1" }));
    });

    it("writes the observation onto the pool as its current trailing figure", async () => {
      rewards.createQueryBuilder.mockImplementation(() => qb({ sum: "100" }));
      await svc.recomputeApr(1, "2026-01");
      expect(pools.save).toHaveBeenCalledWith(
        expect.objectContaining({ currentApr: "11.7741" }),
      );
    });
  });

  describe("daysInPeriod", () => {
    it.each([
      ["2026-01", 31],
      ["2026-02", 28],
      ["2024-02", 29],
      ["2026-04", 30],
      ["2026-04-15", 1],
    ])("resolves %s to %i days", (key, expected) => {
      expect(daysInPeriod(key)).toBe(expected);
    });
  });

  /* ==================================================================== *
   * Pool presentation
   * ==================================================================== */

  describe("listPools", () => {
    it("reports rewards remaining as funded minus paid, floored at zero", async () => {
      pools.find.mockResolvedValue([{ ...POOL }]);
      const [p] = await svc.listPools();
      expect(p.rewardsRemaining).toBe("800.000000000000000000");
    });

    it("flags a pool whose mirror is behind as stale rather than presenting it as current", async () => {
      pools.find.mockResolvedValue([
        { ...POOL, updatedAt: new Date(Date.now() - 60 * 60_000) },
      ]);
      const [p] = await svc.listPools();
      expect(p.stale).toBe(true);
    });

    it("flags a pool that has never synced as stale", async () => {
      pools.find.mockResolvedValue([{ ...POOL, lastSyncedBlock: null }]);
      const [p] = await svc.listPools();
      expect(p.stale).toBe(true);
    });
  });

  describe("upsertPool", () => {
    it("audits the mirror change with a reason — a wrong mirror misinforms every member", async () => {
      pools.findOne.mockResolvedValue(null);
      await svc.upsertPool(
        {
          poolId: 2, name: "Flexible", lockDays: 0, rewardsDurationDays: 30,
          earlyPenaltyBps: 0, active: true, reason: "mirroring pool 2 deployed on chain",
        },
        "finance-1",
        "1.2.3.4",
      );
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ action: "staking.pool.create", reason: "mirroring pool 2 deployed on chain" }),
      );
    });

    it("records the previous terms when updating, so a change is reviewable", async () => {
      pools.findOne.mockResolvedValue({ ...POOL });
      await svc.upsertPool(
        {
          poolId: 1, name: "90-day lock", lockDays: 90, rewardsDurationDays: 90,
          earlyPenaltyBps: 1_000, active: true, reason: "penalty lowered on chain",
        },
        "finance-1",
        null,
      );
      const [entry] = audit.recordOrThrow.mock.calls[0] as [{ before: Record<string, unknown> }];
      expect(entry.before.earlyPenaltyBps).toBe(2_500);
    });
  });

});
