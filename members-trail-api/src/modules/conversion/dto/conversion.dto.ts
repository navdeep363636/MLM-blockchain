import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt, IsISO8601, IsOptional, IsPositive, IsString, Max, MaxLength, Min, MinLength,
} from "class-validator";
import { DateRangeQuery } from "@/common/dto";
import type { RateStatus, TxStatus } from "@/database/entities";

/* ============================================================================
 * Points → MTT conversion DTOs (FRD W-02, AD-05).
 * ========================================================================== */

/** Sane bounds on the proposable rate. A rate of 0 would mint MTT from nothing;
 *  an absurdly high one would silently disable conversion for every player. */
export const RATE_MIN = 1;
export const RATE_MAX = 10_000_000;

export class ConversionQuoteQuery {
  @ApiProperty({ minimum: 1, description: "Points the player intends to spend" })
  @IsInt() @IsPositive() @Max(1_000_000_000)
  points!: number;
}

export class CreateConversionRequest {
  @ApiProperty({ minimum: 1, description: "Points to spend. Must be a whole number." })
  @IsInt() @IsPositive() @Max(1_000_000_000)
  points!: number;
}

export class ConversionRateResponse {
  @ApiProperty({ description: "Points required for one MTT" }) pointsPerMtt!: number;
  @ApiProperty() effectiveFrom!: string;
  @ApiPropertyOptional({ nullable: true, description: "Next approved rate, if one is scheduled" })
  nextPointsPerMtt!: number | null;
  @ApiPropertyOptional({ nullable: true }) nextEffectiveFrom!: string | null;
}

export class ConversionCapMeter {
  @ApiProperty({ description: "\"day\" or \"month\"" }) window!: "day" | "month";
  @ApiProperty({ description: "UTC period key the meter applies to" }) periodKey!: string;
  @ApiProperty() limitPoints!: number;
  @ApiProperty() usedPoints!: number;
  @ApiProperty() remainingPoints!: number;
  @ApiProperty({ description: "Seconds until this window resets" }) resetsInSeconds!: number;
}

export class ConversionQuoteResponse {
  @ApiProperty() pointsRequested!: number;
  @ApiProperty({ description: "Points actually convertible after caps and balance" })
  pointsConvertible!: number;
  @ApiProperty() pointsPerMtt!: number;
  @ApiProperty({ description: "MTT credited for pointsConvertible, truncated — never rounded up" })
  mttOut!: string;
  @ApiProperty({ description: "Points that would be left as an unconvertible remainder" })
  remainderPoints!: number;
  @ApiProperty() pointsBalance!: number;
  @ApiProperty({ type: [ConversionCapMeter] }) caps!: ConversionCapMeter[];
  @ApiProperty({ description: "False when a cap, the balance or the rate blocks the conversion" })
  executable!: boolean;
  @ApiPropertyOptional({
    nullable: true,
    description:
      "Binding constraint when pointsConvertible is less than pointsRequested: " +
      "INSUFFICIENT_POINTS, DAILY_CAP, MONTHLY_CAP, RATE_GRANULARITY or BELOW_MINIMUM. Null when unconstrained.",
  })
  blockedBy!: string | null;
}

export class ConversionResponse {
  @ApiProperty() ref!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() pointsSpent!: number;
  @ApiProperty() rateApplied!: number;
  @ApiProperty() mttCredited!: string;
  @ApiProperty() status!: TxStatus;
  @ApiPropertyOptional({ nullable: true }) txHash!: string | null;
  @ApiProperty({ description: "Points balance immediately after the debit" })
  pointsBalanceAfter!: number;
  @ApiProperty({ description: "True when this was a replay of an already-applied conversion" })
  replayed!: boolean;
}

export class ConversionHistoryQuery extends DateRangeQuery {}

export class ConversionSummaryResponse {
  @ApiProperty() totalConversions!: number;
  @ApiProperty() pointsSpentLifetime!: number;
  @ApiProperty() mttReceivedLifetime!: string;
  @ApiPropertyOptional({ nullable: true }) lastConvertedAt!: string | null;
  @ApiProperty({ description: "Weighted average Points paid per MTT across all conversions" })
  averageRate!: number;
}

/* ------------------------------- admin ------------------------------------ */

export class ProposeRateRequest {
  @ApiProperty({ minimum: RATE_MIN, maximum: RATE_MAX })
  @IsInt() @Min(RATE_MIN) @Max(RATE_MAX)
  pointsPerMtt!: number;

  @ApiProperty({ description: "UTC instant the rate takes effect. Must be in the future." })
  @IsISO8601()
  effectiveFrom!: string;

  @ApiProperty({ description: "Why the rate is changing. Recorded in the audit trail." })
  @IsString() @MinLength(10) @MaxLength(1_000)
  rationale!: string;
}

export class DecideRateRequest {
  @ApiPropertyOptional({ description: "Reviewer note, stored with the decision" })
  @IsOptional() @IsString() @MaxLength(1_000)
  note?: string;
}

export class RejectRateRequest {
  @ApiProperty({ description: "Why the proposal was rejected" })
  @IsString() @MinLength(5) @MaxLength(1_000)
  reason!: string;
}

export class RateResponse {
  @ApiProperty() id!: string;
  @ApiProperty() pointsPerMtt!: number;
  @ApiProperty() effectiveFrom!: string;
  @ApiProperty() status!: RateStatus;
  @ApiProperty() proposedById!: string;
  @ApiPropertyOptional({ nullable: true }) approvedById!: string | null;
  @ApiPropertyOptional({ nullable: true }) approvedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) rationale!: string | null;
  @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;
  @ApiProperty() createdAt!: string;
}

export class UpdateConversionCapsRequest {
  @ApiProperty({ description: "Points a single member may convert per UTC day" })
  @IsInt() @Min(0) @Max(1_000_000_000)
  dailyPoints!: number;

  @ApiProperty({ description: "Points a single member may convert per UTC month" })
  @IsInt() @Min(0) @Max(10_000_000_000)
  monthlyPoints!: number;

  @ApiProperty({ description: "Reason for the change — required for the audit trail" })
  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}

export class AdminConversionQuery extends DateRangeQuery {
  @ApiPropertyOptional({ description: "Filter to one member" })
  @IsOptional() @IsString() @MaxLength(64)
  userId?: string;
}


/* ============================================================================
 * What the operator screen needs to show a ceiling honestly.
 *
 * Per-member ceilings alone do not answer the question an operator actually has,
 * which is "are we close to the platform's own limit today". Both are here, with
 * usage, so the screen does not have to derive a global figure from a per-member
 * one — which it cannot.
 * ========================================================================== */

export class ConversionCapsOverview {
  @ApiProperty({ description: "Per-member ceiling for one UTC day, in Points" })
  perUserDailyPoints!: number;

  @ApiProperty({ description: "Per-member ceiling for one UTC month, in Points" })
  perUserMonthlyPoints!: number;

  @ApiProperty({
    description:
      "Platform-wide ceiling for one UTC day, in Points. Null when none is " +
      "configured — an unset global limit is not a limit of zero, and rendering " +
      "it as one would show every operator a permanently breached gauge.",
    nullable: true,
  })
  globalDailyPoints!: number | null;

  @ApiProperty({ description: "Points converted platform-wide since 00:00 UTC" })
  globalDailyUsedPoints!: string;

  @ApiProperty({ description: "Conversions counted in that usage figure" })
  globalDailyConversions!: number;
}
