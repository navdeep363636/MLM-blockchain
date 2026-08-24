import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Ticket, TicketMessage, User } from "@/database/entities";
import { AuditModule } from "@/modules/audit/audit.module";
import { NotificationsModule } from "@/modules/notifications/notifications.module";
import { SupportController, SupportAdminController } from "./support.controller";
import { SupportService } from "./support.service";

/**
 * Support ticketing with SLA tracking and financial-dispute routing.
 *
 * Exported for the SLA-breach cron, which auto-escalates unanswered tickets —
 * silence on a financial dispute has a regulatory cost, not just an unhappy
 * member.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, TicketMessage, User]),
    AuditModule,
    NotificationsModule,
  ],
  controllers: [SupportController, SupportAdminController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
