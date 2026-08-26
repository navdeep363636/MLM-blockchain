import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CommissionPlan, ConversionRate, Game, Tournament } from "@/database/entities";
import { RoutinesModule } from "@/database/routines/routines.module";
import { EconomyConfigModule } from "@/modules/economy-config/economy-config.module";
import { PublicController } from "./public.controller";
import { PublicService } from "./public.service";

@Module({
  imports: [TypeOrmModule.forFeature([Game, Tournament, ConversionRate, CommissionPlan]),
    RoutinesModule,
    EconomyConfigModule,],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
