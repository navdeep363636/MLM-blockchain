import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { Address, Hex } from "viem";
import { keccak256, toHex } from "viem";
import type { OutboundTransaction } from "@/database/entities";
import { fromWei, toWei } from "@/common/utils";
import { ChainReadService } from "./chain-read.service";
import { RpcService } from "./rpc.service";
import { TxSubmitterService } from "./tx-submitter.service";
import { Contracts, specFor } from "./chain.constants";

/* ============================================================================
 * Contract writes, as domain operations.
 *
 * The submitter below this handles nonces, repricing and idempotency. This layer
 * handles the part that is specific to THESE contracts: which function, in what
 * argument order, with amounts converted once, and an idempotency key derived
 * from the domain fact rather than invented.
 *
 * Why it is a layer at all rather than call sites reaching for the submitter:
 *
 *  1. ARGUMENT ORDER IS DECLARED ONCE. `recordCommission(recipient, level,
 *     amount, sourceEventId)` — the exact ordering the previous chain layer got
 *     wrong. Encoded in one place, it can be wrong once and fixed once.
 *
 *  2. IDEMPOTENCY KEYS ARE DERIVED, NEVER RANDOM. Every key below is a function
 *     of the domain fact it settles, so a retried job, a duplicated queue
 *     message and a double-clicked admin button all resolve to the same row.
 *
 *  3. WEI CONVERSION HAPPENS AT THE BOUNDARY. Callers pass decimal MTT strings,
 *     which is what the ledger holds. `toWei` is applied here, once, so no
 *     caller has to remember and no amount is converted twice.
 * ========================================================================== */

export interface CommissionEntry {
  /** The recipient's verified wallet address. */
  recipient: string;
  /** Referral level, 1-3. */
  level: number;
  /** Amount in decimal MTT, as held in the ledger. */
  amountMtt: string;
}

@Injectable()
export class ChainWriteService {
  private readonly log = new Logger(ChainWriteService.name);

  constructor(
    private readonly submitter: TxSubmitterService,
    private readonly reads: ChainReadService,
    private readonly rpc: RpcService,
  ) {}

  /* ==================================================================== *
   * Referral commission
   * ==================================================================== */

