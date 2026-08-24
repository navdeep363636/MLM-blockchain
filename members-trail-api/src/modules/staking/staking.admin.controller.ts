import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClientIp, CurrentUser, RequirePermissions, StaffOnly, type AuthUser } from "@/common/decorators";
import { StakingService } from "./staking.service";
import {
  AprPointResponse, RecomputeAprRequest, StakingPoolResponse, UpsertPoolRequest,
} from "./dto/staking.dto";

/* ============================================================================
 * Staking administration (FRD AD-07).
 *
 * Nothing here can change the terms a member is actually subject to — those live
 * in the contract. These routes maintain the mirror and recompute the realised
 * APR, and every write is audited precisely because a wrong mirror misinforms
 * every member who reads it.
 * ========================================================================== */

@ApiTags("admin: staking")
@StaffOnly("finance_admin", "super_admin")
@Controller("admin/staking")
export class StakingAdminController {
  constructor(private readonly staking: StakingService) {}

  @Get("pools")
  @ApiOperation({ summary: "All pools including inactive ones, with sync state" })
  @ApiOkResponse({ type: [StakingPoolResponse] })
  pools(@Query("includeInactive") includeInactive?: string): Promise<StakingPoolResponse[]> {
    return this.staking.listPools(includeInactive !== "false");
  }

  @Put("pools")
  @RequirePermissions("staking:pool:write")
  @ApiOperation({
    summary: "Create or update a pool mirror",
    description:
      "Mirrors the on-chain configuration. This does not change the contract — if these values " +
      "disagree with the chain, the chain wins and members were shown the wrong terms.",
  })
  @ApiOkResponse({ type: StakingPoolResponse })
  upsert(
    @Body() dto: UpsertPoolRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<StakingPoolResponse> {
    return this.staking.upsertPool(dto, actor.id, ip);
  }

  @Post("pools/:poolId/recompute-apr")
  @RequirePermissions("staking:pool:write")
  @ApiOperation({
    summary: "Recompute the realised APR for a period",
    description:
      "inflow ÷ TVL annualised. Returns null for a pool with no TVL — an empty pool has no " +
      "observation, and reporting 0% would imply one.",
  })
  recompute(
    @Param("poolId", ParseIntPipe) poolId: number,
    @Body() dto: RecomputeAprRequest,
  ): Promise<AprPointResponse | null> {
    return this.staking.recomputeApr(poolId, dto.periodKey);
  }
}
