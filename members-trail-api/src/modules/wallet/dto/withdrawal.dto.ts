import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum, IsEthereumAddress, IsIn, IsNumberString, IsOptional, IsString, MaxLength, MinLength,
} from "class-validator";
import { DateRangeQuery } from "@/common/dto";
import type { FundsSourceTag, WithdrawalKind, WithdrawalStatus } from "@/database/entities";

/* ============================================================================
 * Withdrawal DTOs (FRD W-04, AD-06).
 *
 * Amounts are strings, never numbers: a JSON number cannot represent 18 decimal
 * places without losing the low digits, and the low digits are money.
 * ========================================================================== */

export const SOURCE_TAGS: FundsSourceTag[] = ["gameplay", "staking", "referral", "deposit", "prize"];

export const WITHDRAWAL_STATUSES: WithdrawalStatus[] = [
  "pending", "cooling_off", "review", "approved", "processing",
  "completed", "rejected", "cancelled", "failed",
];

export class CreateWithdrawalRequest {
  @ApiProperty({ enum: ["mtt", "fiat"] })
  @IsIn(["mtt", "fiat"])
  kind!: WithdrawalKind;

  @ApiProperty({ description: "MTT amount as a decimal string, e.g. \"125.5\"" })
  @IsNumberString({ no_symbols: false })
  amountMtt!: string;

  @ApiPropertyOptional({ description: "Destination EVM address. Required for kind=mtt." })
  @IsOptional() @IsEthereumAddress()
  destinationAddress?: string;

  @ApiPropertyOptional({
    description: "Opaque payout-method reference for kind=fiat. Bank details are never sent in the clear.",
  })
  @IsOptional() @IsString() @MinLength(4) @MaxLength(255)
  payoutMethodRef?: string;

  @ApiProperty({
    enum: SOURCE_TAGS,
    description: "Provenance of the funds. Recorded for AML — a payout must be traceable to how it was earned.",
  })
  @IsEnum(SOURCE_TAGS)
  sourceTag!: FundsSourceTag;
}

export class WithdrawalResponse {
  @ApiProperty() ref!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ enum: ["mtt", "fiat"] }) kind!: WithdrawalKind;
  @ApiProperty() amountMtt!: string;
  @ApiPropertyOptional({ nullable: true }) amountFiat!: string | null;
  @ApiPropertyOptional({ nullable: true }) destinationAddress!: string | null;
  @ApiProperty({ enum: SOURCE_TAGS }) sourceTag!: FundsSourceTag;
  @ApiProperty({ enum: WITHDRAWAL_STATUSES }) status!: WithdrawalStatus;
  @ApiProperty() kycTierAtRequest!: number;
  @ApiProperty({ description: "True when the amount routed the request to manual compliance review" })
  reviewRequired!: boolean;
  @ApiPropertyOptional({ nullable: true }) coolingOffUntil!: string | null;
  @ApiPropertyOptional({ nullable: true }) txHash!: string | null;
  @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) reviewedAt!: string | null;
}

export class WithdrawalLimitsResponse {
  @ApiProperty() kycTier!: number;
  @ApiProperty({ description: "Rolling-window ceiling for this tier, in MTT" }) tierLimitMtt!: string;
  @ApiProperty({ description: "Width of the rolling window in days" }) windowDays!: number;
  @ApiProperty({ description: "Already committed inside the window" }) usedMtt!: string;
  @ApiProperty({ description: "tierLimit − used, floored at zero" }) remainingMtt!: string;
  @ApiProperty({ description: "Above this amount a request always goes to manual review" })
  reviewThresholdMtt!: string;
  @ApiProperty({ description: "Delay applied to the first payout to a newly linked address" })
  coolingOffHours!: number;
  @ApiProperty({ description: "Spendable balance right now" }) availableMtt!: string;
  @ApiProperty({ description: "min(available, remaining) — the largest request that would be accepted" })
  maxRequestableMtt!: string;
  @ApiProperty({ description: "False when the tier forbids withdrawal entirely" }) eligible!: boolean;
  @ApiPropertyOptional({ nullable: true }) blockedBy!: string | null;
}

export class WithdrawalHistoryQuery extends DateRangeQuery {
  @ApiPropertyOptional({ enum: WITHDRAWAL_STATUSES })
  @IsOptional() @IsEnum(WITHDRAWAL_STATUSES)
  status?: WithdrawalStatus;
}

/* --------------------------------- admin ---------------------------------- */

export class AdminWithdrawalQuery extends WithdrawalHistoryQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64)
  userId?: string;

  @ApiPropertyOptional({ enum: SOURCE_TAGS })
  @IsOptional() @IsEnum(SOURCE_TAGS)
  sourceTag?: FundsSourceTag;
}

export class ApproveWithdrawalRequest {
  @ApiProperty({ description: "Reviewer's note. Required — an approval with no rationale is not reviewable." })
  @IsString() @MinLength(5) @MaxLength(1_000)
  note!: string;
}

export class RejectWithdrawalRequest {
  @ApiProperty({ description: "Reason shown to the member and stored on the record" })
  @IsString() @MinLength(5) @MaxLength(1_000)
  reason!: string;
}

export class UpdateWithdrawalPolicyRequest {
  @ApiProperty({ description: "Above this MTT amount, every request goes to manual review" })
  @IsNumberString()
  autoApproveMtt!: string;

  @ApiProperty({ description: "Rolling-window ceiling for KYC tier 1, in MTT" })
  @IsNumberString()
  tier1Mtt!: string;

  @ApiProperty({ description: "Rolling-window ceiling for KYC tier 2, in MTT" })
  @IsNumberString()
  tier2Mtt!: string;

  @ApiProperty({ description: "Cooling-off hours for a newly linked destination address" })
  @IsNumberString()
  coolingOffHours!: string;

  @ApiProperty({ description: "Reason for the change — recorded in the audit trail" })
  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}
