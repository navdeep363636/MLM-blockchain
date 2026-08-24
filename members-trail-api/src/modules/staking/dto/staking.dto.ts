import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean, IsInt, IsNumberString, IsOptional, IsString, Max, MaxLength, Min, MinLength,
} from "class-validator";
import { DateRangeQuery } from "@/common/dto";

/* ============================================================================
 * Staking DTOs (FRD S-01 … S-04).
 *
 * APR is always presented as *derived and historical*, never as a promise. The
 * field names say so on purpose: a UI that renders `currentApr` as "you will
 * earn" is making a financial guarantee the platform has not made.
 * ========================================================================== */

export class StakingPoolResponse {
  @ApiProperty({ description: "On-chain pool id" }) poolId!: number;
  @ApiProperty() name!: string;
  @ApiProperty({ description: "Lock length in days. 0 means flexible." }) lockDays!: number;
  @ApiProperty() rewardsDurationDays!: number;
  @ApiProperty({
    description: "Penalty applied to UNCLAIMED REWARDS on an early exit, in basis points. Principal is never cut.",
  })
  earlyPenaltyBps!: number;
  @ApiProperty() active!: boolean;
  @ApiProperty({ description: "Total value locked in this pool" }) totalStaked!: string;
  @ApiProperty() totalRewardsFunded!: string;
  @ApiProperty() totalRewardsPaid!: string;
  @ApiProperty({
    description: "Trailing, derived APR — inflow ÷ TVL annualised. Historical observation, not a forecast.",
  })
  currentApr!: string;
  @ApiProperty({ description: "Funded minus paid: what is actually available to pay out" })
  rewardsRemaining!: string;
  @ApiPropertyOptional({ nullable: true, description: "Last block this mirror was refreshed from" })
  lastSyncedBlock!: number | null;
  @ApiProperty({ description: "True when the mirror is behind and figures may be stale" })
  stale!: boolean;
}

export class StakingPositionResponse {
  @ApiProperty() poolId!: number;
  @ApiProperty() poolName!: string;
  @ApiProperty({ description: "Staked principal, mirrored from chain" }) amount!: string;
  @ApiProperty() pendingRewards!: string;
  @ApiPropertyOptional({ nullable: true }) stakedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) lockEnd!: string | null;
  @ApiProperty({ description: "True while the lock has not expired" }) locked!: boolean;
  @ApiProperty({ description: "Seconds until the lock expires, 0 when unlocked" }) unlocksInSeconds!: number;
  @ApiPropertyOptional({ nullable: true }) lastSyncedBlock!: number | null;
}

export class UnstakePreviewResponse {
  @ApiProperty() poolId!: number;
  @ApiProperty({ description: "Principal returned in full — never reduced by the penalty" })
  principal!: string;
  @ApiProperty() pendingRewards!: string;
  @ApiProperty({ description: "True when the lock has not yet expired" }) early!: boolean;
  @ApiProperty() penaltyBps!: number;
  @ApiProperty({ description: "Penalty taken from pendingRewards only" }) penaltyMtt!: string;
  @ApiProperty({ description: "pendingRewards − penalty" }) rewardsPayable!: string;
  @ApiProperty({ description: "principal + rewardsPayable" }) totalReceived!: string;
  @ApiPropertyOptional({ nullable: true, description: "Wait until this instant to avoid the penalty" })
  penaltyFreeAt!: string | null;
}

export class StakeRequest {
  @ApiProperty({ description: "On-chain pool id to stake into" })
  @IsInt() @Min(0) @Max(1_000_000)
  poolId!: number;

  @ApiProperty({ description: "MTT amount as a decimal string" })
  @IsNumberString()
  amountMtt!: string;
}

export class UnstakeRequest {
  @ApiProperty()
  @IsInt() @Min(0) @Max(1_000_000)
  poolId!: number;

  @ApiProperty({
    description:
      "Set true to accept the early-exit penalty on unclaimed rewards. Required while the lock is active.",
  })
  @IsBoolean()
  acceptPenalty!: boolean;
}

export class ClaimRewardsRequest {
  @ApiProperty()
  @IsInt() @Min(0) @Max(1_000_000)
  poolId!: number;
}

export class StakingIntentResponse {
  @ApiProperty({ description: "\"stake\", \"unstake\" or \"claim\"" }) action!: string;
  @ApiProperty() poolId!: number;
  @ApiProperty() amountMtt!: string;
  @ApiProperty({
    description: "Queued: the chain is the source of truth, so the position updates when the tx confirms.",
  })
  status!: string;
  @ApiProperty({ description: "Reference for tracking this intent" }) ref!: string;
  @ApiPropertyOptional({ nullable: true, description: "Penalty accepted on unclaimed rewards, if any" })
  penaltyMtt!: string | null;
}

export class StakingRewardResponse {
  @ApiProperty() ref!: string;
  @ApiProperty() poolId!: number;
  @ApiProperty() accrued!: string;
  @ApiProperty() claimed!: boolean;
  @ApiProperty() periodKey!: string;
  @ApiPropertyOptional({ nullable: true }) txHash!: string | null;
  @ApiProperty() createdAt!: string;
}

export class RewardHistoryQuery extends DateRangeQuery {
  @ApiPropertyOptional({ description: "Filter to one pool" })
  @IsOptional() @IsInt() @Min(0)
  poolId?: number;
}

export class AprPointResponse {
  @ApiProperty() periodKey!: string;
  @ApiProperty() apr!: string;
  @ApiProperty({ description: "Rewards paid into the pool during the period" }) inflow!: string;
  @ApiProperty({ description: "Average value locked over the period" }) tvl!: string;
}

export class StakingSummaryResponse {
  @ApiProperty() totalStakedMtt!: string;
  @ApiProperty() totalPendingRewardsMtt!: string;
  @ApiProperty() lifetimeRewardsClaimedMtt!: string;
  @ApiProperty() activePositions!: number;
  @ApiProperty({ type: [StakingPositionResponse] }) positions!: StakingPositionResponse[];
}

/* --------------------------------- admin ---------------------------------- */

export class UpsertPoolRequest {
  @ApiProperty({ description: "On-chain pool id this row mirrors" })
  @IsInt() @Min(0) @Max(1_000_000)
  poolId!: number;

  @ApiProperty()
  @IsString() @MinLength(2) @MaxLength(60)
  name!: string;

  @ApiProperty({ description: "Must match the on-chain lock length" })
  @IsInt() @Min(0) @Max(3_650)
  lockDays!: number;

  @ApiProperty()
  @IsInt() @Min(1) @Max(3_650)
  rewardsDurationDays!: number;

  @ApiProperty({ description: "Penalty on unclaimed rewards, in bps. Capped at 10000 (100%)." })
  @IsInt() @Min(0) @Max(10_000)
  earlyPenaltyBps!: number;

  @ApiProperty()
  @IsBoolean()
  active!: boolean;

  @ApiProperty({ description: "Reason for the change — recorded in the audit trail" })
  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}

export class RecomputeAprRequest {
  @ApiPropertyOptional({ description: "UTC month key (YYYY-MM). Defaults to the current month." })
  @IsOptional() @IsString() @MaxLength(10)
  periodKey?: string;
}
