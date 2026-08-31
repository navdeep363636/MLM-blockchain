import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
} from "class-validator";
import { DateRangeQuery, PaginationQuery } from "@/common/dto";
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
  @IsIn(APPROVAL_KINDS)
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
  @IsOptional() @IsIn(APPROVAL_STATUSES)
  status?: ApprovalStatus;

  @ApiPropertyOptional({ enum: APPROVAL_KINDS })
  @IsOptional() @IsIn(APPROVAL_KINDS)
  kind?: ApprovalKind;

  @ApiPropertyOptional({ description: "Only requests this actor may decide (excludes their own)" })
  @IsOptional() @IsBoolean()
  decidableByMe?: boolean;
}

/* ------------------------------ member state ------------------------------ */

export class ChangeUserStatusRequest {
  @ApiProperty({ enum: USER_STATUSES })
  @IsIn(USER_STATUSES)
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

  /* ---- operations dashboard figures -------------------------------------- *
   * Everything below is for the dashboard's charts and tiles. They are on this
   * response rather than a second endpoint because a dashboard that renders in
   * two round trips renders twice, and an operator reading a half-updated
   * screen is exactly the failure this page exists to prevent. */

  @ApiProperty({ description: "Members with a validated session today, UTC" })
  activeMembersToday!: number;

  @ApiProperty({ description: "Points credited in the last 30 days" }) pointsIssued30d!: string;

  @ApiProperty({
    description:
      "Total MTT the platform owes members across every bucket. This is a " +
      "liability, not a token supply figure — the two are different numbers and " +
      "conflating them is how a treasury looks solvent when it is not.",
  })
  mttLiability!: string;

  @ApiProperty({ description: "MTT staked across all pools" }) mttStaked!: string;

  @ApiProperty({ description: "Confirmed pool funding not yet committed to a payout, MTT" })
  treasuryHeadroomMtt!: string;

  @ApiProperty({ description: "Withdrawals not yet in a terminal state" })
  pendingWithdrawals!: number;

  @ApiProperty({ description: "MTT held against those withdrawals" })
  pendingWithdrawalsMtt!: string;

  @ApiProperty({ description: "KYC submissions awaiting a reviewer" }) openKycQueue!: number;

  @ApiProperty({ description: "Support tickets not resolved or closed" }) openTickets!: number;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Released commission over reconciled net revenue this month, as a " +
      "percentage. Null when there is no revenue — 0% would read as healthy.",
  })
  commissionPayoutRatioPct!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Confirmed pool transfers over reconciled Treasury inflow this month. Not " +
      "summable with commissionPayoutRatioPct — commission is paid FROM the transfer.",
  })
  outflowRatioPct!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "Share of committed commission covered by confirmed funding, capped at 100.",
  })
  revenueFundedPct!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Change in today's active members against yesterday, as a percentage. Null " +
      "when yesterday had none to compare against — a platform's first day is not " +
      "0% growth, it has no growth figure at all, and rendering one is a lie the " +
      "dashboard would repeat every morning.",
  })
  activeTodayDeltaPct!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "Change in 30-day actives against the preceding 30 days. Null on the same basis.",
  })
  active30dDeltaPct!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Confirmed transfers to the STAKING pools over reconciled inflow this month. " +
      "Reported separately from outflowRatioPct, which covers every destination.",
  })
  stakingOutflowRatioPct!: number | null;
}


/* ============================================================================
 * Member and staff directories.
 *
 * The member list is the back-office's most-used screen and its most dangerous:
 * it is a searchable index of every person on the platform. Two consequences are
 * built into the contract below.
 *
 * IT IS NOT A DATA EXPORT. `email` and `phone` come back masked. An operator
 * triaging a ticket needs to confirm they have the right account, which a mask
 * does; reading ten thousand addresses off a list is not a support task, and the
 * unmasked value is available on the member's own record where the read is
 * attributable to one person and one reason.
 *
 * IT DOES NOT CARRY BALANCES. A directory row with money on it would put every
 * member's holdings behind one search box. Balances have their own endpoint.
 * ========================================================================== */

export const MEMBER_SORTS = ["createdAt", "lastActiveAt", "riskScore", "status"] as const;

export class MemberQuery extends DateRangeQuery {
  @ApiPropertyOptional({
    enum: ["unverified", "verified_kyc_pending", "active", "suspended", "frozen", "closed"],
  })
  @IsOptional() @IsString() @MaxLength(32)
  status?: string;

  @ApiPropertyOptional({
    enum: [0, 1, 2],
    description: "Verification tier. Numeric because the tier IS a level — 2 grants what 1 does and more.",
  })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2)
  kycTier?: number;

  @ApiPropertyOptional({ description: "ISO 3166-1 alpha-2" })
  @IsOptional() @IsString() @MaxLength(2)
  country?: string;

  @ApiPropertyOptional({ description: "Only members at or above this risk score" })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100)
  minRiskScore?: number;
}

export class MemberSummaryResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ description: "Human-facing reference, safe to quote to the member" }) ref!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ description: "Masked — a•••@example.com" }) email!: string;
  @ApiPropertyOptional({ nullable: true, description: "Masked to the last two digits" })
  phone!: string | null;
  @ApiPropertyOptional({ nullable: true }) country!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty({
    enum: [0, 1, 2],
    description:
      "Verification tier only. Whether a submission is pending or was rejected is " +
      "the state of a SUBMISSION, not of the member, and lives on the KYC queue.",
  })
  kycTier!: number;
  @ApiProperty() twoFactorEnabled!: boolean;
  @ApiPropertyOptional({ nullable: true, description: "Truncated: 0x1234…abcd" })
  walletAddress!: string | null;
  @ApiPropertyOptional({ nullable: true }) walletType!: string | null;
  @ApiProperty() referralCode!: string;
  @ApiProperty({ description: "Whether this member was referred, not by whom" })
  wasReferred!: boolean;
  @ApiProperty() joinedAt!: string;
  @ApiPropertyOptional({ nullable: true }) lastActiveAt!: string | null;
  @ApiProperty({ description: "0-100 from the fraud engine" }) riskScore!: number;
  @ApiProperty({ isArray: true, type: String }) riskFlags!: string[];
}

export class StaffMemberResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: "Unmasked: staff addresses are work addresses" }) email!: string;
  @ApiProperty({ enum: ["support", "compliance", "finance_admin", "super_admin"] }) role!: string;
  @ApiProperty({
    description:
      "Whether this account can act as a second approver. Requires 2FA — an " +
      "approver without it is a single stolen password away from being both pairs of eyes.",
  })
  twoFactorEnabled!: boolean;
  @ApiPropertyOptional({ nullable: true }) lastActiveAt!: string | null;
  @ApiProperty() active!: boolean;
}

export class StaffIdentityResponse {
  @ApiProperty({ type: StaffMemberResponse }) me!: StaffMemberResponse;
  @ApiProperty({
    isArray: true, type: String,
    description: "Effective permission strings for this role, e.g. `withdrawal:approve`.",
  })
  permissions!: string[];
  @ApiProperty({ type: RolePermissionResponse, isArray: true })
  modules!: RolePermissionResponse[];
  @ApiProperty({
    type: StaffMemberResponse, isArray: true,
    description:
      "Colleagues who may act as this operator's second approver: active, 2FA " +
      "enabled, and not themselves. The server decides this so the UI cannot " +
      "offer a four-eyes violation.",
  })
  approvers!: StaffMemberResponse[];
  @ApiProperty({ description: "Server time, so SLA countdowns do not depend on the operator's clock" })
  serverTime!: string;
}
