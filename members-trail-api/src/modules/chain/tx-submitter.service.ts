import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { encodeFunctionData } from "viem";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { OutboundTransaction, type OutboundTxKind, type OutboundTxStatus } from "@/database/entities";
import { EventBusService, Events } from "@/events";
import { RedisService } from "@/common/redis/redis.service";
import { Ref, dec } from "@/common/utils";
import { RpcService } from "./rpc.service";
import {
  CONTRACT_SPECS, MAX_REPRICE_ATTEMPTS, MIN_TX_CONFIRMATIONS, REPRICE_BUMP_BPS, STUCK_TX_MS,
  assertCallable, specFor, specForCallable, type ContractName, type ContractSpec,
} from "./chain.constants";

/* ============================================================================
 * The outbound transaction submitter.
 *
 * The problem this exists to solve, stated plainly: **two concurrent sends grab
 * the same nonce, and one silently replaces the other.** The replaced one does
 * not fail — it disappears. If it was a commission payment, someone is simply
 * never paid, and nothing in the logs says so.
 *
 * So every send goes through this table and these rules:
 *
 *  1. NONCES ARE ASSIGNED UNDER A LOCK, from max(node's pending nonce, highest
 *     nonce we have already assigned + 1). Taking the node's number alone is not
 *     enough: transactions we submitted a second ago may not be visible yet.
 *
 *  2. A STUCK TRANSACTION IS REPRICED ON THE SAME NONCE. Never a new one. A new
 *     nonce leaves the original live, and both can land — for a payout, that is
 *     paying twice.
 *
 *  3. IDEMPOTENT AT THE ENTRY POINT. `idempotencyKey` is UNIQUE, so a retried
 *     job resolves to the transaction that already exists rather than queueing a
 *     second one.
 *
 *  4. ABANDON, DO NOT LOOP. After a bounded number of reprices the transaction
 *     is abandoned for a human. A relayer that retries forever at rising gas
 *     prices is a way to spend a treasury on nothing.
 *
 *  5. GAS HAS A CEILING, enforced in the RPC layer. A reprice loop cannot walk
 *     past it.
 * ========================================================================== */

const NONCE_LOCK_TTL_SECONDS = 30;

/** Statuses that still occupy a nonce. */
const NONCE_HOLDING: OutboundTxStatus[] = ["signing", "submitted", "confirmed"];

export interface EnqueueTxInput {
  kind: OutboundTxKind;
  /**
   * Which contract to call.
   *
   * Now required. The submitter used to encode EVERY call with one shared
   * `RELAYER_ABI` covering four different contracts, which meant it could not
   * tell `pause()` on the token from `pause()` on the payout rail, and a
   * function absent from that hand-written list simply failed at signing time.
   */
  contract: ContractName;
  functionName: string;
  args: unknown[];
  /** Defaults to the configured address for `contract`. */
  toAddress?: string;
  /** MUST be derived from the domain — never random. */
  idempotencyKey: string;
  relatedType?: string | null;
  relatedId?: string | null;
}

export interface SubmitOutcome {
  ref: string;
  status: OutboundTxStatus;
  txHash: string | null;
  nonce: number | null;
  explorerUrl: string | null;
  reason?: string;
}

@Injectable()
export class TxSubmitterService {
  private readonly log = new Logger(TxSubmitterService.name);

  constructor(
    @InjectRepository(OutboundTransaction) private readonly txs: Repository<OutboundTransaction>,
    private readonly rpc: RpcService,
    private readonly redis: RedisService,
    private readonly bus: EventBusService,
  ) {}

  /* ==================================================================== *
   * Enqueue
   * ==================================================================== */

