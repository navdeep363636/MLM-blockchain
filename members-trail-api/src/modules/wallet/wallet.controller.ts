import {
  Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClientIp, CurrentUser, Idempotent, RequireKyc, type AuthUser } from "@/common/decorators";
import { OkResponse, type Paginated } from "@/common/dto";
import { WalletService } from "./wallet.service";
import { WithdrawalService } from "./withdrawal.service";
import { DepositService } from "./deposit.service";
import {
  BalanceResponse, LinkAddressRequest, LinkChallengeResponse, TransactionExportResponse,
  TransactionQuery, TransactionResponse, WalletAddressResponse,
} from "./dto/wallet.dto";
import {
  CreateWithdrawalRequest, WithdrawalHistoryQuery, WithdrawalLimitsResponse, WithdrawalResponse,
} from "./dto/withdrawal.dto";
import {
  CreateDepositRequest, DepositHistoryQuery, DepositIntentResponse, DepositResponse,
} from "./dto/deposit.dto";

/* ============================================================================
 * Wallet, player side (FRD W-01 … W-05).
 *
 * KYC gating is deliberate and asymmetric: reading a balance or a statement
 * needs no tier, because a member is always entitled to see their own records.
 * Moving value out — a withdrawal — requires tier 1 at minimum, and the tier
 * also sets the rolling-window ceiling.
 * ========================================================================== */

