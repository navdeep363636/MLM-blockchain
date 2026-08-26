import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import type { GetLogsReturnType } from "viem";
import { ChainEvent, IndexerCursor } from "@/database/entities";
import { EventBusService, Events } from "@/events";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import { RedisService } from "@/common/redis/redis.service";
import { RpcService } from "./rpc.service";
import {
  HEALTHY_LAG_BLOCKS, INDEXED_SPECS, MIN_CONFIRMATIONS, REORG_REWIND_BLOCKS,
  assertSpecsValid, watchedEventAbi, type ContractName, type ContractSpec,
} from "./chain.constants";

/* ============================================================================
 * The event indexer.
 *
 * WHY POLLED getLogs RATHER THAN A WEBSOCKET SUBSCRIPTION — this is the central
 * design decision of the chain layer, and it is not about preference:
 *
 *  • A subscription delivers events only while the socket is up. A restart, a
 *    deploy or a provider blip loses everything that happened in between, with
 *    no record that anything was missed. A persisted cursor cannot lose events:
 *    the worst case is that it resumes late.
 *
 *  • A subscription gives no way to re-read history. A reorg, a handler bug or a
 *    schema fix all require re-processing a past range, which a cursor makes a
 *    one-line operation and a subscription makes impossible.
 *
 *  • Polling is idempotent by construction. Combined with UNIQUE(txHash,
 *    logIndex) on `chain_events`, re-scanning a range is free — which is what
 *    makes the reorg rewind below safe to run aggressively.
 *
 * THE OTHER THREE RULES:
 *
 *  1. CONFIRMATION DEPTH. Never index closer to the head than the configured
 *     confirmations. A one-block-deep event can still be reorganised away, and
 *     crediting a reward from it means paying for something that did not happen.
 *
 *  2. REORG DETECTION BY BLOCK HASH. The cursor stores the hash of the last
 *     block it indexed. Before advancing, that block is re-fetched: a different
 *     hash means the chain reorganised under us, so the cursor rewinds and the
 *     affected events are marked orphaned rather than left as facts.
 *
 *  3. STORE FIRST, PROCESS SECOND. Indexing writes the raw decoded event; a
 *     separate dispatch step applies it to domain state. A bug in a handler
 *     therefore never loses an event — it leaves a row with `processedAt` null
 *     and an error to fix and replay.
 * ========================================================================== */

/*
 * What to watch now comes from CONTRACT_SPECS, and the event ABIs are FILTERED
 * FROM THE GENERATED ABI rather than re-declared here. That is the fix for the
 * defect this file's own header warned about: "an ABI mismatch does not throw,
 * it silently matches nothing". It was warning about a bug it already had —
 * seven of the eight signatures were wrong.
 */
const INDEX_LOCK_TTL_SECONDS = 120;

export interface IndexRunResult {
  contract: ContractName;
  fromBlock: number;
  toBlock: number;
  indexed: number;
  duplicates: number;
  reorgDetected: boolean;
  skipped?: string;
}

export interface IndexerStatus {
  chainId: number;
  head: number;
  safeHead: number;
  confirmations: number;
  cursors: {
    contract: string;
    lastBlock: number;
    lagBlocks: number;
    reorgCount: number;
    lastRunAt: string | null;
    lastError: string | null;
    healthy: boolean;
  }[];
  unprocessedEvents: number;
  healthy: boolean;
}

@Injectable()
export class IndexerService implements OnModuleInit {
  private readonly log = new Logger(IndexerService.name);

  constructor(
    @InjectRepository(IndexerCursor) private readonly cursors: Repository<IndexerCursor>,
    @InjectRepository(ChainEvent) private readonly events: Repository<ChainEvent>,
    private readonly rpc: RpcService,
    private readonly redis: RedisService,
    private readonly bus: EventBusService,
    private readonly routines: DbRoutinesService,
  ) {}

  /**
   * Refuses to start if any watched event name is absent from the ABI.
   *
   * Deliberately fatal. The alternative — log a warning and carry on — is how a
   * chain layer ends up reporting healthy while indexing nothing, which is the
   * exact failure this service spent its first production life having.
   */
  onModuleInit(): void {
    assertSpecsValid();

    const summary = INDEXED_SPECS.map(
      (s) => `${s.name}[${s.watch.length}]`,
    ).join(" ");
    this.log.log(`event specs validated against the generated ABIs: ${summary}`);
  }

