import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bullmq";
import {
  Notification, NotificationDelivery, NotificationPreference, User,
} from "@/database/entities";
import { Queues } from "@/queues/queue.constants";
import { AuditModule } from "@/modules/audit/audit.module";
import { NotificationsController, NotificationsAdminController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

/**
 * Notifications and delivery tracking.
 *
 * Exported because almost every module needs to tell a member something, and the
 * Notification queue processor records the outcome of each attempt. Keeping the
 * "security cannot be muted" rule in one service is the reason this is not just
 * an event listener per module.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, NotificationDelivery, NotificationPreference, User]),
    BullModule.registerQueue({ name: Queues.Notification }),
    AuditModule,
  ],
  controllers: [NotificationsController, NotificationsAdminController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
