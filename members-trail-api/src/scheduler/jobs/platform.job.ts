import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { RedisService } from "@/common/redis/redis.service";
import { Jobs, Queues, jobKey } from "@/queues/queue.constants";
import { AdminService } from "@/modules/admin/admin.service";
import { FraudService } from "@/modules/fraud/fraud.service";
import { LeaderboardService } from "@/modules/leaderboard/leaderboard.service";
import { NotificationsService } from "@/modules/notifications/notifications.service";
import { QuestsService } from "@/modules/quests/quests.service";
import { StoreService } from "@/modules/store/store.service";
import { SupportService } from "@/modules/support/support.service";
import { TournamentsService } from "@/modules/tournaments/tournaments.service";
import { WebhooksService } from "@/modules/webhooks/webhooks.service";
import { IndexerService } from "@/modules/chain/indexer.service";
import { TxSubmitterService } from "@/modules/chain/tx-submitter.service";

/* ============================================================================
 * Platform, compliance and integration crons.
 *
 * Same discipline as the economy jobs: every body runs under a Redis lock, and a
 * failure is logged at error level with the job name rather than disappearing.
 *
 * The chain jobs are the ones with the tightest interval, because indexer lag is
 * how a member's stake fails to appear — and a stalled indexer looks exactly like
 * a quiet chain unless something is watching.
 * ========================================================================== */

@Injectable()
export class PlatformJobs {
  private readonly log = new Logger(PlatformJobs.name);

  constructor(
    private readonly redis: RedisService,
    private readonly admin: AdminService,
    private readonly fraud: FraudService,
    private readonly leaderboard: LeaderboardService,
    private readonly notifications: NotificationsService,
    private readonly quests: QuestsService,
    private readonly store: StoreService,
    private readonly support: SupportService,
    private readonly tournaments: TournamentsService,
    private readonly webhooks: WebhooksService,
    private readonly indexer: IndexerService,
    private readonly submitter: TxSubmitterService,
    @InjectQueue(Queues.ChainIndex) private readonly chainIndexQueue: Queue,
    @InjectQueue(Queues.ChainTx) private readonly chainTxQueue: Queue,
    @InjectQueue(Queues.Fraud) private readonly fraudQueue: Queue,
    @InjectQueue(Queues.Leaderboard) private readonly leaderboardQueue: Queue,
  ) {}

  /* ==================================================================== *
   * Chain
   * ==================================================================== */

  /**
   * Enqueues an indexing pass.
   *
   * The cron enqueues rather than indexing inline: the work belongs on the worker
   * fleet, and a scheduler that did the indexing itself would tie the chain's
   * throughput to whichever instance happens to hold the scheduler lock.
   */
  @Cron(CronExpression.EVERY_30_SECONDS, { name: "chain-index" })
  async indexChain(): Promise<void> {
    await this.locked("chain-index", 25, async () => {
      await this.chainIndexQueue.add(
        Jobs.IndexRange,
        {},
        /* One in flight at a time: the id collapses a backlog rather than
         * building one, and the cursor makes the next pass pick up the slack. */
        { jobId: jobKey("index-range:current"), removeOnComplete: true },
      );
    });
  }

  /**
   * Watches in-flight transactions and reprices the stuck ones.
   *
   * Every minute, because the reprice threshold is measured in minutes and a
   * payout sitting in the mempool is a member waiting for their money.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: "chain-tx-watch" })
  async watchTransactions(): Promise<void> {
    await this.locked("chain-tx-watch", 55, async () => {
      const inFlight = await this.submitter.inFlight(100);
      for (const tx of inFlight) {
        await this.chainTxQueue.add(
          Jobs.WatchTx,
          { outboundId: tx.id },
          { jobId: jobKey(`watch:${tx.id}:${Math.floor(Date.now() / 60_000)}`), removeOnComplete: true },
        );
      }
      if (inFlight.length > 0) this.log.debug(`queued ${inFlight.length} transaction checks`);
    });
  }

  /** Submits queued transactions. */
  @Cron(CronExpression.EVERY_MINUTE, { name: "chain-tx-submit" })
  async submitTransactions(): Promise<void> {
    await this.locked("chain-tx-submit", 55, async () => {
      const queued = await this.submitter.pending(25);
      for (const tx of queued) {
        await this.chainTxQueue.add(
          Jobs.SubmitTx,
          { outboundId: tx.id },
          { jobId: jobKey(`submit:${tx.id}`), removeOnComplete: true },
        );
      }
    });
  }

