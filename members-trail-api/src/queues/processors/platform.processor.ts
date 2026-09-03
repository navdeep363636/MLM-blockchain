import { Injectable, Logger } from "@nestjs/common";
import { Processor } from "@nestjs/bullmq";
import { Jobs, Queues } from "@/queues/queue.constants";
import { asAmount, firstScalar } from "@/common/utils";
import { GamesService } from "@/modules/games/games.service";
import { TournamentsService } from "@/modules/tournaments/tournaments.service";
import { LeaderboardService } from "@/modules/leaderboard/leaderboard.service";
import { QuestsService } from "@/modules/quests/quests.service";
import { NotificationsService } from "@/modules/notifications/notifications.service";
import { FraudService } from "@/modules/fraud/fraud.service";
import { ReportsService } from "@/modules/reports/reports.service";
import { WebhooksService } from "@/modules/webhooks/webhooks.service";
import { DepositService } from "@/modules/wallet/deposit.service";
import { IndexerService } from "@/modules/chain/indexer.service";
import { EventDispatcherService } from "@/modules/chain/event-dispatcher.service";
import { TxSubmitterService } from "@/modules/chain/tx-submitter.service";
import { StakingService } from "@/modules/staking/staking.service";
import { BaseProcessor } from "./base.processor";

/* ============================================================================
 * Gameplay, platform and integration queues.
 *
 * The one that matters most is game validation: it is the only path that creates
 * Points from gameplay, it runs off the request path so a slow replay cannot hold
 * an HTTP connection, and it is idempotent on the session id so a retry credits
 * once.
 * ========================================================================== */

@Injectable()
@Processor(Queues.GameValidation)
export class GameValidationProcessor extends BaseProcessor {
  protected readonly log = new Logger(GameValidationProcessor.name);

  constructor(
    private readonly games: GamesService,
    private readonly quests: QuestsService,
    private readonly leaderboard: LeaderboardService,
  ) {
    super();
  }

  protected handlers() {
    return {
      /**
       * Replays a submitted session and credits Points from the SERVER score.
       *
       * Quests and leaderboards are advanced from the same validated result, in
       * that order, and a failure in either does not undo the Points: the member
       * earned them, and a quest counter is not worth reversing a credit over.
       */
      [Jobs.ValidateSession]: async (data: {
        sessionId: string;
        telemetry: { t: number; e: number; v: number }[];
        clientScore: number;
        durationMs: number;
      }) => {
        const outcome = await this.games.validateSession(data);

        if (outcome.status !== "validated") return outcome;

        const signal = {
          userId: outcome.userId,
          gameId: outcome.gameId,
          serverScore: outcome.serverScore ?? 0,
          pointsAwarded: outcome.pointsAwarded,
        };

        /* Both are swallowed on purpose: a quest counter or a leaderboard index
         * must not cost a member the Points they already earned, and the session
         * is validated and credited by this point. */
        try {
          await this.quests.onSessionValidated(signal);
        } catch (e) {
          this.log.warn(
            `quest tracking failed for session ${data.sessionId}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        try {
          await this.leaderboard.onSessionValidated(signal);
        } catch (e) {
          this.log.warn(
            `leaderboard update failed for session ${data.sessionId}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }

        return outcome;
      },
    };
  }
}

@Injectable()
@Processor(Queues.Leaderboard)
export class LeaderboardProcessor extends BaseProcessor {
  protected readonly log = new Logger(LeaderboardProcessor.name);

  constructor(
    private readonly leaderboard: LeaderboardService,
    private readonly tournaments: TournamentsService,
  ) {
    super();
  }

  protected handlers() {
    return {
      /** Persists the live board so a rank survives a Redis flush. */
      [Jobs.SnapshotLeaderboard]: async (data: {
        period?: "daily" | "weekly" | "monthly" | "all_time";
      }) => {
        return this.leaderboard.snapshotAll(data.period ?? "daily");
      },

      /**
       * Settles a finished tournament.
       *
       * On the leaderboard queue rather than a money queue because it is
       * triggered by a schedule; the settlement itself is idempotent and refuses
       * to pay more than the declared pool.
       */
      [Jobs.SettleTournament]: async (data: { tournamentId: string }) => {
        return this.tournaments.settle(data.tournamentId);
      },

      /**
       * Reconstructs the LIVE index for a period from validated sessions.
       *
       * Distinct from `SnapshotLeaderboard`: that one persists the live index to
       * the durable `leaderboard_snapshots` table, this one repopulates Redis
       * itself. Used for manual recovery after a Redis flush/eviction outside the
       * boot-time reconciliation — it used to just call `snapshotAll` again,
       * which re-persists whatever the (possibly still-empty) live index holds
       * rather than rebuilding it.
       */
      [Jobs.RebuildLeaderboard]: async (data: {
        period?: "daily" | "weekly" | "monthly" | "all_time";
      }) => {
        const period = data.period ?? "weekly";
        const metrics: Array<"points" | "score" | "sessions" | "wins"> = [
          "points", "score", "sessions", "wins",
        ];
        let total = 0;
        for (const metric of metrics) total += await this.leaderboard.rebuild(metric, period);
        return { period, rebuilt: total };
      },
    };
  }
}

@Injectable()
@Processor(Queues.Notification)
export class NotificationProcessor extends BaseProcessor {
  protected readonly log = new Logger(NotificationProcessor.name);

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  protected handlers() {
    return {
      /**
       * Delivers one notification on one channel.
       *
       * The provider integration is deliberately a seam: until an email or SMS
       * provider is wired in, the delivery is recorded as `suppressed` with the
       * reason rather than reported as sent. A system that logs "sent" for
       * messages it never sent is worse than one that sends nothing.
       */
      [Jobs.SendNotification]: async (data: { deliveryId: string; notificationId: string }) => {
        await this.notifications.recordDelivery({
          deliveryId: data.deliveryId,
          status: "suppressed",
          error: "no delivery provider configured for this channel",
        });
        return { deliveryId: data.deliveryId, delivered: false, reason: "NO_PROVIDER" };
      },
    };
  }
}

@Injectable()
@Processor(Queues.Fraud)
export class FraudProcessor extends BaseProcessor {
  protected readonly log = new Logger(FraudProcessor.name);

