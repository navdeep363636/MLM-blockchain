import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { PaginationQuery } from "@/common/dto";

/* ============================================================================
 * Referral network DTOs (FRD R-01 … R-03).
 *
 * PRIVACY IS STRUCTURAL HERE. A member sees their downline as anonymised labels
 * and activity signals — never a name, email or handle. Exposing identities
 * would turn the referral tree into a contact list for pressuring people, which
 * is exactly the dynamic that makes these programmes harmful.
 * ========================================================================== */

export class ReferralCodeResponse {
  @ApiProperty() code!: string;
  @ApiProperty({ description: "Share link containing the code" }) link!: string;
  @ApiProperty({ description: "How many members joined with this code" }) directJoins!: number;
}

export class DownlineMemberResponse {
  @ApiProperty({ description: "Anonymised label — identity is never exposed (R-02)" })
  label!: string;
  @ApiProperty({ enum: [1, 2, 3] }) level!: number;
  @ApiProperty({ description: "UTC date they joined" }) joinedAt!: string;
  @ApiProperty({ description: "True when they have played a validated session in the last 30 days" })
  active!: boolean;
  @ApiProperty({ description: "Commission this member has generated for you, in MTT" })
  earnedFromMtt!: string;
  @ApiProperty({ description: "Whether they have completed identity verification" })
  verified!: boolean;
}

export class DownlineQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: [1, 2, 3], description: "Filter to one tier" })
  @IsOptional() @IsInt() @Min(1) @Max(3)
  level?: number;
}

export class LevelBreakdown {
  @ApiProperty({ enum: [1, 2, 3] }) level!: number;
  @ApiProperty() members!: number;
  @ApiProperty({ description: "Members with a validated session in the last 30 days" })
  activeMembers!: number;
  @ApiProperty() earnedMtt!: string;
  @ApiProperty({ description: "Rate applied at this level under the active plan" }) rateBps!: number;
}

export class ReferralStatsResponse {
  @ApiProperty() code!: string;
  @ApiProperty() link!: string;
  @ApiProperty({ description: "Total across all three tiers" }) totalDownline!: number;
  @ApiProperty() activeDownline!: number;
  @ApiProperty({ type: [LevelBreakdown] }) levels!: LevelBreakdown[];
  @ApiProperty() lifetimeEarnedMtt!: string;
  @ApiProperty() claimableMtt!: string;
  @ApiProperty({ description: "Accrued but not released — awaiting KYC or pool funding" })
  pendingMtt!: string;
  @ApiProperty({ description: "Maximum depth under the active plan. Never more than 3." })
  maxDepth!: number;
  @ApiPropertyOptional({ nullable: true, description: "Null when no plan is in force" })
  planVersion!: number | null;
}
