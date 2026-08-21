"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowUpFromLine, Banknote, CheckCircle2, Clock, Info, ShieldAlert,
  ShieldCheck, Wallet, X,
} from "lucide-react";
import {
  Badge, Button, Callout, CapMeter, Checkbox, DataTable, DetailRow, InfoHint, Input,
  KycBadge, Modal, SegmentedControl, Select, StatusPill, useToast, type Column,
} from "@/components/ui";
import { useBalances, useCurrentUser, useTransactions } from "@/lib/hooks/use-data";
import { useMttBalance } from "@/lib/hooks/use-web3";
import { MTT_SYMBOL, txUrl } from "@/lib/web3";
import { clamp, formatCurrency, formatDate, formatToken, shortenHash } from "@/lib/utils";
import type { Transaction } from "@/types";
import { RelativeTime } from "../../../_components/time";

type Kind = "mtt" | "fiat";

/** Tier limits, in MTT. Tier 2 unlocks the higher band (FRD W-04 / AML policy). */
const TIER_LIMITS = { tier1: 25_000, tier2: 500_000 } as const;
const AUTO_APPROVE_THRESHOLD = 5_000;
const COOLING_OFF_HOURS = 48;

const SOURCE_OPTIONS = [
  { value: "gameplay", label: "Gameplay earnings" },
  { value: "staking", label: "Staking rewards" },
  { value: "referral", label: "Referral commission" },
];

