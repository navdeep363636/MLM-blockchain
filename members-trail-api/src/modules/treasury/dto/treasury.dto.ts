import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray, IsEnum, IsInt, IsISO8601, IsNumberString, IsOptional, IsString,
  IsUUID, Max, MaxLength, Min, MinLength,
} from "class-validator";
import { DateRangeQuery } from "@/common/dto";
import type { RevenueStream } from "@/database/entities";

export const REVENUE_STREAMS = ["iap", "tournament", "marketplace", "advertising", "subscription"] as const;

/* ------------------------------- queries ---------------------------------- */

export class InflowQuery extends DateRangeQuery {
  @ApiPropertyOptional({ enum: REVENUE_STREAMS })
  @IsOptional() @IsEnum(REVENUE_STREAMS)
  stream?: RevenueStream;

  @ApiPropertyOptional({ description: "Filter to reconciled or unreconciled only" })
  @IsOptional() @IsEnum(["true", "false"] as const)
  reconciled?: "true" | "false";

  @ApiPropertyOptional({ example: "2026-08" })
  @IsOptional() @IsString() @MaxLength(10)
  periodKey?: string;
}

export class OutflowQuery extends DateRangeQuery {
  @ApiPropertyOptional({ enum: ["staking_pool", "commission_pool"] })
  @IsOptional() @IsEnum(["staking_pool", "commission_pool"] as const)
  destination?: "staking_pool" | "commission_pool";

  @ApiPropertyOptional({ enum: ["proposed", "approved", "submitted", "confirmed", "failed", "rejected"] })
  @IsOptional() @IsEnum(["proposed", "approved", "submitted", "confirmed", "failed", "rejected"] as const)
  status?: string;

  @ApiPropertyOptional({ example: "2026-08" })
  @IsOptional() @IsString() @MaxLength(10)
  periodKey?: string;
}

/* ------------------------------- commands --------------------------------- */

export class RecogniseRevenueDto {
  @ApiProperty() @IsUUID() userId!: string;

  @ApiProperty({ enum: REVENUE_STREAMS }) @IsEnum(REVENUE_STREAMS) stream!: RevenueStream;

  @ApiProperty({ description: "Gross amount charged, as a decimal string" })
  @IsNumberString() grossAmount!: string;

  @ApiProperty({ description: "Processor fee deducted from gross" })
  @IsNumberString() processorFee!: string;

  @ApiPropertyOptional({ default: "INR" })
  @IsOptional() @IsString() @MaxLength(3) currency?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) processor?: string;

  @ApiPropertyOptional({ description: "Processor's own reference — the dedupe key" })
  @IsOptional() @IsString() @MaxLength(128) processorRef?: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601() occurredAt?: string;
}

export class ReconcileBatchDto {
  @ApiProperty({ description: "Inflow ids to mark reconciled", type: [String] })
  @IsArray() @IsUUID(undefined, { each: true }) inflowIds!: string[];

  @ApiProperty({ description: "Settlement total reported by the processor, for cross-check" })
  @IsNumberString() settlementTotal!: string;

  @ApiProperty({ minLength: 10 })
  @IsString() @MinLength(10) @MaxLength(500) reason!: string;
}

export class ProposeOutflowDto {
  @ApiProperty({ enum: ["staking_pool", "commission_pool"] })
  @IsEnum(["staking_pool", "commission_pool"] as const)
  destination!: "staking_pool" | "commission_pool";

  @ApiPropertyOptional({ description: "Required when destination is staking_pool" })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(64)
  poolId?: number;

  @ApiProperty({ description: "MTT amount, decimal string" })
  @IsNumberString() amount!: string;

  @ApiProperty({ example: "2026-08" })
  @IsString() @MaxLength(10) periodKey!: string;

  @ApiProperty({ minLength: 10, description: "Mandatory rationale — recorded in the audit log" })
  @IsString() @MinLength(10) @MaxLength(1000) rationale!: string;

  @ApiPropertyOptional({ description: "Draw from the 15% Treasury Reserve instead of real revenue" })
  @IsOptional() @IsEnum(["true", "false"] as const) fromReserve?: "true" | "false";
}

