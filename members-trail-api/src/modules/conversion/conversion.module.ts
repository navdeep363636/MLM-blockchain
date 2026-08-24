import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Conversion, ConversionRate, PointsLedgerEntry, Transaction } from "@/database/entities";
import { AuditModule } from "@/modules/audit/audit.module";
import { EconomyConfigModule } from "@/modules/economy-config/economy-config.module";
import { ConversionController } from "./conversion.controller";
import { ConversionAdminController } from "./conversion.admin.controller";
import { ConversionService } from "./conversion.service";

/**
 * Points → MTT conversion.
 *
 * Exports ConversionService because the treasury reversal path needs reverse()
 * and operations needs attachTxHash(); nothing else may write a conversion row.
 *
 * No queue is registered here: a conversion is a custodial credit that commits
 * synchronously and has no on-chain counterpart. See the note in convert().
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Conversion, ConversionRate, PointsLedgerEntry, Transaction]),
    AuditModule,
    EconomyConfigModule,
  ],
  controllers: [ConversionController, ConversionAdminController],
  providers: [ConversionService],
  exports: [ConversionService],
})
export class ConversionModule {}
