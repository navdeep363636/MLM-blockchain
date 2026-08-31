import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEthereumAddress, IsInt,
  IsNumberString, IsOptional, IsString, MaxLength, Min, MinLength,
} from "class-validator";
import { Type } from "class-transformer";
import { RequirePermissions, StaffOnly } from "@/common/decorators";
import type { OutboundTransaction } from "@/database/entities";
import { Ref } from "@/common/utils";
import { EventDispatcherService, type DispatchResult } from "./event-dispatcher.service";
import { IndexerService, type IndexRunResult, type IndexerStatus } from "./indexer.service";
import { TxSubmitterService, type SubmitOutcome } from "./tx-submitter.service";
import { ChainReadService } from "./chain-read.service";
import { ChainWriteService } from "./chain-write.service";
import { DeploymentVerifierService } from "./deployment-verifier.service";
import { CONTRACT_SPECS, validateSpecs } from "./chain.constants";

/* ============================================================================
 * Chain operations (FRD AD-12).
 *
 * These routes exist because the chain layer's failure modes are operational, not
 * exceptional: a provider stalls, a handler has a bug, a transaction sticks in the
 * mempool. Each has a deliberate, audited recovery here — rewind the cursor,
 * replay a range, requeue a transaction — rather than a database edit.
 * ========================================================================== */

class RewindRequest {
  @IsInt() @Min(0) @Type(() => Number)
  blockNumber!: number;

  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}

class ReplayRequest {
  @IsInt() @Min(0) @Type(() => Number)
  fromBlock!: number;

  @IsInt() @Min(0) @Type(() => Number)
  toBlock!: number;

  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}

class RequeueRequest {
  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}

class AmountRequest {
  /** Decimal MTT, as the ledger holds it. Never a float. */
  @IsNumberString()
  amountMtt!: string;

  @IsOptional() @IsString() @MinLength(10) @MaxLength(500)
  reason?: string;
}

class FundPoolRequest extends AmountRequest {
  @IsInt() @Min(0) @Type(() => Number)
  poolId!: number;
}

class CreatePoolRequest {
  @IsInt() @Min(0) @Type(() => Number)
  lockDurationSeconds!: number;

  @IsInt() @Min(1) @Type(() => Number)
  rewardsDurationSeconds!: number;

  @IsInt() @Min(0) @Type(() => Number)
  earlyPenaltyBps!: number;
}

class SetPoolActiveRequest {
  @IsBoolean()
  active!: boolean;
}

class KycFlagRequest {
  @IsEthereumAddress()
  address!: string;

  @IsBoolean()
  approved!: boolean;

  @IsString() @MinLength(1)
  userId!: string;
}

class KycBatchRequest {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsEthereumAddress({ each: true })
  addresses!: string[];

  @IsBoolean()
  approved!: boolean;
}

class ClawbackRequest {
  @IsEthereumAddress()
  recipient!: string;

  @IsNumberString()
  amountMtt!: string;

  @IsString() @MinLength(1) @MaxLength(120)
  sourceEventRef!: string;

  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}

class ReasonRequest {
  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}

@ApiTags("admin: chain")
@StaffOnly("super_admin")
@Controller("admin/chain")
export class ChainAdminController {
  constructor(
    private readonly indexer: IndexerService,
    private readonly dispatcher: EventDispatcherService,
    private readonly submitter: TxSubmitterService,
    private readonly reads: ChainReadService,
    private readonly writes: ChainWriteService,
    private readonly deployment: DeploymentVerifierService,
  ) {}

  /* --------------------------------- state -------------------------------- */

  @Get("overview")
  @ApiOperation({
    summary: "Live chain state: token, staking solvency, commission pool, payout float, vesting",
    description:
      "Each section is independently fault-tolerant — one unreachable contract returns null for " +
      "its own section rather than failing the response, because an operator reading this during " +
      "an incident needs the parts that still answer.",
  })
  overview() {
    return this.reads.overview();
  }

  @Get("contracts")
  @ApiOperation({
    summary: "Configured addresses, watched events and the callable allowlist per contract",
    description:
      "`specProblems` is empty when every watched event name exists in the generated ABI. A " +
      "non-empty list is the failure that used to be invisible: a wrong event name means getLogs " +
      "matches nothing and the indexer reports healthy while indexing zero events.",
  })
  contracts() {
    return {
      specProblems: validateSpecs(),
      contracts: CONTRACT_SPECS.map((spec) => ({
        name: spec.name,
        address: this.writes.addressOf(spec.name),
        configured: this.writes.addressOf(spec.name) !== null,
        watchedEvents: spec.watch,
        callableFunctions: spec.callable,
      })),
    };
  }

