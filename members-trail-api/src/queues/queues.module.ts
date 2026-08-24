import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigType } from "@nestjs/config";
import { redisConfig } from "@/config/configuration";
import { ALL_QUEUES, QueueDefaults } from "./queue.constants";

/**
 * Registers every queue for producers, and the processors only when
 * QUEUE_WORKERS_ENABLED is true.
 *
 * That split is what makes the monolith scalable without being split up: run N
 * API instances with workers off and M worker instances with them on, and a
 * slow commission batch can never starve HTTP request handling.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [redisConfig.KEY],
      useFactory: (redis: ConfigType<typeof redisConfig>) => ({
        connection: {
          host: redis.host,
          port: redis.port,
          password: redis.password,
          db: redis.db,
          maxRetriesPerRequest: null,
        },
        prefix: `${redis.keyPrefix}bull`,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: 1_000,
          removeOnFail: 5_000,
        },
      }),
    }),

    /* Producer registration for every queue — always on, so any module can
     * enqueue regardless of whether this instance runs workers. */
    ...ALL_QUEUES.map((name) =>
      BullModule.registerQueue({
        name,
        defaultJobOptions: {
          attempts: QueueDefaults[name].attempts,
          backoff: { type: "exponential", delay: QueueDefaults[name].backoffMs },
          removeOnComplete: QueueDefaults[name].removeOnComplete,
          removeOnFail: QueueDefaults[name].removeOnFail,
        },
      }),
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
