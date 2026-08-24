import { Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, RequireKyc, type AuthUser } from "@/common/decorators";
import type { Paginated } from "@/common/dto";
import { CommissionService } from "./commission.service";
import { ReferralService } from "./referral.service";
import {
  CapMeterResponse, ClaimCommissionResponse, CommissionEarningsResponse, CommissionQuery,
  CommissionResponse,
} from "./dto/commission.dto";
import {
  DownlineMemberResponse, DownlineQuery, ReferralCodeResponse, ReferralStatsResponse,
} from "./dto/referral.dto";

/* ============================================================================
 * Referral programme, member side (FRD R-01 … R-05).
 *
 * Two properties every response here maintains:
 *
 *  • ANONYMITY. The downline is shape and activity, never identity. No name,
 *    email or handle appears in any payload below.
 *
 *  • HONESTY ABOUT WHAT IS OWED. `pendingMtt` is separated from `claimableMtt`
 *    with the reason it has not been released — awaiting KYC, or awaiting
 *    Treasury funding of the commission pool. Presenting unfunded accrual as a
 *    claimable balance would be a promise the platform has not made.
 * ========================================================================== */

@ApiTags("referral")
@ApiBearerAuth()
@Controller("referral")
export class ReferralController {
  constructor(
    private readonly referral: ReferralService,
    private readonly commission: CommissionService,
  ) {}

  @Get("code")
  @ApiOperation({ summary: "The member's referral code, share link and direct join count" })
  @ApiOkResponse({ type: ReferralCodeResponse })
  code(@CurrentUser() user: AuthUser): Promise<ReferralCodeResponse> {
    return this.referral.code(user.id);
  }

  @Get("stats")
  @ApiOperation({
    summary: "Network shape and earnings across the three tiers",
    description:
      "`rateBps` per level comes from the approved plan in force; it is 0 when no plan is " +
      "approved, because a member is never shown a rate nobody signed off.",
  })
  @ApiOkResponse({ type: ReferralStatsResponse })
  stats(@CurrentUser() user: AuthUser): Promise<ReferralStatsResponse> {
    return this.referral.stats(user.id);
  }

  @Get("downline")
  @ApiOperation({
    summary: "Paginated downline, anonymised",
    description:
      "Members appear as anonymous labels with an activity flag and what they have earned you. " +
      "Identity is never exposed (R-02).",
  })
  downline(
    @CurrentUser() user: AuthUser,
    @Query() q: DownlineQuery,
  ): Promise<Paginated<DownlineMemberResponse>> {
    return this.referral.downline(user.id, q);
  }

  @Get("commissions")
  @ApiOperation({
    summary: "Commission history with the rate, the net spend it was calculated on, and the cap effect",
    description: "`cappedAmount` is what the monthly cap refused. It is never carried into the next month.",
  })
  commissions(
    @CurrentUser() user: AuthUser,
    @Query() q: CommissionQuery,
  ): Promise<Paginated<CommissionResponse>> {
    return this.commission.history(user.id, q);
  }

  @Get("earnings")
  @ApiOperation({ summary: "Lifetime, claimable, pending and this-month commission, plus a per-level split" })
  @ApiOkResponse({ type: CommissionEarningsResponse })
  earnings(@CurrentUser() user: AuthUser): Promise<CommissionEarningsResponse> {
    return this.commission.earnings(user.id);
  }

  @Get("cap")
  @ApiOperation({
    summary: "This month's commission cap meter",
    description:
      "cap = min(absolute, multiplier × trailing-3-month own spend + base). Anything above it " +
      "is refused for the month and not deferred.",
  })
  @ApiOkResponse({ type: CapMeterResponse })
  cap(@CurrentUser() user: AuthUser): Promise<CapMeterResponse> {
    return this.commission.capMeter(user.id);
  }

  @Post("claim")
  @HttpCode(200)
  @RequireKyc(1)
  @ApiOperation({
    summary: "Move all released commission into the spendable balance",
    description:
      "Only released commission can be claimed. Entries awaiting KYC or pool funding are " +
      "reported back as `remainingPendingMtt` rather than silently omitted.",
  })
  @ApiOkResponse({ type: ClaimCommissionResponse })
  claim(@CurrentUser() user: AuthUser): Promise<ClaimCommissionResponse> {
    return this.commission.claim(user.id);
  }
}
