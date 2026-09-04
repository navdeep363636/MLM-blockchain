import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { DateRangeQuery, PaginationQuery } from "@/common/dto";
import type { EntryType, SessionMode, SessionStatus } from "@/database/entities";

/* ============================================================================
 * Game and session DTOs (FRD G-01, G-02).
 *
 * The shape of `SubmitSessionRequest` encodes the trust model: the client sends
 * what it OBSERVED (a score, a telemetry digest), and the server decides what
 * that is worth. `clientScore` is named for what it is — a claim.
 * ========================================================================== */

export const SESSION_MODES: SessionMode[] = ["free", "paid", "tournament", "demo"];
export const SESSION_STATUSES: SessionStatus[] = ["open", "submitted", "validated", "rejected", "abandoned"];
export const ENTRY_TYPES: EntryType[] = ["free", "paid", "both"];

export class GameResponse {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty() genre!: string;
  @ApiProperty() blurb!: string;
  @ApiProperty({ description: "Hue used for the procedural artwork" }) thumbnailHue!: number;
  @ApiProperty() pointsPerSessionMin!: number;
  @ApiProperty() pointsPerSessionMax!: number;
  @ApiProperty({ enum: ENTRY_TYPES }) entryType!: EntryType;
  @ApiProperty() entryFee!: string;
  @ApiProperty({ description: "Per-member daily Points ceiling for this title" }) dailyPointsCap!: number;
  @ApiProperty({ description: "Ceiling for a single session" }) sessionPointsCap!: number;
  @ApiProperty() active!: boolean;
  @ApiProperty() rating!: string;
  @ApiProperty() players30d!: number;
}

export class GameQuery extends PaginationQuery {
  @ApiPropertyOptional({ description: "Free-text search over title and slug" })
  @IsOptional() @IsString() @MaxLength(120)
  q?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40)
  genre?: string;

  @ApiPropertyOptional({ enum: ENTRY_TYPES })
  @IsOptional() @IsIn(ENTRY_TYPES)
  entryType?: EntryType;
}

/* -------------------------------- sessions -------------------------------- */

export class StartSessionRequest {
  @ApiProperty() @IsUUID()
  gameId!: string;

  @ApiProperty({ enum: SESSION_MODES })
  @IsIn(SESSION_MODES)
  mode!: SessionMode;

  /**
   * The tournament, by its public reference.
   *
   * Every other tournament route is addressed by ref (`/tournaments/:ref/...`),
   * and the read model deliberately exposes the ref rather than the uuid — so a
   * uuid-only field here was a field no browser client could populate. Both are
   * accepted; the ref is the one to use.
   */
  @ApiPropertyOptional({ description: "Required when mode is tournament, e.g. TRN-XZ31F0J1" })
  @IsOptional() @IsString() @MinLength(4) @MaxLength(32)
  tournamentRef?: string;

  @ApiPropertyOptional({ deprecated: true, description: "Legacy: prefer tournamentRef" })
  @IsOptional() @IsUUID()
  tournamentId?: string;

  @ApiPropertyOptional({ description: "Stable client fingerprint, used for abuse correlation" })
  @IsOptional() @IsString() @MinLength(8) @MaxLength(128)
  deviceFingerprint?: string;
}

export class StartSessionResponse {
  @ApiProperty() ref!: string;
  @ApiProperty() sessionId!: string;
  @ApiProperty({ description: "Deterministic seed the client renders from and the server replays" })
  seed!: string;
  @ApiProperty({
    description:
      "One-time token. Echo it back on submit; it proves the submission belongs to this session. " +
      "Returned exactly once and never retrievable again.",
  })
  sessionToken!: string;
  @ApiProperty() startedAt!: string;
  @ApiProperty({ description: "Points still issuable to you today for this title" })
  pointsHeadroom!: number;
  @ApiProperty({ description: "Ceiling for this single session" }) sessionCap!: number;
}

export class TelemetryFrame {
  @ApiProperty({ description: "Milliseconds since session start" })
  @IsInt() @Min(0) @Max(86_400_000)
  t!: number;

  @ApiProperty({ description: "Event code the game defines, e.g. 1 = input, 2 = score" })
  @IsInt() @Min(0) @Max(255)
  e!: number;

  @ApiProperty({ description: "Event value" })
  @IsInt() @Min(-1_000_000) @Max(1_000_000)
  v!: number;
}

export class SubmitSessionRequest {
  @ApiProperty({ description: "The one-time token issued when the session started" })
  @IsString() @MinLength(16) @MaxLength(128)
  sessionToken!: string;

  @ApiProperty({ description: "The score the CLIENT claims. Never credited directly." })
  @IsInt() @Min(0) @Max(100_000_000)
  clientScore!: number;

