import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bullmq";
import { OutboundWebhook, WebhookEvent } from "@/database/entities";
import { Queues } from "@/queues/queue.constants";
import { WebhooksController, WebhooksAdminController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";

/**
 * Inbound provider callbacks and outbound partner deliveries.
 *
 * Exported for the Webhook and OutboundWebhook queue processors, which do the
 * actual work — the HTTP handler only verifies, stores and enqueues, because a
 * provider that times out retries.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookEvent, OutboundWebhook]),
    BullModule.registerQueue({ name: Queues.Webhook }, { name: Queues.OutboundWebhook }),
  ],
  controllers: [WebhooksController, WebhooksAdminController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