  constructor(private readonly fraud: FraudService) {
    super();
  }

  protected handlers() {
    return {
      /** Runs the detection sweeps off the request path. */
      [Jobs.EvaluateFraudRules]: async () => {
        return this.fraud.sweepAll();
      },
    };
  }
}

@Injectable()
@Processor(Queues.Report)
export class ReportProcessor extends BaseProcessor {
  protected readonly log = new Logger(ReportProcessor.name);

  constructor(private readonly reports: ReportsService) {
    super();
  }

  protected handlers() {
    return {
      /**
       * Generates a report asynchronously.
       *
       * The same service the HTTP route uses, so a scheduled report and an
       * on-demand one cannot produce different totals.
       */
      [Jobs.GenerateReport]: async (data: {
        type: Parameters<ReportsService["generate"]>[0]["type"];
        from?: string;
        to?: string;
        actorId: string;
      }) => {
        const report = await this.reports.generate(
          { type: data.type, from: data.from, to: data.to },
          data.actorId,
        );
        return {
          type: report.type,
          rowCount: report.rowCount,
          truncated: report.truncated,
          filename: report.filename,
        };
      },
    };
  }
}

@Injectable()
@Processor(Queues.Webhook)
export class WebhookProcessor extends BaseProcessor {
  protected readonly log = new Logger(WebhookProcessor.name);

  constructor(
    private readonly webhooks: WebhooksService,
    private readonly deposits: DepositService,
  ) {
    super();
  }

  protected handlers() {
    return {
      /**
       * Applies a verified provider callback.
       *
       * A payment settlement is the case that matters: it credits real money, so
       * it goes through DepositService.creditReconciled, which is idempotent on
       * the deposit id and refuses anything that does not reconcile.
       */
      [Jobs.ProcessWebhook]: async (data: {
        webhookEventId: string;
        provider: string;
        eventType: string | null;
      }) => {
        const event = await this.webhooks.find(data.webhookEventId);
        if (!event) return { skipped: "EVENT_GONE" };
        if (event.processedAt) return { skipped: "ALREADY_PROCESSED" };
        if (!event.signatureValid) {
          /* Should be unreachable — an invalid signature is never enqueued — but
           * a defence here costs nothing and the alternative is crediting money
           * from an unverified payload. */
          await this.webhooks.markProcessed(event.id, "refused: signature was not valid");
          return { skipped: "SIGNATURE_INVALID" };
        }

        const payload = event.payload;

        if (event.provider === "payment" && isSettled(payload)) {
          /* Every field below is read with a helper that REFUSES a non-scalar.
           * `String(payload.amount)` would turn a provider's
           * `{ "amount": { "value": "100" } }` into the literal string
           * "[object Object]" and record it as money that arrived. */
          const ref = firstScalar(payload.reference, payload.deposit_ref);
          if (!ref) {
            await this.webhooks.markProcessed(event.id, "no deposit reference in payload");
            return { skipped: "NO_REFERENCE" };
          }

          const settled = asAmount(payload.settled_amount) ?? asAmount(payload.amount);
          if (settled === null) {
            /* A settlement callback with no readable amount is not a zero-value
             * credit — it is a payload we do not understand, and guessing is how
             * a member gets credited the wrong number. */
            await this.webhooks.markProcessed(
              event.id,
              "settled payment carried no readable amount — needs manual reconciliation",
            );
            return { skipped: "NO_READABLE_AMOUNT", depositRef: ref };
          }

          const result = await this.deposits.creditReconciled({
            ref,
            processor: firstScalar(payload.processor) ?? event.provider,
            processorRef: firstScalar(payload.id) ?? event.eventId,
            settledAmountFiat: settled,
            currency: firstScalar(payload.currency) ?? "INR",
            payload,
          });

          await this.webhooks.markProcessed(event.id, null);
          return { credited: true, depositRef: result.ref, status: result.status };
        }

        /* Anything else is stored for the audit trail and acknowledged. An
         * unrecognised event type is not an error — providers add them. */
        await this.webhooks.markProcessed(event.id, null);
        return { handled: false, eventType: data.eventType };
      },
    };
  }
}

@Injectable()
@Processor(Queues.OutboundWebhook)
export class OutboundWebhookProcessor extends BaseProcessor {
  protected readonly log = new Logger(OutboundWebhookProcessor.name);

