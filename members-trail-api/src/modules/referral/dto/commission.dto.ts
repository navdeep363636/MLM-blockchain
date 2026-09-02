import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray, IsISO8601, IsIn, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
} from "class-validator";
import { DateRangeQuery } from "@/common/dto";
import type { CommissionStatus, CommissionTrigger } from "@/database/entities";

/* ============================================================================
 * Commission DTOs (FRD R-01 … R-05, AD-07).
 *
 * Fiat amounts are 2dp strings, MTT amounts 18dp strings. Both are strings
 * because a JSON number silently loses the digits that make a payout exact.
 * ========================================================================== */

export const COMMISSION_STATUSES: CommissionStatus[] = [
  "pending_kyc", "queued", "released", "claimed", "capped", "clawed_back", "rejected",
];

export const COMMISSION_TRIGGERS: CommissionTrigger[] = ["iap", "tournament_entry", "subscription"];

/** Hard ceiling on plan depth. There is no level 4 anywhere in the system. */
export const MAX_DEPTH = 3;

export class CommissionResponse {
  @ApiProperty() ref!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ description: "1 = direct sponsor, 2 and 3 are the tiers above" }) level!: number;
  @ApiProperty({ description: "Anonymised label for the member whose spend generated it (R-02)" })
  fromMember!: string;
  @ApiProperty({ enum: COMMISSION_TRIGGERS }) triggerType!: CommissionTrigger;
  @ApiProperty({ description: "NET eligible spend the rate was applied to — never gross" })
  eligibleSpend!: string;
  @ApiProperty() rateBps!: number;
  @ApiProperty({ description: "What the rate produced before the monthly cap" }) grossAmount!: string;
  @ApiProperty({ description: "Payable after the cap" }) amount!: string;
  @ApiProperty({ description: "Refused by the cap. Never carried into the next month." })
  cappedAmount!: string;
  @ApiProperty() amountMtt!: string;
  @ApiProperty({ enum: COMMISSION_STATUSES }) status!: CommissionStatus;
  @ApiProperty() monthKey!: string;
  @ApiPropertyOptional({ nullable: true, description: "The Treasury deposit that funded this payout" })
  treasuryInflowRef!: string | null;
  @ApiPropertyOptional({ nullable: true }) releasedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) claimedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, description: "Set when a refund or chargeback reversed it" })
  clawbackReason!: string | null;
}

export class CommissionQuery extends DateRangeQuery {
  @ApiPropertyOptional({ enum: COMMISSION_STATUSES })
  @IsOptional() @IsIn(COMMISSION_STATUSES)
  status?: CommissionStatus;

  /* enableImplicitConversion is off globally, so without the explicit @Type a
   * query value stays a string and @IsInt() rejects it — this filter returned
   * 400 on every request. PaginationQuery.page/.limit already do it this way. */
  @ApiPropertyOptional({ enum: [1, 2, 3] })
  @Type(() => Number)
  @IsOptional() @IsInt() @Min(1) @Max(MAX_DEPTH)
  level?: number;
}

export class AdminCommissionQuery extends CommissionQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID()
  recipientId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  downlineUserId?: string;

  @ApiPropertyOptional({ description: "UTC month, YYYY-MM" })
  @IsOptional() @IsString() @MaxLength(10)
  monthKey?: string;
}

export class CapMeterResponse {
  @ApiProperty() monthKey!: string;
  @ApiProperty({ description: "min(absolute, multiplier × trailing-3-month own spend + base)" })
  capAmount!: string;
  @ApiProperty() usedAmount!: string;
  @ApiProperty() remainingAmount!: string;
  @ApiProperty({ description: "Refused by the cap this month. Never carried over." })
  cappedAwayAmount!: string;
  @ApiProperty({ description: "Own net spend over the trailing three months, which sets the cap" })
  trailingSpend!: string;
  @ApiProperty() entryCount!: number;
  @ApiProperty({ description: "Absolute ceiling regardless of spend" }) absoluteCap!: string;
  @ApiProperty() capMultiplier!: string;
  @ApiProperty() capBase!: string;
}

export class ClaimCommissionResponse {
  @ApiProperty({ description: "MTT moved to the spendable balance" }) claimedMtt!: string;
  @ApiProperty({ description: "How many commission rows were settled" }) entries!: number;
  @ApiProperty({ description: "Still awaiting KYC or pool funding" }) remainingPendingMtt!: string;
  @ApiProperty() transactionRef!: string | null;
}

export class CommissionEarningsResponse {
  @ApiProperty() lifetimeMtt!: string;
  @ApiProperty() claimableMtt!: string;
  @ApiProperty({ description: "Calculated but not yet released — awaiting KYC or pool funding" })
  pendingMtt!: string;
  @ApiProperty() thisMonthMtt!: string;
  @ApiProperty({ type: [Number], description: "Lifetime MTT earned per level, index 0 = level 1" })
  perLevelMtt!: string[];
  @ApiProperty() totalEntries!: number;
}

/* ------------------------------- plan ------------------------------------- */

export class PlanRatesInput {
  @ApiProperty({ description: "Level 1 rate in basis points of NET eligible spend" })
  @IsInt() @Min(0) @Max(10_000)
  l1Bps!: number;

  @ApiProperty() @IsInt() @Min(0) @Max(10_000)
  l2Bps!: number;

