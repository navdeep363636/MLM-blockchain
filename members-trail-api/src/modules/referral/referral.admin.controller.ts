import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClientIp, CurrentUser, RequirePermissions, StaffOnly, type AuthUser } from "@/common/decorators";
import type { Paginated } from "@/common/dto";
import { CommissionService, type FanoutOutcome } from "./commission.service";
import { CommissionPlanService } from "./commission-plan.service";
import {
  AdminCommissionQuery, ClawbackRequest, CommissionResponse, DecidePlanRequest, PlanResponse,
  PlanSimulationResponse, ProposePlanRequest, RejectPlanRequest, SimulatePlanRequest,
  SolvencyResponse,
} from "./dto/commission.dto";

/* ============================================================================
 * Referral administration (FRD AD-07).
 *
 * The two routes that matter most:
 *
 *  • POST plans — a rate change, gated by four eyes AND by a solvency
 *    simulation that refuses to publish a plan projecting more liability than
 *    the Treasury takes in.
 *
 *  • GET solvency — the invariant, live: cumulative released commission against
 *    cumulative confirmed pool funding. If this ever reports solvent=false,
 *    releases stop until funding catches up.
 * ========================================================================== */

@ApiTags("admin: referral")
@StaffOnly("compliance", "finance_admin", "super_admin")
@Controller("admin/referral")
export class ReferralAdminController {
  constructor(
    private readonly commission: CommissionService,
    private readonly plans: CommissionPlanService,
  ) {}

  /* -------------------------------- plans --------------------------------- */

  @Get("plans")
  @ApiOperation({ summary: "Plan version history, newest first, including rejected proposals" })
  @ApiOkResponse({ type: [PlanResponse] })
  listPlans(): Promise<PlanResponse[]> {
    return this.plans.list();
  }

  @Get("plans/defaults")
  @ApiOperation({ summary: "Environment defaults, as a starting point for a first proposal" })
  defaults(): SimulatePlanRequest {
    return this.plans.defaults();
  }

  @Post("plans/simulate")
  @ApiOperation({
    summary: "Project a plan's liability against Treasury inflow before proposing it",
    description:
      "Monthly caps are ignored, so the figure is an upper bound. Per-level revenue is measured " +
      "from real upline coverage, not assumed.",
  })
  @ApiOkResponse({ type: PlanSimulationResponse })
  simulate(@Body() dto: SimulatePlanRequest): Promise<PlanSimulationResponse> {
    return this.plans.simulate(dto);
  }

  @Post("plans")
  @RequirePermissions("commission:plan:propose")
  @ApiOperation({
    summary: "Propose a new plan version — inert until a second approver signs off",
    description: "The simulation is computed and stored at proposal time so the approver reviews the same numbers.",
  })
  @ApiOkResponse({ type: PlanResponse })
  propose(
    @Body() dto: ProposePlanRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<PlanResponse> {
    return this.plans.propose(dto, actor.id, ip);
  }

  @Patch("plans/:id/approve")
  @RequirePermissions("commission:plan:approve")
  @ApiOperation({
    summary: "Approve a proposed plan",
    description:
      "Refuses with FOUR_EYES_VIOLATION if the approver proposed it, and with PLAN_INSOLVENT if " +
      "the projection exceeds Treasury inflow. The simulation is re-run at approval time.",
  })
  @ApiOkResponse({ type: PlanResponse })
  approve(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DecidePlanRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<PlanResponse> {
    return this.plans.approve(id, dto.note ?? null, actor.id, ip);
  }

  @Patch("plans/:id/reject")
  @RequirePermissions("commission:plan:approve")
  @ApiOperation({ summary: "Reject a proposed plan with a recorded reason" })
  @ApiOkResponse({ type: PlanResponse })
  reject(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RejectPlanRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<PlanResponse> {
    return this.plans.reject(id, dto.reason, actor.id, ip);
  }

  /* ----------------------------- commissions ------------------------------ */

  @Get("commissions")
  @ApiOperation({
    summary: "All commission rows, filterable by recipient, downline, status, level and month",
    description: "Includes rejected and capped rows — a refusal is recorded, not absent.",
  })
  list(@Query() q: AdminCommissionQuery): Promise<Paginated<CommissionResponse & { recipientId: string }>> {
    return this.commission.adminList(q);
  }

  @Get("solvency")
  @ApiOperation({
    summary: "The solvency invariant, live",
    description:
      "committed ≤ funded. `queuedMtt` is calculated commission the pool cannot yet fund; it is " +
      "a liability, not a commitment, and is reported separately for exactly that reason.",
  })
  @ApiOkResponse({ type: SolvencyResponse })
  solvency(): Promise<SolvencyResponse> {
    return this.commission.fundingAvailable();
  }

  @Post("release-queued")
  @RequirePermissions("commission:release")
  @ApiOperation({
    summary: "Release queued commission, oldest first, up to the pool's available funding",
    description: "Normally driven by the queue after a funding transfer confirms; exposed here for operations.",
  })
  releaseQueued(): Promise<{ released: number; releasedMtt: string; remaining: number }> {
    return this.commission.releaseQueued();
  }

  @Post("events/:revenueEventId/process")
  @RequirePermissions("commission:release")
  @ApiOperation({
    summary: "Fan a settled revenue event out to its upline",
    description:
      "Idempotent. Refuses unreconciled or non-eligible revenue with a reason rather than paying " +
      "optimistically.",
  })
  process(@Param("revenueEventId", ParseUUIDPipe) revenueEventId: string): Promise<FanoutOutcome> {
    return this.commission.processRevenueEvent(revenueEventId);
  }

  @Patch("commissions/:id/clawback")
  @RequirePermissions("commission:clawback")
  @ApiOperation({
    summary: "Reverse one commission after a fraud finding",
    description:
      "Reclaims from the least-liquid bucket first and returns the cap allowance. A shortfall is " +
      "recorded and alerted rather than forcing the balance negative.",
  })
  @ApiOkResponse({ type: CommissionResponse })
  clawback(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ClawbackRequest,
    @CurrentUser() actor: AuthUser,
  ): Promise<CommissionResponse> {
    return this.commission.clawbackOne(id, dto.reason, actor.id);
  }
}
