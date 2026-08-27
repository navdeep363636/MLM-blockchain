import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClientIp, CurrentUser, RequirePermissions, StaffOnly, type AuthUser } from "@/common/decorators";
import type { Paginated } from "@/common/dto";
import { AdminService } from "./admin.service";
import {
  ApprovalQuery, ApprovalResponse, AuditEntryResponse, AuditQuery, ChangeUserStatusRequest,
  CreateApprovalRequest, DecideApprovalRequest, MemberQuery, MemberSummaryResponse,
  PlatformKpisResponse, RolePermissionResponse, SetRolePermissionRequest, StaffIdentityResponse,
  StaffMemberResponse,
} from "./dto/admin.dto";

/* ============================================================================
 * Governance and operations (FRD AD-01, AD-02, AD-08).
 *
 * The dashboard's `attentionRequired` is the route that matters most day to day:
 * a list of counts tells an operator nothing about what to do next, so the API
 * names the things that need a human today.
 * ========================================================================== */

@ApiTags("admin: governance")
@StaffOnly("compliance", "finance_admin", "super_admin")
@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /* ------------------------------- dashboard ------------------------------ */

  @Get("kpis")
  @ApiOperation({
    summary: "Operations dashboard",
    description:
      "`attentionRequired` names what needs a human today. An insolvent commission pool is " +
      "reported first — it is a release blocker, not a metric.",
  })
  @ApiOkResponse({ type: PlatformKpisResponse })
  kpis(): Promise<PlatformKpisResponse> {
    return this.admin.kpis();
  }

  /* ------------------------------- approvals ------------------------------ */

  @Get("approvals")
  @ApiOperation({
    summary: "Dual-control queue",
    description:
      "Pass decidableByMe=true for the requests you may actually decide — it excludes your own, " +
      "so the UI cannot offer you a four-eyes violation.",
  })
  approvals(
    @Query() q: ApprovalQuery,
    @CurrentUser() actor: AuthUser,
  ): Promise<Paginated<ApprovalResponse>> {
    return this.admin.listApprovals(q, actor.id);
  }

  @Post("approvals")
  @ApiOperation({
    summary: "Raise a request for a second approver",
    description: "Expires after 72 hours: a stale approval must not be applied months later.",
  })
  @ApiOkResponse({ type: ApprovalResponse })
  request(
    @Body() dto: CreateApprovalRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<ApprovalResponse> {
    return this.admin.requestApproval(dto, actor.id, ip);
  }

  @Patch("approvals/:ref/decide")
  @RequirePermissions("approvals:approve")
  @ApiOperation({
    summary: "Approve or reject a request",
    description:
      "Refuses when the decider raised it, and when it has expired — the expiry is enforced here, " +
      "not just displayed.",
  })
  @ApiOkResponse({ type: ApprovalResponse })
  decide(
    @Param("ref") ref: string,
    @Body() dto: DecideApprovalRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<ApprovalResponse> {
    return this.admin.decide(ref, dto, actor.id, ip);
  }

  @Patch("approvals/:ref/applied")
  @RequirePermissions("approvals:approve")
  @ApiOperation({
    summary: "Record that an approved change actually took effect",
    description: "Approving and applying are different acts — the record needs to show which happened.",
  })
  @ApiOkResponse({ type: ApprovalResponse })
  applied(
    @Param("ref") ref: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<ApprovalResponse> {
    return this.admin.markApplied(ref, actor.id);
  }

  @Post("approvals/expire-stale")
  @RequirePermissions("approvals:approve")
  @ApiOperation({ summary: "Sweep requests past their deadline" })
  expireStale(): Promise<number> {
    return this.admin.expireStaleApprovals();
  }

  /* -------------------------------- identity ------------------------------ */

  @Get("me")
  @ApiOperation({
    summary: "The operator's own staff record, permissions and eligible second approvers",
    description:
      "The approver list is computed server-side. The client asking who may " +
      "second-approve and the server deciding whether an approval is valid have " +
      "to agree, so only one of them gets to decide — and a UI that offered the " +
      "requester themselves would be a control failure, not a display bug.",
  })
  @ApiOkResponse({ type: StaffIdentityResponse })
  me(@CurrentUser() actor: AuthUser): Promise<StaffIdentityResponse> {
    return this.admin.staffIdentity(actor.id);
  }

  @Get("staff")
  @RequirePermissions("config:read")
  @ApiOperation({ summary: "The staff directory" })
  @ApiOkResponse({ type: StaffMemberResponse, isArray: true })
  staff(): Promise<StaffMemberResponse[]> {
    return this.admin.listStaff();
  }

  /* ------------------------------- directory ------------------------------ */

  @Get("members")
  @RequirePermissions("members:read")
  @ApiOperation({
    summary: "Member directory",
    description:
      "Contact details are masked and no balances are included. Search covers the " +
      "reference, display name and referral code — not email or phone, which are " +
      "stored hashed precisely so that a LIKE over every member's contact details " +
      "is not a query an operator can run casually.",
  })
  @ApiOkResponse({ type: MemberSummaryResponse, isArray: true })
  members(@Query() q: MemberQuery): Promise<Paginated<MemberSummaryResponse>> {
    return this.admin.listMembers(q);
  }

  /* ------------------------------ member state ---------------------------- */

  @Patch("members/:userId/status")
  @RequirePermissions("members:write")
  @ApiOperation({
    summary: "Change a member's account status",
    description:
      "Only active, suspended, frozen and closed are settable — the verification states are " +
      "derived from KYC and must not be faked. The member is always notified.",
  })
  status(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() dto: ChangeUserStatusRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    return this.admin.changeUserStatus(userId, dto, actor.id, ip);
  }

  /* --------------------------------- RBAC --------------------------------- */

  @Get("permissions")
  @ApiOperation({ summary: "The role/module permission matrix" })
  @ApiOkResponse({ type: [RolePermissionResponse] })
  permissions(): Promise<RolePermissionResponse[]> {
    return this.admin.permissionMatrix();
  }

  @Put("permissions")
  @StaffOnly("super_admin")
  @RequirePermissions("config:write")
  @ApiOperation({
    summary: "Set one cell of the permission matrix",
    description: "Granting canApprove decides who can be the second pair of eyes, and is audited as such.",
  })
  @ApiOkResponse({ type: RolePermissionResponse })
  setPermission(
    @Body() dto: SetRolePermissionRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<RolePermissionResponse> {
    return this.admin.setPermission(dto, actor.id, ip);
  }

  /* ------------------------------ audit trail ----------------------------- */

  @Get("audit")
  @ApiOperation({
    summary: "The audit trail",
    description:
      "Read-only: there is no update or delete path, and the production grant is INSERT/SELECT. " +
      "An audit trail an operator can edit is not evidence of anything.",
  })
  audit(@Query() q: AuditQuery): Promise<Paginated<AuditEntryResponse>> {
    return this.admin.auditTrail(q);
  }
}
