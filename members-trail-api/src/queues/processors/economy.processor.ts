import { Inject, Injectable, Logger } from "@nestjs/common";
import { Processor } from "@nestjs/bullmq";
import { keccak256, toHex } from "viem";
import { Jobs, Queues } from "@/queues/queue.constants";
import { chainConfig, type ChainConfig } from "@/config/configuration";
import { WithdrawalService } from "@/modules/wallet/withdrawal.service";
import { CommissionService } from "@/modules/referral/commission.service";
import { TreasuryService } from "@/modules/treasury/treasury.service";
import { TxSubmitterService } from "@/modules/chain/tx-submitter.service";
import { BaseProcessor } from "./base.processor";

/* ============================================================================
 * Money-moving queues.
 *
 * These processors are thin on purpose. Every rule — the solvency invariant, the
 * caps, the four-eyes checks — lives in the service, so a job is a scheduling
 * decision rather than a second place where money logic can drift. If a
 * processor here contained a business rule, the HTTP path and the queue path
 * could disagree, and only one of them would be tested.
 *
 * Retries are safe because every service method these call is idempotent on a
 * domain-derived key.
 * ========================================================================== */

@Injectable()
@Processor(Queues.Withdrawal)
export class WithdrawalProcessor extends BaseProcessor {
  protected readonly log = new Logger(WithdrawalProcessor.name);

  constructor(
    private readonly withdrawal: WithdrawalService,
    private readonly submitter: TxSubmitterService,
    @Inject(chainConfig.KEY) private readonly chain: ChainConfig,
  ) {
    super();
  }

  protected handlers() {
    return {
      /** Closes a cooling-off window; the service decides where it routes next. */
      [Jobs.ReleaseCoolingOff]: async (data: { withdrawalId: string }) => {
        await this.withdrawal.releaseCoolingOff(data.withdrawalId);
        return { withdrawalId: data.withdrawalId };
      },

      /**
       * Carries out an approved payout.
       *
       * The processor decides nothing: `beginPayout` re-checks the status, picks
       * the rail and returns the whitelisted destination and the amount in base
       * units. Every value in the transfer below comes from that instruction —
       * NOTHING comes from the job payload except the id used to look it up, so a
       * forged or replayed job cannot redirect a payout.
       */
      [Jobs.ProcessWithdrawal]: async (data: { withdrawalId: string }) => {
        const instruction = await this.withdrawal.beginPayout(data.withdrawalId);

        if (instruction.rail === "none") {
          /* Deliberately not a throw: retrying will not change the status. */
          return { withdrawalId: data.withdrawalId, skipped: instruction.reason };
        }

        if (instruction.rail === "fiat") {
          /* Fiat leaves through the payment provider, not the chain. This is an
           * explicit seam: until that integration exists the payout stays in
           * `processing` and appears in the ops queue, rather than being reported
           * as sent. */
          this.log.warn(
            `fiat payout ${instruction.ref} is awaiting the payment-provider rail — ` +
            "left in processing for operations",
          );
          return { withdrawalId: data.withdrawalId, rail: "fiat", pendingProvider: true };
        }

        /*
         * Settlement rail.
         *
         * PREFERRED: MTTPayout. The contract dedupes on the withdrawal reference,
         * enforces a daily ceiling on what the relayer key can move, and emits the
         * reference alongside the amount — so "did we pay this member twice" is
         * answerable from chain data rather than from trusting this table.
         *
         * FALLBACK: a direct ERC-20 transfer from the token contract, which is
         * what this did before MTTPayout existed. It works, but it requires the
         * relayer key to BE the wallet holding the tokens — an always-online hot
         * key with unilateral authority over the 400,000,000 MTT rewards pool and
         * no on-chain limit. That is why the fallback warns every single time
         * rather than quietly doing the less safe thing.
         */
        const payoutRail = this.chain.contracts.payout;
        const token = this.chain.contracts.mttToken;

        if (!payoutRail && !token) {
          /* Thrown, not failed: an unconfigured address is an operator mistake
           * that a retry fixes. Refunding the member here would undo a payout
           * they are still owed, and the request stays visible in `processing`
           * until someone sets the address. */
          throw new Error(
            `cannot pay ${instruction.ref}: neither PAYOUT_ADDRESS nor MTT_TOKEN_ADDRESS ` +
            "is configured on this instance",
          );
        }

        const tx = payoutRail
          ? await this.submitter.enqueue({
              kind: "transfer",
              contract: "payout",
              functionName: "payout",
              /*
               * payout(to, amount, withdrawalRef).
               *
               * The reference is keccak256 of the platform's own withdrawal ref,
               * so the contract's replay guard and the ledger key the same fact.
               * Deriving it from `ref` rather than the row id keeps it stable and
               * human-traceable: the same string appears in the member's history,
               * in the audit log and in the event on the explorer.
               */
              args: [
                instruction.toAddress,
                instruction.amountWei,
                keccak256(toHex(instruction.ref)),
              ],
              idempotencyKey: instruction.idempotencyKey,
              relatedType: "withdrawal",
              relatedId: instruction.withdrawalId,
            })
          : await (async () => {
              this.log.warn(
                `paying ${instruction.ref} by direct token transfer: PAYOUT_ADDRESS is unset, ` +
                "so the relayer key must hold the rewards pool and no on-chain daily limit " +
                "or replay guard applies. Deploy MTTPayout and set PAYOUT_ADDRESS.",
              );
              return this.submitter.enqueue({
                kind: "transfer",
                contract: "mttToken",
                functionName: "transfer",
                /* ERC-20 transfer(to, value): the token contract is the callee,
                 * the member's whitelisted address is the argument. */
                args: [instruction.toAddress, instruction.amountWei],
                idempotencyKey: instruction.idempotencyKey,
                relatedType: "withdrawal",
                relatedId: instruction.withdrawalId,
              });
            })();

        return {
          withdrawalId: data.withdrawalId,
          rail: payoutRail ? "chain:payout" : "chain:token",
          outboundTxRef: tx.ref,
        };
      },
    };
  }
}