  /**
   * Records the intent to send a transaction. Signs nothing.
   *
   * Separating intent from submission is what makes the whole thing recoverable:
   * the row exists before any key is touched, so a crash between "we decided to
   * pay" and "we paid" leaves a queued row rather than nothing at all.
   */
  async enqueue(input: EnqueueTxInput): Promise<OutboundTransaction> {
    const existing = await this.txs.findOne({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      this.log.debug(`outbound tx replay ignored: ${input.idempotencyKey}`);
      return existing;
    }

    /*
     * Validate BEFORE a row exists, let alone a nonce.
     *
     * `assertCallable` refuses anything outside the reviewed allowlist, and
     * `encodeFunctionData` proves the arguments actually encode against the real
     * ABI — so a wrong argument order is a synchronous error here rather than a
     * revert three steps later that has already consumed a nonce every queued
     * transaction behind it has to wait on.
     */
    assertCallable(input.contract, input.functionName);
    const spec = specFor(input.contract);
    try {
      encodeFunctionData({
        abi: spec.abi,
        functionName: input.functionName,
        args: input.args,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new BadRequestException({
        code: "TX_ENCODE_FAILED",
        message:
          `${input.contract}.${input.functionName} does not encode with the given ` +
          `arguments: ${message}`,
      });
    }

    const toAddress = input.toAddress ?? this.rpc.address(spec.configKey);

    const row = await this.txs.save(
      this.txs.create({
        ref: Ref.transaction().replace("TX-", "OTX-"),
        kind: input.kind,
        /* Recorded now so the audit trail shows which key was expected to sign,
         * even if the signer is rotated later. */
        fromAddress: this.rpc.canSign ? this.rpc.signer : "0x0000000000000000000000000000000000000000",
        toAddress,
        functionName: input.functionName,
        args: input.args,
        status: "queued",
        attempts: 0,
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        idempotencyKey: input.idempotencyKey,
      }),
    );

    return row;
  }

  /* ==================================================================== *
   * Submit
   * ==================================================================== */

  /**
   * Signs and submits one queued transaction.
   *
   * The nonce assignment and the status transition to `signing` happen together
   * under the nonce lock, so a second worker cannot pick the same number. If the
   * submission then fails, the nonce is released by returning the row to
   * `queued` — leaving a gap would stall every later transaction from the same
   * address until it was filled.
   */
  async submit(id: string): Promise<SubmitOutcome> {
    const row = await this.txs.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Outbound transaction not found");

    if (row.status === "confirmed") {
      return this.outcome(row, "ALREADY_CONFIRMED");
    }
    if (row.status === "submitted") {
      /* Already in flight. Watching it is correct; submitting again is not. */
      return this.outcome(row, "ALREADY_SUBMITTED");
    }
    if (row.status === "abandoned") {
      return this.outcome(row, "ABANDONED");
    }
    if (!this.rpc.canSign) {
      return this.outcome(row, "NO_SIGNER");
    }

    const result = await this.redis.withLock(
      `chain:nonce:${this.rpc.signer.toLowerCase()}`,
      NONCE_LOCK_TTL_SECONDS,
      () => this.submitUnderNonceLock(row),
    );

    if (result === null) {
      /* Another worker holds the nonce lock. Leaving the row queued is right:
       * the job will retry and the transaction is still exactly once. */
      return this.outcome(row, "NONCE_LOCK_HELD");
    }
    return result;
  }

  private async submitUnderNonceLock(row: OutboundTransaction): Promise<SubmitOutcome> {
    const signer = this.rpc.signer;

    /* Rule 1: the higher of what the node knows and what we have assigned. */
    const nodeNonce = await this.rpc.pendingNonce(signer);
    const localMax = await this.highestAssignedNonce(signer);
    const nonce = row.nonce ?? Math.max(nodeNonce, localMax + 1);

    row.nonce = nonce;
    row.status = "signing";
    row.attempts += 1;
    await this.txs.save(row);

    const gasPrice = await this.rpc.gasPrice();
    const spec = this.resolveSpec(row);

    try {
      const hash = await this.rpc.send({
        to: row.toAddress as `0x${string}`,
        abi: spec.abi,
        functionName: row.functionName,
        args: row.args,
        nonce,
        gasPriceWei: gasPrice,
      });

      row.status = "submitted";
      row.txHash = hash;
      row.submittedAt = new Date();
      row.lastError = null;
      await this.txs.save(row);

      this.log.log(`submitted ${row.kind} ${row.ref} nonce ${nonce}: ${this.rpc.explorerTx(hash)}`);
      return this.outcome(row);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);

      /* Back to queued, not failed: the nonce is released for the retry, and a
       * gap in the sequence would stall everything behind it. */
      row.status = "queued";
      row.nonce = null;
      row.lastError = message.slice(0, 1_000);
      await this.txs.save(row);

      if (row.attempts >= MAX_REPRICE_ATTEMPTS) {
        await this.abandon(row, `submission failed ${row.attempts} times: ${message}`);
        return this.outcome(row, "ABANDONED");
      }

      this.log.error(`submit ${row.ref} failed (attempt ${row.attempts}): ${message}`);
      throw e;
    }
  }

  /**
   * Which contract a stored row is calling.
   *
   * Resolved by ADDRESS first, because that is unambiguous. The fallback by
   * function name exists only for a row whose contract address was rotated after
   * it was queued, and it refuses when the name is ambiguous rather than
   * guessing — `pause` exists on both the token and the payout rail, and sending
   * a privileged call to the wrong contract is not a mistake worth risking to
   * save an operator one requeue.
   */
  private resolveSpec(row: OutboundTransaction): ContractSpec {
    const target = row.toAddress.toLowerCase();

    for (const spec of CONTRACT_SPECS) {
      if (!this.rpc.hasAddress(spec.configKey)) continue;
      if (this.rpc.address(spec.configKey).toLowerCase() === target) return spec;
    }

    const byName = specForCallable(row.functionName);
    if (byName) {
      this.log.warn(
        `${row.ref}: ${row.toAddress} matches no configured contract; resolved ` +
        `${row.functionName} to ${byName.name} by name. Check the address configuration.`,
      );
      return byName;
    }

    throw new ServiceUnavailableException({
      code: "UNRESOLVABLE_CONTRACT",
      message:
        `Cannot determine which contract ${row.ref} targets: ${row.toAddress} matches no ` +
        `configured address and "${row.functionName}" is declared on more than one contract. ` +
        `Fix the contract addresses in configuration and requeue.`,
    });
  }

  /** The highest nonce this address has assigned locally, or -1 if none. */
  private async highestAssignedNonce(signer: string): Promise<number> {
    const raw = await this.txs
      .createQueryBuilder("t")
      .select("COALESCE(MAX(t.nonce), -1)", "max")
      .where("t.fromAddress = :signer", { signer })
      .andWhere("t.nonce IS NOT NULL")
      .andWhere("t.status IN (:...statuses)", { statuses: NONCE_HOLDING })
      .getRawOne<{ max: string | null }>();
    return Number(raw?.max ?? -1);
  }

  /* ==================================================================== *
   * Watch
   * ==================================================================== */

  /**
   * Checks a submitted transaction for its receipt.
   *
   * Three outcomes, all of them explicit: confirmed, reverted, or still pending.
   * A reverted transaction is a FAILURE even though it was mined — treating a
   * revert as success is how a payout gets marked paid without paying.
   */
  async watch(id: string): Promise<SubmitOutcome> {
    const row = await this.txs.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Outbound transaction not found");
    if (row.status === "confirmed" || row.status === "failed" || row.status === "abandoned") {
      return this.outcome(row, "TERMINAL");
    }
    if (!row.txHash) return this.outcome(row, "NOT_SUBMITTED");

    const receipt = await this.rpc.receipt(row.txHash);

    if (!receipt) {
      /* Still pending. Rule 2: if it has been pending too long, reprice on the
       * SAME nonce rather than sending a new transaction. */
      if (row.submittedAt && Date.now() - row.submittedAt.getTime() > STUCK_TX_MS) {
        return this.reprice(row);
      }
      return this.outcome(row, "PENDING");
    }

    if (receipt.status === "reverted") {
      row.status = "failed";
      row.blockNumber = Number(receipt.blockNumber);
      row.gasUsed = receipt.gasUsed.toString();
      row.lastError = "transaction reverted on chain";
      await this.txs.save(row);

      await this.bus.publish(Events.OutboundTxFailed, {
        ref: row.ref,
        kind: row.kind,
        txHash: row.txHash,
        relatedType: row.relatedType,
        relatedId: row.relatedId,
        reason: "reverted",
      });

      this.log.error(`${row.kind} ${row.ref} REVERTED on chain: ${this.rpc.explorerTx(row.txHash)}`);
      return this.outcome(row, "REVERTED");
    }

    /* Mined successfully — but wait out the confirmation depth before telling
     * the domain layer, for the same reason the indexer does. */
    const head = await this.rpc.blockNumber();
    const depth = head - Number(receipt.blockNumber);
    if (depth < MIN_TX_CONFIRMATIONS) {
      return this.outcome(row, "AWAITING_CONFIRMATIONS");
    }

    row.status = "confirmed";
    row.blockNumber = Number(receipt.blockNumber);
    row.gasUsed = receipt.gasUsed.toString();
    row.confirmedAt = new Date();
    row.lastError = null;
    await this.txs.save(row);

    await this.bus.publish(Events.OutboundTxConfirmed, {
      ref: row.ref,
      kind: row.kind,
      txHash: row.txHash,
      blockNumber: row.blockNumber,
      relatedType: row.relatedType,
      relatedId: row.relatedId,
    });

    this.log.log(`${row.kind} ${row.ref} confirmed in block ${row.blockNumber}`);
    return this.outcome(row);
  }

  /**
   * Replaces a stuck transaction at a higher gas price, ON THE SAME NONCE.
   *
   * This is the single most important line in the file. A replacement must reuse
   * the nonce: sending the same payload on a new nonce leaves the original in
   * the mempool, and if it later confirms, both have executed.
   */
  private async reprice(row: OutboundTransaction): Promise<SubmitOutcome> {
    if (row.attempts >= MAX_REPRICE_ATTEMPTS) {
      await this.abandon(row, `still pending after ${row.attempts} attempts`);
      return this.outcome(row, "ABANDONED");
    }
    if (row.nonce === null || row.nonce === undefined) {
      return this.outcome(row, "NO_NONCE_TO_REPLACE");
    }

    const base = await this.rpc.gasPrice();
    /* Bump above the node's minimum replacement threshold, compounded per
     * attempt so a persistently congested chain still clears. */
    const bumped = (base * BigInt(10_000 + REPRICE_BUMP_BPS * row.attempts)) / 10_000n;

    row.attempts += 1;
    await this.txs.save(row);

    const spec = this.resolveSpec(row);

    try {
      const hash = await this.rpc.send({
        to: row.toAddress as `0x${string}`,
        abi: spec.abi,
        functionName: row.functionName,
        args: row.args,
        /* THE SAME NONCE. */
        nonce: row.nonce,
        gasPriceWei: bumped,
      });

      row.txHash = hash;
      row.submittedAt = new Date();
      row.lastError = `repriced at attempt ${row.attempts}`;
      await this.txs.save(row);

      this.log.warn(
        `repriced ${row.ref} on nonce ${row.nonce} at ${bumped} wei: ${this.rpc.explorerTx(hash)}`,
      );
      return this.outcome(row, "REPRICED");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      row.lastError = message.slice(0, 1_000);
      await this.txs.save(row);

      /* A gas ceiling refusal is not something to retry into — it is a decision
       * for a human to make deliberately. */
      if (message.includes("GAS_CEILING_EXCEEDED")) {
        await this.abandon(row, "gas ceiling reached while repricing");
        return this.outcome(row, "ABANDONED");
      }

      this.log.error(`reprice ${row.ref} failed: ${message}`);
      return this.outcome(row, "REPRICE_FAILED");
    }
  }

  /**
   * Gives up on a transaction and says so loudly.
   *
   * An abandoned transaction may still confirm later — the mempool does not care
   * that we stopped watching — so the domain layer is told, rather than left to
   * assume it never happened.
   */
  private async abandon(row: OutboundTransaction, reason: string): Promise<void> {
    row.status = "abandoned";
    row.lastError = reason.slice(0, 1_000);
    await this.txs.save(row);

    await this.bus.publish(Events.OutboundTxFailed, {
      ref: row.ref,
      kind: row.kind,
      txHash: row.txHash ?? null,
      relatedType: row.relatedType,
      relatedId: row.relatedId,
      reason: `abandoned: ${reason}`,
      /* Stated explicitly: an abandoned nonce may still land. */
      mayStillConfirm: Boolean(row.txHash),
    });

    this.log.error(`ABANDONED ${row.kind} ${row.ref}: ${reason}`);
  }

  /* ==================================================================== *
   * Operations
   * ==================================================================== */

  /** Queued transactions the submitter should pick up next. */
  async pending(limit = 50): Promise<OutboundTransaction[]> {
    return this.txs.find({
      where: { status: "queued" },
      order: { createdAt: "ASC" },
      take: Math.min(limit, 500),
    });
  }

  /** Submitted transactions still awaiting a receipt. */
  async inFlight(limit = 100): Promise<OutboundTransaction[]> {
    return this.txs.find({
      where: { status: In(["submitted", "signing"] as OutboundTxStatus[]) },
      order: { submittedAt: "ASC" },
      take: Math.min(limit, 500),
    });
  }

  /**
   * Requeues an abandoned or failed transaction after a human has looked at it.
   *
   * The nonce is deliberately cleared: whatever was wrong, reusing a nonce that
   * may already have been consumed on chain would produce an immediate,
   * confusing rejection.
   */
  async requeue(id: string, reason: string): Promise<SubmitOutcome> {
    const row = await this.txs.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Outbound transaction not found");
    if (row.status === "confirmed") {
      throw new ConflictException({
        code: "ALREADY_CONFIRMED",
        message: "This transaction already confirmed on chain",
      });
    }

    row.status = "queued";
    row.nonce = null;
    row.txHash = null;
    row.attempts = 0;
    row.lastError = `requeued: ${reason}`.slice(0, 1_000);
    await this.txs.save(row);

    this.log.warn(`requeued ${row.ref}: ${reason}`);
    return this.outcome(row, "REQUEUED");
  }

  /** Relayer health: queue depth, in-flight count and the signer's state. */
  async status(): Promise<{
    signer: string | null;
    canSign: boolean;
    queued: number;
    inFlight: number;
    abandoned: number;
    failed: number;
    nextNonce: number | null;
    gasPriceGwei: string | null;
    healthy: boolean;
  }> {
    const [queued, inFlight, abandoned, failed] = await Promise.all([
      this.txs.count({ where: { status: "queued" } }),
      this.txs.count({ where: { status: "submitted" } }),
      this.txs.count({ where: { status: "abandoned" } }),
      this.txs.count({ where: { status: "failed" } }),
    ]);

    let nextNonce: number | null = null;
    let gasPriceGwei: string | null = null;

    if (this.rpc.canSign) {
      try {
        nextNonce = await this.rpc.pendingNonce(this.rpc.signer);
        const gas = await this.rpc.gasPrice();
        gasPriceGwei = dec(gas.toString()).div(1_000_000_000).toFixed(3);
      } catch {
        /* A node that cannot answer is itself the health signal. */
        nextNonce = null;
      }
    }

    return {
      signer: this.rpc.canSign ? this.rpc.signer : null,
      canSign: this.rpc.canSign,
      queued,
      inFlight,
      abandoned,
      failed,
      nextNonce,
      gasPriceGwei,
      /* Abandoned transactions always need a human, so they make the relayer
       * unhealthy by definition rather than sitting quietly in a table. */
      healthy: this.rpc.canSign && abandoned === 0 && nextNonce !== null,
    };
  }

  private outcome(row: OutboundTransaction, reason?: string): SubmitOutcome {
    return {
      ref: row.ref,
      status: row.status,
      txHash: row.txHash ?? null,
      nonce: row.nonce ?? null,
      explorerUrl: row.txHash ? this.rpc.explorerTx(row.txHash) : null,
      reason,
    };
  }
}
