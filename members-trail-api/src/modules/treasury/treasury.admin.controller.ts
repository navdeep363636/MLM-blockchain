import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, RequirePermissions, StaffOnly, type AuthUser } from "@/common/decorators";
import { TreasuryService } from "./treasury.service";
import {
  ApproveOutflowDto, InflowQuery, OutflowQuery, ProposeOutflowDto, ReconcileBatchDto,
} from "./dto/treasury.dto";

/**
 * AD-08 Revenue Treasury Management.
 *
 * The FRD calls this page "the compliance backbone of the entire platform", and
 * the controlling rule is on `POST outflows/propose`: it refuses outright when
 * the amount exceeds reconciled inflow for the period.
 */
@ApiTags("treasury")
@Controller("admin/treasury")
@StaffOnly("finance_admin", "super_admin")
export class TreasuryAdminController {
  constructor(private readonly treasury: TreasuryService) {}

  @Get("dashboard")
  @ApiOperation({
    summary: "Treasury KPIs for a period",
    description:
      "Includes payoutRatioBps — the single most important compliance KPI. " +
      "Bands: safe < 7500, watch 7500–8999, escalate 9000–9999, breach >= 10000.",
  })
  dashboard(@Query("periodKey") periodKey?: string) {
    return this.treasury.dashboard(periodKey);
  }

  @Get("headroom/:periodKey")
  @ApiOperation({ summary: "Reconciled inflow, prior outflow and remaining headroom" })
  headroom(@Param("periodKey") periodKey: string) {
    return this.treasury.headroom(periodKey);
  }

  @Get("inflows")
  @ApiOperation({ summary: "Inflow ledger with reconciliation status" })
  inflows(@Query() q: InflowQuery) {
    return this.treasury.listInflows(q);
  }

  @Get("outflows")
  @ApiOperation({ summary: "Outflow ledger with on-chain tx hashes" })
  outflows(@Query() q: OutflowQuery) {
    return this.treasury.listOutflows(q);
  }

  @Post("reconcile")
  @RequirePermissions("treasury:write")
  @ApiOperation({
    summary: "Reconcile a settlement batch",
    description:
      "Matches reported revenue against the processor's settlement total. A mismatch " +
      "is rejected rather than reconciled — an unexplained difference must block " +
      "downstream payouts.",
  })
  reconcile(@Body() dto: ReconcileBatchDto, @CurrentUser() user: AuthUser) {
    return this.treasury.reconcileBatch(dto, user.id);
  }

  @Post("outflows/propose")
  @RequirePermissions("treasury:write")
  @ApiOperation({
    summary: "Propose a funding transfer to a staking or commission pool",
    description:
      "Refuses with 403 TREASURY_HEADROOM_EXCEEDED when the amount exceeds reconciled " +
      "inflow for the period. Set fromReserve=true to draw the 15% Treasury Reserve " +
      "instead, which is exempt from the ceiling but recorded separately so the " +
      "published real-revenue-funded ratio stays accurate.",
  })
  propose(@Body() dto: ProposeOutflowDto, @CurrentUser() user: AuthUser) {
    return this.treasury.proposeOutflow(dto, user.id);
  }

  @Post("outflows/:id/approve")
  @RequirePermissions("treasury:approve")
  @ApiOperation({
    summary: "Co-sign a proposed transfer",
    description:
      "Four-eyes: the proposer cannot approve, and two distinct approvers are required. " +
      "Headroom is re-checked at approval time in case a refund has since un-reconciled inflow.",
  })
  approve(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ApproveOutflowDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.treasury.approveOutflow(id, dto, user.id);
  }

  @Post("rollup/:periodKey")
  @RequirePermissions("treasury:write")
  @ApiOperation({ summary: "Recompute a period's rollup on demand" })
  rollup(@Param("periodKey") periodKey: string) {
    return this.treasury.rollupPeriod(periodKey);
  }
}
