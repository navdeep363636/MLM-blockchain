import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator";
import type { AchievementTier, QuestKind } from "@/database/entities";

/* ============================================================================
 * Quest and achievement DTOs (FRD G-04).
 *
 * `rewardPoints` is what the quest promises; `pointsAwarded` is what was
 * actually credited. They differ when a daily Points cap intervened, and both
 * are exposed rather than one — a member who was capped is entitled to see it.
 * ========================================================================== */

export const QUEST_KINDS: QuestKind[] = ["daily", "weekly", "milestone"];
export const ACHIEVEMENT_TIERS: AchievementTier[] = ["bronze", "silver", "gold", "platinum"];

/** Objective metrics the tracker understands. Anything else never progresses. */
export const QUEST_METRICS = [
  "sessions", "score", "points", "wins", "tournaments", "conversions", "referrals",
] as const;
export type QuestMetric = (typeof QUEST_METRICS)[number];

export class QuestResponse {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: QUEST_KINDS }) kind!: QuestKind;
  @ApiPropertyOptional({ nullable: true, description: "Set when the quest is title-specific" })
  gameId!: string | null;
  @ApiProperty({ description: "Metric being counted" }) metric!: string;
  @ApiProperty() target!: number;
  @ApiProperty() progress!: number;
  @ApiProperty({ description: "0–100, clamped" }) progressPct!: number;
  @ApiProperty({ description: "Points the quest promises" }) rewardPoints!: number;
  @ApiProperty() completed!: boolean;
  @ApiProperty() claimed!: boolean;
  @ApiProperty({ description: "Points actually credited — lower than the reward if a cap intervened" })
  pointsAwarded!: number;
  @ApiProperty({ description: "UTC period this instance belongs to" }) periodKey!: string;
  @ApiPropertyOptional({ nullable: true, description: "When this instance stops being claimable" })
  expiresAt!: string | null;
  @ApiProperty({ description: "Seconds until it expires, 0 for milestones" }) expiresInSeconds!: number;
}

export class QuestListResponse {
  @ApiProperty({ type: [QuestResponse] }) daily!: QuestResponse[];
  @ApiProperty({ type: [QuestResponse] }) weekly!: QuestResponse[];
  @ApiProperty({ type: [QuestResponse] }) milestones!: QuestResponse[];
  @ApiProperty({ description: "Claimable now" }) readyToClaim!: number;
  @ApiProperty({ description: "Points claimable across every completed quest" })
  claimablePoints!: number;
}

export class ClaimQuestResponse {
  @ApiProperty() questId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ description: "Points the quest promised" }) rewardPoints!: number;
  @ApiProperty({ description: "Points actually credited" }) pointsAwarded!: number;
  @ApiProperty({ description: "Refused by a daily cap. Never carried over." }) pointsCapped!: number;
  @ApiPropertyOptional({ nullable: true }) cappedBy!: string | null;
  @ApiProperty() periodKey!: string;
}

export class AchievementResponse {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: ACHIEVEMENT_TIERS }) tier!: AchievementTier;
  @ApiProperty() rewardPoints!: number;
  @ApiProperty() unlocked!: boolean;
  @ApiPropertyOptional({ nullable: true }) unlockedAt!: string | null;
  @ApiProperty({ description: "Current value of the tracked metric" }) progress!: number;
  @ApiProperty() target!: number;
  @ApiProperty() pointsAwarded!: number;
}

export class AchievementSummaryResponse {
  @ApiProperty({ type: [AchievementResponse] }) achievements!: AchievementResponse[];
  @ApiProperty() unlockedCount!: number;
  @ApiProperty() totalCount!: number;
  @ApiProperty({ description: "Points earned from achievements so far" }) pointsEarned!: number;
}

/* --------------------------------- admin ---------------------------------- */

export class UpsertQuestRequest {
  @ApiPropertyOptional({ description: "Omit to create" })
  @IsOptional() @IsUUID()
  id?: string;

  @ApiProperty() @IsString() @MinLength(3) @MaxLength(160)
  title!: string;

  @ApiProperty() @IsString() @MinLength(10) @MaxLength(1_000)
  description!: string;

  @ApiProperty({ enum: QUEST_KINDS })
  @IsEnum(QUEST_KINDS)
  kind!: QuestKind;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  gameId?: string;

  @ApiProperty({ enum: QUEST_METRICS, description: "Metric the objective counts" })
  @IsIn(QUEST_METRICS)
  metric!: QuestMetric;

  @ApiProperty() @IsInt() @Min(1) @Max(1_000_000)
  target!: number;

  @ApiProperty({ description: "Points awarded on claim, subject to the daily caps" })
  @IsInt() @Min(1) @Max(1_000_000)
  rewardPoints!: number;

  @ApiProperty() @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}
