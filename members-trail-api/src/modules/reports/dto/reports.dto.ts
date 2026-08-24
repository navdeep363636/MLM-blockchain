import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from "class-validator";

/* ============================================================================
 * Reporting DTOs (FRD AD-12).
 *
 * `basis` and `truncated` are part of the contract. A number with no stated basis
 * is not a report, and a report that silently truncated is worse than one that
 * failed — the reader has no way to know a total is incomplete.
 * ========================================================================== */

export const REPORT_TYPES = [
  "revenue", "commission", "withdrawals", "conversions", "treasury", "kyc", "points", "members",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** One row is an array of pre-stringified cells, aligned to `columns`. */
export type ReportRow = (string | number)[];

export class ReportRequest {
  @ApiProperty({ enum: REPORT_TYPES })
  @IsIn(REPORT_TYPES)
  type!: ReportType;

  @ApiPropertyOptional({ description: "Inclusive lower bound. Defaults to the trailing month." })
  @IsOptional() @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: "Inclusive upper bound" })
  @IsOptional() @IsISO8601()
  to?: string;
}

export class ReportResponse {
  @ApiProperty({ enum: REPORT_TYPES }) type!: ReportType;
  @ApiProperty() title!: string;
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({
    description: "What the report counts and what it excludes. A number with no basis is not a report.",
  })
  basis!: string;
  @ApiProperty({ type: [String] }) columns!: string[];
  @ApiProperty({ type: "array", items: { type: "array", items: { type: "string" } } })
  rows!: string[][];
  @ApiProperty() rowCount!: number;
  @ApiProperty({ description: "True when the row cap was hit and the totals are incomplete" })
  truncated!: boolean;
  @ApiProperty() generatedAt!: string;
  @ApiProperty({ description: "Suggested download name" }) filename!: string;
}

export class PayoutRatioQuery {
  @ApiPropertyOptional({ description: "UTC month, YYYY-MM. Defaults to the current month." })
  @IsOptional() @IsString() @MaxLength(10)
  period?: string;
}

export class PayoutRatioResponse {
  @ApiProperty() period!: string;
  @ApiProperty({ description: "Reconciled net revenue occurring in the period" })
  reconciledNetRevenue!: string;
  @ApiProperty({ description: "Commission released or claimed for the period" })
  commissionPaid!: string;
  @ApiProperty({ description: "Confirmed Treasury transfers for the period" })
  treasuryOutflowConfirmed!: string;
  @ApiProperty({ description: "commissionPaid ÷ reconciledNetRevenue × 10000" })
  payoutRatioBps!: number;
  @ApiProperty({ description: "False means the platform paid out more than it took in" })
  withinPolicy!: boolean;
  @ApiProperty() basis!: string;
}
