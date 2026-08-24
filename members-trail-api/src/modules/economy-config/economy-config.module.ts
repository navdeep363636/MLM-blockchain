import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PlatformConfig } from "@/database/entities";
import { EconomyConfigService } from "./economy-config.service";

/**
 * Shared reader for the economy's runtime policy (caps, thresholds, Treasury
 * allocation bps).
 *
 * Lives in its own tiny module because Points, Conversion, Wallet, Staking and
 * Treasury all need the same numbers, and duplicating the fallback logic per
 * module is how two modules end up disagreeing about a cap.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PlatformConfig])],
  providers: [EconomyConfigService],
  exports: [EconomyConfigService],
})
export class EconomyConfigModule {}