  /* ==================================================================== *
   * The run loop's single step
   * ==================================================================== */

  /** Indexes every configured contract once. Called by the indexer cron. */
  async runAll(): Promise<IndexRunResult[]> {
    const results: IndexRunResult[] = [];
    for (const target of INDEXED_SPECS) {
      if (!this.rpc.hasAddress(target.configKey)) {
        results.push({
          contract: target.name,
          fromBlock: 0, toBlock: 0, indexed: 0, duplicates: 0, reorgDetected: false,
          skipped: "ADDRESS_UNSET",
        });
        continue;
      }
      results.push(await this.runOne(target));
    }
    return results;
  }

  /**
   * Indexes one contract's next batch.
   *
   * Held under a Redis lock per contract: two workers scanning the same range
   * would both write, and while the unique index makes that harmless, it wastes
   * an RPC budget that providers meter.
   */
  private async runOne(target: ContractSpec): Promise<IndexRunResult> {
    const address = this.rpc.address(target.configKey);
    const cursorKey = `${target.name}@${address.toLowerCase()}`;

    const result = await this.redis.withLock(
      `indexer:${cursorKey}`,
      INDEX_LOCK_TTL_SECONDS,
      () => this.indexUnderLock(target, address, cursorKey),
    );

    return (
      result ?? {
        contract: target.name,
        fromBlock: 0, toBlock: 0, indexed: 0, duplicates: 0, reorgDetected: false,
        skipped: "LOCK_HELD",
      }
    );
  }

  private async indexUnderLock(
    target: ContractSpec,
    address: `0x${string}`,
    cursorKey: string,
  ): Promise<IndexRunResult> {
    const cursor = await this.cursor(cursorKey);
    const head = await this.rpc.blockNumber();

    /* Rule 1: stay behind the head by the confirmation depth. */
    const confirmations = Math.max(this.rpc.confirmations, MIN_CONFIRMATIONS);
    const safeHead = head - confirmations;

    if (safeHead <= cursor.lastBlock) {
      cursor.lastRunAt = new Date();
      cursor.lastError = null;
      await this.cursors.save(cursor);
      return {
        contract: target.name,
        fromBlock: cursor.lastBlock, toBlock: cursor.lastBlock,
        indexed: 0, duplicates: 0, reorgDetected: false,
        skipped: "CAUGHT_UP",
      };
    }

    /* Rule 2: has the block we last indexed survived? */
    const reorg = await this.detectReorg(cursor);
    if (reorg) {
      await this.rewind(cursor, target.name);
      return {
        contract: target.name,
        fromBlock: cursor.lastBlock, toBlock: cursor.lastBlock,
        indexed: 0, duplicates: 0, reorgDetected: true,
      };
    }

    const fromBlock = cursor.lastBlock + 1;
    const toBlock = Math.min(safeHead, fromBlock + this.rpc.batchBlocks - 1);

    let logs: GetLogsReturnType;
    try {
      logs = await this.rpc.logs({
        address,
        events: watchedEventAbi(target),
        fromBlock,
        toBlock,
      });
    } catch (e) {
      /* The cursor is NOT advanced on failure: the range will be retried, which
       * is exactly the behaviour a subscription cannot offer. */
      const message = e instanceof Error ? e.message : String(e);
      cursor.lastError = message.slice(0, 1_000);
      cursor.lastRunAt = new Date();
      await this.cursors.save(cursor);
      throw e;
    }

    let indexed = 0;
    let duplicates = 0;

    for (const entry of logs) {
      const stored = await this.store(target.name, address, entry);
      if (stored) indexed += 1;
      else duplicates += 1;
    }

    /* The cursor advances only after every log in the range is stored, and it
     * records the hash of the block it stopped at so the next run can check it. */
    const endBlock = await this.rpc.block(toBlock);
    cursor.lastBlock = toBlock;
    cursor.lastBlockHash = endBlock.hash ?? null;
    cursor.lastRunAt = new Date();
    cursor.lastError = null;
    await this.cursors.save(cursor);

    if (indexed > 0) {
      this.log.log(`${target.name}: indexed ${indexed} events in ${fromBlock}–${toBlock}`);
    }

    return {
      contract: target.name,
      fromBlock, toBlock, indexed, duplicates, reorgDetected: false,
    };
  }

  /* ==================================================================== *
   * Reorg handling
   * ==================================================================== */

