import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { Events, type DomainEvent } from "@/events";
import { TreasuryService } from "@/modules/treasury/treasury.service";
import { ChainWriteService } from "./chain-write.service";

/* ============================================================================
 * The missing half of a treasury funding transfer.
 *
 * WHAT WAS BROKEN
 * ---------------
 * Funding a pool was a complete, correct, four-eyes-approved workflow that then
 * did nothing at all. `approveOutflow` published `TreasuryOutflowApproved` and
 * NOTHING WAS SUBSCRIBED TO IT, so no chain transaction was ever enqueued; and
 * `markOutflowConfirmed` existed but had no caller, because nothing was
 * subscribed to `OutboundTxConfirmed` either. Both ends of the bridge between an
 * approved transfer and the chain were absent.
 *
 * The failure was silent in the worst way. The outflow reached `approved` and
 * stopped there: no queued job, no error, no alert. Downstream, the commission
 * engine correctly refuses to release a commission the pool has not been funded
 * for — so commissions accumulated as `queued`, the operator saw an approved
 * transfer and unfunded pools, and nothing anywhere said why. Found by driving a
 * purchase through to a payout and watching it stop.
 *
 * WHAT THIS DOES
 * --------------
 * Two listeners, in the chain layer because that is the only layer allowed to
 * know a chain exists (treasury does not import chain; see chain.module.ts):
 *
 *   approved  -> enqueue depositCommissionPool / fundRewardPool, tagged with the
 *                outflow that authorised it
 *   confirmed -> mark that outflow confirmed with its block and hash
 *
 * The tag is the point. Funding transactions were previously linked to a
 * treasury PERIOD, which cannot identify which of a month's transfers a given
 * receipt settled — so the confirmation had nowhere to go back to.
 * ========================================================================== */

/** `relatedType` on the outbound transaction, and the routing key on the way back. */
export const OUTFLOW_RELATED_TYPE = "treasury_outflow";

@Injectable()
export class TreasuryChainBridgeService {
  private readonly log = new Logger(TreasuryChainBridgeService.name);

  constructor(
    private readonly writes: ChainWriteService,
    private readonly treasury: TreasuryService,
  ) {}

  /**
   * Submits an approved transfer to the chain.
   *
   * Idempotent on the outflow id, so a redelivered event, a restart mid-publish
   * or a second approval racing the first all resolve to one transaction.
   * Failures are logged and left for the relayer's own queue and the outflow's
   * `approved` status to make visible — throwing here would only lose the event.
   */
  @OnEvent(Events.TreasuryOutflowApproved)
  async onApproved(event: DomainEvent<{
    outflowId: string;
    ref: string;
    destination: "staking_pool" | "commission_pool";
    poolId: number | null;
    amount: string;
    periodKey: string;
  }>): Promise<void> {
    /* The bus emits a DomainEvent envelope, not the bare payload — see the note
       in realtime.gateway.ts. Reading the wrapper as the payload gives undefined
       for every field and fails at the first use. */
    const payload = event.payload;
    const link = {
      relatedType: OUTFLOW_RELATED_TYPE,
      relatedId: payload.outflowId,
      idempotencyKey: `treasury-outflow:${payload.outflowId}`,
    };

    try {
      if (payload.destination === "commission_pool") {
        const tx = await this.writes.depositCommissionPool(payload.amount, payload.periodKey, link);
        this.log.log(
          `outflow ${payload.ref} (${payload.amount} MTT to the commission pool) enqueued as ${tx.ref}`,
        );
        return;
      }

      if (payload.poolId === null) {
        /* Refused at proposal time, so this is a data problem rather than an
           operator mistake — and funding "some pool" is not a guess to make. */
        this.log.error(
          `outflow ${payload.ref} targets a staking pool but carries no poolId — not submitted`,
        );
        return;
      }

      const tx = await this.writes.fundRewardPool(
        payload.poolId, payload.amount, payload.periodKey, link,
      );
      this.log.log(
        `outflow ${payload.ref} (${payload.amount} MTT to staking pool ${payload.poolId}) ` +
        `enqueued as ${tx.ref}`,
      );
    } catch (e) {
      this.log.error(
        `could not enqueue the chain transaction for approved outflow ${payload.ref} — it stays ` +
        `approved and unfunded until this is resolved`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  /**
   * Records the settlement against the outflow that authorised it.
   *
   * `markOutflowConfirmed` also rolls the period up and publishes
   * `TreasuryOutflowConfirmed`, which is what the commission release path and
   * the treasury dashboard read — so this is the step that turns an approval
   * into funded, releasable money.
   */
  @OnEvent(Events.OutboundTxConfirmed)
  async onConfirmed(event: DomainEvent<{
    ref: string;
    kind: string;
    txHash: string | null;
    blockNumber: number | null;
    relatedType: string | null;
    relatedId: string | null;
  }>): Promise<void> {
    const payload = event.payload;
    if (payload.relatedType !== OUTFLOW_RELATED_TYPE || !payload.relatedId) return;
    if (!payload.txHash) {
      this.log.error(`${payload.ref} confirmed with no transaction hash — outflow not marked`);
      return;
    }

    try {
      await this.treasury.markOutflowConfirmed(
        payload.relatedId, payload.txHash, payload.blockNumber ?? 0,
      );
      this.log.log(`outflow ${payload.relatedId} confirmed by ${payload.kind} ${payload.ref}`);
    } catch (e) {
      this.log.error(
        `${payload.ref} confirmed on chain but outflow ${payload.relatedId} could not be marked — ` +
        `the money moved and the platform's record disagrees, which needs a human`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }
}