  @ApiProperty() @IsInt() @Min(0) @Max(10_000)
  l3Bps!: number;

  @ApiProperty({ description: `Maximum depth. Hard-capped at ${MAX_DEPTH} — there is no level 4.` })
  @IsInt() @Min(1) @Max(MAX_DEPTH)
  maxDepth!: number;

  @ApiProperty({ enum: COMMISSION_TRIGGERS, isArray: true })
  @IsArray() @IsIn(COMMISSION_TRIGGERS, { each: true })
  eligibleTriggers!: CommissionTrigger[];

  @ApiProperty({ description: "Absolute monthly ceiling per recipient, in fiat" })
  @IsNumberString()
  monthlyCapAbsolute!: string;

  @ApiProperty({ description: "Multiplier applied to trailing-3-month own spend" })
  @IsNumberString()
  capMultiplier!: string;

  @ApiProperty({ description: "Flat allowance added to the multiplied spend" })
  @IsNumberString()
  capBase!: string;

  @ApiProperty({ description: "Minimum account age in days before a recipient may earn" })
  @IsInt() @Min(0) @Max(365)
  minAccountAgeDays!: number;

  @ApiProperty({ description: "Minimum validated gameplay sessions before a recipient may earn" })
  @IsInt() @Min(0) @Max(1_000)
  minGameplaySessions!: number;
}

export class ProposePlanRequest extends PlanRatesInput {
  @ApiProperty({ description: "UTC instant the plan takes effect. Must be in the future." })
  @IsISO8601()
  effectiveFrom!: string;

  @ApiProperty({ description: "Why the plan is changing. Recorded in the audit trail." })
  @IsString() @MinLength(10) @MaxLength(2_000)
  rationale!: string;
}

export class SimulatePlanRequest extends PlanRatesInput {}

export class PlanSimulationResponse {
  @ApiProperty({ description: "Months of history the projection is based on" }) monthsSampled!: number;
  @ApiProperty({ description: "Reconciled, commission-eligible NET revenue in the sample" })
  eligibleRevenue!: string;
  @ApiProperty({
    type: [String],
    description: "Eligible revenue that actually has an upline at each level, index 0 = level 1",
  })
  revenueWithUplinePerLevel!: string[];
  @ApiProperty({
    description: "Projected commission liability BEFORE monthly caps — a deliberate upper bound",
  })
  projectedLiability!: string;
  @ApiProperty({ description: "Treasury allocation the same revenue would have produced" })
  projectedTreasuryInflow!: string;
  @ApiProperty({ description: "liability ÷ inflow × 10000. Must stay below 10000." })
  payoutRatioBps!: number;
  @ApiProperty({ description: "False when the plan would pay out more than the Treasury takes in" })
  solvent!: boolean;
  @ApiProperty({ description: "True when the ratio is at or above the compliance alert threshold" })
  breachesAlertThreshold!: boolean;
  @ApiProperty({ type: [String] }) notes!: string[];
}

export class PlanResponse {
  @ApiProperty() id!: string;
  @ApiProperty() version!: number;
  @ApiProperty() l1Bps!: number;
  @ApiProperty() l2Bps!: number;
  @ApiProperty() l3Bps!: number;
  @ApiProperty() maxDepth!: number;
  @ApiProperty({ enum: COMMISSION_TRIGGERS, isArray: true }) eligibleTriggers!: CommissionTrigger[];
  @ApiProperty() monthlyCapAbsolute!: string;
  @ApiProperty() capMultiplier!: string;
  @ApiProperty() capBase!: string;
  @ApiProperty() minAccountAgeDays!: number;
  @ApiProperty() minGameplaySessions!: number;
  @ApiProperty() status!: string;
  @ApiProperty() effectiveFrom!: string;
  @ApiProperty() proposedById!: string;
  @ApiPropertyOptional({ nullable: true }) approvedById!: string | null;
  @ApiPropertyOptional({ nullable: true }) approvedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, type: PlanSimulationResponse })
  simulationSnapshot!: PlanSimulationResponse | null;
  @ApiPropertyOptional({ nullable: true }) rationale!: string | null;
  @ApiProperty() createdAt!: string;
}

export class DecidePlanRequest {
  @ApiPropertyOptional({ description: "Approver's note, stored with the decision" })
  @IsOptional() @IsString() @MaxLength(1_000)
  note?: string;
}

export class RejectPlanRequest {
  @ApiProperty()
  @IsString() @MinLength(5) @MaxLength(1_000)
  reason!: string;
}

export class SolvencyResponse {
  @ApiProperty({ description: "Cumulative confirmed Treasury funding of the commission pool" })
  poolFundedMtt!: string;
  @ApiProperty({ description: "Cumulative commission released or claimed" }) committedMtt!: string;
  @ApiProperty({ description: "funded − committed. Releases stop when this reaches zero." })
  availableMtt!: string;
  @ApiProperty({ description: "Calculated but unreleased, waiting on funding" }) queuedMtt!: string;
  @ApiProperty({ description: "Calculated but unreleased, waiting on the recipient's KYC" })
  pendingKycMtt!: string;
  @ApiProperty({
    description: "The invariant: committed ≤ funded. False here is a release blocker, not a warning.",
  })
  solvent!: boolean;
}

export class ClawbackRequest {
  @ApiProperty({ description: "Why the commission is being reversed" })
  @IsString() @MinLength(5) @MaxLength(255)
  reason!: string;
}
