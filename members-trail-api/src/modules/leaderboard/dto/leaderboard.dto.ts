import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";
import { Type } from "class-transformer";

/* ============================================================================
 * Leaderboard DTOs (FRD G-05).
 *
 * A leaderboard is the one place a member's chosen display name is shown to
 * other members — that is the point of one, and playing a ranked mode is the
 * opt-in. It is deliberately different from the referral downline, where
 * identity is never exposed: there, the member did not choose to be listed.
 * ========================================================================== */

/** Metrics a board can rank on. Anything else is refused rather than guessed. */
export const LEADERBOARD_METRICS = ["points", "score", "sessions", "wins"] as const;
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];

/** Periods a board can cover. All UTC. */
export const LEADERBOARD_PERIODS = ["daily", "weekly", "monthly", "all_time"] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

export class LeaderboardQuery {
  @ApiPropertyOptional({ enum: LEADERBOARD_METRICS, default: "points" })
  @IsOptional() @IsIn(LEADERBOARD_METRICS)
  metric?: LeaderboardMetric;

  @ApiPropertyOptional({ enum: LEADERBOARD_PERIODS, default: "weekly" })
  @IsOptional() @IsIn(LEADERBOARD_PERIODS)
  period?: LeaderboardPeriod;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: "Restrict to one title" })
  @IsOptional() @IsUUID()
  gameId?: string;
}

export class LeaderboardRow {
  @ApiProperty() rank!: number;
  @ApiProperty({ description: "The member's chosen display name" }) displayName!: string;
  @ApiProperty() score!: number;
  @ApiProperty({ description: "True for the caller's own row" }) isYou!: boolean;
}

export class LeaderboardResponse {
  @ApiProperty({ enum: LEADERBOARD_METRICS }) metric!: LeaderboardMetric;
  @ApiProperty({ enum: LEADERBOARD_PERIODS }) period!: LeaderboardPeriod;
  @ApiProperty({ description: "UTC period key the board covers" }) periodKey!: string;
  @ApiProperty({ type: [LeaderboardRow] }) rows!: LeaderboardRow[];
  @ApiPropertyOptional({
    type: LeaderboardRow,
    nullable: true,
    description: "The caller's row, returned even when it falls outside the visible page",
  })
  you!: LeaderboardRow | null;
  @ApiProperty({ description: "Members ranked in this period" }) totalRanked!: number;
  @ApiProperty({ description: "Seconds until the period resets, 0 for all-time" })
  resetsInSeconds!: number;
  @ApiProperty({
    description: "\"live\" when served from the live index, \"snapshot\" when served from persisted history",
  })
  source!: "live" | "snapshot";
}

export class SnapshotResultResponse {
  @ApiProperty() metric!: string;
  @ApiProperty() periodKey!: string;
  @ApiProperty({ description: "Rows persisted" }) persisted!: number;
}
