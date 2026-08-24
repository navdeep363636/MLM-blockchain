import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bullmq";
import {
  StakingAprHistory, StakingPool, StakingPosition, StakingReward,
} from "@/database/entities";
import { Queues } from "@/queues/queue.constants";
import { AuditModule } from "@/modules/audit/audit.module";
import { StakingController } from "./staking.controller";
import { StakingAdminController } from "./staking.admin.controller";
import { StakingService } from "./staking.service";

/**
 * Staking — an indexed mirror of on-chain state.
 *
 * Exported because the chain indexer and the transaction watcher in src/queues
 * drive every state change through `mirror*` / `syncPendingRewards` /
 * `revertStakeIntent`. Those are deliberately not HTTP routes: no client may
 * assert that a stake happened.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([StakingPool, StakingPosition, StakingReward, StakingAprHistory]),
    BullModule.registerQueue({ name: Queues.ChainTx }),
    AuditModule,
  ],
  controllers: [StakingController, StakingAdminController],
  providers: [StakingService],
  exports: [StakingService],
})
export class StakingModule {}
