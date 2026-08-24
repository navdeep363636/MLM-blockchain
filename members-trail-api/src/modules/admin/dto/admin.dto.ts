import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean, IsEnum, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength,
} from "class-validator";
import { PaginationQuery } from "@/common/dto";
import type { ApprovalKind, ApprovalStatus, UserStatus } from "@/database/entities";

/* ============================================================================
 * Governance DTOs (FRD AD-01, AD-02, AD-08).
 *
 * Every request here carries a mandatory `reason`. That is not bureaucracy: an
 * action that moves money or changes an account's state with no recorded
 * rationale is unreviewable a year later, which is precisely when someone asks.
 * ========================================================================== */

export const APPROVAL_KINDS: ApprovalKind[] = [
  "conversion_rate", "commission_plan", "treasury_outflow", "balance_adjustment",
  "points_rule", "staking_pool", "user_status", "legal_publish", "role_assignment",
];

export const APPROVAL_STATUSES: ApprovalStatus[] = [
  "pending", "approved", "rejected", "expired", "applied",
];

export const USER_STATUSES: UserStatus[] = [
  "pending_verification", "verified_kyc_pending", "active", "suspended", "frozen", "closed",
];

export class ApprovalResponse {
  @ApiProperty() ref!: string;
  @ApiProperty({ enum: APPROVAL_KINDS }) kind!: ApprovalKind;
  @ApiPropertyOptional({ nullable: true }) targetId!: string | null;
  @ApiProperty() payload!: Record<string, unknown>;
  @ApiProperty() reason!: string;
  @ApiProperty() requestedById!: string;
  @ApiPropertyOptional({ nullable: true }) approverId!: string | null;
  @ApiProperty({ enum: APPROVAL_STATUSES }) status!: ApprovalStatus;
  @ApiPropertyOptional({ nullable: true }) decisionNote!: string | null;
  @ApiPropertyOptional({ nullable: true }) decidedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) appliedAt!: string | null;
  @ApiProperty({ description: "Pending requests expire so a stale one cannot be applied later" })
  expiresAt!: string;
  @ApiProperty() expired!: boolean;
  @ApiProperty({ description: "True for actions policy says need a hardware key" })
  requiresHardwareKey!: boolean;
  @ApiProperty() createdAt!: string;
}

export class CreateApprovalRequest {
  @ApiProperty({ enum: APPROVAL_KINDS })
  @IsEnum(APPROVAL_KINDS)
  kind!: ApprovalKind;

  @ApiPropertyOptional({ description: "The entity this request acts on" })
  @IsOptional() @IsString() @MaxLength(64)
  targetId?: string;

  @ApiProperty({ description: "What will be applied if approved" })
  @IsObject()
  payload!: Record<string, unknown>;

  @ApiProperty({ description: "Why this is being requested" })
  @IsString() @MinLength(10) @MaxLength(2_000)
  reason!: string;
}

export class DecideApprovalRequest {
  @ApiProperty({ enum: ["approve", "reject"] })
  @IsIn(["approve", "reject"])
  decision!: "approve" | "reject";

  @ApiProperty({ description: "The approver's note. Required for both outcomes." })
  @IsString() @MinLength(5) @MaxLength(2_000)
  note!: string;
}

export class ApprovalQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: APPROVAL_STATUSES })
  @IsOptional() @IsEnum(APPROVAL_STATUSES)
  status?: ApprovalStatus;

  @ApiPropertyOptional({ enum: APPROVAL_KINDS })
  @IsOptional() @IsEnum(APPROVAL_KINDS)
  kind?: ApprovalKind;

  @ApiPropertyOptional({ description: "Only requests this actor may decide (excludes their own)" })
  @IsOptional() @IsBoolean()
  decidableByMe?: boolean;
}

/* ------------------------------ member state ------------------------------ */

export class ChangeUserStatusRequest {
  @ApiProperty({ enum: USER_STATUSES })
  @IsEnum(USER_STATUSES)
  status!: UserStatus;

  @ApiProperty({ description: "Shown to the member and recorded in the audit trail" })
  @IsString() @MinLength(10) @MaxLength(1_000)
  reason!: string;
}

/* --------------------------------- RBAC ----------------------------------- */

export class RolePermissionResponse {
  @ApiProperty() role!: string;
  @ApiProperty() module!: string;
  @ApiProperty() canRead!: boolean;
  @ApiProperty() canWrite!: boolean;
  @ApiProperty() canApprove!: boolean;
}

export class SetRolePermissionRequest {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(40)
  role!: string;

  @ApiProperty() @IsString() @MinLength(2) @MaxLength(60)
  module!: string;

  @ApiProperty() @IsBoolean() canRead!: boolean;
  @ApiProperty() @IsBoolean() canWrite!: boolean;
  @ApiProperty() @IsBoolean() canApprove!: boolean;

  @ApiProperty({ description: "Reason recorded in the audit trail" })
  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}

/* ------------------------------- audit trail ------------------------------ */

export class AuditQuery extends PaginationQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ description: "Dotted action prefix, e.g. \"treasury.\"" })
  @IsOptional() @IsString() @MaxLength(120)
  action?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60)
  targetType?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64)
  targetId?: string;

  @ApiPropertyOptional({ description: "Only entries that required a second approver" })
  @IsOptional() @IsBoolean()
  fourEyesOnly?: boolean;
}

export class AuditEntryResponse {
  @ApiProperty() ref!: string;
  @ApiPropertyOptional({ nullable: true }) actorId!: string | null;
  @ApiPropertyOptional({ nullable: true }) actorRole!: string | null;
  @ApiProperty() action!: string;
  @ApiPropertyOptional({ nullable: true }) targetType!: string | null;
  @ApiPropertyOptional({ nullable: true }) targetId!: string | null;
  @ApiPropertyOptional({ nullable: true }) before!: Record<string, unknown> | null;
  @ApiPropertyOptional({ nullable: true }) after!: Record<string, unknown> | null;
  @ApiPropertyOptional({ nullable: true }) reason!: string | null;
  @ApiProperty() requiredSecondApproval!: boolean;
  @ApiPropertyOptional({ nullable: true }) approvedById!: string | null;
  @ApiPropertyOptional({ nullable: true }) ip!: string | null;
  @ApiProperty() createdAt!: string;
}

/* -------------------------------- dashboard ------------------------------- */

export class PlatformKpisResponse {
  @ApiProperty() members!: number;
  @ApiProperty({ description: "Members with a validated session in the last 30 days" })
  activeMembers30d!: number;
  @ApiProperty() kycVerified!: number;
  @ApiProperty() frozen!: number;
  @ApiProperty({ description: "Withdrawals awaiting compliance review" }) withdrawalsInReview!: number;
  @ApiProperty({ description: "Open fraud alerts" }) openFraudAlerts!: number;
  @ApiProperty({ description: "Open support tickets past their SLA" }) breachedTickets!: number;
  @ApiProperty({ description: "Approval requests waiting for a second pair of eyes" })
  pendingApprovals!: number;
  @ApiProperty({
    description: "Commission calculated but not released for want of pool funding, in MTT",
  })
  queuedCommissionMtt!: string;
  @ApiProperty({ description: "The solvency invariant: released commission ≤ confirmed funding" })
  commissionSolvent!: boolean;
  @ApiProperty({ description: "Anything here needs a human today" }) attentionRequired!: string[];
}
