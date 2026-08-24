import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  KycAccessLog, KycDocument, KycSubmission, User, WebhookEvent,
} from "@/database/entities";
import { AuditModule } from "@/modules/audit/audit.module";
import { KycController } from "./kyc.controller";
import { KycAdminController } from "./kyc.admin.controller";
import { KycService } from "./kyc.service";

/**
 * Identity verification.
 *
 * Deliberately does NOT import the referral module: commissions held
 * `pending_kyc` are released by publishing an event, so the two modules share a
 * contract rather than a call graph.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([KycSubmission, KycDocument, KycAccessLog, User, WebhookEvent]),
    AuditModule,
  ],
  controllers: [KycController, KycAdminController],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