  /**
   * True when the block the cursor last indexed no longer has the hash we
   * recorded — the definition of a reorg from this layer's point of view.
   *
   * A cursor with no recorded hash (a fresh deployment, or one written before
   * this check existed) is treated as fine rather than as a reorg: refusing to
   * index until someone manually seeds a hash would be a worse failure.
   */
  private async detectReorg(cursor: IndexerCursor): Promise<boolean> {
    if (!cursor.lastBlockHash || cursor.lastBlock <= 0) return false;

    try {
      const block = await this.rpc.block(cursor.lastBlock);
      return block.hash !== cursor.lastBlockHash;
    } catch (e) {
      /* A block that cannot be fetched at all is more likely a provider problem
       * than a reorg, and rewinding on a provider hiccup would thrash. */
      this.log.warn(
        `could not re-fetch block ${cursor.lastBlock} for reorg check: ` +
        `${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
  }

  /**
   * Rewinds the cursor and orphans the events that came from the abandoned
   * blocks.
   *
   * The events are MARKED, not deleted: an audit trail that quietly loses rows
   * cannot be reconciled, and a support question about a reward that appeared
   * and vanished deserves an answer. Anything already processed is republished
   * as a reorg so the domain layer can decide what to unwind.
   */
  private async rewind(cursor: IndexerCursor, contract: ContractName): Promise<void> {
    const from = Math.max(0, cursor.lastBlock - REORG_REWIND_BLOCKS);

    /* One UPDATE, and the count of already-applied events comes back with it.
     *
     * This used to load five thousand rows, filter them in JavaScript — the
     * `blockNumber > from` test the database could have done — and then save each
     * one. During a reorg, which is exactly when the indexer must catch up
     * quickly.
     *
     * `orphanedProcessed` is the number that matters: those events were already
     * applied to balances, and a reward credited from an abandoned block has to
     * be reversed by whoever applied it. It is counted inside the procedure,
     * before the write, because afterwards it cannot be recovered. */
    const rewound = await this.routines.markChainEventsOrphaned(contract, from);
    const orphanedCount = rewound.orphaned;
    const orphanedProcessed = rewound.processedBeforeRewind;

    cursor.lastBlock = from;
    cursor.lastBlockHash = null;
    cursor.reorgCount += 1;
    cursor.lastRunAt = new Date();
    cursor.lastError = `reorg detected; rewound to ${from}`;
    await this.cursors.save(cursor);

    this.log.error(
      `REORG on ${contract}: rewound to block ${from}, orphaned ${orphanedCount} events ` +
      `(${orphanedProcessed} of them already applied)`,
    );

    await this.bus.publish(Events.ChainReorgDetected, {
      contract,
      rewoundTo: from,
      orphanedEvents: orphanedCount,
      /* Processed events that are now orphaned need domain attention — a reward
       * credited from an abandoned block has to be reversed by whoever applied it. */
      orphanedProcessed,
      reorgCount: cursor.reorgCount,
    });
  }

  /* ==================================================================== *
   * Storage
   * ==================================================================== */

  /**
   * Stores one decoded log. Returns false when it was already stored.
   *
   * The duplicate case is normal, not exceptional: a rewind re-scans blocks on
   * purpose. UNIQUE(txHash, logIndex) is what makes that safe, and catching the
   * duplicate here is what keeps a re-scan from aborting the batch.
   */
  private async store(
    contract: ContractName,
    address: string,
    entry: GetLogsReturnType[number],
  ): Promise<boolean> {
    const log = entry as unknown as {
      eventName?: string;
      args?: Record<string, unknown>;
      blockNumber: bigint | null;
      blockHash: string | null;
      transactionHash: string | null;
      logIndex: number | null;
    };

    if (!log.transactionHash || log.logIndex === null || log.blockNumber === null) {
      /* A pending log has no position on chain, so it has no identity to dedupe
       * on. Confirmation depth means we should never see one; skipping is the
       * correct response if we do. */
      this.log.warn(`${contract}: skipping a log with no confirmed position`);
      return false;
    }

    const existing = await this.events.findOne({
      where: { txHash: log.transactionHash, logIndex: log.logIndex },
    });
    if (existing) {
      /* A re-scanned event that was orphaned by a reorg and then re-mined is
       * un-orphaned rather than duplicated: same identity, back on the chain. */
      if (existing.orphaned) {
        existing.orphaned = false;
        existing.blockHash = log.blockHash ?? existing.blockHash;
        await this.events.save(existing);
        this.log.log(`${contract}: event ${existing.txHash}#${existing.logIndex} re-mined after reorg`);
      }
      return false;
    }

    await this.events.save(
      this.events.create({
        contractAddress: address,
        contractName: contract,
        eventName: log.eventName ?? "Unknown",
        blockNumber: Number(log.blockNumber),
        blockHash: log.blockHash ?? "",
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        /* BigInts are serialised as strings: JSON cannot hold them, and a
         * silently truncated amount is a wrong balance. */
        args: serialiseArgs(log.args ?? {}),
        processedAt: null,
        processAttempts: 0,
        orphaned: false,
      }),
    );

    await this.bus.publish(Events.ChainEventIndexed, {
      contract,
      eventName: log.eventName ?? "Unknown",
      txHash: log.transactionHash,
      logIndex: log.logIndex,
      blockNumber: Number(log.blockNumber),
    });

    return true;
  }

