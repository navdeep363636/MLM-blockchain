"use client";

/* ============================================================================
 * Every action that changes something on the server.
 *
 * Four rules, and they are the reason this is one file rather than a handler in
 * each component.
 *
 *  1. AMOUNTS ARE PASSED AS STRINGS, EXACTLY AS TYPED. Not parsed to a float and
 *     re-serialised. `parseFloat("0.1") * 3` is 0.30000000000000004, and on a
 *     platform where a balance is DECIMAL(36,18) that is a real discrepancy
 *     between the number a member confirmed and the number that settles. The
 *     input's own string goes to the server; the server does the arithmetic.
 *
 *  2. EVERY MUTATION INVALIDATES WHAT IT AFFECTED. Listed explicitly, coarsest
 *     key first. A stake changes the balance, the positions, and the ledger —
 *     forget one and the UI shows a stale figure with no error anywhere to
 *     explain it.
 *
 *  3. NOTHING IS RETRIED AUTOMATICALLY. The idempotency key makes a retry safe,
 *     but a member watching a spinner after an error cannot tell whether their
 *     withdrawal went through. That decision is theirs.
 *
 *  4. NO OPTIMISTIC UPDATES ON MONEY. Showing a balance that has not settled is
 *     how a member spends what they do not have. Optimism is fine for a "mark as
 *     read"; it is not fine for anything with an amount on it.
 * ========================================================================== */

import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import type {
  ConversionQuote, ConversionResponse, OkResponse, TicketResponse, WithdrawalResponse,
} from "@/lib/api/types";

/* --------------------------------- plumbing ------------------------------- */

type Keys = readonly (readonly unknown[])[];

/**
 * A mutation that invalidates a fixed set of keys on success.
 *
 * `invalidates` is a required argument. Making it optional is how a mutation
 * ships without cache invalidation and the bug surfaces a week later as "the
 * number doesn't update until I reload".
 */
