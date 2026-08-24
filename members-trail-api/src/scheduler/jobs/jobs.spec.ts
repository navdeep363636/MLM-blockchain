import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { Test } from "@nestjs/testing";
import { DiscoveryModule } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { RedisService } from "@/common/redis/redis.service";
import { EconomyJobs } from "./economy.job";
import { PlatformJobs } from "./platform.job";

/* ============================================================================
 * Crons are the part of the system nobody watches until it has been broken for
 * a week, so three properties are asserted here rather than assumed:
 *
 *  1. EVERY job body runs under a Redis lock. Without it, two scheduler
 *     instances double-count a rollup, and one slow run overlaps itself.
 *  2. A failure inside a job is logged at error level and does NOT escape — an
 *     unhandled rejection in a cron takes the process down in some Node
 *     configurations, which turns one broken job into an outage.
 *  3. The schedule is registered under the names operators grep for.
 * ========================================================================== */

/** Passes the body through, recording the lock key and TTL it was given. */
function lockRecorder() {
  const calls: { key: string; ttl: number }[] = [];
  return {
    calls,
    redis: {
      withLock: jest.fn(async (key: string, ttl: number, fn: () => Promise<unknown>) => {
        calls.push({ key, ttl });
        return fn();
      }),
    },
  };
}

const stub = () => new Proxy({}, {
  get: () => jest.fn(async (): Promise<unknown> => []),
}) as never;

describe("EconomyJobs", () => {
  let recorder: ReturnType<typeof lockRecorder>;
  let jobs: EconomyJobs;
  let commission: { releaseQueued: jest.Mock; fundingAvailable: jest.Mock };
  let treasury: { rollupPeriod: jest.Mock };
  let deposits: { stale: jest.Mock };
  let staking: { listPools: jest.Mock; recomputeApr: jest.Mock };
  /* The drift sweep reads v_points_drift — one query that returns only the
   * accounts whose balance disagrees with their ledger. */
  let routines: { pointsDrift: jest.Mock; mttLiability: jest.Mock };
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);

    recorder = lockRecorder();
    commission = {
      releaseQueued: jest.fn(async () => ({ released: 2, releasedMtt: "20", remaining: 1 })),
      fundingAvailable: jest.fn(async () => ({ solvent: true, committedMtt: "10", poolFundedMtt: "100" })),
    };
    treasury = { rollupPeriod: jest.fn(async (periodKey: string) => ({ periodKey, payoutRatioBps: 4_000, reconciledInflow: "1000" })) };
    deposits = { stale: jest.fn(async (): Promise<unknown[]> => []) };
    staking = {
      listPools: jest.fn(async () => [{ poolId: 1 }, { poolId: 2 }]),
      recomputeApr: jest.fn(async (poolId: number) => (poolId === 1 ? { aprBps: 500 } : null)),
    };
    routines = {
      pointsDrift: jest.fn(async (): Promise<unknown[]> => []),
      mttLiability: jest.fn(async () => ({
        accounts: 0, totalLiabilityMtt: "0", totalPoints: "0",
      })),
    };

    jobs = new EconomyJobs(
      recorder.redis as never, commission as never, treasury as never,
      stub(), deposits as never, staking as never, stub(), routines as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it("runs the commission release under a named lock whose TTL is under its interval", async () => {
    await jobs.releaseQueuedCommission();
    expect(recorder.calls[0]?.key).toBe("cron:commission-release");
    /* Every ten minutes; the TTL has to expire before the next run or a crashed
     * instance blocks the schedule forever. */
    expect(recorder.calls[0]?.ttl).toBeLessThan(600);
  });

  it("skips silently when another instance holds the lock", async () => {
    recorder.redis.withLock.mockResolvedValue(null);
    await jobs.rollupTreasury();
    expect(treasury.rollupPeriod).not.toHaveBeenCalled();
  });

  it("does NOT let a job failure escape into an unhandled rejection", async () => {
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    treasury.rollupPeriod.mockRejectedValue(new Error("mysql gone away"));

    await expect(jobs.rollupTreasury()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("cron treasury-rollup failed"),
      expect.anything(),
    );
  });

  it("re-rolls the PREVIOUS month early in a new one, so late reconciliations land", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-03-02T00:30:00Z"));
    await jobs.rollupPreviousPeriod();
    expect(treasury.rollupPeriod).toHaveBeenCalledWith("2026-02");
    jest.useRealTimers();
  });

  it("stops re-rolling the previous month once the window has passed", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-03-20T00:30:00Z"));
    await jobs.rollupPreviousPeriod();
    expect(recorder.redis.withLock).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("counts only the pools that produced an APR observation", async () => {
    await jobs.recomputeStakingApr();
    /* A pool with no TVL has no realised APR — recording zero would publish a
     * number the pool never paid. */
    expect(log).toHaveBeenCalledWith("recomputed APR for 1 of 2 pools");
  });

  it("reports ledger drift, which is the check that never used to run", async () => {
    /* A balance is a projection of an immutable ledger; if they disagree,
     * something wrote a balance outside LedgerService. Sweeping every account
     * meant a query per member, so this cron skipped the walk entirely — and the
     * check silently never happened for anybody. */
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    routines.pointsDrift.mockResolvedValue([
      { userId: "u1", balancePoints: "500", ledgerPoints: "300", drift: "200" },
    ]);

    await jobs.auditLedger();

    expect(error).toHaveBeenCalledWith(expect.stringContaining("LEDGER DRIFT on 1 account"));
  });

  it("says nothing about drift when the ledger and the balances agree", async () => {
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    await jobs.auditLedger();
    /* An empty result IS the healthy answer, so it must not produce noise. */
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining("LEDGER DRIFT"));
  });

  it("escalates commission insolvency to error level — the invariant that matters most", async () => {
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    commission.fundingAvailable.mockResolvedValue({ solvent: false, committedMtt: "150", poolFundedMtt: "100" });

    await jobs.auditLedger();

    expect(error).toHaveBeenCalledWith(expect.stringContaining("COMMISSION POOL INSOLVENT"));
  });
});