  /* ==================================================================== *
   * Operations
   * ==================================================================== */

  /** Cursor row, created on demand at the configured start block. */
  private async cursor(cursorKey: string): Promise<IndexerCursor> {
    const found = await this.cursors.findOne({ where: { cursorKey } });
    if (found) return found;

    return this.cursors.save(
      this.cursors.create({
        cursorKey,
        /* Starting from the deployment block rather than 0 avoids scanning
         * millions of empty blocks on first boot. */
        lastBlock: Math.max(0, this.rpc.startBlock - 1),
        lastBlockHash: null,
        reorgCount: 0,
      }),
    );
  }

  /**
   * Rewinds a cursor deliberately, to re-index a range.
   *
   * The operational escape hatch that a subscription-based indexer cannot offer:
   * a handler bug is fixed by rewinding and re-running, not by asking a provider
   * to resend history it no longer has.
   */
  async rewindTo(cursorKey: string, blockNumber: number, reason: string): Promise<IndexerCursor> {
    const cursor = await this.cursor(cursorKey);
    cursor.lastBlock = Math.max(0, blockNumber);
    cursor.lastBlockHash = null;
    cursor.lastError = `manual rewind: ${reason}`.slice(0, 1_000);
    await this.cursors.save(cursor);
    this.log.warn(`cursor ${cursorKey} manually rewound to ${blockNumber}: ${reason}`);
    return cursor;
  }

  /**
   * Indexer health.
   *
   * Cursor lag is the metric that matters: a silently stalled indexer looks
   * exactly like a quiet chain, and the difference is whether members' stakes
   * are appearing. This is what makes that difference visible.
   */
  async status(): Promise<IndexerStatus> {
    const head = await this.rpc.blockNumber();
    const confirmations = Math.max(this.rpc.confirmations, MIN_CONFIRMATIONS);
    const safeHead = head - confirmations;

    const rows = await this.cursors.find({ order: { cursorKey: "ASC" } });
    const cursors = rows.map((c) => {
      const lag = Math.max(0, safeHead - c.lastBlock);
      return {
        contract: c.cursorKey,
        lastBlock: c.lastBlock,
        lagBlocks: lag,
        reorgCount: c.reorgCount,
        lastRunAt: c.lastRunAt ? c.lastRunAt.toISOString() : null,
        lastError: c.lastError ?? null,
        healthy: lag <= HEALTHY_LAG_BLOCKS && !c.lastError,
      };
    });

    /* IsNull, not undefined: an undefined filter is dropped by TypeORM, which
     * would report every event as unprocessed and make the metric useless. */
    const unprocessed = await this.events.count({ where: { processedAt: IsNull(), orphaned: false } });

    return {
      chainId: this.rpc.chainId,
      head,
      safeHead,
      confirmations,
      cursors,
      unprocessedEvents: unprocessed,
      healthy: cursors.every((c) => c.healthy),
    };
  }
}

/**
 * Makes decoded event args JSON-safe.
 *
 * BigInt is the important case: `JSON.stringify` throws on it, and coercing to a
 * number silently loses precision above 2^53 — which for an 18-decimal token
 * amount is routine, not exotic. Strings keep it exact.
 */
export function serialiseArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "bigint") out[key] = value.toString();
    else if (Array.isArray(value)) {
      out[key] = value.map((v) => (typeof v === "bigint" ? v.toString() : v));
    } else out[key] = value;
  }
  return out;
}