  constructor(private readonly webhooks: WebhooksService) {
    super();
  }

  protected handlers() {
    return {
      /**
       * Delivers a signed payload to a partner.
       *
       * The HTTP client is a seam like the notification provider: until one is
       * configured the attempt is recorded as failed with the reason, so nothing
       * claims to have been delivered when it was not.
       */
      [Jobs.DeliverWebhook]: async (data: { outboundId: string }) => {
        const row = await this.webhooks.markFailed(
          data.outboundId,
          null,
          "no outbound HTTP client configured",
        );
        return {
          outboundId: data.outboundId,
          status: row?.status ?? "unknown",
          nextRetryAt: row?.nextRetryAt?.toISOString() ?? null,
        };
      },
    };
  }
}

@Injectable()
@Processor(Queues.ChainIndex)
export class ChainIndexProcessor extends BaseProcessor {
  protected readonly log = new Logger(ChainIndexProcessor.name);

  constructor(
    private readonly indexer: IndexerService,
    private readonly dispatcher: EventDispatcherService,
    private readonly staking: StakingService,
  ) {
    super();
  }

  protected handlers() {
    return {
      /**
       * One indexing pass, then dispatch.
       *
       * In that order and in the same job: indexing without dispatching leaves
       * stored events unapplied, and dispatching first would apply the previous
       * pass's events a tick later than necessary.
       */
      [Jobs.IndexRange]: async () => {
        const indexed = await this.indexer.runAll();
        const dispatched = await this.dispatcher.dispatch();
        return { indexed, dispatched };
      },

      /** Refreshes a member's pending rewards from an authoritative chain read. */
      [Jobs.SyncStaking]: async (data: {
        userId: string;
        poolId: number;
        pendingRewardsMtt: string;
        blockNumber: number;
      }) => {
        await this.staking.syncPendingRewards(data);
        return { userId: data.userId, poolId: data.poolId };
      },
    };
  }
}

@Injectable()
@Processor(Queues.ChainTx)
export class ChainTxProcessor extends BaseProcessor {
  protected readonly log = new Logger(ChainTxProcessor.name);

  constructor(
    private readonly submitter: TxSubmitterService,
    private readonly staking: StakingService,
  ) {
    super();
  }

  protected handlers() {
    return {
      /**
       * Submits a queued transaction.
       *
       * Nonce assignment is serialised inside the submitter, so several workers
       * running this concurrently is safe — which is the whole reason the nonce
       * is managed there rather than here.
       */
      [Jobs.SubmitTx]: async (data: { intentRef?: string; outboundId?: string }) => {
        if (!data.outboundId) {
          /* A staking intent arrives with its own shape; the submitter needs a
           * row, so the intent is recorded first by the service that made it. */
          return { skipped: "NO_OUTBOUND_ID", intentRef: data.intentRef ?? null };
        }
        return this.submitter.submit(data.outboundId);
      },

      /** Checks a submitted transaction, repricing on the SAME nonce if stuck. */
      [Jobs.WatchTx]: async (data: { outboundId: string }) => {
        return this.submitter.watch(data.outboundId);
      },
    };
  }
}

/* --------------------------------- helpers -------------------------------- */

/**
 * Whether a payment payload represents money that actually arrived.
 *
 * Deliberately a whitelist, and deliberately an EXACT match. A default of
 * "anything that is not explicitly a failure counts as settled" would credit a
 * member on a `pending` or `authorized` event — before the money is captured and
 * while a cancellation is still possible. Substring matching is nearly as bad:
 * `refund.settled` contains "settled", so a refund notification would have
 * credited the deposit a second time.
 *
 * An unrecognised status is not settled. The event is still stored and
 * acknowledged, so a provider adding a new name costs a reconciliation entry —
 * not a wrong credit.
 */
const SETTLED_STATUSES = new Set([
  "captured", "succeeded", "success", "settled", "paid", "completed",
  "payment.captured", "payment.succeeded", "payment_success", "charge.succeeded",
  "order.paid", "transaction.settled",
]);

/** Words that mean the money is going the other way, or is not there yet. */
const NEVER_SETTLED = ["refund", "chargeback", "reversal", "reversed", "dispute", "failed", "cancel", "void"];

export function isSettled(payload: Record<string, unknown>): boolean {
  const candidates = [payload.status, payload.event, payload.type]
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().toLowerCase());

  /* If ANY field says the money moved back or never arrived, that wins over any
   * other field claiming success — a refund payload often carries both. */
  if (candidates.some((c) => NEVER_SETTLED.some((bad) => c.includes(bad)))) return false;

  return candidates.some((c) => SETTLED_STATUSES.has(c));
}