  @ApiProperty({ description: "Client-measured duration in milliseconds" })
  @IsInt() @Min(0) @Max(86_400_000)
  durationMs!: number;

  @ApiProperty({
    type: [TelemetryFrame],
    description: "Ordered input/score frames. The server replays these to recompute the score.",
  })
  /* The client caps itself at 2,000 frames; the server did not, so a 256 kB
   * body could carry ~10,000, each running a nested validator pass and all of
   * them copied verbatim into the Redis job payload. */
  @IsArray() @ArrayMaxSize(2_000) @ValidateNested({ each: true }) @Type(() => TelemetryFrame)
  telemetry!: TelemetryFrame[];
}

export class SubmitSessionResponse {
  @ApiProperty() ref!: string;
  @ApiProperty({ enum: SESSION_STATUSES }) status!: SessionStatus;
  @ApiProperty({
    description: "True when validation was queued. Points appear once the server has replayed the session.",
  })
  queued!: boolean;
  @ApiProperty({ description: "What the client claimed, echoed for transparency" }) clientScore!: number;
}

export class SessionResponse {
  @ApiProperty() ref!: string;
  @ApiProperty() gameId!: string;
  @ApiProperty({ enum: SESSION_MODES }) mode!: SessionMode;
  @ApiProperty({ enum: SESSION_STATUSES }) status!: SessionStatus;
  @ApiProperty() startedAt!: string;
  @ApiPropertyOptional({ nullable: true }) endedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) durationMs!: number | null;
  @ApiPropertyOptional({ nullable: true, description: "What the client claimed" })
  clientScore!: number | null;
  @ApiPropertyOptional({ nullable: true, description: "What the server computed. Points come from this." })
  serverScore!: number | null;
  @ApiProperty() pointsAwarded!: number;
  @ApiPropertyOptional({ nullable: true, description: "Why the session earned nothing" })
  rejectionReason!: string | null;
  @ApiPropertyOptional({ type: [String], nullable: true, description: "Anti-cheat heuristics that fired" })
  anomalyFlags!: string[] | null;
}

export class SessionQuery extends DateRangeQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID()
  gameId?: string;

  @ApiPropertyOptional({ enum: SESSION_STATUSES })
  @IsOptional() @IsIn(SESSION_STATUSES)
  status?: SessionStatus;
}

export class ValidationOutcomeResponse {
  @ApiProperty() ref!: string;
  @ApiProperty({ description: "Who played it — the queue needs this to advance quests and boards" })
  userId!: string;
  @ApiProperty() gameId!: string;
  @ApiProperty({ enum: SESSION_STATUSES }) status!: SessionStatus;
  @ApiPropertyOptional({ nullable: true }) serverScore!: number | null;
  @ApiProperty() pointsAwarded!: number;
  @ApiProperty({ description: "Points refused by a cap. Never carried over." }) pointsCapped!: number;
  @ApiPropertyOptional({ nullable: true }) cappedBy!: string | null;
  @ApiProperty({ type: [String] }) anomalyFlags!: string[];
  @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;
}

/* --------------------------------- admin ---------------------------------- */

export class UpsertGameRequest {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(64)
  slug!: string;

  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120)
  title!: string;

  @ApiProperty() @IsString() @MinLength(2) @MaxLength(40)
  genre!: string;

  @ApiProperty() @IsString() @MinLength(10) @MaxLength(2_000)
  blurb!: string;

  @ApiProperty() @IsInt() @Min(0) @Max(360)
  thumbnailHue!: number;

  @ApiProperty() @IsInt() @Min(0) @Max(1_000_000)
  pointsPerSessionMin!: number;

  @ApiProperty() @IsInt() @Min(0) @Max(1_000_000)
  pointsPerSessionMax!: number;

  @ApiProperty({ enum: ENTRY_TYPES })
  @IsIn(ENTRY_TYPES)
  entryType!: EntryType;

  @ApiProperty() @IsNumberString()
  entryFee!: string;

  @ApiProperty({ description: "Per-member daily Points ceiling for this title" })
  @IsInt() @Min(0) @Max(10_000_000)
  dailyPointsCap!: number;

  @ApiProperty({ description: "Ceiling for a single session" })
  @IsInt() @Min(0) @Max(1_000_000)
  sessionPointsCap!: number;

  @ApiProperty() @IsBoolean()
  active!: boolean;

  @ApiProperty({ description: "Reason for the change — recorded in the audit trail" })
  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}

export class AdminSessionQuery extends SessionQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: "Only sessions where an anti-cheat heuristic fired" })
  @IsOptional() @IsBoolean()
  flaggedOnly?: boolean;
}
