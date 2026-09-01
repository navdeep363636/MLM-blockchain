"use client";

/* ============================================================================
 * In-flight withdrawals, shaped like transactions.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * `transactions` is the SETTLED ledger. Requesting a withdrawal moves the amount
 * from `mttAvailable` to `mttLockedForWithdrawal` and writes a `withdrawals` row
 * — it deliberately writes no transaction, because nothing has settled yet. The
 * transaction is created when the payout completes.
 *
 * That accounting is right, and it is why the member saw their balance drop and
 * their history stay empty for the whole 48-hour cooling-off window plus however
 * long compliance and the chain take. Money appearing to vanish is not an
 * acceptable state for a wallet, even a correct one.
 *
 * So the pending rows are fetched from the endpoint that already serves them and
 * projected into the `Transaction` shape the history table renders. That keeps
 * the ledger's meaning intact — nothing pretends to have settled — while giving
 * the member a row that says "requested, held until Tuesday".
 *
 * `completed` withdrawals are excluded: those DO have a real transaction row, and
 * including them would show every finished withdrawal twice.
 * ========================================================================== */

import { useMemo } from "react";

import { useWithdrawals } from "@/lib/hooks/use-data";
import type { StatusKind, Transaction } from "@/types";

/**
 * Withdrawal status -> the badge vocabulary the history table already speaks.
 *
 * Every withdrawal status has a direct counterpart in `StatusKind`, so nothing
 * here is a lossy approximation. An unrecognised status falls back to `pending`
 * rather than being dropped: a row the member cannot see is worse than a row
 * with a conservative label.
 */
const STATUS: Record<string, StatusKind> = {
  pending: "pending",
  cooling_off: "queued",
  review: "review",
  approved: "approved",
  processing: "processing",
  rejected: "rejected",
  cancelled: "cancelled",
  failed: "failed",
};

/** Source tags the Transaction type accepts; anything else is simply omitted. */
const SOURCE_TAGS = new Set(["gameplay", "staking", "referral"]);

function noteFor(status: string, coolingOffUntil?: string | null): string {
  if (status === "cooling_off" && coolingOffUntil) {
    return `Held until ${new Date(coolingOffUntil).toLocaleString()} — new-address cooling-off period`;
  }
  if (status === "review") return "Held for compliance review";
  if (status === "approved") return "Approved — waiting to be paid out";
  if (status === "processing") return "Payout submitted, waiting for confirmation";
  if (status === "rejected") return "Rejected by compliance";
  if (status === "cancelled") return "Cancelled";
  if (status === "failed") return "Payout failed — the amount was returned to your balance";
  return "Requested";
}

/**
 * The member's withdrawals that have not settled yet, as `Transaction` rows.
 *
 * Amounts are negative, matching how a settled withdrawal is recorded: value is
 * leaving the account.
 */
export function useInFlightWithdrawals(): { rows: Transaction[]; isLoading: boolean } {
  const { data, isLoading } = useWithdrawals();

  const rows = useMemo<Transaction[]>(
    () =>
      data
        .filter((w) => w.status !== "completed")
        .map((w) => {
          const tag = w.sourceTag && SOURCE_TAGS.has(w.sourceTag) ? w.sourceTag : undefined;
          return {
            id: w.ref,
            date: w.createdAt,
            type: "withdrawal",
            /* Negative: the amount has already left the available balance. */
            amountMtt: -Math.abs(Number(w.amountMtt) || 0),
            status: STATUS[w.status] ?? "pending",
            ...(w.txHash ? { txHash: w.txHash } : {}),
            ...(tag ? { sourceTag: tag as Transaction["sourceTag"] } : {}),
            note: noteFor(w.status, w.coolingOffUntil),
          };
        }),
    [data],
  );

  return { rows, isLoading };
}
