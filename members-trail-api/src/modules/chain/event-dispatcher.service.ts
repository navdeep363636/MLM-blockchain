import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import { ChainEvent, User, WalletAddress } from "@/database/entities";
import { EventBusService, Events } from "@/events";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import { fromWei, asAmount, asIndex } from "@/common/utils";
import { CommissionService } from "@/modules/referral/commission.service";
import { StakingService } from "@/modules/staking/staking.service";
import { Contracts } from "./chain.constants";

/* ============================================================================
 * The event dispatcher: stored chain events → domain state.
 *
 * This is the second half of "store first, process second". The indexer's job is
 * to lose nothing; this service's job is to apply what was stored, and the split
 * is what makes both jobs safe:
 *
 *  • A HANDLER BUG NEVER LOSES AN EVENT. A failure leaves `processedAt` null and
 *    an error on the row. Fix the handler, run again, and the event is applied.
 *    Doing the work inline in the indexer would mean a bug either lost events or
 *    stalled the cursor.
 *
 *  • ORDER IS PRESERVED. Events are applied in (blockNumber, logIndex) order, so
 *    a stake and the unstake that follows it cannot be applied backwards.
 *
 *  • ORPHANED EVENTS ARE NEVER APPLIED. A reorg marks them; this service skips
 *    them. An already-processed event that is later orphaned is a domain problem
 *    that the reorg alert raises, not something to silently re-apply.
 *
 *  • AN UNKNOWN ADDRESS IS NOT AN ERROR. Anyone can interact with a public
 *    contract. An event from an address that belongs to no member is marked
 *    processed with a note, not retried forever.
 * ========================================================================== */

const MAX_ATTEMPTS = 5;

export interface DispatchResult {
  processed: number;
  skipped: number;
  failed: number;
  remaining: number;
}

@Injectable()
export class EventDispatcherService {
  private readonly log = new Logger(EventDispatcherService.name);

  constructor(
    @InjectRepository(ChainEvent) private readonly events: Repository<ChainEvent>,
    @InjectRepository(WalletAddress) private readonly addresses: Repository<WalletAddress>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly staking: StakingService,
    private readonly commission: CommissionService,
    private readonly bus: EventBusService,
    private readonly routines: DbRoutinesService,
  ) {}

  /**
   * Applies the next batch of unprocessed events, oldest first.
   *
   * Called by the indexer cron immediately after a scan. Each event is handled in
   * its own try/catch: one poisoned event must not block the queue behind it.
   */
  async dispatch(limit = 200): Promise<DispatchResult> {
    const rows = await this.events.find({
      where: { processedAt: IsNull(), orphaned: false },
      /* Chain order, not insertion order: a stake must be applied before the
       * unstake that followed it in the same block. */
      order: { blockNumber: "ASC", logIndex: "ASC" },
      take: Math.min(limit, 1_000),
    });

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const event of rows) {
      try {
        const outcome = await this.apply(event);
        event.processedAt = new Date();
        event.processError = outcome === "skipped" ? "no matching platform account or handler" : null;
        await this.events.save(event);
        if (outcome === "skipped") skipped += 1;
        else processed += 1;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        event.processAttempts += 1;
        event.processError = message.slice(0, 1_000);

        if (event.processAttempts >= MAX_ATTEMPTS) {
          /* Marked processed so the queue drains, but with the error preserved
           * and an alert raised. Silently retrying forever would hide it. */
          event.processedAt = new Date();
          this.log.error(
            `giving up on ${event.eventName} ${event.txHash}#${event.logIndex} ` +
            `after ${event.processAttempts} attempts: ${message}`,
          );
          await this.bus.publish(Events.FraudAlertRaised, {
            kind: "chain_event_undeliverable",
            eventName: event.eventName,
            txHash: event.txHash,
            logIndex: event.logIndex,
            error: message.slice(0, 500),
            severity: "high",
          });
        }

        await this.events.save(event);
        failed += 1;
      }
    }

    const remaining = await this.events.count({
      where: { processedAt: IsNull(), orphaned: false },
    });

    if (processed > 0 || failed > 0) {
      this.log.log(`dispatched ${processed} chain events (${skipped} skipped, ${failed} failed)`);
    }

