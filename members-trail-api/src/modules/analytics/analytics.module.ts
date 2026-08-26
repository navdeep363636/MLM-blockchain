import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  KycSubmission, RevenueEvent, StakingAprHistory, StakingPosition, Transaction, User,
} from "@/database/entities";
import { RoutinesModule } from "@/database/routines/routines.module";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RevenueEvent, Transaction, StakingAprHistory, StakingPosition, KycSubmission, User,
    ]),
    RoutinesModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
