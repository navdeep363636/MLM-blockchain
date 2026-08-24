import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { Queues } from "@/queues/queue.constants";
import { AdminModule } from "@/modules/admin/admin.module";
import { ChainModule } from "@/modules/chain/chain.module";
import { FraudModule } from "@/modules/fraud/fraud.module";
import { LeaderboardModule } from "@/modules/leaderboard/leaderboard.module";
import { NotificationsModule } from "@/modules/notifications/notifications.module";
import { QuestsModule } from "@/modules/quests/quests.module";
import { ReferralModule } from "@/modules/referral/referral.module";
import { StakingModule } from "@/modules/staking/staking.module";
import { StoreModule } from "@/modules/store/store.module";
import { SupportModule } from "@/modules/support/support.module";
import { TournamentsModule } from "@/modules/tournaments/tournaments.module";
import { TreasuryModule } from "@/modules/treasury/treasury.module";
import { WalletModule } from "@/modules/wallet/wallet.module";
import { WebhooksModule } from "@/modules/webhooks/webhooks.module";
import { EconomyJobs } from "./jobs/economy.job";
import { PlatformJobs } from "./jobs/platform.job";

/**
 * Cron jobs live here, not inside feature modules.
 *
 * Two reasons: a cron is an operational concern with its own failure mode and
 * on-call story, and keeping them in one folder means the whole schedule is
 * reviewable in one place instead of hidden across twenty services. Every job
 * takes a Redis lock before doing work, so running several instances does not
 * run the job several times — and, just as importantly, a slow run cannot
 * overlap itself.
 *
 * Set SCHEDULER_ENABLED=false on API instances and true on exactly one worker
 * deployment. The gate is in app.module: this module is imported or not, because
 * a registered @Cron fires whether or not anything wants it to.
 */
@Module({
  imports: [
    /* The scheduler enqueues rather than doing heavy work inline, so it needs
     * producer access to the queues it feeds. */
    BullModule.registerQueue(
      { name: Queues.ChainIndex },
      { name: Queues.ChainTx },
      { name: Queues.Fraud },
      { name: Queues.Leaderboard },
    ),
    ReferralModule,
    TreasuryModule,
    WalletModule,
    StakingModule,
    AdminModule,
    FraudModule,
    LeaderboardModule,
    NotificationsModule,
    QuestsModule,
    StoreModule,
    SupportModule,
    TournamentsModule,
    WebhooksModule,
    ChainModule,
  ],
  providers: [EconomyJobs, PlatformJobs],
})
export class SchedulerModule {}
