import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, RequirePermissions, StaffOnly, type AuthUser } from "@/common/decorators";
import { ReportsService } from "./reports.service";
import {
  PayoutRatioQuery, PayoutRatioResponse, ReportRequest, ReportResponse,
} from "./dto/reports.dto";

/* ============================================================================
 * Reporting (FRD AD-12).
 *
 * Reports are staff-only and every generation is audited: a report of member
 * financial data is a disclosure, and who ran it over what window is worth
 * recording.
 * ========================================================================== */

@ApiTags("admin: reports")
@StaffOnly("compliance", "finance_admin", "super_admin")
@Controller("admin/reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @RequirePermissions("report:generate")
  @ApiOperation({
    summary: "Generate a report",
    description:
      "Every response states its own basis, its window and whether it hit the row cap. Defaults " +
      "to the trailing month — an unbounded default would make this a way to read the whole database.",
  })
  @ApiOkResponse({ type: ReportResponse })
  generate(
    @Body() dto: ReportRequest,
    @CurrentUser() actor: AuthUser,
  ): Promise<ReportResponse> {
    return this.reports.generate(dto, actor.id);
  }

  @Get("payout-ratio")
  @ApiOperation({
    summary: "The payout ratio for a period",
    description:
      "Commission released or claimed against RECONCILED net revenue. `withinPolicy` false means " +
      "the platform paid out more than it took in — the single most important compliance figure.",
  })
  @ApiOkResponse({ type: PayoutRatioResponse })
  payoutRatio(@Query() q: PayoutRatioQuery): Promise<PayoutRatioResponse> {
    return this.reports.payoutRatio(q.period);
  }
}
