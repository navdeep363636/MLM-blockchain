import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsUUID } from "class-validator";
import { DateRangeQuery } from "@/common/dto";
import type { PointsSource } from "@/database/entities";

/* ============================================================================
 * Points ledger DTOs (FRD G-02, W-01).
 * ========================================================================== */

const SOURCES: PointsSource[] = [
  "gameplay", "quest", "achievement", "ad", "tournament", "purchase",
  "referral_bonus", "conversion", "admin_adjustment", "reversal",
];

export class PointsHistoryQuery extends DateRangeQuery {
  @ApiPropertyOptional({ enum: SOURCES, description: "Filter to a single issuance source" })
  @IsOptional() @IsEnum(SOURCES)
  source?: PointsSource;

  @ApiPropertyOptional({ description: "Filter to one game" })
  @IsOptional() @IsUUID()
  gameId?: string;
}

export class PointsEntryResponse {
  @ApiProperty() ref!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ enum: SOURCES }) source!: PointsSource;
  @ApiProperty({ description: "Signed: positive credits, negative debits" }) amount!: number;
  @ApiProperty() runningBalance!: number;
  @ApiPropertyOptional({ nullable: true }) gameId!: string | null;
  @ApiPropertyOptional({ nullable: true }) gameSessionId!: string | null;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
}

/** Ready-to-serialise CSV payload for the statement export (FRD W-05). */
export class PointsExportResponse {
  @ApiProperty() filename!: string;
  @ApiProperty({ type: [String] }) columns!: string[];
  /* Swagger cannot express string[][] as a typed array; described as a raw
   * schema so the generated client still sees the right shape. */
  @ApiProperty({ type: "array", items: { type: "array", items: { type: "string" } } })
  rows!: string[][];
  @ApiProperty() rowCount!: number;
  @ApiProperty() generatedAt!: string;
}

export class PointsBestDay {
  @ApiProperty({ description: "UTC day, YYYY-MM-DD" }) day!: string;
  @ApiProperty() earned!: number;
}

export class PointsSummaryResponse {
  @ApiProperty({ description: "Total Points ever credited" }) earned!: number;
  @ApiProperty({ description: "Total Points spent on MTT conversions" }) convertedOut!: number;
  @ApiProperty({ description: "Total of every signed ledger row — equals the balance" }) net!: number;
  @ApiProperty() currentBalance!: number;
  @ApiPropertyOptional({ type: PointsBestDay, nullable: true }) bestDay!: PointsBestDay | null;
  @ApiProperty() earnedToday!: number;
  @ApiProperty() firstEntryAt!: string | null;
}

export class GameCapMeter {
  @ApiProperty() gameId!: string;
  @ApiProperty() gameTitle!: string;
  @ApiProperty() cap!: number;
  @ApiProperty() issued!: number;
  @ApiProperty() remaining!: number;
  @ApiProperty() sessionCap!: number;
}

export class PointsCapsResponse {
  @ApiProperty({ description: "UTC day the meters apply to" }) day!: string;
  @ApiProperty() globalCap!: number;
  @ApiProperty() globalIssued!: number;
  @ApiProperty() globalRemaining!: number;
  @ApiProperty({ type: [GameCapMeter] }) games!: GameCapMeter[];
  @ApiProperty({ description: "Seconds until the caps reset (UTC midnight)" }) resetsInSeconds!: number;
}
