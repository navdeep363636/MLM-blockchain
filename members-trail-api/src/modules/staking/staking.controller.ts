import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from "@nestjs/common";
import { ApiHeader, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Public, RequireKyc, type AuthUser, Idempotent } from "@/common/decorators";
import type { Paginated } from "@/common/dto";
import { StakingService } from "./staking.service";
import {
  AprPointResponse, ClaimRewardsRequest, RewardHistoryQuery, StakeRequest, StakingIntentResponse,
  StakingPoolResponse, StakingRewardResponse, StakingSummaryResponse, UnstakePreviewResponse,
  UnstakeRequest,
} from "./dto/staking.dto";

/* ============================================================================
 * Staking, player side (FRD S-01 … S-04).
 *
 * Every mutating route returns an INTENT, not a result. The chain is the source
 * of truth: a position changes when the transaction confirms and the indexer
 * mirrors it, which is why these routes answer "queued" rather than a new
 * balance. A client that renders an optimistic position will disagree with the
 * chain the first time a transaction fails.
 * ========================================================================== */

@ApiTags("staking")
@Controller("staking")
export class StakingController {
  constructor(private readonly staking: StakingService) {}

  @Get("pools")
  @Public()
  @ApiOperation({
    summary: "Staking pools with lock terms, penalty and trailing APR",
    description:
      "`currentApr` is a realised, trailing observation — never a forecast. `earlyPenaltyBps` " +
      "applies to unclaimed rewards only; principal is always returned in full. `stale` flags a " +
      "mirror that is behind the chain.",
  })
  @ApiOkResponse({ type: [StakingPoolResponse] })
  pools(): Promise<StakingPoolResponse[]> {
    return this.staking.listPools();
  }

  @Get("pools/:poolId/apr")
  @Public()
  @ApiOperation({ summary: "Trailing APR observations for one pool — chart history, not a projection" })
  @ApiOkResponse({ type: [AprPointResponse] })
  apr(@Param("poolId", ParseIntPipe) poolId: number): Promise<AprPointResponse[]> {
    return this.staking.aprSeries(poolId);
  }

  @Get("positions")
  @ApiBearerAuth()
  @ApiOperation({ summary: "The member's positions, totals and lifetime rewards claimed" })
  @ApiOkResponse({ type: StakingSummaryResponse })
  positions(@CurrentUser() user: AuthUser): Promise<StakingSummaryResponse> {
    return this.staking.positionsFor(user.id);
  }

  @Get("positions/:poolId/unstake-preview")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Exactly what an unstake right now would return",
    description:
      "Principal and rewards are separate figures. The penalty is taken from rewards only, so " +
      "`principal` is what comes back regardless of the lock state.",
  })
  @ApiOkResponse({ type: UnstakePreviewResponse })
  preview(
    @CurrentUser() user: AuthUser,
    @Param("poolId", ParseIntPipe) poolId: number,
  ): Promise<UnstakePreviewResponse> {
    return this.staking.previewUnstake(user.id, poolId);
  }

  @Post("stake")
  @HttpCode(202)
  @ApiBearerAuth()
  @RequireKyc(1)
  /* A double-clicked stake would reserve the member's MTT twice and submit two transactions. */
  @Idempotent("staking")
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Client-generated, 8–128 chars. A retry with the same key is refused, not repeated.",
  })
  @ApiOperation({
    summary: "Queue a stake",
    description:
      "Reserves the MTT out of the spendable balance immediately so it cannot be double-spent, " +
      "then submits the transaction. The position appears once the chain confirms.",
  })
  @ApiOkResponse({ type: StakingIntentResponse })
  stake(
    @CurrentUser() user: AuthUser,
    @Body() dto: StakeRequest,
  ): Promise<StakingIntentResponse> {
    return this.staking.requestStake(user.id, dto);
  }

  @Post("unstake")
  @HttpCode(202)
  @ApiBearerAuth()
  @RequireKyc(1)
  /* A repeated unstake would queue two exits from one position. */
  @Idempotent("staking")
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Client-generated, 8–128 chars. A retry with the same key is refused, not repeated.",
  })
  @ApiOperation({
    summary: "Queue an unstake",
    description:
      "While the lock is active, `acceptPenalty` must be true — and the penalty applies to " +
      "unclaimed rewards only. Refuses with PENALTY_NOT_ACCEPTED otherwise.",
  })
  @ApiOkResponse({ type: StakingIntentResponse })
  unstake(
    @CurrentUser() user: AuthUser,
    @Body() dto: UnstakeRequest,
  ): Promise<StakingIntentResponse> {
    return this.staking.requestUnstake(user.id, dto);
  }

  @Post("claim")
  @HttpCode(202)
  @ApiBearerAuth()
  @RequireKyc(1)
  /* A repeated claim would submit two reward transactions and pay the gas twice. */
  @Idempotent("staking")
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Client-generated, 8–128 chars. A retry with the same key is refused, not repeated.",
  })
  @ApiOperation({ summary: "Queue a claim of the unclaimed rewards in a pool" })
  @ApiOkResponse({ type: StakingIntentResponse })
  claim(
    @CurrentUser() user: AuthUser,
    @Body() dto: ClaimRewardsRequest,
  ): Promise<StakingIntentResponse> {
    return this.staking.requestClaim(user.id, dto);
  }

  @Get("rewards")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Reward history, filterable by pool and date" })
  rewards(
    @CurrentUser() user: AuthUser,
    @Query() q: RewardHistoryQuery,
  ): Promise<Paginated<StakingRewardResponse>> {
    return this.staking.rewardHistory(user.id, q);
  }
}
