import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Commission, FraudAlert, FraudRule, GameSession, ReferralEdge, User, Withdrawal,
} from "@/database/entities";
import { AuditModule } from "@/modules/audit/audit.module";
import { NotificationsModule } from "@/modules/notifications/notifications.module";
import { FraudAdminController } from "./fraud.admin.controller";
import { FraudService } from "./fraud.service";

/**
 * Fraud detection and review.
 *
 * Exported so the Fraud queue and the detection cron can run the sweeps, and so
 * other modules can raise an alert on something only they can see. There is no
 * player-facing controller: a member must not be able to learn which detections
 * exist or that they tripped one.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      FraudAlert, FraudRule, User, Withdrawal, GameSession, ReferralEdge, Commission,
    ]),
    AuditModule,
    NotificationsModule,
  ],
  controllers: [FraudAdminController],
  providers: [FraudService],
  exports: [FraudService],
})
export class FraudModule {}