export class ApproveOutflowDto {
  @ApiProperty({ minLength: 10 })
  @IsString() @MinLength(10) @MaxLength(1000) note!: string;
}

/* ------------------------------- responses -------------------------------- */

/* ============================================================================
 * Ledger rows.
 *
 * These exist because the list endpoints used to return the ENTITIES, which is a
 * different contract from the one every other endpoint here publishes and leaked
 * internal column names (`allocationBps`, `amountToTreasury`, `amount`) plus
 * columns no client should see (`reconciledById`, `reconciliationNote`,
 * `budgetAtApproval`). A client written against the documented names read
 * `undefined` for the date and every amount, and rendered zeroes.
 * ========================================================================== */

export class TreasuryInflowResponse {
  @ApiProperty() ref!: string;
  @ApiProperty({
    description:
      "When the Treasury recognised this allocation. Named for what it is: the " +
      "processor's own event time lives on the revenue event, and reporting that " +
      "here would claim a precision this row does not have.",
  })
  recognisedAt!: string;
  @ApiProperty({ enum: REVENUE_STREAMS }) stream!: RevenueStream;
  @ApiProperty({ description: "Gross amount charged, fiat" }) grossRevenue!: string;
  @ApiProperty({ description: "Basis points of net revenue allocated to the Treasury" })
  treasuryAllocationBps!: number;
  @ApiProperty({ description: "Allocation in fiat" }) amountToTreasury!: string;
  @ApiProperty({ description: "Allocation in MTT at the rate in force when recorded" })
  amountToTreasuryMtt!: string;
  @ApiPropertyOptional({ nullable: true }) processorRef!: string | null;
  @ApiProperty() reconciled!: boolean;
  @ApiPropertyOptional({ nullable: true }) reconciledAt!: string | null;
  @ApiProperty({ example: "2026-08" }) periodKey!: string;
}

export class TreasuryOutflowResponse {
  @ApiProperty() ref!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ enum: ["staking_pool", "commission_pool"] })
  destination!: "staking_pool" | "commission_pool";
  @ApiPropertyOptional({ nullable: true }) poolId!: number | null;
  @ApiProperty({ description: "MTT moved" }) amountMtt!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional({ nullable: true }) txHash!: string | null;
  @ApiPropertyOptional({
    nullable: true, isArray: true, type: String,
    description: "Ids of the approvers. Four-eyes means more than one.",
  })
  approvedByIds!: string[] | null;
  @ApiPropertyOptional({ nullable: true }) approvedAt!: string | null;
  @ApiProperty({ example: "2026-08" }) periodKey!: string;
}

export class HeadroomResponse {
  @ApiProperty() periodKey!: string;
  @ApiProperty() reconciledInflow!: string;
  @ApiProperty() priorOutflow!: string;
  @ApiProperty() headroom!: string;
  @ApiProperty() withinBudget!: boolean;
}

export class TreasuryDashboardResponse {
  @ApiProperty() periodKey!: string;
  @ApiProperty() reconciledInflow!: string;
  @ApiProperty() unreconciledInflow!: string;
  @ApiProperty() commissionOutflow!: string;
  @ApiProperty() stakingOutflow!: string;
  @ApiProperty() totalOutflow!: string;
  @ApiProperty() headroom!: string;
  @ApiProperty({ description: "(commission + staking) / reconciled inflow, in bps. Must stay < 10000." })
  payoutRatioBps!: number;
  @ApiProperty({ description: "Share of payouts funded by real revenue rather than the reserve, in bps" })
  realRevenueFundedBps!: number;
  @ApiProperty({ enum: ["safe", "watch", "escalate", "breach"] })
  ratioBand!: "safe" | "watch" | "escalate" | "breach";
  @ApiProperty() reserveFunded!: string;
  @ApiProperty({ type: [Object] }) byStream!: { stream: string; gross: string; toTreasury: string }[];
  @ApiProperty() unreconciledCount!: number;
  @ApiProperty() mismatchCount!: number;
}