  @Get("deployment")
  @ApiOperation({
    summary: "Whether the configured addresses are the contracts this build expects",
    description:
      "`verified` is true only when the check ran against a reachable RPC and found no errors. " +
      "It compares every configured address against the recorded deployment, confirms each has " +
      "bytecode, confirms every peripheral contract settles in the configured MTTToken, checks " +
      "the staking pool count, and checks the relayer signer holds the address the deployment " +
      "granted ORACLE_ROLE to. Each of those failures is otherwise silent: a wrong address " +
      "means getLogs matches nothing while the indexer reports healthy. " +
      "`reachable: false` means the RPC failed, so a clean result proves nothing.",
  })
  deploymentReport() {
    return this.deployment.latest() ?? { pending: true };
  }

  @Post("deployment/verify")
  @ApiOperation({
    summary: "Re-run the deployment verification now",
    description: "Use after changing addresses or rotating the relayer key, instead of restarting.",
  })
  reverifyDeployment() {
    return this.deployment.verify();
  }

  @Get("solvency")
  @ApiOperation({
    summary: "On-chain solvency of the staking, commission and payout contracts",
    description:
      "Answers, from chain data rather than from this platform's own tables, whether every " +
      "staker's principal and every recorded commission is actually held.",
  })
  async solvency() {
    const [staking, distributor, payout] = await Promise.all([
      this.reads.stakingSolvency().catch(() => null),
      this.reads.distributorState().catch(() => null),
      this.reads.payoutState().catch(() => null),
    ]);
    return {
      staking,
      distributor,
      payout,
      healthy:
        (staking?.solvent ?? true) &&
        (distributor?.solvent ?? true) &&
        !(payout?.paused ?? false),
    };
  }

  @Get("roles/:contract/:roleName/:account")
  @ApiOperation({
    summary: "Whether an address holds a role on a contract",
    description:
      "The post-deployment question that matters most — does any EOA still hold admin rights " +
      "over the treasury. Use roleName=DEFAULT_ADMIN_ROLE for the admin role itself.",
  })
  hasRole(
    @Param("contract") contract: string,
    @Param("roleName") roleName: string,
    @Param("account") account: string,
  ) {
    return this.reads.hasRole(contract as never, roleName, account);
  }

  @Get("staking/positions/:address")
  @ApiOperation({ summary: "One address's staking positions across every pool, read live" })
  positions(@Param("address") address: string) {
    return this.reads.positions(address);
  }

  @Get("commission/account/:address")
  @ApiOperation({ summary: "An address's claimable commission and on-chain KYC flag" })
  commissionAccount(@Param("address") address: string) {
    return this.reads.distributorAccount(address);
  }

  @Get("payout/settlement/:withdrawalRef")
  @ApiOperation({
    summary: "Whether a withdrawal has settled on chain, and for how much",
    description:
      "The amount matters as much as the flag: it proves the settlement matches the ledger, " +
      "not merely that something was sent.",
  })
  settlement(@Param("withdrawalRef") withdrawalRef: string) {
    return this.reads.settlement(withdrawalRef);
  }

  /* --------------------------------- writes ------------------------------- */

  @Post("staking/fund")
  @RequirePermissions("treasury:approve")
  @ApiOperation({
    summary: "Stream reconciled revenue into a pool's reward balance",
    description:
      "The only way rewards enter the staking contract, and the reason the APR claim is " +
      "defensible: the rate is a consequence of this call, not a promise made before it.",
  })
  fundPool(@Body() dto: FundPoolRequest): Promise<OutboundTransaction> {
    return this.writes.fundRewardPool(dto.poolId, dto.amountMtt, Ref.transaction());
  }

  @Post("staking/pools")
  @RequirePermissions("staking:write")
  @ApiOperation({
    summary: "Create a staking pool on chain",
    description:
      "Durations are SECONDS, which is what the contract takes. The previous relayer ABI " +
      "declared them as days, so a 30-day pool would have been created with a 30-second lock.",
  })
  createPool(@Body() dto: CreatePoolRequest): Promise<OutboundTransaction> {
    return this.writes.createPool(
      dto.lockDurationSeconds, dto.rewardsDurationSeconds, dto.earlyPenaltyBps, Ref.transaction(),
    );
  }