  /**
   * Reports indexer and relayer health.
   *
   * Logged at warn/error level so it reaches alerting. Silence from the chain
   * layer is indistinguishable from a healthy quiet chain, which is exactly why
   * this exists.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: "chain-health" })
  async chainHealth(): Promise<void> {
    await this.locked("chain-health", 240, async () => {
      /* The two halves are reported independently on purpose.
       *
       * Indexer status needs an RPC read (how far is the head?); relayer status
       * is derived from our own tables. When the RPC provider is unreachable —
       * which happens, and is itself the finding — a single try/catch around both
       * would hide the relayer's queue depth exactly when someone is looking. */
      try {
        const indexer = await this.indexer.status();
        if (!indexer.healthy) {
          const worst = indexer.cursors.filter((c) => !c.healthy);
          this.log.error(
            `indexer unhealthy: ${worst
              .map((c) => `${c.contract} lag ${c.lagBlocks} blocks${c.lastError ? ` (${c.lastError})` : ""}`)
              .join("; ")}`,
          );
        }
        if (indexer.unprocessedEvents > 500) {
          this.log.warn(`${indexer.unprocessedEvents} chain events stored but not yet applied`);
        }
      } catch (e) {
        /* Named for what it is, rather than surfacing a transport error whose
         * message ("HTTP request failed") says nothing about the chain. */
        this.log.error(
          "chain unreachable: no configured RPC endpoint answered, so indexer lag is unknown " +
          `— ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      const relayer = await this.submitter.status();
      if (!relayer.healthy) {
        this.log.error(
          `relayer unhealthy: signer=${relayer.canSign}, abandoned=${relayer.abandoned}, ` +
          `queued=${relayer.queued}, nextNonce=${relayer.nextNonce}`,
        );
      }
    });
  }

  /* ==================================================================== *
   * Gameplay
   * ==================================================================== */

  /** Moves tournaments through their lifecycle and queues finished ones. */
  @Cron(CronExpression.EVERY_MINUTE, { name: "tournament-lifecycle" })
  async tournamentLifecycle(): Promise<void> {
    await this.locked("tournament-lifecycle", 55, async () => {
      const result = await this.tournaments.advanceLifecycle();
      if (result.started > 0 || result.queuedForSettlement > 0) {
        this.log.log(
          `tournaments: ${result.started} started, ${result.queuedForSettlement} queued for settlement`,
        );
      }
    });
  }

  /**
   * Snapshots the daily leaderboards shortly before UTC midnight, and again
   * just after.
   *
   * Twice on purpose: the pre-midnight run captures the final standings while the
   * live index still holds them, and the post-midnight run catches anything that
   * landed in between. Prizes are awarded on rank, so the record has to be right.
   */
  @Cron("55 23 * * *", { name: "leaderboard-snapshot-close" })
  async snapshotBeforeMidnight(): Promise<void> {
    await this.locked("leaderboard-snapshot-close", 240, async () => {
      await this.leaderboardQueue.add(Jobs.SnapshotLeaderboard, { period: "daily" });
    });
  }

  @Cron("5 0 * * *", { name: "leaderboard-snapshot-open" })
  async snapshotAfterMidnight(): Promise<void> {
    await this.locked("leaderboard-snapshot-open", 600, async () => {
      await this.leaderboard.snapshotAll("daily");
      await this.leaderboard.snapshotAll("weekly");
      await this.leaderboard.snapshotAll("monthly");
      /* Pruned AFTER snapshotting, never before: pruning first would lose a
       * period's final standings if Redis were the only copy. */
      await this.leaderboard.pruneClosedPeriods();
    });
  }

  /** Expires yesterday's unclaimed daily quests. */
  @Cron(CronExpression.EVERY_DAY_AT_1AM, { name: "quest-expiry" })
  async expireQuests(): Promise<void> {
    await this.locked("quest-expiry", 600, async () => {
      const expired = await this.quests.expireStale();
      if (expired > 0) this.log.log(`${expired} quest instances expired unclaimed`);
    });
  }

  /** Expires stale marketplace listings and releases their locked items. */
  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: "listing-expiry" })
  async expireListings(): Promise<void> {
    await this.locked("listing-expiry", 900, async () => {
      const expired = await this.store.expireStaleListings();
      if (expired > 0) this.log.log(`${expired} listings expired, items released`);
    });
  }

  /* ==================================================================== *
   * Compliance and support
   * ==================================================================== */

  /** Runs the fraud sweeps on the worker fleet. */
  @Cron(CronExpression.EVERY_30_MINUTES, { name: "fraud-sweep" })
  async fraudSweep(): Promise<void> {
    await this.locked("fraud-sweep", 1_500, async () => {
      await this.fraudQueue.add(
        Jobs.EvaluateFraudRules,
        {},
        { jobId: jobKey(`fraud-sweep:${Math.floor(Date.now() / 1_800_000)}`), removeOnComplete: true },
      );
    });
  }

  /** Cap-hugging runs monthly: it is a per-month pattern by definition. */
  @Cron("0 4 1 * *", { name: "fraud-cap-hugging" })
  async capHuggingSweep(): Promise<void> {
    await this.locked("fraud-cap-hugging", 900, async () => {
      const previous = new Date();
      previous.setUTCMonth(previous.getUTCMonth() - 1);
      const result = await this.fraud.sweepCapHugging(previous.toISOString().slice(0, 7));
      if (result.raised > 0) this.log.log(`cap-hugging: ${result.raised} alerts raised`);
    });
  }

  /**
   * Escalates support tickets that breached their SLA with no reply.
   *
   * Every 15 minutes rather than nightly: the financial-dispute SLA is four
   * hours, and an escalation that arrives the next morning is not an escalation.
   */
  @Cron("*/15 * * * *", { name: "sla-escalation" })
  async escalateBreachedTickets(): Promise<void> {
    await this.locked("sla-escalation", 800, async () => {
      const escalated = await this.support.escalateBreached();
      if (escalated > 0) this.log.warn(`auto-escalated ${escalated} tickets past their SLA`);
    });
  }

  /** Expires stale dual-control requests. */
  @Cron(CronExpression.EVERY_HOUR, { name: "approval-expiry" })
  async expireApprovals(): Promise<void> {
    await this.locked("approval-expiry", 3_000, async () => {
      const expired = await this.admin.expireStaleApprovals();
      if (expired > 0) this.log.log(`${expired} approval requests expired unanswered`);
    });
  }

  /* ==================================================================== *
   * Integration and housekeeping
   * ==================================================================== */

  /** Retries outbound webhook deliveries whose backoff has elapsed. */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: "webhook-retry" })
  async retryWebhooks(): Promise<void> {
    await this.locked("webhook-retry", 540, async () => {
      const due = await this.webhooks.dueForRetry(100);
      for (const row of due) await this.webhooks.requeueOutbound(row.id);
      if (due.length > 0) this.log.log(`requeued ${due.length} outbound webhooks`);
    });
  }

  /**
   * Re-drives inbound webhooks that were stored but never processed.
   *
   * The provider will not send them again — their retry is answered as a
   * duplicate by design — so if the enqueue was lost (a Redis blip between the
   * INSERT and the queue write, a worker crash before the job was persisted)
   * this sweep is the only thing that recovers it. Five minutes of grace so
   * events currently in flight are left alone.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: "webhook-inbound-sweep" })
  async sweepInboundWebhooks(): Promise<void> {
    await this.locked("webhook-inbound-sweep", 540, async () => {
      const stranded = await this.webhooks.unprocessed(100, 5);
      for (const row of stranded) await this.webhooks.requeueInbound(row);
      if (stranded.length > 0) {
        this.log.warn(
          `re-drove ${stranded.length} stored-but-unprocessed inbound webhooks — ` +
          `oldest ${stranded[0]?.provider} ${stranded[0]?.eventId}`,
        );
      }
    });
  }

  /**
   * Reports webhook health.
   *
   * A burst of rejected signatures is either our misconfiguration or someone
   * probing the endpoint, and both deserve to be noticed the same day.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: "webhook-health" })
  async webhookHealth(): Promise<void> {
    await this.locked("webhook-health", 3_000, async () => {
      const status = await this.webhooks.status();
      if (status.inboundRejected24h > 0) {
        this.log.error(
          `${status.inboundRejected24h} webhook deliveries rejected in 24h — ` +
          "misconfiguration or probing",
        );
      }
      if (status.outboundAbandoned > 0) {
        this.log.warn(`${status.outboundAbandoned} outbound webhooks abandoned and awaiting a human`);
      }
      if (status.inboundUnprocessed > 50) {
        this.log.warn(`${status.inboundUnprocessed} verified webhooks stored but not yet applied`);
      }
    });
  }

  /** Prunes long-read notifications. */
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: "notification-prune" })
  async pruneNotifications(): Promise<void> {
    await this.locked("notification-prune", 900, async () => {
      const pruned = await this.notifications.pruneRead(90);
      if (pruned > 0) this.log.log(`pruned ${pruned} read notifications`);
    });
  }

  /** Reports what needs a human, once a day, at the start of the working day. */
  @Cron("0 8 * * *", { name: "daily-attention" })
  async dailyAttention(): Promise<void> {
    await this.locked("daily-attention", 900, async () => {
      const kpis = await this.admin.kpis();
      if (kpis.attentionRequired.length === 0) {
        this.log.log("nothing needs attention today");
        return;
      }
      for (const item of kpis.attentionRequired) this.log.warn(`ATTENTION: ${item}`);
    });
  }

  /* ------------------------------------------------------------------ */

  private async locked(name: string, ttlSeconds: number, fn: () => Promise<void>): Promise<void> {
    const result = await this.redis.withLock(`cron:${name}`, ttlSeconds, async () => {
      const started = Date.now();
      try {
        await fn();
      } catch (e) {
        this.log.error(
          `cron ${name} failed after ${Date.now() - started}ms: ${e instanceof Error ? e.message : String(e)}`,
          e instanceof Error ? e.stack : undefined,
        );
      }
      return true;
    });

    if (result === null) this.log.debug(`cron ${name} skipped — lock held`);
  }
}
