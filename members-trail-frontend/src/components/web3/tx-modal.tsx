"use client";

import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, PenLine } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import type { TxState } from "@/lib/hooks/use-web3";

/**
 * Transaction lifecycle modal. Covers every on-chain write in the app:
 * approve -> sign -> mine -> confirmed, with the BscScan link at every stage
 * where a hash exists (FRD W-05 requires on-chain proof to be reachable).
 */
export function TxModal({
  open, onClose, state, title, summary, successMessage, onSuccessAction,
}: {
  open: boolean;
  onClose: () => void;
  state: TxState;
  title: string;
  summary?: React.ReactNode;
  successMessage?: string;
  onSuccessAction?: { label: string; onClick: () => void };
}) {
  const { phase, explorerUrl, error } = state;
  const busy = phase === "awaiting_signature" || phase === "pending";

  const copy: Record<TxState["phase"], { heading: string; body: string }> = {
    idle: { heading: "Ready", body: "Review the details and confirm." },
    awaiting_signature: {
      heading: "Confirm in your wallet",
      body: "Approve the transaction in your wallet to continue. Nothing has been submitted yet.",
    },
    pending: {
      heading: "Transaction submitted",
      body: "Waiting for BNB Smart Chain to confirm. This usually takes a few seconds.",
    },
    success: { heading: "Confirmed", body: successMessage ?? "Your transaction is confirmed on-chain." },
    error: { heading: "Transaction failed", body: error ?? "Something went wrong. No funds were moved." },
  };

  const { heading, body } = copy[phase];

  return (
    <Modal
      open={open}
      onClose={onClose}
      hideClose={busy}
      title={title}
      size="sm"
      footer={
        phase === "success" ? (
          <>
            {explorerUrl && (
              <Button variant="ghost" href={explorerUrl} iconRight={<ExternalLink className="size-3.5" />}>
                View on BscScan
              </Button>
            )}
            {onSuccessAction ? (
              <Button onClick={onSuccessAction.onClick}>{onSuccessAction.label}</Button>
            ) : (
              <Button onClick={onClose}>Done</Button>
            )}
          </>
        ) : phase === "error" ? (
          <>
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button onClick={state.reset}>Try again</Button>
          </>
        ) : busy && explorerUrl ? (
          <Button variant="ghost" href={explorerUrl} iconRight={<ExternalLink className="size-3.5" />}>
            View on BscScan
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <span
          className={
            phase === "success"
              ? "grid size-14 place-items-center rounded-full bg-good-500/12 text-good-400"
              : phase === "error"
                ? "grid size-14 place-items-center rounded-full bg-critical-500/12 text-critical-400"
                : "grid size-14 place-items-center rounded-full bg-accent-soft text-[var(--accent)]"
          }
        >
          {phase === "success" ? (
            <CheckCircle2 className="size-7" />
          ) : phase === "error" ? (
            <AlertTriangle className="size-7" />
          ) : phase === "awaiting_signature" ? (
            <PenLine className="size-7" />
          ) : (
            <Loader2 className="size-7 animate-spin" />
          )}
        </span>

        <div>
          <p className="font-semibold text-text-primary">{heading}</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-text-muted">{body}</p>
        </div>

        {summary && (
          <div className="w-full rounded-xl border border-border-subtle bg-surface-inset p-3 text-left">
            {summary}
          </div>
        )}
      </div>
    </Modal>
  );
}