function useAction<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  invalidates: Keys,
): UseMutationResult<TResult, Error, TVars> {
  const qc = useQueryClient();
  return useMutation<TResult, Error, TVars>({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of invalidates) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

/* ================================ Conversion ============================== */

export interface ConvertVars {
  /** Points to spend. An integer count, so a number is the honest type here. */
  points: number;
}

/**
 * Points → MTT.
 *
 * `POST /conversion` accepts `points` and NOTHING else — the endpoint runs under
 * a `forbidNonWhitelisted` validation pipe, so an extra field is a 400 rather
 * than an ignored key. This previously also sent `expectedPointsPerMtt` as a
 * rate guard, which meant every conversion in the app was rejected.
 *
 * The guard itself is worth having and is NOT re-added here as a client-only
 * field: a value the server accepts and ignores looks like protection without
 * being any. It needs `CreateConversionRequest` to carry it and the service to
 * compare it against the active rate; until then the confirmation step showing
 * the rate is the only thing standing between a mid-flow rate change and a
 * surprise, and that is worth fixing server-side next.
 */
export const useConvertPoints = () =>
  useAction<ConvertVars, ConversionResponse>(
    (v) => api.post<ConversionResponse>("/conversion", { points: v.points }),
    [qk.wallet(), qk.points(), qk.conversion()],
  );

/** A quote is a read, but it is triggered by typing, so it lives with the actions. */
export const useConversionQuote = () =>
  useAction<{ points: number }, ConversionQuote>(
    (v) => api.get<ConversionQuote>("/conversion/quote", { query: { points: v.points } }),
    [],
  );

/* ================================== Wallet ================================ */

/** Provenance of the funds, as the AML record requires. Matches SOURCE_TAGS server-side. */
export type SourceTag = "gameplay" | "staking" | "referral" | "deposit" | "prize";

export interface WithdrawVars {
  /**
   * Which rail. Required by the server, and the two branches take different
   * destinations: `mtt` needs an on-chain address, `fiat` an opaque payout
   * method reference. Omitting it made every withdrawal a 400.
   */
  kind: "mtt" | "fiat";
  /** MTT, as the member typed it. Never a float. */
  amountMtt: string;
  /** EVM address. Required by the server for kind=mtt, refused for kind=fiat. */
  destinationAddress?: string;
  /**
   * Opaque payout-method reference for kind=fiat. Bank details never cross this
   * wire, which is why it is a reference and not an account number.
   */
  payoutMethodRef?: string;
  /** AML source tagging — required by the FRD, so it is not optional here. */
  sourceTag: SourceTag;
}

/**
 * Requests a withdrawal.
 *
 * The payload is assembled field by field rather than spread, because the server
 * refuses unknown properties: passing the caller's object through is how
 * `destination`, `addressId` and `twoFaCode` — none of which the API declares —
 * used to turn every request into a 400. A step-up 2FA code, when that is wired,
 * belongs in the `X-Two-Fa-Code` header the API already allows through CORS, not
 * in this body.
 */
export const useRequestWithdrawal = () =>
  useAction<WithdrawVars, WithdrawalResponse>(
    (v) =>
      api.post<WithdrawalResponse>("/wallet/withdrawals", {
        kind: v.kind,
        amountMtt: v.amountMtt,
        sourceTag: v.sourceTag,
        ...(v.destinationAddress ? { destinationAddress: v.destinationAddress } : {}),
        ...(v.payoutMethodRef ? { payoutMethodRef: v.payoutMethodRef } : {}),
      }),
    [qk.wallet()],
  );

export const useCancelWithdrawal = () =>
  useAction<{ ref: string }, WithdrawalResponse>(
    (v) => api.patch<WithdrawalResponse>(`/wallet/withdrawals/${v.ref}/cancel`),
    [qk.wallet()],
  );

export const useCreateDeposit = () =>
  useAction<{ amountFiat: string; currency: string; method?: string }, Record<string, unknown>>(
    (v) => api.post<Record<string, unknown>>("/wallet/deposits", v),
    [qk.wallet()],
  );

/* -------------------------------- addresses ------------------------------- */

/**
 * Wallet whitelisting is two steps by design.
 *
 * `challenge` returns a nonce the member signs with the wallet they claim to
 * own; `add` presents the signature. Proving control before money can be sent
 * there is the whole point — a whitelist you can add an arbitrary address to is
 * decoration.
 */
export const useAddressChallenge = () =>
  useAction<{ address: string }, { message: string; nonce: string; expiresIn?: number }>(
    (v) => api.post("/wallet/addresses/challenge", v),
    [],
  );

export const useAddWalletAddress = () =>
  useAction<{ address: string; signature: string; label?: string }, Record<string, unknown>>(
    (v) => api.post("/wallet/addresses", v),
    [qk.walletAddresses(), qk.me()],
  );

export const useRemoveWalletAddress = () =>
  useAction<{ id: string }, OkResponse>(
    (v) => api.del<OkResponse>(`/wallet/addresses/${v.id}`),
    [qk.walletAddresses()],
  );

export const useSetPrimaryAddress = () =>
  useAction<{ id: string }, Record<string, unknown>>(
    (v) => api.patch(`/wallet/addresses/${v.id}/primary`),
    [qk.walletAddresses(), qk.me()],
  );

/* ================================== Staking =============================== */

export const useStake = () =>
  useAction<{ poolId: number; amountMtt: string }, Record<string, unknown>>(
    (v) => api.post("/staking/stake", v),
    [qk.staking(), qk.wallet()],
  );

export const useUnstake = () =>
  useAction<{ poolId: number; amountMtt: string }, Record<string, unknown>>(
    (v) => api.post("/staking/unstake", v),
    [qk.staking(), qk.wallet()],
  );

export const useClaimStakingRewards = () =>
  useAction<{ poolId: number }, Record<string, unknown>>(
    (v) => api.post("/staking/claim", v),
    [qk.staking(), qk.wallet()],
  );

/**
 * What early exit would cost, before the member commits to it.
 *
 * A preview, not a promise: the penalty applies to unclaimed REWARDS and never
 * to principal, and showing that split before the confirmation is the difference
 * between an informed decision and a surprise.
 */
export const useUnstakePreview = () =>
  useAction<{ poolId: number; amountMtt: string }, Record<string, unknown>>(
    (v) =>
      api.get(`/staking/positions/${v.poolId}/unstake-preview`, {
        query: { amountMtt: v.amountMtt },
      }),
    [],
  );

/* ================================= Referral =============================== */

export const useClaimCommission = () =>
  useAction<Record<string, never> | void, Record<string, unknown>>(
    () => api.post("/referral/claim"),
    [qk.referral(), qk.wallet()],
  );

/* ================================= Quests ================================= */

export const useClaimQuest = () =>
  useAction<{ id: string }, Record<string, unknown>>(
    (v) => api.post(`/quests/${v.id}/claim`),
    [qk.quests(), qk.points(), qk.balance()],
  );

/* =============================== Tournaments ============================== */

export const useRegisterForTournament = () =>
  useAction<{ ref: string }, Record<string, unknown>>(
    (v) => api.post(`/tournaments/${v.ref}/register`),
    [qk.tournaments(), qk.wallet()],
  );

/* ================================== Games ================================= */

/**
 * Opening a session is a server-side act, not a client-side one.
 *
 * The client cannot be trusted with "I scored 4,000" — the whole anti-fraud
 * design rests on the server issuing a session and validating the result
 * against it. So the UI starts a session and submits to it; it never reports
 * points.
 */
export const useStartGameSession = () =>
  useAction<{ gameId: string; entryType?: string }, { ref: string; [k: string]: unknown }>(
    (v) => api.post("/games/sessions", v),
    [qk.games()],
  );

export const useSubmitGameSession = () =>
  useAction<{ ref: string; score: number; durationSeconds?: number }, Record<string, unknown>>(
    (v) => api.post(`/games/sessions/${v.ref}/submit`, v),
    [qk.points(), qk.quests(), qk.leaderboard(), qk.balance()],
  );

/* =================================== Store ================================ */

export const usePurchaseStoreItem = () =>
  useAction<{ itemId: string; payWith: "mtt" | "points"; quantity?: number }, Record<string, unknown>>(
    (v) => api.post("/store/purchase", v),
    [qk.store(), qk.wallet(), qk.points()],
  );

export const useConsumeInventoryItem = () =>
  useAction<{ id: string }, Record<string, unknown>>(
    (v) => api.post(`/store/inventory/${v.id}/consume`),
    [qk.inventory()],
  );

export const useCreateListing = () =>
  useAction<{ inventoryItemId: string; askMtt: string }, Record<string, unknown>>(
    (v) => api.post("/store/market", v),
    [qk.market(), qk.inventory()],
  );

export const useBuyListing = () =>
  useAction<{ ref: string }, Record<string, unknown>>(
    (v) => api.post(`/store/market/${v.ref}/buy`),
    [qk.market(), qk.inventory(), qk.wallet()],
  );

export const useCancelListing = () =>
  useAction<{ ref: string }, OkResponse>(
    (v) => api.del<OkResponse>(`/store/market/${v.ref}`),
    [qk.market(), qk.inventory()],
  );

/* ================================== Support =============================== */

/**
 * Opens a ticket.
 *
 * `financialDispute` is NOT in this payload and must not be: the server derives
 * it from the category — withdrawal, commission and KYC tickets are routed to
 * compliance-trained agents — and it refuses the field outright, which used to
 * make every ticket a 400. The UI still computes the same predicate locally to
 * decide what to tell the member, which is fine; it just cannot assert it.
 *
 * `disputedRef` is the one thing the client legitimately supplies here, and it is
 * optional: the reference of the item being disputed, when the member reached
 * support from a specific withdrawal or commission row. Neither of the two forms
 * that open tickets today collects one, so neither sends it.
 */
export const useCreateTicket = () =>
  useAction<
    { subject: string; category: string; body: string; disputedRef?: string },
    TicketResponse
  >(
    (v) =>
      api.post<TicketResponse>("/support/tickets", {
        subject: v.subject,
        category: v.category,
        body: v.body,
        ...(v.disputedRef ? { disputedRef: v.disputedRef } : {}),
      }),
    [qk.tickets()],
  );

export const useReplyToTicket = () =>
  useAction<{ ref: string; body: string }, Record<string, unknown>>(
    (v) => api.post(`/support/tickets/${v.ref}/messages`, { body: v.body }),
    [qk.tickets()],
  );

export const useRateTicket = () =>
  useAction<{ ref: string; rating: number; comment?: string }, Record<string, unknown>>(
    (v) => api.patch(`/support/tickets/${v.ref}/rate`, { rating: v.rating, comment: v.comment }),
    [qk.tickets()],
  );

/* =============================== Notifications ============================ */

export const useMarkNotificationsRead = () =>
  useAction<{ ids: string[] }, Record<string, unknown>>(
    (v) => api.patch("/notifications/read", { ids: v.ids }),
    [qk.notifications()],
  );

export const useMarkAllNotificationsRead = () =>
  useAction<void, Record<string, unknown>>(
    () => api.patch("/notifications/read-all"),
    [qk.notifications()],
  );

export const useUpdateNotificationPreferences = () =>
  useAction<Record<string, unknown>, Record<string, unknown>>(
    (v) => api.patch("/notifications/preferences", v),
    [qk.notificationPrefs()],
  );

/* ================================== Profile =============================== */

export const useUpdateProfile = () =>
  useAction<
    { displayName?: string; avatarUrl?: string; locale?: string; timezone?: string },
    Record<string, unknown>
  >((v) => api.patch("/users/me", v), [qk.me()]);

export const useChangeEmail = () =>
  useAction<{ email: string; password: string }, Record<string, unknown>>(
    (v) => api.post("/users/me/email", v),
    [],
  );

export const useConfirmEmailChange = () =>
  useAction<{ code: string }, Record<string, unknown>>(
    (v) => api.post("/users/me/email/confirm", v),
    [qk.me()],
  );

export const useChangePhone = () =>
  useAction<{ phone: string; password: string }, Record<string, unknown>>(
    (v) => api.post("/users/me/phone", v),
    [],
  );

export const useConfirmPhoneChange = () =>
  useAction<{ code: string }, Record<string, unknown>>(
    (v) => api.post("/users/me/phone/confirm", v),
    [qk.me()],
  );

export const useAcceptLegal = () =>
  useAction<{ versions: Record<string, string> }, Record<string, unknown>>(
    (v) => api.post("/users/me/legal-acceptance", v),
    [qk.me()],
  );

export const useRequestDataExport = () =>
  useAction<void, Record<string, unknown>>(() => api.post("/users/me/export"), []);

/* ================================== Security ============================== */

export const useChangePassword = () =>
  useAction<{ currentPassword: string; newPassword: string }, Record<string, unknown>>(
    (v) => api.post("/auth/change-password", v),
    [qk.security()],
  );

export const useSetupTwoFa = () =>
  useAction<{ method: "totp" | "sms" }, { secret?: string; otpauthUrl?: string; [k: string]: unknown }>(
    (v) => api.post("/auth/2fa/setup", v),
    [],
  );

export const useEnableTwoFa = () =>
  useAction<{ code: string }, { recoveryCodes?: string[]; [k: string]: unknown }>(
    (v) => api.post("/auth/2fa/enable", v),
    [qk.me(), qk.security()],
  );

export const useDisableTwoFa = () =>
  useAction<{ code: string; password: string }, Record<string, unknown>>(
    (v) => api.post("/auth/2fa/disable", v),
    [qk.me(), qk.security()],
  );

export const useRevokeSession = () =>
  useAction<{ id: string }, OkResponse>(
    (v) => api.del<OkResponse>(`/auth/sessions/${v.id}`),
    [qk.sessions()],
  );

export const useLogoutEverywhere = () =>
  useAction<void, OkResponse>(() => api.post<OkResponse>("/auth/logout-all"), [qk.sessions()]);

/* ==================================== KYC ================================= */

/** One identity document, as the API registers it. Every field is required. */
export interface KycDocumentInput {
  kind: "id_front" | "id_back" | "selfie" | "address_proof" | "source_of_funds";
  /** Object-store key from the presigned upload. At least 8 characters. */
  storageKey: string;
  /** One of image/jpeg, image/png, image/webp, image/heic, application/pdf. */
  mimeType: string;
  /** Actual byte length. Must be at least 1 — a zero here is a rejected submission. */
  sizeBytes: number;
  /** SHA-256 of the uploaded bytes, 64 lowercase hex characters. Required. */
  sha256: string;
}

export interface SubmitKycVars {
  tier: 1 | 2;
  documents: KycDocumentInput[];
  /** Overrides the country on file when the ID is foreign. ISO-3166-1 alpha-2. */
  documentCountry?: string;
}

/**
 * Registers a KYC submission.
 *
 * Typed rather than `Record<string, unknown>` on purpose: this used to be a loose
 * record, which is how the caller came to send `sizeBytes: 0` and no `sha256` at
 * all — both rejected by the server, so no submission could succeed. A named
 * shape makes the next caller's mistake a compile error.
 */
export const useSubmitKyc = () =>
  useAction<SubmitKycVars, Record<string, unknown>>(
    (v) => api.post("/kyc/submissions", v),
    [qk.kycMine(), qk.me()],
  );

/* ============================== Registration ============================== */

/**
 * Registration and the OTP steps.
 *
 * These are not in the auth context because they do not produce a session: a
 * new account is unverified, and the tokens only arrive after a subsequent
 * login. Keeping them here stops the auth provider from growing a second
 * lifecycle it does not own.
 */
export const useRegister = () =>
  useAction<
    {
      email: string;
      password: string;
      phone: string;
      fullName: string;
      country: string;
      dateOfBirth: string;
      termsAccepted: boolean;
      referralCode?: string;
    },
    Record<string, unknown>
  >((v) => api.post("/auth/register", v), []);

/**
 * The OTP channel, as the API names it.
 *
 * `phone`, not `sms`. The distinction is the channel versus the transport, and
 * sending "sms" failed the enum on every phone verification in the app.
 */
export type OtpChannel = "email" | "phone";

export interface VerifyOtpVars {
  channel: OtpChannel;
  code: string;
  /**
   * The address or number the code went to. The API calls this `identifier`, and
   * it is what lets an unauthenticated caller — which is every caller on the
   * verify screen, since the account has no session until it is verified — say
   * which account the code belongs to.
   */
  identifier?: string;
}

export const useVerifyOtp = () =>
  useAction<VerifyOtpVars, Record<string, unknown>>(
    (v) => api.post("/auth/verify-otp", v),
    [qk.me()],
  );

/** Resend requires the identifier: there is no session to infer it from. */
export const useResendOtp = () =>
  useAction<{ channel: OtpChannel; identifier: string }, { resendAfter?: number }>(
    (v) => api.post("/auth/resend-otp", v),
    [],
  );

export const useForgotPassword = () =>
  useAction<{ identifier: string }, Record<string, unknown>>(
    (v) => api.post("/auth/forgot-password", v),
    [],
  );

export const useResetPassword = () =>
  useAction<{ token: string; password: string }, Record<string, unknown>>(
    (v) => api.post("/auth/reset-password", v),
    [],
  );

/* ============================== Admin actions ============================= */

/**
 * The back-office writes.
 *
 * Every one of these carries a `reason`, because the server requires it and
 * writes it verbatim to append-only audit storage. A UI that made the reason
 * optional would be building a form whose submission always fails.
 */

export const useSetMemberStatus = () =>
  useAction<{ userId: string; status: string; reason: string }, Record<string, unknown>>(
    (v) => api.patch(`/admin/members/${v.userId}/status`, { status: v.status, reason: v.reason }),
    [qk.adminMembers(), qk.adminKpis(), qk.adminAudit()],
  );

export const useDecideKyc = () =>
  useAction<
    { id: string; decision: "approve" | "reject" | "more_info"; tier?: number; notes?: string },
    Record<string, unknown>
  >(
    (v) => api.post(`/kyc/admin/submissions/${v.id}/decision`, v),
    [qk.adminKycQueue(), qk.adminKpis(), qk.adminAudit()],
  );

export const useApproveWithdrawal = () =>
  useAction<{ id: string; reason: string }, Record<string, unknown>>(
    (v) => api.patch(`/admin/wallet/withdrawals/${v.id}/approve`, { reason: v.reason }),
    [qk.adminWithdrawals(), qk.adminKpis(), qk.adminAudit()],
  );

export const useRejectWithdrawal = () =>
  useAction<{ id: string; reason: string }, Record<string, unknown>>(
    (v) => api.patch(`/admin/wallet/withdrawals/${v.id}/reject`, { reason: v.reason }),
    [qk.adminWithdrawals(), qk.adminKpis(), qk.adminAudit()],
  );

export const useProposeConversionRate = () =>
  useAction<{ pointsPerMtt: number; effectiveFrom: string; reason: string }, Record<string, unknown>>(
    (v) => api.post("/admin/conversion/rates", v),
    [qk.adminConversionRates(), qk.adminApprovals(), qk.adminAudit()],
  );

export const useApproveConversionRate = () =>
  useAction<{ id: string; reason: string }, Record<string, unknown>>(
    (v) => api.patch(`/admin/conversion/rates/${v.id}/approve`, { reason: v.reason }),
    [qk.adminConversionRates(), qk.conversionRate(), qk.adminAudit()],
  );

export const useRejectConversionRate = () =>
  useAction<{ id: string; reason: string }, Record<string, unknown>>(
    (v) => api.patch(`/admin/conversion/rates/${v.id}/reject`, { reason: v.reason }),
    [qk.adminConversionRates(), qk.adminAudit()],
  );

export const useProposeCommissionPlan = () =>
  useAction<Record<string, unknown>, Record<string, unknown>>(
    (v) => api.post("/admin/referral/plans", v),
    [qk.adminCommissionPlans(), qk.adminApprovals(), qk.adminAudit()],
  );

export const useApproveCommissionPlan = () =>
  useAction<{ id: string; reason: string }, Record<string, unknown>>(
    (v) => api.patch(`/admin/referral/plans/${v.id}/approve`, { reason: v.reason }),
    [qk.adminCommissionPlans(), qk.adminAudit()],
  );

export const useSimulateCommissionPlan = () =>
  useAction<Record<string, unknown>, Record<string, unknown>>(
    (v) => api.post("/admin/referral/plans/simulate", v),
    [],
  );

export const useProposeTreasuryOutflow = () =>
  useAction<
    { destination: string; poolId?: number; amountMtt: string; rationale: string },
    Record<string, unknown>
  >(
    (v) => api.post("/admin/treasury/outflows/propose", v),
    [qk.adminTreasuryOutflows(), qk.adminApprovals(), qk.adminTreasuryDashboard(), qk.adminAudit()],
  );

export const useApproveTreasuryOutflow = () =>
  useAction<{ id: string; reason: string }, Record<string, unknown>>(
    (v) => api.post(`/admin/treasury/outflows/${v.id}/approve`, { reason: v.reason }),
    [qk.adminTreasuryOutflows(), qk.adminTreasuryDashboard(), qk.adminKpis(), qk.adminAudit()],
  );

export const useResolveFraudAlert = () =>
  useAction<{ ref: string; resolution: string; reason: string }, Record<string, unknown>>(
    (v) => api.patch(`/admin/fraud/alerts/${v.ref}/resolve`, v),
    [qk.adminFraudAlerts(), qk.adminKpis(), qk.adminAudit()],
  );

export const useAssignFraudAlert = () =>
  useAction<{ ref: string; assigneeId: string }, Record<string, unknown>>(
    (v) => api.patch(`/admin/fraud/alerts/${v.ref}/assign`, { assigneeId: v.assigneeId }),
    [qk.adminFraudAlerts()],
  );

export const useSetRolePermissions = () =>
  useAction<
    { role: string; module: string; canRead: boolean; canWrite: boolean; canApprove: boolean },
    Record<string, unknown>
  >((v) => api.put("/admin/permissions", v), [qk.adminPermissions(), qk.adminAudit()]);

export const useRequestApproval = () =>
  useAction<{ kind: string; targetId?: string; payload?: unknown; reason: string }, Record<string, unknown>>(
    (v) => api.post("/admin/approvals", v),
    [qk.adminApprovals(), qk.adminKpis()],
  );

export const useDecideApproval = () =>
  useAction<{ ref: string; decision: "approve" | "reject"; note: string }, Record<string, unknown>>(
    (v) => api.patch(`/admin/approvals/${v.ref}/decide`, { decision: v.decision, note: v.note }),
    [qk.adminApprovals(), qk.adminKpis(), qk.adminAudit()],
  );

export const useUpsertGame = () =>
  useAction<Record<string, unknown>, Record<string, unknown>>(
    (v) => api.put("/admin/games", v),
    [qk.adminGames(), qk.games(), qk.adminPointsRules(), qk.adminAudit()],
  );

export const useUpsertStakingPool = () =>
  useAction<Record<string, unknown>, Record<string, unknown>>(
    (v) => api.put("/admin/staking/pools", v),
    [qk.adminStakingPools(), qk.stakingPools(), qk.adminAudit()],
  );

export const useUpsertStoreItem = () =>
  useAction<Record<string, unknown>, Record<string, unknown>>(
    (v) => api.put("/admin/store/items", v),
    [qk.adminStoreItems(), qk.storeItems(), qk.adminAudit()],
  );

export const useUpsertQuest = () =>
  useAction<Record<string, unknown>, Record<string, unknown>>(
    (v) => api.put("/admin/quests", v),
    [qk.quests(), qk.adminAudit()],
  );

export const useSetFraudRules = () =>
  useAction<Record<string, unknown>, Record<string, unknown>>(
    (v) => api.put("/admin/fraud/rules", v),
    [qk.adminFraudRules(), qk.adminAudit()],
  );

export const usePublishLegalDocument = () =>
  useAction<{ id: string; reason: string }, Record<string, unknown>>(
    (v) => api.patch(`/admin/legal/documents/${v.id}/publish`, { reason: v.reason }),
    [qk.adminLegalDocuments(), qk.legalDocuments(), qk.adminAudit()],
  );

export const useSubmitLegalForReview = () =>
  useAction<{ id: string }, Record<string, unknown>>(
    (v) => api.patch(`/admin/legal/documents/${v.id}/submit-review`),
    [qk.adminLegalDocuments(), qk.adminAudit()],
  );

export const useUpsertCmsContent = () =>
  useAction<Record<string, unknown>, Record<string, unknown>>(
    (v) => api.put("/admin/legal/content", v),
    [qk.adminCmsContent(), qk.adminAudit()],
  );

export const useGenerateReport = () =>
  useAction<Record<string, unknown>, Record<string, unknown>>(
    (v) => api.post("/admin/reports", v),
    [],
  );

export const useAssignTicket = () =>
  useAction<{ ref: string; assigneeId: string }, Record<string, unknown>>(
    (v) => api.patch(`/admin/support/tickets/${v.ref}/assign`, { assigneeId: v.assigneeId }),
    [qk.adminTickets(), qk.adminKpis()],
  );

export const useEscalateTicket = () =>
  useAction<{ ref: string; reason: string }, Record<string, unknown>>(
    (v) => api.patch(`/admin/support/tickets/${v.ref}/escalate`, { reason: v.reason }),
    [qk.adminTickets(), qk.adminKpis()],
  );

export const useResolveTicket = () =>
  useAction<{ ref: string; resolution: string }, Record<string, unknown>>(
    (v) => api.patch(`/admin/support/tickets/${v.ref}/resolve`, { resolution: v.resolution }),
    [qk.adminTickets(), qk.adminKpis()],
  );

export const useReplyAsStaff = () =>
  useAction<{ ref: string; body: string; internal?: boolean }, Record<string, unknown>>(
    (v) => api.post(`/admin/support/tickets/${v.ref}/messages`, v),
    [qk.adminTickets()],
  );

export const useBroadcastNotification = () =>
  useAction<{ title: string; body: string; audience?: string }, Record<string, unknown>>(
    (v) => api.post("/admin/notifications/broadcast", v),
    [qk.adminAudit()],
  );
