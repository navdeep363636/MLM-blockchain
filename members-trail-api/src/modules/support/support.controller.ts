import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClientIp, CurrentUser, RequirePermissions, StaffOnly, type AuthUser } from "@/common/decorators";
import type { Paginated } from "@/common/dto";
import { SupportService } from "./support.service";
import {
  AddMessageRequest, AdminTicketQuery, AgentReplyRequest, AssignTicketRequest, CreateTicketRequest,
  RateTicketRequest, ResolveTicketRequest, SetPriorityRequest, SlaReportResponse,
  TicketDetailResponse, TicketQuery, TicketResponse,
} from "./dto/support.dto";

/* ============================================================================
 * Support, member side (FRD N-02).
 *
 * `financialDispute` appears in every response and is never accepted as input.
 * A withdrawal or commission complaint is classified as one by the server, gets
 * the tighter SLA, and can only be handled by compliance-trained staff.
 * ========================================================================== */

@ApiTags("support")
@ApiBearerAuth()
@Controller("support")
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post("tickets")
  @HttpCode(201)
  @ApiOperation({
    summary: "Open a support ticket",
    description:
      "The category sets the priority and the SLA. Withdrawal, commission and KYC tickets are " +
      "classified as financial disputes by the server and routed accordingly.",
  })
  @ApiOkResponse({ type: TicketDetailResponse })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTicketRequest,
    @ClientIp() ip: string,
  ): Promise<TicketDetailResponse> {
    return this.support.create(user.id, dto, ip);
  }

  @Get("tickets")
  @ApiOperation({ summary: "The member's tickets" })
  list(
    @CurrentUser() user: AuthUser,
    @Query() q: TicketQuery,
  ): Promise<Paginated<TicketResponse>> {
    return this.support.list(user.id, q);
  }

  @Get("tickets/:ref")
  @ApiOperation({
    summary: "One ticket with its thread",
    description: "Internal agent notes are never returned here.",
  })
  @ApiOkResponse({ type: TicketDetailResponse })
  detail(@CurrentUser() user: AuthUser, @Param("ref") ref: string): Promise<TicketDetailResponse> {
    return this.support.detail(user.id, ref);
  }

  @Post("tickets/:ref/messages")
  @HttpCode(201)
  @ApiOperation({ summary: "Reply to your ticket" })
  @ApiOkResponse({ type: TicketDetailResponse })
  reply(
    @CurrentUser() user: AuthUser,
    @Param("ref") ref: string,
    @Body() dto: AddMessageRequest,
  ): Promise<TicketDetailResponse> {
    return this.support.reply(user.id, ref, dto.body);
  }

  @Patch("tickets/:ref/rate")
  @ApiOperation({ summary: "Rate a resolved ticket" })
  @ApiOkResponse({ type: TicketResponse })
  rate(
    @CurrentUser() user: AuthUser,
    @Param("ref") ref: string,
    @Body() dto: RateTicketRequest,
  ): Promise<TicketResponse> {
    return this.support.rate(user.id, ref, dto.rating);
  }
}

/* ============================================================================
 * Support administration (FRD AD-13).
 *
 * The queue orders itself by risk: financial disputes first, then by SLA
 * deadline. `breachedOnly` is the list that needs attention right now.
 * ========================================================================== */

@ApiTags("admin: support")
@StaffOnly("support", "compliance", "finance_admin", "super_admin")
@Controller("admin/support")
export class SupportAdminController {
  constructor(private readonly support: SupportService) {}

  @Get("tickets")
  @ApiOperation({
    summary: "The support queue, financial disputes first",
    description: "Use breachedOnly=true for tickets past their SLA with no first response.",
  })
  list(@Query() q: AdminTicketQuery): Promise<Paginated<TicketResponse & { userId: string }>> {
    return this.support.adminList(q);
  }

  @Get("tickets/:ref")
  @ApiOperation({ summary: "The full thread including internal notes" })
  detail(@Param("ref") ref: string) {
    return this.support.adminDetail(ref);
  }

  @Post("tickets/:ref/messages")
  @HttpCode(201)
  @ApiOperation({
    summary: "Reply to a member, or add an internal note",
    description:
      "A non-internal reply stamps the first-response time and notifies the member. An internal " +
      "note deliberately does neither — writing a note to yourself is not a response.",
  })
  reply(
    @Param("ref") ref: string,
    @Body() dto: AgentReplyRequest,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.support.agentReply(ref, dto, actor.id);
  }

  @Patch("tickets/:ref/assign")
  @ApiOperation({
    summary: "Assign a ticket to an agent",
    description:
      "Refuses to assign a financial dispute to staff who are not compliance-trained. Assignment " +
      "never moves the SLA deadline.",
  })
  @ApiOkResponse({ type: TicketResponse })
  assign(
    @Param("ref") ref: string,
    @Body() dto: AssignTicketRequest,
    @CurrentUser() actor: AuthUser,
  ): Promise<TicketResponse> {
    return this.support.assign(ref, dto.assigneeId, actor.id);
  }

  @Patch("tickets/:ref/escalate")
  @ApiOperation({ summary: "Escalate a ticket with a recorded reason" })
  @ApiOkResponse({ type: TicketResponse })
  escalate(
    @Param("ref") ref: string,
    @Body() dto: { reason: string },
    @CurrentUser() actor: AuthUser,
  ): Promise<TicketResponse> {
    return this.support.escalate(ref, dto.reason, actor.id);
  }

  @Patch("tickets/:ref/resolve")
  @ApiOperation({ summary: "Resolve a ticket, posting the resolution to the member" })
  @ApiOkResponse({ type: TicketResponse })
  resolve(
    @Param("ref") ref: string,
    @Body() dto: ResolveTicketRequest,
    @CurrentUser() actor: AuthUser,
  ): Promise<TicketResponse> {
    return this.support.resolve(ref, dto.resolution, actor.id);
  }

  @Patch("tickets/:ref/priority")
  @ApiOperation({ summary: "Change a ticket's priority" })
  @ApiOkResponse({ type: TicketResponse })
  priority(
    @Param("ref") ref: string,
    @Body() dto: SetPriorityRequest,
    @CurrentUser() actor: AuthUser,
  ): Promise<TicketResponse> {
    return this.support.setPriority(ref, dto.priority, dto.reason, actor.id);
  }

  @Get("sla")
  @ApiOperation({
    summary: "SLA dashboard",
    description:
      "`breached` counts open tickets past their deadline with NO first response — the only " +
      "definition that measures what the member experienced.",
  })
  @ApiOkResponse({ type: SlaReportResponse })
  sla(): Promise<SlaReportResponse> {
    return this.support.slaReport();
  }

  @Post("escalate-breached")
  @RequirePermissions("support:escalate")
  @ApiOperation({
    summary: "Escalate every ticket that breached its SLA with no response",
    description: "Normally driven by the cron; exposed for operations.",
  })
  escalateBreached(): Promise<number> {
    return this.support.escalateBreached();
  }
}
