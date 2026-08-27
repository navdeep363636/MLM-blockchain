import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClientIp, CurrentUser, StaffOnly, RequirePermissions, type AuthUser } from "@/common/decorators";
import type { Paginated } from "@/common/dto";
import type { ConversionCapsConfig } from "@/modules/economy-config/economy-config.constants";
import { ConversionService } from "./conversion.service";
import {
  AdminConversionQuery, ConversionResponse, DecideRateRequest, ProposeRateRequest,
  ConversionCapsOverview, RateResponse, RejectRateRequest, UpdateConversionCapsRequest,
} from "./dto/conversion.dto";

/* ============================================================================
 * Conversion administration (FRD AD-05).
 *
 * Every route here is four-eyes or audited, or both. A rate change is the single
 * most economically significant lever in the platform: it revalues every Point
 * every member holds, so no one person may pull it alone.
 * ========================================================================== */

@ApiTags("admin: conversion")
@StaffOnly("finance_admin", "super_admin")
@Controller("admin/conversion")
export class ConversionAdminController {
  constructor(private readonly conversion: ConversionService) {}

  @Get("rates")
  @ApiOperation({ summary: "Rate history, newest first, including rejected proposals" })
  @ApiOkResponse({ type: [RateResponse] })
  rates(): Promise<RateResponse[]> {
    return this.conversion.listRates();
  }

  @Post("rates")
  @RequirePermissions("conversion:write")
  @ApiOperation({
    summary: "Propose a new rate — takes effect only after a second approver signs off",
    description: "effectiveFrom must be in the future; a backdated rate would reprice settled conversions.",
  })
  @ApiOkResponse({ type: RateResponse })
  propose(
    @Body() dto: ProposeRateRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<RateResponse> {
    return this.conversion.proposeRate(dto, actor.id, ip);
  }

  @Patch("rates/:id/approve")
  @RequirePermissions("conversion:approve")
  @ApiOperation({
    summary: "Approve a proposed rate",
    description: "Refuses with FOUR_EYES_VIOLATION if the approver is the proposer.",
  })
  @ApiOkResponse({ type: RateResponse })
  approve(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DecideRateRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<RateResponse> {
    return this.conversion.approveRate(id, dto.note ?? null, actor.id, ip);
  }

  @Patch("rates/:id/reject")
  @RequirePermissions("conversion:approve")
  @ApiOperation({ summary: "Reject a proposed rate with a recorded reason" })
  @ApiOkResponse({ type: RateResponse })
  reject(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RejectRateRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<RateResponse> {
    return this.conversion.rejectRate(id, dto.reason, actor.id, ip);
  }

  @Patch("caps")
  @RequirePermissions("conversion:write")
  @ApiOperation({
    summary: "Update the per-member daily and monthly conversion ceilings",
    description: "Versioned in platform_config — the previous values stay readable for audit.",
  })
  caps(
    @Body() dto: UpdateConversionCapsRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<ConversionCapsConfig> {
    return this.conversion.updateCaps(dto, actor.id, ip);
  }

  @Get("caps")
  @ApiOperation({
    summary: "The conversion ceilings in force, and today's global usage",
    description:
      "The write side of this has existed since the beginning; the read side did " +
      "not, so the operator screen was showing ceilings compiled into the browser " +
      "bundle while the server enforced whatever was last configured. Global usage " +
      "is included because a per-member ceiling tells an operator nothing about " +
      "whether the platform is close to its own daily limit.",
  })
  capsOverview(): Promise<ConversionCapsOverview> {
    return this.conversion.capsOverview();
  }

  @Get()
  @ApiOperation({ summary: "All conversions, filterable by member and date, for reconciliation" })
  list(@Query() q: AdminConversionQuery): Promise<Paginated<ConversionResponse & { userId: string }>> {
    return this.conversion.adminList(q);
  }
}