export function WithdrawView() {
  const { data: balances } = useBalances();
  const { data: user } = useCurrentUser();
  const { data: txs } = useTransactions();
  const { balance: onChain } = useMttBalance();
  const toast = useToast();

  const available = onChain ?? balances.mttAvailable;
  const tier = user.kycTier === "tier2" ? "tier2" : "tier1";
  const tierLimit = TIER_LIMITS[tier];
  const kycOk = user.kycTier === "tier1" || user.kycTier === "tier2";

  const [kind, setKind] = useState<Kind>("mtt");
  const [amount, setAmount] = useState(1_000);
  const [destination, setDestination] = useState("");
  const [source, setSource] = useState("gameplay");
  const [whitelisted, setWhitelisted] = useState(true);
  const [ack, setAck] = useState({ address: false, irreversible: false });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [cancelling, setCancelling] = useState<Transaction | null>(null);

  const withdrawals = useMemo(() => txs.filter((t) => t.type === "withdrawal"), [txs]);
  const pendingCount = withdrawals.filter((t) => t.status === "pending" || t.status === "processing").length;

  /* Rolling 30-day usage against the tier limit. */
  const used30d = useMemo(() => {
    const newest = txs.reduce((m, t) => Math.max(m, Date.parse(t.date)), 0);
    const cutoff = newest - 30 * 86_400_000;
    return withdrawals
      .filter((t) => Date.parse(t.date) >= cutoff && t.status !== "failed" && t.status !== "cancelled")
      .reduce((s, t) => s + Math.abs(t.amountMtt), 0);
  }, [withdrawals, txs]);

  const limitRemaining = Math.max(0, tierLimit - used30d);
  const maxOut = Math.min(available, limitRemaining);
  const addressValid = kind === "fiat" || /^0x[a-fA-F0-9]{40}$/.test(destination.trim());
  const needsReview = amount > AUTO_APPROVE_THRESHOLD;
  const overLimit = amount > limitRemaining;
  const canSubmit =
    kycOk && amount > 0 && amount <= maxOut && addressValid && ack.address && ack.irreversible;

  const columns: Column<Transaction>[] = [
    {
      key: "date",
      header: "Requested",
      cell: (t) => (
        <span className="whitespace-nowrap">
          <span className="tnum block text-text-primary">{formatDate(t.date, true)}</span>
          <span className="block text-xs text-text-muted"><RelativeTime date={t.date} /></span>
        </span>
      ),
      sortValue: (t) => t.date,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (t) => (
        <span className="tnum font-medium text-text-primary">
          {formatToken(Math.abs(t.amountMtt))} {MTT_SYMBOL}
          {t.amountFiat != null && (
            <span className="block text-xs font-normal text-text-muted">{formatCurrency(t.amountFiat)}</span>
          )}
        </span>
      ),
      sortValue: (t) => Math.abs(t.amountMtt),
    },
    {
      key: "source",
      header: "Source tag",
      hideBelow: "md",
      cell: (t) => (
        <Badge tone={t.sourceTag === "referral" ? "warning" : t.sourceTag === "staking" ? "info" : "neutral"}>
          {t.sourceTag ? SOURCE_OPTIONS.find((s) => s.value === t.sourceTag)?.label ?? t.sourceTag : "—"}
        </Badge>
      ),
      sortValue: (t) => t.sourceTag ?? "",
    },
    { key: "status", header: "Status", cell: (t) => <StatusPill status={t.status} /> },
    {
      key: "proof",
      header: "Proof",
      align: "right",
      hideBelow: "lg",
      cell: (t) =>
        t.txHash ? (
          <a
            href={txUrl(t.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono-num text-xs text-[var(--accent-hover)] hover:underline"
          >
            {shortenHash(t.txHash)}
          </a>
        ) : (
          <span className="text-xs text-text-muted">—</span>
        ),
    },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (t) =>
        t.status === "pending" ? (
          <Button size="xs" variant="ghost" onClick={() => setCancelling(t)}>Cancel</Button>
        ) : null,
    },
  ];

  const submit = async () => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 1100));
    setBusy(false);
    setConfirmOpen(false);
    setSubmitted(true);
  };

  return (
    <>
      {!kycOk && (
        <Callout tone="critical" title="Withdrawals require Tier 1 KYC" icon={<AlertTriangle />} className="mb-5">
          <p className="mt-1">
            Identity verification is required before any real-money withdrawal, whatever the source
            of the funds. Your balance is safe in the meantime.
          </p>
          <Button href="/kyc" size="sm" className="mt-3">Complete verification</Button>
        </Callout>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface-1 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]">
                <ArrowUpFromLine className="size-5" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-text-primary">Request a withdrawal</h2>
                <p className="text-xs text-text-muted">From your available, unlocked balance</p>
              </div>
            </div>
            <KycBadge tier={user.kycTier} />
          </div>

          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Withdrawal type</p>
            <SegmentedControl
              value={kind}
              onValueChange={(v) => setKind(v)}
              options={[
                { value: "mtt", label: `${MTT_SYMBOL} to wallet`, icon: <Wallet className="size-3.5" /> },
                { value: "fiat", label: "Fiat payout", icon: <Banknote className="size-3.5" /> },
              ]}
            />
          </div>

          <div className="mt-5 rounded-xl border border-border-subtle bg-surface-inset p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Amount</span>
              <button
                onClick={() => setAmount(Math.floor(maxOut))}
                disabled={maxOut <= 0}
                className="text-xs font-medium text-[var(--accent-hover)] hover:underline disabled:text-text-muted disabled:no-underline"
              >
                Max {formatToken(maxOut)}
              </button>
            </div>
            <input
              type="number"
              min={0}
              max={maxOut}
              value={amount}
              onChange={(e) => setAmount(clamp(Number(e.target.value) || 0, 0, Math.floor(maxOut)))}
              aria-label={`Amount to withdraw in ${MTT_SYMBOL}`}
              className="tnum mt-2 w-full bg-transparent font-display text-3xl font-semibold tracking-tight text-text-primary outline-none"
            />
            <p className="mt-1 text-xs text-text-muted">
              ≈ {formatCurrency(amount * balances.usdRate)} · available {formatToken(available)} {MTT_SYMBOL}
            </p>
          </div>

          <div className="mt-4">
            <CapMeter
              used={used30d + amount}
              cap={tierLimit}
              unit=""
              label={
                <span className="inline-flex items-center gap-1">
                  30-day limit ({tier === "tier2" ? "Tier 2" : "Tier 1"})
                  <InfoHint>
                    Tier 1 allows up to {formatToken(TIER_LIMITS.tier1, 0)} {MTT_SYMBOL} per rolling
                    30 days. Tier 2 verification — proof of address — raises this to{" "}
                    {formatToken(TIER_LIMITS.tier2, 0)}.
                  </InfoHint>
                </span>
              }
            />
            {overLimit && (
              <p className="mt-2 text-xs font-medium text-critical-400">
                Exceeds your remaining 30-day allowance of {formatToken(limitRemaining)} {MTT_SYMBOL}.
                {tier === "tier1" && " Complete Tier 2 verification to raise the limit."}
              </p>
            )}
          </div>

          {kind === "mtt" ? (
            <div className="mt-5">
              <Input
                label="Destination address"
                required
                placeholder="0x…"
                value={destination}
                onChange={(e) => { setDestination(e.target.value); setAck((a) => ({ ...a, address: false })); }}
                error={destination.length > 0 && !addressValid && "Enter a valid BSC (BEP-20) address."}
                hint="BNB Smart Chain only. Double-check every character — on-chain transfers cannot be reversed."
              />
              <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl border border-border-subtle bg-surface-inset p-3.5">
                <input
                  type="checkbox"
                  checked={whitelisted}
                  onChange={(e) => setWhitelisted(e.target.checked)}
                  className="mt-0.5 size-4 accent-[var(--accent)]"
                />
                <span className="text-sm text-text-secondary">
                  <span className="font-medium text-text-primary">This is an address I&apos;ve used before</span> —
                  uncheck if it&apos;s new, and the {COOLING_OFF_HOURS}-hour cooling-off period will apply.
                </span>
              </label>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <Input label="Account holder name" required placeholder="As registered with your bank" hint="Must match your KYC-verified name exactly." />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Account number" required placeholder="••••••••1234" />
                <Input label="IFSC / SWIFT" required placeholder="HDFC0001234" />
              </div>
            </div>
          )}

          <Select
            className="mt-4"
            label="Source of these funds"
            options={SOURCE_OPTIONS}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            hint="Tagged for AML monitoring. Declaring it accurately speeds up review."
          />

          {!whitelisted && kind === "mtt" && (
            <Callout tone="warning" title={`${COOLING_OFF_HOURS}-hour cooling-off period`} icon={<Clock />} className="mt-4">
              <p className="mt-1">
                New or changed destination addresses are held for {COOLING_OFF_HOURS} hours before the
                first withdrawal is released. It&apos;s an anti-fraud control: if someone compromises
                your account and swaps the payout address, that window is what lets you and our
                compliance team catch it.
              </p>
            </Callout>
          )}

          {needsReview && (
            <Callout tone="serious" title="Manual compliance review" icon={<ShieldAlert />} className="mt-4">
              <p className="mt-1">
                Withdrawals above {formatToken(AUTO_APPROVE_THRESHOLD, 0)} {MTT_SYMBOL} route to the
                compliance queue. That is a standard AML control, not a signal that anything is wrong
                with your account. Expect a decision within one business day.
              </p>
            </Callout>
          )}

          <div className="mt-5 space-y-2.5 border-t border-border-subtle pt-4">
            <Checkbox
              checked={ack.address}
              onCheckedChange={(v) => setAck((a) => ({ ...a, address: v }))}
              label={
                kind === "mtt"
                  ? "I've verified the destination address character by character."
                  : "I've verified the bank details, and the account is in my own name."
              }
            />
            <Checkbox
              checked={ack.irreversible}
              onCheckedChange={(v) => setAck((a) => ({ ...a, irreversible: v }))}
              label="I understand a completed transfer cannot be reversed by Members Trail or by support."
            />
          </div>

          <Button fullWidth size="lg" className="mt-5" disabled={!canSubmit} onClick={() => setConfirmOpen(true)}>
            {kycOk ? "Review withdrawal" : "Verify identity to withdraw"}
          </Button>
        </div>

        <div className="space-y-5">
          <div className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
            <h3 className="text-sm font-semibold text-text-primary">Before you withdraw</h3>
            <ul className="mt-4 space-y-3.5">
              {[
                { icon: <ShieldCheck className="size-4 text-good-400" />, title: "Your principal is never withheld", body: "Staked MTT returns in full on unstake. Early exit only ever penalises unclaimed rewards." },
                { icon: <Clock className="size-4 text-warning-400" />, title: "New addresses wait 48 hours", body: "First withdrawal to a new address is held as an anti-fraud measure." },
                { icon: <ShieldAlert className="size-4 text-serious-400" />, title: "Large amounts get reviewed", body: `Above ${formatToken(AUTO_APPROVE_THRESHOLD, 0)} ${MTT_SYMBOL} a compliance officer checks it.` },
                { icon: <Info className="size-4 text-info-400" />, title: "Source is tagged, not judged", body: "Gameplay, staking and referral funds are tagged for monitoring. All three are withdrawable." },
              ].map((r) => (
                <li key={r.title} className="flex gap-3">
                  <span className="mt-0.5 shrink-0">{r.icon}</span>
                  <div>
                    <p className="text-sm font-medium text-text-primary">{r.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{r.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1">
            <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">Withdrawal history</h3>
                <p className="mt-0.5 text-xs text-text-muted">
                  {pendingCount > 0 ? `${pendingCount} request${pendingCount > 1 ? "s" : ""} in progress` : "No requests in progress"}
                </p>
              </div>
              {pendingCount > 0 && <Badge tone="warning" dot>{pendingCount} pending</Badge>}
            </div>
            <DataTable
              columns={columns}
              rows={withdrawals}
              keyOf={(t) => t.id}
              pageSize={8}
              dense
              caption="Your withdrawal requests, with on-chain proof where available"
              empty={{ title: "No withdrawals yet", description: "Your requests and their on-chain proof will appear here." }}
            />
          </div>
        </div>
      </div>

      {/* Confirm */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm withdrawal request"
        icon={<ArrowUpFromLine className="size-5" />}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Back</Button>
            <Button loading={busy} onClick={submit}>Submit request</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
            <DetailRow label="Type" value={kind === "mtt" ? `${MTT_SYMBOL} to external wallet` : "Fiat payout"} />
            <DetailRow label="Amount" value={`${formatToken(amount)} ${MTT_SYMBOL}`} />
            <DetailRow label="Estimated value" value={formatCurrency(amount * balances.usdRate)} />
            {kind === "mtt" && (
              <DetailRow label="Destination" mono value={`${destination.slice(0, 10)}…${destination.slice(-6)}`} />
            )}
            <DetailRow label="Source tag" value={SOURCE_OPTIONS.find((s) => s.value === source)?.label ?? source} />
            <DetailRow
              label="Expected route"
              value={needsReview ? "Compliance review" : !whitelisted ? "48h cooling-off" : "Auto-process"}
            />
          </div>
          <Callout tone="warning" title="This cannot be undone once processed" icon={<AlertTriangle />}>
            <p className="mt-1">
              You can cancel while the request is still pending. Once it moves to processing, the
              transfer is on its way and Members Trail cannot recall it.
            </p>
          </Callout>
        </div>
      </Modal>

      {/* Submitted */}
      <Modal
        open={submitted}
        onClose={() => setSubmitted(false)}
        title="Withdrawal requested"
        icon={<CheckCircle2 className="size-5" />}
        size="sm"
        footer={
          <>
            <Button variant="ghost" href="/app/wallet/history">Track it</Button>
            <Button onClick={() => setSubmitted(false)}>Done</Button>
          </>
        }
      >
        <div className="py-2 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-good-500/12 text-good-400">
            <CheckCircle2 className="size-7" />
          </span>
          <p className="mt-4 font-semibold text-text-primary">
            {formatToken(amount)} {MTT_SYMBOL} requested
          </p>
          <p className="mx-auto mt-2 max-w-xs text-sm text-text-muted">
            {needsReview
              ? "Routed to compliance review. You'll be notified when a decision is made — usually within one business day."
              : !whitelisted
                ? `Held for the ${COOLING_OFF_HOURS}-hour new-address cooling-off period, then processed automatically.`
                : "Below the review threshold, so it processes automatically. You'll get the transaction hash on completion."}
          </p>
          <Badge tone={needsReview ? "serious" : "warning"} className="mt-4" dot>
            {needsReview ? "In review" : "Pending"}
          </Badge>
        </div>
      </Modal>

      {/* Cancel pending */}
      <Modal
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        title="Cancel this withdrawal?"
        icon={<X className="size-5" />}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelling(null)}>Keep request</Button>
            <Button
              variant="danger"
              onClick={() => {
                toast.success("Withdrawal cancelled", "The amount is back in your available balance.");
                setCancelling(null);
              }}
            >
              Cancel withdrawal
            </Button>
          </>
        }
      >
        {cancelling && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
              <DetailRow label="Reference" mono value={cancelling.id} />
              <DetailRow label="Amount" value={`${formatToken(Math.abs(cancelling.amountMtt))} ${MTT_SYMBOL}`} />
              <DetailRow label="Requested" value={formatDate(cancelling.date, true)} />
            </div>
            <p className="text-sm leading-relaxed text-text-secondary">
              The full amount returns to your available balance immediately. You can submit a new
              request at any time.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
