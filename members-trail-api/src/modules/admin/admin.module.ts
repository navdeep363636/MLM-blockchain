import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  ApprovalRequest, AuditLog, Commission, FraudAlert, KycSubmission, PointsLedgerEntry,
  RolePermission, Ticket, User, Withdrawal,
} from "@/database/entities";
import { AuditModule } from "@/modules/audit/audit.module";
import { NotificationsModule } from "@/modules/notifications/notifications.module";
import { ReferralModule } from "@/modules/referral/referral.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

/**
 * Governance: dual control, RBAC, the audit trail and the operations dashboard.
 *
 * Imports ReferralModule so the dashboard reads the commission solvency
 * invariant from the service that owns it, rather than recomputing it here and
 * risking two answers to the same question.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApprovalRequest, RolePermission, AuditLog, User, Withdrawal, FraudAlert, Ticket, Commission,
      KycSubmission, PointsLedgerEntry,
    ]),
    AuditModule,
    NotificationsModule,
    ReferralModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
