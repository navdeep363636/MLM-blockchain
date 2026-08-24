import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Commission, CommissionCapUsage, CommissionPlan, GameSession, ReferralEdge, RevenueEvent,
  TreasuryOutflow, User,
} from "@/database/entities";
import { AuditModule } from "@/modules/audit/audit.module";
import { EconomyConfigModule } from "@/modules/economy-config/economy-config.module";
import { ReferralController } from "./referral.controller";
import { ReferralAdminController } from "./referral.admin.controller";
import { ReferralService } from "./referral.service";
import { CommissionService } from "./commission.service";
import { CommissionPlanService } from "./commission-plan.service";

/**
 * The referral programme: network reads, the commission engine and the plan.
 *
 * Exported because the Commission queue processor drives the engine
 * (`processRevenueEvent`, `releaseQueued`, `releaseForKyc`) and the treasury
 * reversal path drives clawback. None of those are HTTP-first operations.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Commission, CommissionCapUsage, CommissionPlan, ReferralEdge, RevenueEvent,
      TreasuryOutflow, User, GameSession,
    ]),
    AuditModule,
    EconomyConfigModule,
  ],
  controllers: [ReferralController, ReferralAdminController],
  providers: [ReferralService, CommissionService, CommissionPlanService],
  exports: [ReferralService, CommissionService, CommissionPlanService],
})
export class ReferralModule {}