describe("PlatformJobs", () => {
  let recorder: ReturnType<typeof lockRecorder>;
  let jobs: PlatformJobs;
  let webhooks: { dueForRetry: jest.Mock; requeueOutbound: jest.Mock; unprocessed: jest.Mock; requeueInbound: jest.Mock; status: jest.Mock };
  let submitter: { inFlight: jest.Mock; pending: jest.Mock };
  let chainIndexQueue: { add: jest.Mock };
  let chainTxQueue: { add: jest.Mock };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);

    recorder = lockRecorder();
    webhooks = {
      dueForRetry: jest.fn(async (): Promise<unknown[]> => []),
      requeueOutbound: jest.fn(async () => undefined),
      unprocessed: jest.fn(async () => [{ id: "we1", provider: "payment", eventId: "evt_1" }]),
      requeueInbound: jest.fn(async () => undefined),
      status: jest.fn(async () => ({ inboundRejected24h: 0, outboundAbandoned: 0, inboundUnprocessed: 0 })),
    };
    submitter = {
      inFlight: jest.fn(async () => [{ id: "tx1" }]),
      pending: jest.fn(async () => [{ id: "tx2" }]),
    };
    chainIndexQueue = { add: jest.fn(async () => undefined) };
    chainTxQueue = { add: jest.fn(async () => undefined) };

    jobs = new PlatformJobs(
      recorder.redis as never, stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
      webhooks as never, stub(), submitter as never,
      chainIndexQueue as never, chainTxQueue as never, stub(), stub(),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it("collapses the indexing backlog to ONE job rather than building a queue of passes", async () => {
    await jobs.indexChain();
    await jobs.indexChain();
    expect(chainIndexQueue.add).toHaveBeenCalledTimes(2);
    const ids = chainIndexQueue.add.mock.calls.map((c) => (c[2] as { jobId: string }).jobId);
    /* Same id twice: BullMQ keeps one. */
    expect(new Set(ids).size).toBe(1);
  });

  it("gives every enqueued job id a colon-free form BullMQ accepts", async () => {
    await jobs.indexChain();
    await jobs.watchTransactions();
    await jobs.submitTransactions();
    const ids = [...chainIndexQueue.add.mock.calls, ...chainTxQueue.add.mock.calls]
      .map((c) => (c[2] as { jobId: string }).jobId);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).not.toContain(":");
  });

  it("re-drives stranded inbound webhooks, which no provider will resend", async () => {
    await jobs.sweepInboundWebhooks();
    expect(webhooks.unprocessed).toHaveBeenCalledWith(100, 5);
    expect(webhooks.requeueInbound).toHaveBeenCalledWith(
      expect.objectContaining({ id: "we1" }),
    );
  });

  it("still reports relayer state when the chain is unreachable", async () => {
    /* An RPC outage must not hide the relayer's queue depth: that is our own
     * data, and it is what someone looking at an outage needs. */
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const indexer = { status: jest.fn(async () => { throw new Error("HTTP request failed."); }) };
    const submitter2 = {
      status: jest.fn(async () => ({ healthy: false, canSign: false, abandoned: 2, queued: 9, nextNonce: 4 })),
    };

    const isolated = new PlatformJobs(
      recorder.redis as never, stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
      webhooks as never, indexer as never, submitter2 as never,
      chainIndexQueue as never, chainTxQueue as never, stub(), stub(),
    );

    await isolated.chainHealth();

    expect(error).toHaveBeenCalledWith(expect.stringContaining("chain unreachable"));
    expect(error).toHaveBeenCalledWith(expect.stringContaining("relayer unhealthy"));
  });

  it("takes a lock for the chain jobs that expires before their next tick", async () => {
    await jobs.watchTransactions();
    /* Every minute: a 55s TTL means a stuck run cannot block the next two. */
    expect(recorder.calls[0]).toEqual({ key: "cron:chain-tx-watch", ttl: 55 });
  });
});