@ApiTags("wallet")
@ApiBearerAuth()
@Controller("wallet")
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly withdrawal: WithdrawalService,
    private readonly deposit: DepositService,
  ) {}

  /* ------------------------------- balance -------------------------------- */

  @Get("balance")
  @ApiOperation({
    summary: "Live balance across every bucket",
    description:
      "Read from the ledger on every call — never cached. `mttLockedForWithdrawal` is the " +
      "member's money held against an in-flight payout, and is included in totalMtt.",
  })
  @ApiOkResponse({ type: BalanceResponse })
  balance(@CurrentUser() user: AuthUser): Promise<BalanceResponse> {
    return this.wallet.balance(user.id);
  }

  /* ----------------------------- transactions ----------------------------- */

  @Get("transactions")
  @ApiOperation({ summary: "Paginated MTT transaction history, filterable by type, status and date" })
  transactions(
    @CurrentUser() user: AuthUser,
    @Query() q: TransactionQuery,
  ): Promise<Paginated<TransactionResponse>> {
    return this.wallet.transactionHistory(user.id, q);
  }

  @Get("transactions/export")
  @ApiOperation({ summary: "The same filtered ledger as statement rows (W-05)" })
  @ApiOkResponse({ type: TransactionExportResponse })
  exportTransactions(
    @CurrentUser() user: AuthUser,
    @Query() q: TransactionQuery,
  ): Promise<TransactionExportResponse> {
    return this.wallet.exportTransactions(user.id, q);
  }

  @Get("transactions/:ref")
  @ApiOperation({ summary: "One transaction by its business reference" })
  @ApiOkResponse({ type: TransactionResponse })
  transaction(
    @CurrentUser() user: AuthUser,
    @Param("ref") ref: string,
  ): Promise<TransactionResponse> {
    return this.wallet.findTransaction(user.id, ref);
  }

  /* ------------------------------- addresses ------------------------------ */

  @Get("addresses")
  @ApiOperation({
    summary: "Linked wallet addresses, with cooling-off state",
    description: "`withdrawable` is false while the anti-fraud window on a newly linked address is open.",
  })
  @ApiOkResponse({ type: [WalletAddressResponse] })
  addresses(@CurrentUser() user: AuthUser): Promise<WalletAddressResponse[]> {
    return this.wallet.listAddresses(user.id);
  }

  @Post("addresses/challenge")
  @HttpCode(200)
  @ApiOperation({
    summary: "Get a single-use message to sign, proving control of an address",
    description: "Valid for 5 minutes and consumed on use, so a captured signature cannot be replayed.",
  })
  @ApiOkResponse({ type: LinkChallengeResponse })
  challenge(@CurrentUser() user: AuthUser): Promise<LinkChallengeResponse> {
    return this.wallet.linkChallenge(user.id);
  }

  @Post("addresses")
  @HttpCode(201)
  @ApiOperation({
    summary: "Link an address by submitting the challenge signature",
    description: "An address may belong to exactly one account. The cooling-off clock starts here.",
  })
  @ApiOkResponse({ type: WalletAddressResponse })
  linkAddress(
    @CurrentUser() user: AuthUser,
    @Body() dto: LinkAddressRequest,
    @ClientIp() ip: string,
  ): Promise<WalletAddressResponse> {
    return this.wallet.linkAddress(user.id, dto, ip);
  }

  @Patch("addresses/:id/primary")
  @ApiOperation({ summary: "Make a verified address the primary one" })
  @ApiOkResponse({ type: WalletAddressResponse })
  setPrimary(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @ClientIp() ip: string,
  ): Promise<WalletAddressResponse> {
    return this.wallet.setPrimary(user.id, id, ip);
  }

  @Delete("addresses/:id")
  @ApiOperation({
    summary: "Unlink an address",
    description: "Refused while a withdrawal to it is still in progress.",
  })
  @ApiOkResponse({ type: OkResponse })
  async removeAddress(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @ClientIp() ip: string,
  ): Promise<OkResponse> {
    await this.wallet.removeAddress(user.id, id, ip);
    return { ok: true };
  }

  /* ------------------------------ withdrawals ----------------------------- */

  @Get("withdrawals/limits")
  @ApiOperation({
    summary: "Tier limit, rolling-window usage and the largest request that would be accepted",
    description: "Call this before showing the form so the member is never told 'no' after typing an amount.",
  })
  @ApiOkResponse({ type: WithdrawalLimitsResponse })
  withdrawalLimits(@CurrentUser() user: AuthUser): Promise<WithdrawalLimitsResponse> {
    return this.withdrawal.limits(user.id);
  }

  @Post("withdrawals")
  @HttpCode(201)
  @RequireKyc(1)
  @Idempotent("withdrawal")
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Client-generated, 8–128 chars. A retry returns the original request, never a second payout.",
  })
  @ApiOperation({
    summary: "Request a withdrawal",
    description:
      "Funds are locked immediately. The request may land in cooling_off (new destination), " +
      "review (above threshold, fiat, or elevated risk) or approved.",
  })
  @ApiOkResponse({ type: WithdrawalResponse })
  requestWithdrawal(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWithdrawalRequest,
    @Headers("idempotency-key") idempotencyKey: string,
    @ClientIp() ip: string,
  ): Promise<WithdrawalResponse> {
    return this.withdrawal.request(user.id, dto, idempotencyKey, ip);
  }

  @Get("withdrawals")
  @ApiOperation({ summary: "Withdrawal history with status and review outcome" })
  withdrawals(
    @CurrentUser() user: AuthUser,
    @Query() q: WithdrawalHistoryQuery,
  ): Promise<Paginated<WithdrawalResponse>> {
    return this.withdrawal.history(user.id, q);
  }

  @Patch("withdrawals/:ref/cancel")
  @ApiOperation({
    summary: "Cancel a withdrawal that has not yet been sent",
    description: "Releases the hold back to the spendable balance. Refused once processing has begun.",
  })
  @ApiOkResponse({ type: WithdrawalResponse })
  cancelWithdrawal(
    @CurrentUser() user: AuthUser,
    @Param("ref") ref: string,
    @ClientIp() ip: string,
  ): Promise<WithdrawalResponse> {
    return this.withdrawal.cancel(user.id, ref, ip);
  }

  /* -------------------------------- deposits ------------------------------ */

  @Post("deposits")
  @HttpCode(201)
  @ApiOperation({
    summary: "Start a deposit and get the processor reference",
    description:
      "Credits nothing. MTT is credited only when the processor's settlement is reconciled, " +
      "at the reference price in force at that moment.",
  })
  @ApiOkResponse({ type: DepositIntentResponse })
  initiateDeposit(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDepositRequest,
    @ClientIp() ip: string,
  ): Promise<DepositIntentResponse> {
    return this.deposit.initiate(user.id, dto, ip);
  }

  @Get("deposits")
  @ApiOperation({ summary: "Deposit history including unreconciled attempts" })
  deposits(
    @CurrentUser() user: AuthUser,
    @Query() q: DepositHistoryQuery,
  ): Promise<Paginated<DepositResponse>> {
    return this.deposit.history(user.id, q);
  }
}
