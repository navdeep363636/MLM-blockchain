import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Game, PointsLedgerEntry } from "@/database/entities";
import { EconomyConfigModule } from "@/modules/economy-config/economy-config.module";
import { PointsController } from "./points.controller";
import { PointsService } from "./points.service";

/**
 * Points issuance and history.
 *
 * Exports PointsService because it is the *only* sanctioned way to create
 * Points: gameplay validation, quests, ads and tournaments all call credit()
 * so the three anti-farming caps are enforced in one place rather than four.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PointsLedgerEntry, Game]), EconomyConfigModule],
  controllers: [PointsController],
  providers: [PointsService],
  exports: [PointsService],
})
export class PointsModule {}