describe("the schedule itself", () => {
  it("registers every cron under a greppable name, with no duplicates", async () => {
    /* A duplicate name silently replaces the earlier job in Nest's registry, so
     * one of the two would never run. */
    const mod = await Test.createTestingModule({
      imports: [DiscoveryModule, ScheduleModule.forRoot()],
      providers: [
        EconomyJobs, PlatformJobs,
        { provide: RedisService, useValue: { withLock: jest.fn(async () => null) } },
        ...[
          "CommissionService", "TreasuryService", "WithdrawalService", "DepositService",
          "StakingService", "LedgerService", "AdminService", "FraudService",
          "LeaderboardService", "NotificationsService", "QuestsService", "StoreService",
          "SupportService", "TournamentsService", "WebhooksService", "IndexerService",
          "TxSubmitterService",
        ].map(() => ({ provide: Symbol("unused"), useValue: {} })),
      ],
    })
      .overrideProvider(EconomyJobs).useValue(new EconomyJobs(
        { withLock: jest.fn(async () => null) } as never,
        stub(), stub(), stub(), stub(), stub(), stub(), stub(),
      ))
      .overrideProvider(PlatformJobs).useValue(new PlatformJobs(
        { withLock: jest.fn(async () => null) } as never,
        stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
        stub(), stub(), stub(), stub(),
      ))
      .compile();

    await mod.init();
    const names = mod.get(SchedulerRegistry).getCronJobs();
    const keys = [...names.keys()];

    expect(keys.length).toBeGreaterThanOrEqual(15);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("commission-release");
    expect(keys).toContain("chain-index");
    expect(keys).toContain("webhook-inbound-sweep");

    await mod.close();
  });
});