@Injectable()
@Processor(Queues.Commission)
export class CommissionProcessor extends BaseProcessor {
  protected readonly log = new Logger(CommissionProcessor.name);

  constructor(
    private readonly commission: CommissionService,
    private readonly treasury: TreasuryService,
  ) {
    super();
  }

  protected handlers() {
    return {
      /**
       * Fans a settled revenue event out to its upline.
       *
       * The engine refuses unreconciled revenue itself and returns a `skipped`
       * reason rather than throwing, so an unreconciled event does not burn
       * retries — it simply pays once reconciliation happens and the event is
       * reprocessed.
       */
      [Jobs.ProcessRevenueEvent]: async (data: { revenueEventId: string }) => {
        return this.commission.processRevenueEvent(data.revenueEventId);
      },

      /** Releases queued commission after the pool has been funded. */
      [Jobs.ReleaseCommission]: async () => {
        return this.commission.releaseQueued();
      },

      /**
       * Reverses commission after a refund or chargeback.
       *
       * Reverses the revenue event first: if the reversal fails partway, the
       * revenue is already marked reversed, so the engine will not pay on it
       * again while the clawback is retried.
       */
      [Jobs.ClawbackCommission]: async (data: { revenueEventId: string; reason: string }) => {
        await this.treasury.reverse(data.revenueEventId, data.reason);
        return this.commission.clawbackForRevenueEvent(data.revenueEventId, data.reason);
      },
    };
  }
}

@Injectable()
@Processor(Queues.Treasury)
export class TreasuryProcessor extends BaseProcessor {
  protected readonly log = new Logger(TreasuryProcessor.name);

  constructor(private readonly treasury: TreasuryService) {
    super();
  }

  protected handlers() {
    return {
      /** Recomputes a period's totals and the payout ratio. */
      [Jobs.RollupTreasuryPeriod]: async (data: { periodKey: string }) => {
        const period = await this.treasury.rollupPeriod(data.periodKey);
        return { periodKey: data.periodKey, payoutRatioBps: period.payoutRatioBps };
      },
    };
  }
}
