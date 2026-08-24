import { Body, Controller, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClientIp, CurrentUser, RequirePermissions, StaffOnly, type AuthUser } from "@/common/decorators";
import type { Paginated } from "@/common/dto";
import { FraudService, type SweepResult } from "./fraud.service";
import {
  AlertQuery, AlertResponse, AssignAlertRequest, FraudRuleResponse, ResolveAlertRequest,
  SweepResultResponse, UpsertRuleRequest,
} from "./dto/fraud.dto";

/* ============================================================================
 * Fraud review (FRD AD-14).
 *
 * There is no player-facing controller here by design: a member should not be
 * able to enumerate which detections exist, or learn from a response that they
 * tripped one. What they see is the outcome — a payout in review, or an account
 * hold with a support route — never the rule.
 * ========================================================================== */

@ApiTags("admin: fraud")
@StaffOnly("compliance", "super_admin")
@Controller("admin/fraud")
export class FraudAdminController {
  constructor(private readonly fraud: FraudService) {}

  @Get("alerts")
  @ApiOperation({
    summary: "Alert queue, highest risk first",
    description: "Each alert carries the signals and evidence that produced it, so a reviewer can disagree.",
  })
  alerts(@Query() q: AlertQuery): Promise<Paginated<AlertResponse>> {
    return this.fraud.list(q);
  }

  @Patch("alerts/:ref/assign")
  @ApiOperation({ summary: "Take an alert and move it to investigating" })
  @ApiOkResponse({ type: AlertResponse })
  assign(
    @Param("ref") ref: string,
    @Body() dto: AssignAlertRequest,
    @CurrentUser() actor: AuthUser,
  ): Promise<AlertResponse> {
    return this.fraud.assign(ref, dto.assigneeId, actor.id);
  }

  @Patch("alerts/:ref/resolve")
  @RequirePermissions("fraud:resolve")
  @ApiOperation({
    summary: "Close an alert with a decision and a note",
    description:
      "Both outcomes require a note and are audited. A dismissal says the platform looked and " +
      "found nothing wrong — a pattern of them is exactly what an audit examines.",
  })
  @ApiOkResponse({ type: AlertResponse })
  resolve(
    @Param("ref") ref: string,
    @Body() dto: ResolveAlertRequest,
    @CurrentUser() actor: AuthUser,
  ): Promise<AlertResponse> {
    return this.fraud.resolve(ref, dto, actor.id);
  }

  @Get("rules")
  @ApiOperation({ summary: "Detection rules and their thresholds" })
  @ApiOkResponse({ type: [FraudRuleResponse] })
  rules(): Promise<FraudRuleResponse[]> {
    return this.fraud.listRules();
  }

  @Put("rules")
  @RequirePermissions("fraud:rules:write")
  @ApiOperation({
    summary: "Create or update a detection rule",
    description:
      "Thresholds are configuration so compliance can tune them without a deploy. Enabling " +
      "autoFreeze converts an advisory rule into one that can hold funds with no human decision, " +
      "and is called out in the audit entry.",
  })
  @ApiOkResponse({ type: FraudRuleResponse })
  upsertRule(
    @Body() dto: UpsertRuleRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<FraudRuleResponse> {
    return this.fraud.upsertRule(dto, actor.id, ip);
  }

  @Post("sweep")
  @RequirePermissions("fraud:resolve")
  @ApiOperation({
    summary: "Run every enabled detection pattern now",
    description: "Normally driven by the cron. Alerts are deduped, so running it twice is harmless.",
  })
  @ApiOkResponse({ type: [SweepResultResponse] })
  sweep(): Promise<SweepResult[]> {
    return this.fraud.sweepAll();
  }

  @Post("sweep/cap-hugging")
  @RequirePermissions("fraud:resolve")
  @ApiOperation({
    summary: "Run the cap-hugging pattern for a month",
    description: "Low-signal on its own: a member at their cap may simply be a successful referrer.",
  })
  capHugging(@Query("month") month?: string): Promise<SweepResult> {
    return this.fraud.sweepCapHugging(month);
  }
}