  @Post("staking/pools/:poolId/active")
  @RequirePermissions("staking:write")
  @ApiOperation({ summary: "Activate or deactivate a pool on chain" })
  setPoolActive(
    @Param("poolId") poolId: string,
    @Body() dto: SetPoolActiveRequest,
  ): Promise<OutboundTransaction> {
    return this.writes.setPoolActive(Number(poolId), dto.active, Ref.transaction());
  }

  @Post("commission/deposit")
  @RequirePermissions("treasury:approve")
  @ApiOperation({
    summary: "Fund the commission pool from reconciled revenue",
    description:
      "The exclusive funding mechanism for referral commission. The contract refuses to record " +
      "more commission than has been deposited here, which is the anti-pyramid safeguard.",
  })
  depositCommissionPool(@Body() dto: AmountRequest): Promise<OutboundTransaction> {
    return this.writes.depositCommissionPool(dto.amountMtt, Ref.transaction());
  }

  @Post("commission/clawback")
  @RequirePermissions("commission:approve")
  @ApiOperation({
    summary: "Reverse a recorded, unclaimed commission",
    description: "The reason is required and is emitted on chain in the event.",
  })
  clawback(@Body() dto: ClawbackRequest): Promise<OutboundTransaction> {
    return this.writes.clawbackCommission(
      dto.recipient, dto.amountMtt, dto.sourceEventRef, dto.reason,
    );
  }

  @Post("kyc/flag")
  @RequirePermissions("kyc:approve")
  @ApiOperation({
    summary: "Mirror one KYC decision onto the commission distributor",
    description:
      "The backend remains the authority on tier; this flag only gates whether the address may " +
      "claim commission on chain.",
  })
  setKycFlag(@Body() dto: KycFlagRequest): Promise<OutboundTransaction> {
    return this.writes.setKycApproved(dto.address, dto.approved, dto.userId);
  }

  @Post("kyc/flag/batch")
  @RequirePermissions("kyc:approve")
  @ApiOperation({
    summary: "Mirror a batch of KYC decisions",
    description:
      "Reviewers clear a queue, so decisions arrive in groups. One transaction per approval " +
      "means forty base fees and forty confirmations to track, any of which can quietly fail.",
  })
  setKycFlagBatch(@Body() dto: KycBatchRequest): Promise<OutboundTransaction> {
    return this.writes.setKycApprovedBatch(dto.addresses, dto.approved, Ref.transaction());
  }

  @Post("payout/fund")
  @RequirePermissions("treasury:approve")
  @ApiOperation({
    summary: "Move treasury MTT into the withdrawal payout float",
    description:
      "The float is what the relayer key can spend. Keeping it small is the point — the rewards " +
      "pool stays in multisig custody and the hot key only ever sees a working balance.",
  })
  fundPayoutFloat(@Body() dto: AmountRequest): Promise<OutboundTransaction> {
    return this.writes.fundPayoutFloat(dto.amountMtt, Ref.transaction());
  }

  @Post("payout/sweep")
  @RequirePermissions("treasury:approve")
  @ApiOperation({
    summary: "Return payout float to the treasury",
    description: "The destination is the calling treasury address on chain — it cannot be aimed elsewhere.",
  })
  sweepPayoutFloat(@Body() dto: AmountRequest): Promise<OutboundTransaction> {
    return this.writes.sweepPayoutFloat(
      dto.amountMtt, dto.reason ?? "operator sweep via admin API", Ref.transaction(),
    );
  }

  @Post("payout/pause")
  @RequirePermissions("chain:write")
  @ApiOperation({
    summary: "Halt withdrawal settlement",
    description:
      "Stops payouts without touching custody of the float — funding and sweeping keep working, " +
      "which is what an incident response actually needs.",
  })
  pausePayouts(@Body() dto: ReasonRequest): Promise<OutboundTransaction> {
    return this.writes.pausePayouts(`${Ref.transaction()}:${dto.reason.slice(0, 40)}`);
  }

  @Post("payout/unpause")
  @RequirePermissions("chain:write")
  @ApiOperation({ summary: "Resume withdrawal settlement" })
  unpausePayouts(@Body() dto: ReasonRequest): Promise<OutboundTransaction> {
    return this.writes.unpausePayouts(`${Ref.transaction()}:${dto.reason.slice(0, 40)}`);
  }

