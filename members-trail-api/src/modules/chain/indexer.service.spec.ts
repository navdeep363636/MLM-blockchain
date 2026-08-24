import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import { ChainEvent, IndexerCursor } from "@/database/entities";
import { EventBusService } from "@/events";
import { RedisService } from "@/common/redis/redis.service";
import { IndexerService, serialiseArgs } from "./indexer.service";
import { RpcService } from "./rpc.service";
import { DbRoutinesService } from "@/database/routines/db-routines.service";

/* ============================================================================
 * What these tests defend:
 *
 *  1  the cursor never advances past the confirmation depth
 *  2  the cursor never advances when the scan failed
 *  3  a changed block hash is treated as a reorg: rewind, orphan, alert
 *  4  a re-scanned event is deduped, not duplicated
 *  5  BigInt event args survive as exact strings
 *
 * Every one of these is a way a chain integration silently pays for something
 * that did not happen, or silently stops paying for something that did.
 * ========================================================================== */

function repo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
    save: jest.fn(async (x: unknown) => x),
    create: jest.fn((x: unknown) => x),
    count: jest.fn(async () => 0),
    createQueryBuilder: jest.fn(),
  };
}

const CURSOR = {
  id: "cur-1",
  cursorKey: "staking@0xstaking",
  lastBlock: 1_000,
  lastBlockHash: "0xhash1000",
  reorgCount: 0,
  lastRunAt: null as Date | null,
  lastError: null as string | null,
};

function log(over: Record<string, unknown> = {}) {
  return {
    eventName: "Staked",
    args: { user: "0xabc", poolId: 1n, amount: 5_000_000_000_000_000_000n, lockEnd: 1_800_000_000n },
    blockNumber: 1_001n,
    blockHash: "0xhash1001",
    transactionHash: "0xtx1",
    logIndex: 0,
    ...over,
  };
}