    return { processed, skipped, failed, remaining };
  }

  /**
   * Routes one event to its handler.
   *
   * Returns "skipped" when the event is genuinely not ours to apply — an unknown
   * address, or an event we index for the audit trail but do not act on.
   */
  private async apply(event: ChainEvent): Promise<"applied" | "skipped"> {
    const args = event.args ?? {};

    if (event.contractName === Contracts.Staking) {
      return this.applyStaking(event, args);
    }
    if (event.contractName === Contracts.ReferralDistributor) {
      return this.applyReferral(event, args);
    }
    return "skipped";
  }

  private async applyStaking(
    event: ChainEvent,
    args: Record<string, unknown>,
  ): Promise<"applied" | "skipped"> {
    /* PoolCreated and pool funding are not per-member, so they are handled
     * before any address resolution. */
    if (event.eventName === "RewardPoolFunded") {
      await this.staking.mirrorPoolFunding({
        poolId: asIndex(args.poolId) ?? 0,
        amountMtt: fromWei(asAmount(args.amount) ?? "0"),
        blockNumber: event.blockNumber,
        txHash: event.txHash,
      });
      return "applied";
    }

    if (event.eventName === "PoolCreated") {
      /* Deliberately not auto-created: the mirror's name, terms and visibility
       * are an administrative decision, and a half-populated pool row shown to
       * members is worse than none. The event is recorded for the audit trail. */
      this.log.log(
        `pool ${String(args.poolId)} created on chain — mirror it explicitly via the admin route`,
      );
      return "skipped";
    }

    const userId = await this.resolveUser(args.user);
    if (!userId) return "skipped";

    if (event.eventName === "Staked") {
      const lockEndSeconds = asIndex(args.lockEnd) ?? 0;
      await this.staking.mirrorStake({
        userId,
        poolId: asIndex(args.poolId) ?? 0,
        amountMtt: fromWei(asAmount(args.amount) ?? "0"),
        lockEnd: lockEndSeconds > 0 ? new Date(lockEndSeconds * 1_000) : null,
        blockNumber: event.blockNumber,
        txHash: event.txHash,
      });
      return "applied";
    }

    if (event.eventName === "Unstaked") {
      await this.staking.mirrorUnstake({
        userId,
        poolId: asIndex(args.poolId) ?? 0,
        principalMtt: fromWei(asAmount(args.amount) ?? "0"),
        rewardsPaidMtt: fromWei(asAmount(args.rewards) ?? "0"),
        penaltyMtt: fromWei(asAmount(args.penalty) ?? "0"),
        blockNumber: event.blockNumber,
        txHash: event.txHash,
      });
      return "applied";
    }

    if (event.eventName === "RewardsClaimed") {
      await this.staking.mirrorRewardClaim({
        userId,
        poolId: asIndex(args.poolId) ?? 0,
        amountMtt: fromWei(asAmount(args.amount) ?? "0"),
        blockNumber: event.blockNumber,
        txHash: event.txHash,
      });
      return "applied";
    }

    return "skipped";
  }

  private async applyReferral(
    event: ChainEvent,
    args: Record<string, unknown>,
  ): Promise<"applied" | "skipped"> {
    if (event.eventName === "CommissionPoolDeposited") {
      /* The pool has been funded on chain, so queued commission may now be
       * releasable. The solvency check inside releaseQueued decides how much —
       * this event is the trigger, not the authority. */
      const result = await this.commission.releaseQueued();
      this.log.log(
        `commission pool funded (${fromWei(asAmount(args.amount) ?? "0")} MTT): ` +
        `released ${result.released}, ${result.remaining} still queued`,
      );
      return "applied";
    }

    if (event.eventName === "CommissionRecorded" || event.eventName === "CommissionClaimed") {
      /* The backend is the accounting authority for commission; the chain record
       * is a public receipt of it. Applying it again here would double-count, so
       * the event is indexed for reconciliation and nothing more. */
      return "skipped";
    }

    return "skipped";
  }

  /**
   * Maps an on-chain address to a platform account.
   *
   * Checks the verified wallet_addresses table first, then the denormalised
   * `users.walletAddress`. A miss is normal — a public contract accepts anyone —
   * and is reported as a skip rather than an error.
   */
  private async resolveUser(raw: unknown): Promise<string | null> {
    if (typeof raw !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
    const address = raw.toLowerCase();

    const linked = await this.addresses.findOne({ where: { address } });
    if (linked) return linked.userId;

    const user = await this.users.findOne({ where: { walletAddress: address } });
    return user?.id ?? null;
  }

  /**
   * Re-queues events for a block range so they are applied again.
   *
   * The operational counterpart to the indexer's rewind: after fixing a handler,
   * this makes the already-stored events flow through it without touching the
   * chain at all.
   */
  async replayRange(fromBlock: number, toBlock: number, reason: string): Promise<number> {
    /* One UPDATE. This loaded up to ten thousand entities and saved them back one
     * at a time — for an operation an operator runs precisely when the chain
     * layer is already in trouble and time matters. */
    const queued = await this.routines.resetChainEventsForReplay(fromBlock, toBlock);

    this.log.warn(`queued ${queued} events in ${fromBlock}–${toBlock} for replay: ${reason}`);
    return queued;
  }
}