  @Post("payout/daily-limit")
  @RequirePermissions("chain:write")
  @ApiOperation({
    summary: "Adjust the payout rail's daily ceiling",
    description:
      "Does not reset the current window's spend — raising the limit to release a blocked payout " +
      "and raising it to clear an exhausted allowance after an incident are different acts.",
  })
  setPayoutDailyLimit(@Body() dto: AmountRequest): Promise<OutboundTransaction> {
    return this.writes.setPayoutDailyLimit(dto.amountMtt, Ref.transaction());
  }

  /* -------------------------------- indexer ------------------------------- */

  @Get("indexer/status")
  @ApiOperation({
    summary: "Indexer health: head, cursors, lag and reorg counts",
    description:
      "Cursor lag is the metric that matters — a stalled indexer looks exactly like a quiet " +
      "chain, and the difference is whether members' stakes are appearing.",
  })
  status(): Promise<IndexerStatus> {
    return this.indexer.status();
  }

  @Post("indexer/run")
  @RequirePermissions("chain:write")
  @ApiOperation({
    summary: "Run one indexing pass now",
    description: "Normally driven by the cron; exposed for a manual catch-up after an outage.",
  })
  run(): Promise<IndexRunResult[]> {
    return this.indexer.runAll();
  }

  @Post("indexer/:cursorKey/rewind")
  @RequirePermissions("chain:write")
  @ApiOperation({
    summary: "Rewind a cursor to re-index a range",
    description:
      "Safe by construction: UNIQUE(txHash, logIndex) means re-scanning is a no-op for events " +
      "already stored. This is the recovery a subscription-based indexer cannot offer.",
  })
  rewind(@Param("cursorKey") cursorKey: string, @Body() dto: RewindRequest) {
    return this.indexer.rewindTo(cursorKey, dto.blockNumber, dto.reason);
  }

  /* ------------------------------- dispatcher ------------------------------ */

  @Post("dispatch")
  @RequirePermissions("chain:write")
  @ApiOperation({ summary: "Apply stored-but-unprocessed chain events to domain state" })
  dispatch(): Promise<DispatchResult> {
    return this.dispatcher.dispatch();
  }

  @Post("dispatch/replay")
  @RequirePermissions("chain:write")
  @ApiOperation({
    summary: "Re-apply already-stored events for a block range",
    description:
      "Touches no RPC: the events are already in the database. This is how a fixed handler is " +
      "applied to history.",
  })
  replay(@Body() dto: ReplayRequest): Promise<number> {
    return this.dispatcher.replayRange(dto.fromBlock, dto.toBlock, dto.reason);
  }

  /* -------------------------------- relayer -------------------------------- */

  @Get("relayer/status")
  @ApiOperation({
    summary: "Relayer health: signer, queue depth, next nonce and gas price",
    description: "Any abandoned transaction makes the relayer unhealthy — it always needs a human.",
  })
  relayerStatus() {
    return this.submitter.status();
  }

  @Get("relayer/queue")
  @ApiOperation({ summary: "Queued outbound transactions" })
  queue(@Query("limit") limit?: string): Promise<OutboundTransaction[]> {
    return this.submitter.pending(limit ? Number(limit) : 50);
  }

  @Get("relayer/in-flight")
  @ApiOperation({ summary: "Submitted transactions still awaiting a receipt" })
  inFlight(): Promise<OutboundTransaction[]> {
    return this.submitter.inFlight();
  }

  @Post("relayer/:id/submit")
  @RequirePermissions("chain:write")
  @ApiOperation({
    summary: "Submit one queued transaction now",
    description: "Nonce assignment is serialised, so this is safe alongside the worker.",
  })
  submit(@Param("id", ParseUUIDPipe) id: string): Promise<SubmitOutcome> {
    return this.submitter.submit(id);
  }

  @Post("relayer/:id/watch")
  @RequirePermissions("chain:write")
  @ApiOperation({
    summary: "Check a submitted transaction for its receipt",
    description: "Reprices on the SAME nonce if it has been pending too long — never on a new one.",
  })
  watch(@Param("id", ParseUUIDPipe) id: string): Promise<SubmitOutcome> {
    return this.submitter.watch(id);
  }

  @Post("relayer/:id/requeue")
  @RequirePermissions("chain:write")
  @ApiOperation({
    summary: "Requeue an abandoned or failed transaction",
    description: "Clears the nonce: reusing one that may already be consumed on chain would just be rejected.",
  })
  requeue(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RequeueRequest,
  ): Promise<SubmitOutcome> {
    return this.submitter.requeue(id, dto.reason);
  }
}