describe("IndexerService", () => {
  let svc: IndexerService;
  let cursors: ReturnType<typeof repo>;
  let events: ReturnType<typeof repo>;
  let rpc: {
    hasAddress: jest.Mock; address: jest.Mock; blockNumber: jest.Mock; block: jest.Mock;
    logs: jest.Mock; confirmations: number; batchBlocks: number; startBlock: number; chainId: number;
  };
  let redis: { withLock: jest.Mock };
  let bus: { publish: jest.Mock };
  let routines: Record<string, jest.Mock>;

  beforeEach(async () => {
    cursors = repo();
    events = repo();

    rpc = {
      hasAddress: jest.fn((k: string) => k === "staking"),
      address: jest.fn(() => "0xStaking000000000000000000000000000000000"),
      blockNumber: jest.fn(async () => 1_100),
      block: jest.fn(async (n: number) => ({ hash: `0xhash${n}` })),
      logs: jest.fn(async () => []),
      confirmations: 3,
      batchBlocks: 50,
      startBlock: 900,
      chainId: 97,
    };
    redis = { withLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()) };
    bus = { publish: jest.fn() };

    routines = {
      markChainEventsOrphaned: jest.fn(async () => ({ orphaned: 0, processedBeforeRewind: 0 })),
    };

    const mod = await Test.createTestingModule({
      providers: [
        IndexerService,
        { provide: getRepositoryToken(IndexerCursor), useValue: cursors },
        { provide: getRepositoryToken(ChainEvent), useValue: events },
        { provide: RpcService, useValue: rpc },
        { provide: RedisService, useValue: redis },
        { provide: DbRoutinesService, useValue: routines },
        { provide: EventBusService, useValue: bus },
      ],
    }).compile();

    svc = mod.get(IndexerService);
    cursors.findOne.mockResolvedValue({ ...CURSOR });
    events.findOne.mockResolvedValue(null);
  });

  const staking = () => (r: { contract: string }) => r.contract === "staking";

  /* ==================================================================== *
   * Confirmation depth
   * ==================================================================== */

  describe("confirmation depth", () => {
    it("never scans closer to the head than the confirmation depth", async () => {
      rpc.blockNumber.mockResolvedValue(1_010);

      await svc.runAll();

      const [args] = rpc.logs.mock.calls[0] as [{ fromBlock: number; toBlock: number }];
      expect(args.fromBlock).toBe(1_001);
      /* head 1010 − 3 confirmations = 1007, not 1010. */
      expect(args.toBlock).toBe(1_007);
    });

    it("enforces a floor on the confirmation depth even if configuration lowers it", async () => {
      rpc.confirmations = 0;
      rpc.blockNumber.mockResolvedValue(1_010);

      await svc.runAll();

      const [args] = rpc.logs.mock.calls[0] as [{ toBlock: number }];
      /* MIN_CONFIRMATIONS is 3, so 1007 regardless of the config. */
      expect(args.toBlock).toBe(1_007);
    });

    it("does nothing when the safe head has not moved past the cursor", async () => {
      rpc.blockNumber.mockResolvedValue(1_002);
      const [result] = (await svc.runAll()).filter(staking());
      expect(result.skipped).toBe("CAUGHT_UP");
      expect(rpc.logs).not.toHaveBeenCalled();
    });

    it("bounds the batch to the configured width", async () => {
      rpc.blockNumber.mockResolvedValue(9_999_999);
      await svc.runAll();
      const [args] = rpc.logs.mock.calls[0] as [{ fromBlock: number; toBlock: number }];
      expect(args.toBlock - args.fromBlock + 1).toBe(50);
    });
  });

  /* ==================================================================== *
   * Cursor safety
   * ==================================================================== */

  describe("cursor", () => {
    it("advances only after every log in the range is stored, recording the block hash", async () => {
      rpc.logs.mockResolvedValue([log()]);

      await svc.runAll();

      const saved = cursors.save.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      /* 1001 + 50 batch − 1. */
      expect(saved.lastBlock).toBe(1_050);
      expect(saved.lastBlockHash).toBe("0xhash1050");
      expect(saved.lastError).toBeNull();
    });

    it("does NOT advance when the scan fails, so the range is retried", async () => {
      rpc.logs.mockRejectedValue(new Error("provider 503"));

      await expect(svc.runAll()).rejects.toThrow("provider 503");

      const saved = cursors.save.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(saved.lastBlock).toBe(1_000);
      expect(saved.lastError).toContain("provider 503");
    });

    it("starts a fresh cursor at the configured deployment block, not block zero", async () => {
      cursors.findOne.mockResolvedValue(null);
      cursors.save.mockImplementation(async (x: unknown) => x);

      await svc.runAll();

      /* Asserted through the scan range rather than the saved row: the mock
       * returns the same object the service then mutates, so reading it back
       * would show the post-scan value. */
      const [args] = rpc.logs.mock.calls[0] as [{ fromBlock: number }];
      expect(args.fromBlock).toBe(900);
    });

    it("skips a contract with no configured address rather than failing the run", async () => {
      rpc.hasAddress.mockReturnValue(false);
      const results = await svc.runAll();
      expect(results.every((r) => r.skipped === "ADDRESS_UNSET")).toBe(true);
      expect(rpc.logs).not.toHaveBeenCalled();
    });

    it("yields to another worker holding the scan lock", async () => {
      redis.withLock.mockResolvedValue(null);
      const [result] = (await svc.runAll()).filter(staking());
      expect(result.skipped).toBe("LOCK_HELD");
    });
  });

  /* ==================================================================== *
   * Reorgs
   * ==================================================================== */

  describe("reorg detection", () => {
    it("REWINDS when the last indexed block no longer has the recorded hash", async () => {
      rpc.block.mockImplementation(async (n: number) =>
        n === 1_000 ? { hash: "0xDIFFERENT" } : { hash: `0xhash${n}` },
      );
      events.find.mockResolvedValue([
        { id: "e1", blockNumber: 995, orphaned: false, processedAt: null },
        { id: "e2", blockNumber: 999, orphaned: false, processedAt: new Date() },
      ]);

      const [result] = (await svc.runAll()).filter(staking());

      expect(result.reorgDetected).toBe(true);
      const saved = cursors.save.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      /* Rewound deeper than the confirmation depth: the reorg may have started
       * before the block we noticed it at. */
      expect(saved.lastBlock).toBe(976);
      expect(saved.reorgCount).toBe(1);
      expect(saved.lastBlockHash).toBeNull();
    });

    it("ORPHANS the affected events instead of deleting them", async () => {
      /* Marking, never deleting: an event that was reorganised away is evidence
       * of what the platform believed, and the dispatcher needs it to undo what
       * it applied. The marking is now one UPDATE — during a reorg, which is
       * exactly when the indexer has to catch up quickly. */
      rpc.block.mockImplementation(async (n: number) =>
        n === 1_000 ? { hash: "0xDIFFERENT" } : { hash: `0xhash${n}` },
      );
      routines.markChainEventsOrphaned.mockResolvedValue({ orphaned: 1, processedBeforeRewind: 0 });

      await svc.runAll();

      expect(routines.markChainEventsOrphaned).toHaveBeenCalledWith("staking", expect.any(Number));
      expect(events.save).not.toHaveBeenCalled();
    });

    it("raises an alert naming how many ALREADY-PROCESSED events were orphaned", async () => {
      rpc.block.mockImplementation(async (n: number) =>
        n === 1_000 ? { hash: "0xDIFFERENT" } : { hash: `0xhash${n}` },
      );
      routines.markChainEventsOrphaned.mockResolvedValue({ orphaned: 2, processedBeforeRewind: 1 });

      await svc.runAll();

      const [, payload] = bus.publish.mock.calls[0] as [string, Record<string, unknown>];
      expect(payload.orphanedEvents).toBe(2);
      /* The dangerous half: these were applied to balances. Counted inside the
       * procedure BEFORE the write, because afterwards it cannot be recovered. */
      expect(payload.orphanedProcessed).toBe(1);
    });

    it("does not scan in the same pass it rewinds — the next pass re-reads cleanly", async () => {
      rpc.block.mockImplementation(async (n: number) =>
        n === 1_000 ? { hash: "0xDIFFERENT" } : { hash: `0xhash${n}` },
      );
      await svc.runAll();
      expect(rpc.logs).not.toHaveBeenCalled();
    });

    it("treats an unfetchable block as a provider problem, not a reorg", async () => {
      /* Only the reorg-check fetch fails; the rest of the pass proceeds. */
      rpc.block.mockImplementation(async (n: number) => {
        if (n === 1_000) throw new Error("timeout");
        return { hash: `0xhash${n}` };
      });

      const [result] = (await svc.runAll()).filter(staking());

      /* No rewind, no orphaning: thrashing on a provider hiccup would be worse. */
      expect(result.reorgDetected).toBe(false);
      expect(cursors.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ reorgCount: 1 }),
      );
    });

    it("does not treat a cursor with no recorded hash as a reorg", async () => {
      cursors.findOne.mockResolvedValue({ ...CURSOR, lastBlockHash: null });
      const [result] = (await svc.runAll()).filter(staking());
      expect(result.reorgDetected).toBe(false);
      expect(rpc.logs).toHaveBeenCalled();
    });
  });

  /* ==================================================================== *
   * Deduplication
   * ==================================================================== */

  describe("storage", () => {
    it("stores a new event with its chain coordinates", async () => {
      rpc.logs.mockResolvedValue([log()]);

      const [result] = (await svc.runAll()).filter(staking());

      expect(result.indexed).toBe(1);
      expect(events.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "Staked", txHash: "0xtx1", logIndex: 0, blockNumber: 1_001,
        }),
      );
    });

    it("DEDUPES an event it has already stored — re-scanning is free by design", async () => {
      events.findOne.mockResolvedValue({ txHash: "0xtx1", logIndex: 0, orphaned: false });
      rpc.logs.mockResolvedValue([log()]);

      const [result] = (await svc.runAll()).filter(staking());

      expect(result.indexed).toBe(0);
      expect(result.duplicates).toBe(1);
    });

    it("UN-ORPHANS an event that was re-mined after a reorg, rather than duplicating it", async () => {
      events.findOne.mockResolvedValue({
        txHash: "0xtx1", logIndex: 0, orphaned: true, blockHash: "0xold",
      });
      rpc.logs.mockResolvedValue([log()]);

      await svc.runAll();

      expect(events.save).toHaveBeenCalledWith(
        expect.objectContaining({ orphaned: false, blockHash: "0xhash1001" }),
      );
    });

    it("skips a log with no confirmed position rather than storing an un-dedupable row", async () => {
      rpc.logs.mockResolvedValue([log({ transactionHash: null, logIndex: null })]);
      const [result] = (await svc.runAll()).filter(staking());
      expect(result.indexed).toBe(0);
      expect(events.save).not.toHaveBeenCalled();
    });

    it("publishes each newly indexed event for downstream consumers", async () => {
      rpc.logs.mockResolvedValue([log()]);
      await svc.runAll();
      const indexed = (bus.publish.mock.calls as [string, Record<string, unknown>][])
        .find(([n]) => n === "chain.event_indexed");
      expect(indexed?.[1]).toMatchObject({ eventName: "Staked", txHash: "0xtx1" });
    });
  });

  /* ==================================================================== *
   * BigInt serialisation
   * ==================================================================== */

  describe("serialiseArgs", () => {
    it("keeps a BigInt EXACT as a string — a number would silently lose precision", () => {
      const args = serialiseArgs({ amount: 123_456_789_012_345_678_901n, poolId: 1n });
      expect(args.amount).toBe("123456789012345678901");
      expect(args.poolId).toBe("1");
    });

    it("handles BigInts inside arrays", () => {
      expect(serialiseArgs({ amounts: [1n, 2n] }).amounts).toEqual(["1", "2"]);
    });

    it("leaves other values untouched", () => {
      expect(serialiseArgs({ user: "0xabc", ok: true })).toEqual({ user: "0xabc", ok: true });
    });

    it("produces args that JSON.stringify can actually serialise", () => {
      const args = serialiseArgs({ amount: 5_000_000_000_000_000_000n });
      expect(() => JSON.stringify(args)).not.toThrow();
    });
  });

  /* ==================================================================== *
   * Status
   * ==================================================================== */

  describe("status", () => {
    it("reports cursor lag against the safe head, not the raw head", async () => {
      rpc.blockNumber.mockResolvedValue(1_100);
      cursors.find.mockResolvedValue([{ ...CURSOR }]);

      const s = await svc.status();

      expect(s.safeHead).toBe(1_097);
      expect(s.cursors[0].lagBlocks).toBe(97);
      expect(s.cursors[0].healthy).toBe(true);
    });

    it("reports an unhealthy cursor once the lag passes the threshold", async () => {
      rpc.blockNumber.mockResolvedValue(5_000);
      cursors.find.mockResolvedValue([{ ...CURSOR }]);

      const s = await svc.status();

      expect(s.cursors[0].healthy).toBe(false);
      expect(s.healthy).toBe(false);
    });

    it("reports an unhealthy cursor when the last run errored, whatever the lag", async () => {
      cursors.find.mockResolvedValue([{ ...CURSOR, lastBlock: 1_097, lastError: "provider 503" }]);
      const s = await svc.status();
      expect(s.cursors[0].healthy).toBe(false);
    });
  });

  describe("rewindTo", () => {
    it("clears the stored hash so the next pass re-reads without a false reorg", async () => {
      const c = await svc.rewindTo("staking@0xstaking", 500, "replaying after a handler fix");
      expect(c.lastBlock).toBe(500);
      expect(c.lastBlockHash).toBeNull();
      expect(c.lastError).toContain("manual rewind");
    });

    it("never rewinds below zero", async () => {
      const c = await svc.rewindTo("staking@0xstaking", -50, "operator typo protection");
      expect(c.lastBlock).toBe(0);
    });
  });
});
