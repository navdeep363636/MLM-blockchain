import { Module } from "@nestjs/common";
import { ChainModule } from "@/modules/chain/chain.module";
import { ConversionModule } from "@/modules/conversion/conversion.module";
import { FraudModule } from "@/modules/fraud/fraud.module";
import { GamesModule } from "@/modules/games/games.module";
import { LeaderboardModule } from "@/modules/leaderboard/leaderboard.module";
import { NotificationsModule } from "@/modules/notifications/notifications.module";
import { QuestsModule } from "@/modules/quests/quests.module";
import { ReferralModule } from "@/modules/referral/referral.module";
import { ReportsModule } from "@/modules/reports/reports.module";
import { StakingModule } from "@/modules/staking/staking.module";
import { TournamentsModule } from "@/modules/tournaments/tournaments.module";
import { TreasuryModule } from "@/modules/treasury/treasury.module";
import { WalletModule } from "@/modules/wallet/wallet.module";
import { WebhooksModule } from "@/modules/webhooks/webhooks.module";
import {
  CommissionProcessor, TreasuryProcessor, WithdrawalProcessor,
} from "./economy.processor";
import {
  ChainIndexProcessor, ChainTxProcessor, FraudProcessor, GameValidationProcessor,
  LeaderboardProcessor, NotificationProcessor, OutboundWebhookProcessor, ReportProcessor,
  WebhookProcessor,
} from "./platform.processor";

/* ============================================================================
 * Queue workers.
 *
 * This module is registered only when QUEUE_WORKERS_ENABLED is true, which is
 * what makes the "monolith that scales" claim real rather than aspirational:
 *
 *   API instances     QUEUE_WORKERS_ENABLED=false  → serve HTTP, enqueue work
 *   Worker instances  QUEUE_WORKERS_ENABLED=true   → drain queues, serve nothing
 *
 * Producers are registered separately and always on (see queues.module.ts), so a
 * feature module can enqueue without knowing whether this instance runs workers.
 * A slow commission batch therefore cannot starve HTTP request handling, and the
 * worker fleet scales on its own.
 *
 * Nothing in a feature module imports a processor — the dependency runs one way,
 * which is what lets any of these queues be lifted into a separate service later
 * without touching feature code.
 *
 * The gate is in app.module: this module is imported or not, rather than
 * registered-but-disabled. A registered BullMQ worker opens Redis connections and
 * starts polling immediately, so "registered but idle" does not exist.
 * ========================================================================== */

const PROCESSORS = [
  /* money */
  WithdrawalProcessor,
  CommissionProcessor,
  TreasuryProcessor,
  /* platform */
  GameValidationProcessor,
  LeaderboardProcessor,
  NotificationProcessor,
  FraudProcessor,
  ReportProcessor,
  /* integration */
  WebhookProcessor,
  OutboundWebhookProcessor,
  ChainIndexProcessor,
  ChainTxProcessor,
];

@Module({
  imports: [
    ConversionModule,
    WalletModule,
    ReferralModule,
    TreasuryModule,
    GamesModule,
    QuestsModule,
    LeaderboardModule,
    TournamentsModule,
    NotificationsModule,
    FraudModule,
    ReportsModule,
    WebhooksModule,
    StakingModule,
    ChainModule,
  ],
  providers: PROCESSORS,
})
export class ProcessorsModule {}
