import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Commission, Conversion, KycSubmission, PointsLedgerEntry, RevenueEvent, TreasuryOutflow,
  User, Withdrawal,
} from "@/database/entities";
import { AuditModule } from "@/modules/audit/audit.module";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

/**
 * Regulatory and operational reporting.
 *
 * Read-only across the domain tables: a report must never be able to change what
 * it is reporting on. Exported for the Report queue processor, which renders the
 * same payload to CSV or PDF rather than recomputing totals a second way.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      RevenueEvent, Commission, Withdrawal, Conversion, TreasuryOutflow, KycSubmission,
      PointsLedgerEntry, User,
    ]),
    AuditModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
