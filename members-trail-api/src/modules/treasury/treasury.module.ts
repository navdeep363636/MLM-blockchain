import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  RevenueEvent, TreasuryInflow, TreasuryOutflow, TreasuryPeriod, User,
} from "@/database/entities";
import { AuditModule } from "@/modules/audit/audit.module";
import { EconomyConfigModule } from "@/modules/economy-config/economy-config.module";
import { TreasuryService } from "./treasury.service";
import { TreasuryAdminController } from "./treasury.admin.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([RevenueEvent, TreasuryInflow, TreasuryOutflow, TreasuryPeriod, User]),
    AuditModule,
    EconomyConfigModule,
  ],
  controllers: [TreasuryAdminController],
  providers: [TreasuryService],
  /* Exported because the commission engine calls assertHeadroom() and
   * recognise() — one definition of the ceiling, not two. */
  exports: [TreasuryService],
})
export class TreasuryModule {}
