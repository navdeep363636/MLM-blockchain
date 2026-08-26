import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClientIp, CurrentUser, RequirePermissions, StaffOnly, type AuthUser } from "@/common/decorators";
import type { Paginated } from "@/common/dto";
import type { WithdrawalPolicyConfig } from "@/modules/economy-config/economy-config.constants";
import { WalletService } from "./wallet.service";
import { WithdrawalService } from "./withdrawal.service";
import { DepositService } from "./deposit.service";
import { BalanceResponse } from "./dto/wallet.dto";
import {
  AdminWithdrawalQuery, ApproveWithdrawalRequest, RejectWithdrawalRequest,
  UpdateWithdrawalPolicyRequest, WithdrawalResponse,
} from "./dto/withdrawal.dto";
import { AdminDepositQuery, DepositResponse } from "./dto/deposit.dto";

/* ============================================================================
 * Wallet administration (FRD AD-06).
 *
 * The compliance queue lives here. Every decision is audited with the actor, the
 * before/after state and the reviewer's reason, because a payout decision is the
 * one a regulator is most likely to ask about a year later.
 * ========================================================================== */

@ApiTags("admin: wallet")
@StaffOnly("compliance", "finance_admin", "super_admin")
@Controller("admin/wallet")
export class WalletAdminController {
  constructor(
    private readonly wallet: WalletService,
    private readonly withdrawal: WithdrawalService,
    private readonly deposit: DepositService,
  ) {}

  @Get("withdrawals")
  @ApiOperation({
    summary: "Withdrawal queue, filterable by status, member, source tag and date",
    description: "Filter status=review for the manual compliance queue.",
  })
  withdrawals(
    @Query() q: AdminWithdrawalQuery,
  ): Promise<Paginated<WithdrawalResponse & { userId: string }>> {
    return this.withdrawal.adminList(q);
  }

  @Patch("withdrawals/:id/approve")
  @RequirePermissions("withdrawals:approve")
  @ApiOperation({
    summary: "Approve a withdrawal and release it to the payout queue",
    description:
      "Refuses while the destination's cooling-off window is still open — staff can reject early, never release early.",
  })
  @ApiOkResponse({ type: WithdrawalResponse })
  approve(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ApproveWithdrawalRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<WithdrawalResponse> {
    return this.withdrawal.approve(id, dto.note, actor.id, ip);
  }

  @Patch("withdrawals/:id/reject")
  @RequirePermissions("withdrawals:approve")
  @ApiOperation({ summary: "Reject a withdrawal and return the held funds to the member" })
  @ApiOkResponse({ type: WithdrawalResponse })
  reject(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RejectWithdrawalRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<WithdrawalResponse> {
    return this.withdrawal.reject(id, dto.reason, actor.id, ip);
  }

  @Patch("withdrawals/policy")
  @RequirePermissions("withdrawals:write")
  @ApiOperation({
    summary: "Update tier limits, the review threshold and the cooling-off window",
    description: "Versioned in platform_config. Tier 0 stays at zero — that is a rule, not a policy number.",
  })
  policy(
    @Body() dto: UpdateWithdrawalPolicyRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<WithdrawalPolicyConfig> {
    return this.withdrawal.updatePolicy(dto, actor.id, ip);
  }

  @Get("deposits")
  @ApiOperation({ summary: "Deposits across all members, for reconciliation and support" })
  deposits(@Query() q: AdminDepositQuery): Promise<Paginated<DepositResponse & { userId: string }>> {
    return this.deposit.adminList(q);
  }

  @Get("members/:userId/balance")
  @RequirePermissions("members:read")
  @ApiOperation({
    summary: "One member's live balance, for support and dispute handling",
    description: "Read-only. Balance corrections are made through the audited adjustment flow, never here.",
  })
  @ApiOkResponse({ type: BalanceResponse })
  memberBalance(@Param("userId", ParseUUIDPipe) userId: string): Promise<BalanceResponse> {
    return this.wallet.balance(userId);
  }
}