  /**
   * Records every commission owed for one revenue event, in one transaction.
   *
   * This is the settlement path. It uses `recordCommissionBatch` rather than a
   * loop of `recordCommission` calls for a reason that is about correctness, not
   * gas: a qualifying purchase generates up to three commissions up the referral
   * chain, and settling them one transaction at a time means level 1 can land
   * while level 2 reverts on the pool's funding invariant. The ledger would then
   * say one member was paid for a purchase and their upline was not, with nothing
   * on chain marking the settlement incomplete.
   *
   * The batch checks the invariant once, against the total, and records all or
   * none.
   */
  async recordCommissions(
    entries: CommissionEntry[],
    sourceEventRef: string,
  ): Promise<OutboundTransaction> {
    if (entries.length === 0) {
      throw new BadRequestException({
        code: "EMPTY_COMMISSION_BATCH",
        message: "Nothing to record",
      });
    }
    if (entries.length > 16) {
      /* The contract's own bound. Refused here so the caller gets a clear error
       * instead of a revert. */
      throw new BadRequestException({
        code: "COMMISSION_BATCH_TOO_LARGE",
        message: `recordCommissionBatch accepts at most 16 entries, got ${entries.length}`,
      });
    }

    for (const e of entries) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(e.recipient)) {
        throw new BadRequestException({
          code: "INVALID_RECIPIENT",
          message: `${e.recipient} is not an address`,
        });
      }
      if (!Number.isInteger(e.level) || e.level < 1 || e.level > 3) {
        throw new BadRequestException({
          code: "INVALID_LEVEL",
          message: `Referral level must be 1-3, got ${e.level}`,
        });
      }
    }

    const sourceEventId = this.refHash(sourceEventRef);

    /*
     * Pre-flight the dedupe check with the CONTRACT'S OWN key derivation.
     *
     * A duplicate would revert, which costs gas and burns a nonce that every
     * queued transaction behind it waits on. Asking first costs one view call.
     * The check is advisory — the contract's `require` is the real guard, and it
     * has to be, because another submission could land between this read and our
     * transaction.
     */
    const alreadyRecorded: string[] = [];
    for (const e of entries) {
      const recorded = await this.reads
        .isCommissionRecorded(e.recipient, e.level, sourceEventId)
        .catch(() => null);
      if (recorded) alreadyRecorded.push(`${e.recipient}@L${e.level}`);
    }
    if (alreadyRecorded.length > 0) {
      throw new BadRequestException({
        code: "COMMISSION_ALREADY_RECORDED",
        message:
          `Already recorded on chain for source ${sourceEventRef}: ` +
          `${alreadyRecorded.join(", ")}. The batch would revert whole.`,
      });
    }

    /*
     * Pre-flight the FUNDING invariant, for the same reason as the dedupe check
     * above and with more force behind it.
     *
     * The contract enforces `totalRecorded <= totalDeposited`, so a batch larger
     * than the pool's headroom reverts whole. On the BSC testnet deployment the
     * commission pool sits at `totalDeposited = 0` — nobody has called
     * `depositCommissionPool()` yet — which means EVERY batch reverts, each one
     * spending gas and burning a nonce that the whole queue behind it waits on.
     * One view call turns that into a refusal with a reason.
     *
     * Advisory, like the dedupe check: another submission can land between this
     * read and ours, and the contract's `require` remains the real guard. An
     * unreadable pool is not treated as empty — refusing to settle because the
     * RPC blinked would be worse than letting the contract decide.
     */
    const total = entries.reduce((sum, e) => sum + toWei(e.amountMtt), 0n);
    const state = await this.reads.distributorState().catch(() => null);
    if (state) {
      const headroom = toWei(state.availablePoolBalance);
      if (headroom < total) {
        throw new BadRequestException({
          code: "COMMISSION_POOL_UNDERFUNDED",
          message:
            `The commission pool has ${state.availablePoolBalance} MTT of unrecorded headroom ` +
            `and this batch needs ${fromWei(total)} MTT, so recordCommissionBatch would revert ` +
            `whole on the totalRecorded <= totalDeposited invariant. ` +
            (state.totalDeposited === "0"
              ? "Nothing has been deposited yet — treasury must call depositCommissionPool() " +
                "before any commission can settle on chain."
              : "Deposit more to the pool, or settle a smaller batch."),
        });
      }
    }

    return this.submitter.enqueue({
      kind: "record_commission",
      contract: Contracts.ReferralDistributor,
      functionName: "recordCommissionBatch",
      /*
       * The tuple order is the CONTRACT'S: (recipient, level, amount). viem
       * encodes a struct array from an array of objects keyed by field name, so
       * the names here are load-bearing.
       */
      args: [
        entries.map((e) => ({
          recipient: e.recipient as Address,
          level: e.level,
          amount: toWei(e.amountMtt),
        })),
        sourceEventId,
      ],
      /* One settlement per revenue event, whatever retries happen above. */
      idempotencyKey: `commission:batch:${sourceEventRef}`,
      relatedType: "revenue_event",
      relatedId: sourceEventRef,
    });
  }

  /**
   * Records a single commission.
   *
   * Kept for the case where one commission genuinely settles alone — a
   * correction, or a chain of depth one. Note the argument order:
   * (recipient, level, amount, sourceEventId). The previous chain layer had this
   * as (recipient, sourceEventId, level, amount), which is a different selector
   * and would have reverted every time.
   */
  async recordCommission(
    recipient: string, level: number, amountMtt: string, sourceEventRef: string,
  ): Promise<OutboundTransaction> {
    const sourceEventId = this.refHash(sourceEventRef);
    return this.submitter.enqueue({
      kind: "record_commission",
      contract: Contracts.ReferralDistributor,
      functionName: "recordCommission",
      args: [recipient, level, toWei(amountMtt), sourceEventId],
      idempotencyKey: `commission:${sourceEventRef}:${recipient.toLowerCase()}:${level}`,
      relatedType: "revenue_event",
      relatedId: sourceEventRef,
    });
  }

  /**
   * Reverses a recorded, unclaimed commission.
   *
   * `reason` is required by the contract and emitted in the event — a clawback is
   * a compliance act somebody will have to justify, so the justification belongs
   * in the permanent record next to the amount.
   */
  async clawbackCommission(
    recipient: string, amountMtt: string, sourceEventRef: string, reason: string,
  ): Promise<OutboundTransaction> {
    if (!reason || reason.trim().length < 10) {
      throw new BadRequestException({
        code: "REASON_REQUIRED",
        message: "A clawback needs a reason of at least 10 characters — it is emitted on chain",
      });
    }
    return this.submitter.enqueue({
      kind: "clawback",
      contract: Contracts.ReferralDistributor,
      functionName: "clawback",
      /* (recipient, amount, sourceEventId, reason) — the old fragment had a
       * `string` in the third position where the contract takes a bytes32. */
      args: [recipient, toWei(amountMtt), this.refHash(sourceEventRef), reason.trim()],
      idempotencyKey: `clawback:${sourceEventRef}:${recipient.toLowerCase()}:${amountMtt}`,
      relatedType: "revenue_event",
      relatedId: sourceEventRef,
    });
  }

  /** Funds the commission pool from reconciled revenue. TREASURY_ROLE on chain. */
  /**
   * `link` attaches the transaction to the record that authorised it, so the
   * confirmation can be routed back. Without it a confirmed deposit is linked
   * only to a period, and nothing can tell WHICH approved outflow it settled.
   */
  async depositCommissionPool(
    amountMtt: string,
    periodRef: string,
    link?: { relatedType: string; relatedId: string; idempotencyKey?: string },
  ): Promise<OutboundTransaction> {
    return this.submitter.enqueue({
      kind: "deposit_commission_pool",
      contract: Contracts.ReferralDistributor,
      functionName: "depositCommissionPool",
      args: [toWei(amountMtt)],
      idempotencyKey: link?.idempotencyKey ?? `commission-pool:deposit:${periodRef}`,
      relatedType: link?.relatedType ?? "treasury_period",
      relatedId: link?.relatedId ?? periodRef,
    });
  }

  /* ==================================================================== *
   * KYC gating
   * ==================================================================== */

  /**
   * Mirrors a KYC decision onto the distributor, which gates commission claims.
   *
   * The backend remains the authority on tier; this flag is only "may this
   * address claim". Idempotent on (address, decision) so re-approving is free
   * and flipping the decision is a distinct transaction.
   */
  async setKycApproved(
    address: string, approved: boolean, userId: string,
  ): Promise<OutboundTransaction> {
    return this.submitter.enqueue({
      kind: "set_kyc_approved",
      contract: Contracts.ReferralDistributor,
      functionName: "setKycApproved",
      args: [address, approved],
      idempotencyKey: `kyc:${address.toLowerCase()}:${approved ? "approve" : "revoke"}`,
      relatedType: "user",
      relatedId: userId,
    });
  }

  /**
   * Mirrors a batch of KYC decisions.
   *
   * Reviewers clear a queue, so decisions arrive in groups. One transaction per
   * approval means forty base fees and forty independent confirmations to track,
   * any one of which can be the one that quietly fails.
   */
  async setKycApprovedBatch(
    addresses: string[], approved: boolean, batchRef: string,
  ): Promise<OutboundTransaction> {
    if (addresses.length === 0 || addresses.length > 100) {
      throw new BadRequestException({
        code: "BAD_BATCH_SIZE",
        message: `setKycApprovedBatch accepts 1-100 addresses, got ${addresses.length}`,
      });
    }
    return this.submitter.enqueue({
      kind: "set_kyc_approved",
      contract: Contracts.ReferralDistributor,
      functionName: "setKycApprovedBatch",
      args: [addresses.map((a) => a as Address), approved],
      idempotencyKey: `kyc:batch:${batchRef}:${approved ? "approve" : "revoke"}`,
      relatedType: "kyc_batch",
      relatedId: batchRef,
    });
  }

  /* ==================================================================== *
   * Staking
   * ==================================================================== */

  /**
   * Streams reconciled revenue into a pool's reward balance.
   *
   * The ONLY way rewards enter the staking contract, and the reason the
   * platform's APR claim is defensible: the rate is a consequence of this call,
   * not a promise made before it.
   */
  async fundRewardPool(
    poolId: number,
    amountMtt: string,
    periodRef: string,
    link?: { relatedType: string; relatedId: string; idempotencyKey?: string },
  ): Promise<OutboundTransaction> {
    return this.submitter.enqueue({
      kind: "fund_reward_pool",
      contract: Contracts.Staking,
      functionName: "fundRewardPool",
      args: [BigInt(poolId), toWei(amountMtt)],
      idempotencyKey: link?.idempotencyKey ?? `pool-funding:${periodRef}:${poolId}`,
      relatedType: link?.relatedType ?? "treasury_period",
      relatedId: link?.relatedId ?? periodRef,
    });
  }

  /**
   * Creates a staking pool.
   *
   * Durations are SECONDS, which is what the contract takes. The previous
   * relayer ABI declared `createPool(uint256 lockDays, uint256
   * rewardsDurationDays, uint256 earlyPenaltyBps)` — wrong types AND wrong
   * units, so a 30-day pool would have been created with a 30-second lock.
   */
  async createPool(
    lockDurationSeconds: number,
    rewardsDurationSeconds: number,
    earlyPenaltyBps: number,
    requestRef: string,
  ): Promise<OutboundTransaction> {
    if (rewardsDurationSeconds <= 0) {
      throw new BadRequestException({
        code: "INVALID_REWARDS_DURATION",
        message: "rewardsDuration must be greater than zero",
      });
    }
    if (earlyPenaltyBps < 0 || earlyPenaltyBps > 10_000) {
      throw new BadRequestException({
        code: "INVALID_PENALTY",
        message: "earlyPenaltyBps must be 0-10000",
      });
    }
    return this.submitter.enqueue({
      kind: "create_pool",
      contract: Contracts.Staking,
      functionName: "createPool",
      args: [
        BigInt(lockDurationSeconds),
        BigInt(rewardsDurationSeconds),
        earlyPenaltyBps,
      ],
      idempotencyKey: `pool:create:${requestRef}`,
      relatedType: "staking_pool",
      relatedId: requestRef,
    });
  }

  async setPoolActive(poolId: number, active: boolean, requestRef: string): Promise<OutboundTransaction> {
    return this.submitter.enqueue({
      kind: "set_pool_active",
      contract: Contracts.Staking,
      functionName: "setPoolActive",
      args: [BigInt(poolId), active],
      idempotencyKey: `pool:${poolId}:${active ? "activate" : "deactivate"}:${requestRef}`,
      relatedType: "staking_pool",
      relatedId: String(poolId),
    });
  }

  /* ==================================================================== *
   * Payout rail
   * ==================================================================== */

  /**
   * Settles one member withdrawal through MTTPayout.
   *
   * Pre-flighted against the rail's own state, because all three of these
   * failures are cheaper to catch as a read than as a reverted transaction:
   * the withdrawal is already settled, the float cannot cover it, or the daily
   * ceiling is exhausted. The contract still enforces every one of them — this
   * only avoids paying gas to be told.
   */
  async payoutWithdrawal(
    to: string, amountMtt: string, withdrawalRef: string, withdrawalId: string,
  ): Promise<OutboundTransaction> {
    const amountWei = toWei(amountMtt);

    const settlement = await this.reads.settlement(withdrawalRef).catch(() => null);
    if (settlement?.settled) {
      throw new BadRequestException({
        code: "ALREADY_SETTLED_ON_CHAIN",
        message:
          `Withdrawal ${withdrawalRef} was already paid on chain ` +
          `(${settlement.amount} MTT). Reconcile the ledger rather than paying again.`,
      });
    }

    const canPay = await this.reads.canPay(amountWei).catch(() => null);
    if (canPay === false) {
      const state = await this.reads.payoutState().catch(() => null);
      throw new BadRequestException({
        code: "PAYOUT_RAIL_CANNOT_PAY",
        message:
          `The payout rail cannot settle ${amountMtt} MTT right now` +
          (state
            ? ` — float ${state.float} MTT, remaining daily allowance ` +
              `${state.remainingAllowance} MTT${state.paused ? ", rail PAUSED" : ""}.`
            : "."),
      });
    }

    return this.submitter.enqueue({
      kind: "payout",
      contract: Contracts.Payout,
      functionName: "payout",
      args: [to, amountWei, this.reads.withdrawalRefHash(withdrawalRef)],
      idempotencyKey: `payout:${withdrawalRef}`,
      relatedType: "withdrawal",
      relatedId: withdrawalId,
    });
  }

  /** Moves treasury MTT into the payout float. TREASURY_ROLE on chain. */
  async fundPayoutFloat(amountMtt: string, requestRef: string): Promise<OutboundTransaction> {
    return this.submitter.enqueue({
      kind: "fund_payout_float",
      contract: Contracts.Payout,
      functionName: "fund",
      args: [toWei(amountMtt)],
      idempotencyKey: `payout-float:fund:${requestRef}`,
      relatedType: "treasury_period",
      relatedId: requestRef,
    });
  }

  /** Returns float to the treasury. The destination is msg.sender on chain. */
  async sweepPayoutFloat(
    amountMtt: string, reason: string, requestRef: string,
  ): Promise<OutboundTransaction> {
    if (!reason || reason.trim().length < 10) {
      throw new BadRequestException({
        code: "REASON_REQUIRED",
        message: "A sweep needs a reason of at least 10 characters — it is emitted on chain",
      });
    }
    return this.submitter.enqueue({
      kind: "sweep_payout_float",
      contract: Contracts.Payout,
      functionName: "sweep",
      args: [toWei(amountMtt), reason.trim()],
      idempotencyKey: `payout-float:sweep:${requestRef}`,
      relatedType: "treasury_period",
      relatedId: requestRef,
    });
  }

  /**
   * Halts the payout rail.
   *
   * The incident-response action. Deliberately does not touch custody of the
   * float: funding and sweeping keep working while payouts are stopped.
   */
  async pausePayouts(requestRef: string): Promise<OutboundTransaction> {
    return this.submitter.enqueue({
      kind: "pause",
      contract: Contracts.Payout,
      functionName: "pause",
      args: [],
      idempotencyKey: `payout:pause:${requestRef}`,
      relatedType: "incident",
      relatedId: requestRef,
    });
  }

  async unpausePayouts(requestRef: string): Promise<OutboundTransaction> {
    return this.submitter.enqueue({
      kind: "unpause",
      contract: Contracts.Payout,
      functionName: "unpause",
      args: [],
      idempotencyKey: `payout:unpause:${requestRef}`,
      relatedType: "incident",
      relatedId: requestRef,
    });
  }

  async setPayoutDailyLimit(limitMtt: string, requestRef: string): Promise<OutboundTransaction> {
    return this.submitter.enqueue({
      kind: "set_daily_limit",
      contract: Contracts.Payout,
      functionName: "setDailyLimit",
      args: [toWei(limitMtt)],
      idempotencyKey: `payout:limit:${requestRef}`,
      relatedType: "incident",
      relatedId: requestRef,
    });
  }

  /* ==================================================================== *
   * Token
   * ==================================================================== */

  /**
   * Emergency pause of ALL MTT transfers.
   *
   * The largest blast radius of anything in this file: it stops staking,
   * claiming, payouts and every DEX trade at once. PAUSER_ROLE is expected to be
   * a timelocked multisig, so this is included for completeness and because the
   * admin surface should be able to see that it exists — not because a backend
   * key should be able to do it.
   */
  async pauseToken(requestRef: string): Promise<OutboundTransaction> {
    this.log.error(`TOKEN PAUSE requested (${requestRef}) — this halts every MTT transfer`);
    return this.submitter.enqueue({
      kind: "pause",
      contract: Contracts.MttToken,
      functionName: "pause",
      args: [],
      idempotencyKey: `token:pause:${requestRef}`,
      relatedType: "incident",
      relatedId: requestRef,
    });
  }

  async unpauseToken(requestRef: string): Promise<OutboundTransaction> {
    return this.submitter.enqueue({
      kind: "unpause",
      contract: Contracts.MttToken,
      functionName: "unpause",
      args: [],
      idempotencyKey: `token:unpause:${requestRef}`,
      relatedType: "incident",
      relatedId: requestRef,
    });
  }

  /**
   * Approves a spender for the signer's MTT.
   *
   * Needed when the relayer itself must let a contract pull tokens — funding a
   * reward pool and funding the payout float both use `safeTransferFrom`, so the
   * approval has to exist first. Not a member-facing operation: members approve
   * from their own wallet in the browser.
   */
  async approve(spender: string, amountMtt: string, requestRef: string): Promise<OutboundTransaction> {
    return this.submitter.enqueue({
      kind: "approve",
      contract: Contracts.MttToken,
      functionName: "approve",
      args: [spender, toWei(amountMtt)],
      idempotencyKey: `approve:${spender.toLowerCase()}:${requestRef}`,
      relatedType: "treasury_period",
      relatedId: requestRef,
    });
  }

  /* ==================================================================== *
   * Helpers
   * ==================================================================== */

  /**
   * The bytes32 a platform reference maps to on chain.
   *
   * Derived from the human-readable ref (`WD-2026-000123`) rather than a UUID, so
   * the same string appears in the member's history, the audit log and the event
   * on the explorer. One definition, used by every write here and mirrored by
   * `ChainReadService.withdrawalRefHash` for the reads.
   */
  private refHash(ref: string): Hex {
    return keccak256(toHex(ref));
  }

  /** Where a given contract lives, for surfacing in the admin UI. */
  addressOf(name: Parameters<typeof specFor>[0]): string | null {
    const spec = specFor(name);
    return this.rpc.hasAddress(spec.configKey) ? this.rpc.address(spec.configKey) : null;
  }
}
