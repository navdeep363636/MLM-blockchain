import { Module, type DynamicModule } from "@nestjs/common";
import { ConfigModule, ConfigType } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";

import { allConfig, appConfig, authConfig, queueConfig, redisConfig } from "./config/configuration";
import { validateEnv } from "./config/env.schema";
import { DatabaseModule } from "./database/database.module";
import { RoutinesModule } from "./database/routines/routines.module";
import { RedisModule } from "./common/redis/redis.module";
import { CryptoModule } from "./common/crypto/crypto.module";
import { EventsModule } from "./events/events.module";
import { HealthModule } from "./health/health.module";
import { JwtAuthGuard, UserThrottlerGuard } from "./common/guards";
import { IdempotencyInterceptor } from "./common/interceptors";
import { QueuesModule } from "./queues/queues.module";
import { ProcessorsModule } from "./queues/processors/processors.module";
import { SchedulerModule } from "./scheduler/scheduler.module";
import { RealtimeModule } from "./realtime/realtime.module";

/* --------------------------- feature modules ------------------------------ */

import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { KycModule } from "./modules/kyc/kyc.module";
import { EconomyConfigModule } from "./modules/economy-config/economy-config.module";
import { PointsModule } from "./modules/points/points.module";
import { TreasuryModule } from "./modules/treasury/treasury.module";
import { ConversionModule } from "./modules/conversion/conversion.module";
import { WalletModule } from "./modules/wallet/wallet.module";
import { StakingModule } from "./modules/staking/staking.module";
import { ReferralModule } from "./modules/referral/referral.module";
import { GamesModule } from "./modules/games/games.module";
import { TournamentsModule } from "./modules/tournaments/tournaments.module";
import { QuestsModule } from "./modules/quests/quests.module";
import { LeaderboardModule } from "./modules/leaderboard/leaderboard.module";
import { StoreModule } from "./modules/store/store.module";
import { ChainModule } from "./modules/chain/chain.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { SupportModule } from "./modules/support/support.module";
import { FraudModule } from "./modules/fraud/fraud.module";
import { CmsModule } from "./modules/cms/cms.module";
import { AdminModule } from "./modules/admin/admin.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { WebhooksModule } from "./modules/webhooks/webhooks.module";

/* ============================================================================
 * The application.
 *
 * A monolith, deliberately — one deployable, one transaction boundary, no
 * network hop between a commission calculation and the ledger it writes to. What
 * makes it scalable rather than merely simple is that the three workloads are
 * separable by configuration, not by rewrite:
 *
 *   API instances     QUEUE_WORKERS_ENABLED=false  SCHEDULER_ENABLED=false
 *   Worker instances  QUEUE_WORKERS_ENABLED=true   SCHEDULER_ENABLED=false
 *   Scheduler         QUEUE_WORKERS_ENABLED=false  SCHEDULER_ENABLED=true   (exactly one)
 *
 * Queue producers are always registered, so any module can enqueue regardless of
 * what this instance runs. Processors and crons are IMPORTED OR NOT — never
 * "registered but disabled" — because a BullMQ worker opens connections and
 * starts polling the moment it exists, and an @Cron fires whether or not anyone
 * wants it to.
 *
 * The module graph runs one way: feature modules know nothing about queues,
 * crons or sockets. That is what lets any of those be lifted out later without
 * touching a single feature file.
 * ========================================================================== */

/** Read once here so the boot-time gates use the same validated values as the
 *  config namespaces, without reaching into process.env at each decision. */
const env = validateEnv(process.env);

/** Workers and crons are opt-in per instance. See the comment above. */
function workloadModules(): NonNullable<DynamicModule["imports"]> {
  const modules: NonNullable<DynamicModule["imports"]> = [];
  if (env.QUEUE_WORKERS_ENABLED) modules.push(ProcessorsModule);
  if (env.SCHEDULER_ENABLED) modules.push(SchedulerModule);
  return modules;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, load: allConfig, envFilePath: [".env.local", ".env"] }),

    /* Global infrastructure. Each is @Global so feature modules don't re-import. */
    CryptoModule,
    RedisModule,
    DatabaseModule,
    /* Views and stored procedures. After DatabaseModule, because it wraps the
     * DataSource that module provides. */
    RoutinesModule,
    EventsModule,

    /* JWT is registered globally because the guard is global. */
    JwtModule.registerAsync({
      global: true,
      inject: [authConfig.KEY],
      useFactory: (cfg: ConfigType<typeof authConfig>) => ({
        secret: cfg.accessSecret,
        signOptions: {
          /* jsonwebtoken types this as a template-literal union; the value is
           * validated as a duration string by the env schema. */
          expiresIn: cfg.accessTtl as `${number}${"s" | "m" | "h" | "d"}`,
          issuer: "members-trail",
          audience: "members-trail-api",
        },
      }),
    }),

    /**
     * Rate limiting backed by Redis, not memory. In-memory throttling is per
     * instance, so with three pods an attacker gets three times the allowance —
     * and the counter resets on every deploy.
     */
    ThrottlerModule.forRootAsync({
      inject: [authConfig.KEY, redisConfig.KEY],
      useFactory: (auth: ConfigType<typeof authConfig>, redis: ConfigType<typeof redisConfig>) => ({
        throttlers: [{ name: "default", ttl: auth.throttleTtl * 1000, limit: auth.throttleLimit }],
        storage: new ThrottlerStorageRedisService({
          host: redis.host,
          port: redis.port,
          password: redis.password,
          db: redis.db,
          keyPrefix: `${redis.keyPrefix}throttle:`,
          maxRetriesPerRequest: null,
        }),
        errorMessage: "Too many requests. Please slow down and try again shortly.",
      }),
    }),

    ScheduleModule.forRoot(),

    /* Queue PRODUCERS: always on, so any module can enqueue. */
    QueuesModule,

    /* Realtime is safe everywhere: the gateway only listens to domain events. */
    RealtimeModule,

    /* ---------------------------- identity ------------------------------- */
    AuditModule,
    AuthModule,
    UsersModule,
    KycModule,

    /* ----------------------------- economy ------------------------------- */
    EconomyConfigModule,
    PointsModule,
    TreasuryModule,
    ConversionModule,
    WalletModule,
    StakingModule,
    ReferralModule,

    /* ---------------------------- gameplay ------------------------------- */
    GamesModule,
    TournamentsModule,
    QuestsModule,
    LeaderboardModule,
    StoreModule,

    /* ------------------------------ chain -------------------------------- */
    ChainModule,

    /* --------------------------- ops & comms ----------------------------- */
    NotificationsModule,
    SupportModule,
    FraudModule,
    CmsModule,
    AdminModule,
    ReportsModule,
    WebhooksModule,

    /* Workers and crons, per this instance's role. */
    ...workloadModules(),

    HealthModule,
  ],
  providers: [
    /* Deny by default: every route requires auth unless it carries @Public(). */
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}

/** Re-exported so the health module can report what this instance is running. */
export const instanceRole = {
  queueWorkers: env.QUEUE_WORKERS_ENABLED,
  scheduler: env.SCHEDULER_ENABLED,
  indexer: env.INDEXER_ENABLED,
} as const;

/** Kept so a reader of app.module can see the queue config is still consumed. */
export type QueueConfig = ConfigType<typeof queueConfig>;
export type AppConfig = ConfigType<typeof appConfig>;
