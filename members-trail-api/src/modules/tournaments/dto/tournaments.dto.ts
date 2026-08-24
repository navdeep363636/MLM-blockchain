import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsISO8601, IsInt, IsNumberString, IsOptional,
  IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { PaginationQuery } from "@/common/dto";
import type { TournamentStatus } from "@/database/entities";

/* ============================================================================
 * Tournament DTOs (FRD G-03).
 *
 * `prizeSplit` is published before entry opens and is immutable thereafter. It
 * is expressed in basis points so the shares are exact and can be asserted to
 * total 100% — a split expressed in percentages with rounding is how a prize
 * pool ends up over- or under-allocated.
 * ========================================================================== */

export const TOURNAMENT_STATUSES: TournamentStatus[] = [
  "draft", "scheduled", "live", "completed", "cancelled",
];

export class PrizeSplitEntry {
  @ApiProperty({ description: "Place or range, e.g. \"1\", \"2-3\", \"4-10\"" })
  @IsString() @MinLength(1) @MaxLength(16)
  place!: string;

  @ApiProperty({ description: "Share of the prize pool in basis points" })
  @IsInt() @Min(1) @Max(10_000)
  share!: number;
}

export class TournamentResponse {
  @ApiProperty() id!: string;
  @ApiProperty() ref!: string;
  @ApiProperty() gameId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() startsAt!: string;
  @ApiProperty() endsAt!: string;
  @ApiProperty() entryFee!: string;
  @ApiProperty() prizePool!: string;
  @ApiProperty() participants!: number;
  @ApiProperty() maxParticipants!: number;
  @ApiProperty({ enum: TOURNAMENT_STATUSES }) status!: TournamentStatus;
  @ApiProperty() format!: string;
  @ApiProperty({ type: [PrizeSplitEntry], description: "Published before entry opens, immutable after" })
  prizeSplit!: { place: string; share: number }[];
  @ApiPropertyOptional({ nullable: true, description: "When the split became immutable" })
  prizeSplitLockedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) rules!: string | null;
  @ApiPropertyOptional({ nullable: true }) settledAt!: string | null;
  @ApiProperty({ description: "Seconds until it starts, 0 once started" }) startsInSeconds!: number;
  @ApiProperty({ description: "True when entry is open right now" }) entryOpen!: boolean;
}

export class TournamentQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: TOURNAMENT_STATUSES })
  @IsOptional() @IsEnum(TOURNAMENT_STATUSES)
  status?: TournamentStatus;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  gameId?: string;
}

export class EntryResponse {
  @ApiProperty() tournamentId!: string;
  @ApiProperty() tournamentName!: string;
  @ApiProperty() paidAmount!: string;
  @ApiPropertyOptional({ nullable: true }) bestScore!: number | null;
  @ApiPropertyOptional({ nullable: true }) rank!: number | null;
  @ApiProperty() prizeAmount!: string;
  @ApiPropertyOptional({ nullable: true }) prizePaidAt!: string | null;
  @ApiProperty() disqualified!: boolean;
  @ApiPropertyOptional({ nullable: true }) disqualificationReason!: string | null;
  @ApiProperty() joinedAt!: string;
}

export class TournamentRegisterResponse {
  @ApiProperty() tournamentId!: string;
  @ApiProperty() ref!: string;
  @ApiProperty({ description: "MTT actually charged" }) paidAmount!: string;
  @ApiProperty() participants!: number;
  @ApiProperty({
    description: "The revenue event the entry fee produced. This is what makes the fee commissionable.",
  })
  revenueEventId!: string | null;
}

export class StandingRow {
  @ApiProperty({ description: "Anonymised unless it is you" }) label!: string;
  @ApiProperty() rank!: number;
  @ApiProperty() bestScore!: number;
  @ApiProperty() isYou!: boolean;
  @ApiProperty({ description: "Projected prize at this standing, if the tournament ended now" })
  projectedPrize!: string;
}

export class StandingsResponse {
  @ApiProperty() tournamentId!: string;
  @ApiProperty({ enum: TOURNAMENT_STATUSES }) status!: TournamentStatus;
  @ApiProperty() prizePool!: string;
  @ApiProperty({ type: [StandingRow] }) standings!: StandingRow[];
  @ApiPropertyOptional({ nullable: true, description: "Your row, even if outside the visible page" })
  you!: StandingRow | null;
  @ApiProperty({ description: "True once prizes are final" }) settled!: boolean;
}

export class SettlementResponse {
  @ApiProperty() tournamentId!: string;
  @ApiProperty() paidEntries!: number;
  @ApiProperty() totalPaid!: string;
  @ApiProperty({ description: "Prize pool minus what was actually paid" }) unallocated!: string;
  @ApiProperty() disqualified!: number;
}

/* --------------------------------- admin ---------------------------------- */

export class CreateTournamentRequest {
  @ApiProperty() @IsUUID()
  gameId!: string;

  @ApiProperty() @IsString() @MinLength(3) @MaxLength(160)
  name!: string;

  @ApiProperty() @IsISO8601()
  startsAt!: string;

  @ApiProperty() @IsISO8601()
  endsAt!: string;

  @ApiProperty({ description: "Entry fee in MTT. Zero for a free tournament." })
  @IsNumberString()
  entryFee!: string;

  @ApiProperty({ description: "Guaranteed prize pool in MTT" })
  @IsNumberString()
  prizePool!: string;

  @ApiProperty() @IsInt() @Min(2) @Max(1_000_000)
  maxParticipants!: number;

  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200)
  format!: string;

  @ApiProperty({
    type: [PrizeSplitEntry],
    description: "Shares in basis points. Must total exactly 10000 — no unallocated remainder.",
  })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => PrizeSplitEntry)
  prizeSplit!: PrizeSplitEntry[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5_000)
  rules?: string;
}

export class PublishTournamentRequest {
  @ApiProperty({ description: "Reason recorded in the audit trail" })
  @IsString() @MinLength(5) @MaxLength(500)
  reason!: string;
}

export class DisqualifyRequest {
  @ApiProperty() @IsUUID()
  userId!: string;

  @ApiProperty({ description: "Why the entry is disqualified. Shown to the member." })
  @IsString() @MinLength(5) @MaxLength(255)
  reason!: string;
}
