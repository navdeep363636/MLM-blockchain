import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  ChainEvent, IndexerCursor, OutboundTransaction, User, WalletAddress,
} from "@/database/entities";
import { ReferralModule } from "@/modules/referral/referral.module";
import { StakingModule } from "@/modules/staking/staking.module";
import { ChainAdminController } from "./chain.admin.controller";
import { ChainReadService } from "./chain-read.service";
import { ChainWriteService } from "./chain-write.service";
import { DeploymentVerifierService } from "./deployment-verifier.service";
import { EventDispatcherService } from "./event-dispatcher.service";
import { IndexerService } from "./indexer.service";
import { RpcService } from "./rpc.service";
import { TxSubmitterService } from "./tx-submitter.service";

/**
 * The chain layer: RPC boundary, event indexer, event dispatcher and relayer.
 *
 * Depends on the domain modules rather than the other way round. That direction
 * matters: staking and commission know nothing about RPC, block numbers or
 * nonces, so they stay testable without a chain, and the chain layer stays the
 * only place that knows a chain exists.
 *
 * Everything is exported for the ChainIndex and ChainTx queue processors, which
 * own the actual scheduling.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ChainEvent, IndexerCursor, OutboundTransaction, WalletAddress, User]),
    StakingModule,
    ReferralModule,
  ],
  controllers: [ChainAdminController],
  providers: [
    RpcService, ChainReadService, ChainWriteService,
    IndexerService, EventDispatcherService, TxSubmitterService,
    DeploymentVerifierService,
  ],
  exports: [
    RpcService, ChainReadService, ChainWriteService,
    IndexerService, EventDispatcherService, TxSubmitterService,
    DeploymentVerifierService,
  ],
})
export class ChainModule {}
