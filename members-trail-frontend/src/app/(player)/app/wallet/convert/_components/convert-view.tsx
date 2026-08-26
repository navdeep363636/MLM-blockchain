"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, CheckCircle2, Coins, Info, Repeat, Sparkles, TriangleAlert,
} from "lucide-react";
import {
  Badge, Button, Callout, CapMeter, Checkbox, DataTable, DetailRow, InfoHint,
  KycBadge, Modal, Slider, StatTile, useToast, type Column,
} from "@/components/ui";
import { useBalances, useCurrentUser, usePointsHistory } from "@/lib/hooks/use-data";
import { useConversionRate, usePublicConfig } from "@/lib/hooks/use-data";
import { humanMessage } from "@/lib/api/errors";
import { useConvertPoints } from "@/lib/hooks/use-mutations";
import { MTT_SYMBOL } from "@/lib/web3";
import { clamp, formatCurrency, formatDate, formatNumber, formatToken } from "@/lib/utils";
import type { PointsEntry } from "@/types";
import { RelativeTime } from "../../../_components/time";

export function ConvertView() {
  const toast = useToast();
  const { data: balances } = useBalances();
  const { data: user } = useCurrentUser();
  const { data: points } = usePointsHistory();

  /* The rate and the caps come from the server. The active rate matters twice
   * over here: it decides what the member is quoted, AND it is sent back with the
   * confirmation so the server can refuse if a scheduled change landed in
   * between — otherwise a rate change mid-flow silently gives them a different
   * amount than the one they agreed to. */
  const { data: rateInfo } = useConversionRate();
  const { data: policy } = usePublicConfig();
  const convertPoints = useConvertPoints();

  const activeRate = {
    pointsPerMtt: rateInfo.pointsPerMtt,
    effectiveFrom: rateInfo.effectiveFrom,
    status: "active" as const,
  };
  const scheduled =
    rateInfo.nextPointsPerMtt !== null && rateInfo.nextEffectiveFrom !== null
      ? {
          pointsPerMtt: rateInfo.nextPointsPerMtt,
          effectiveFrom: rateInfo.nextEffectiveFrom,
          status: "scheduled" as const,
        }
      : undefined;

  const caps = {
    perUserDaily: Number(policy.conversion.perUserDailyPoints),
    perUserMonthly: Number(policy.conversion.perUserMonthlyPoints),
  };

  /* Daily cap already used today — derived from the ledger's conversion entries. */
  const usedToday = useMemo(() => {
    const newest = points.reduce((m, p) => Math.max(m, Date.parse(p.date)), 0);
    const dayStart = new Date(newest).setUTCHours(0, 0, 0, 0);
    return points
      .filter((p) => p.source === "conversion" && Date.parse(p.date) >= dayStart)
      .reduce((s, p) => s + Math.abs(p.amount), 0);
  }, [points]);

  const capRemaining = Math.max(0, caps.perUserDaily - usedToday);
  const maxConvertible = Math.min(balances.points, capRemaining);

  const [amount, setAmount] = useState(() => Math.min(10_000, Math.max(0, maxConvertible)));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [doneAmount, setDoneAmount] = useState<number | null>(null);

  const kycOk = user.kycTier === "tier1" || user.kycTier === "tier2";
  const mttOut = amount / activeRate.pointsPerMtt;
  const capBinding = amount >= capRemaining && capRemaining < balances.points;

  const history = useMemo(
    () => points.filter((p) => p.source === "conversion"),
    [points],
  );

  const columns: Column<PointsEntry>[] = [
    {
      key: "date",
      header: "Date",
      cell: (e) => (
        <span className="whitespace-nowrap">
          <span className="tnum block text-text-primary">{formatDate(e.date, true)}</span>
          <span className="block text-xs text-text-muted"><RelativeTime date={e.date} /></span>
        </span>
      ),
      sortValue: (e) => e.date,
    },
    {
      key: "points",
      header: "Points converted",
      align: "right",
      cell: (e) => <span className="tnum text-text-secondary">{formatNumber(Math.abs(e.amount))}</span>,
      sortValue: (e) => Math.abs(e.amount),
    },
    {
      key: "mtt",
      header: `${MTT_SYMBOL} received`,
      align: "right",
      cell: (e) => (
        <span className="tnum font-medium text-text-primary">
          {formatToken(Math.abs(e.amount) / activeRate.pointsPerMtt)}
        </span>
      ),
      sortValue: (e) => Math.abs(e.amount),
    },
    {
      key: "ref",
      header: "Ref",
      align: "right",
      hideBelow: "md",
      cell: (e) => <span className="font-mono-num text-xs text-text-muted">{e.id}</span>,
    },
  ];

  const convert = async () => {
    setBusy(true);
    try {
      await convertPoints.mutateAsync({
        points: amount,
        /* Sent so the server can refuse if the rate moved between the quote and
         * this confirmation. Without it a scheduled change landing mid-flow gives
         * the member a different amount than the one they just agreed to. */
        expectedPointsPerMtt: activeRate.pointsPerMtt,
      });
      setDoneAmount(amount);
      setConfirmOpen(false);
      setAck(false);
    } catch (err) {
      toast.error("Conversion failed", humanMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!kycOk && (
        <Callout tone="warning" title="Tier 1 KYC required to convert" icon={<AlertTriangle />} className="mb-5">
          <p className="mt-1">
            Conversion is gated on identity verification. Your Points keep accruing in the meantime —
            nothing is lost by verifying later, but you can&apos;t convert until it&apos;s done.
          </p>
          <Button href="/kyc" size="sm" className="mt-3">Complete verification</Button>
        </Callout>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        {/* Converter */}
        <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface-1 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]">
                <Repeat className="size-5" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-text-primary">Convert Points</h2>
                <p className="text-xs text-text-muted">Current published rate</p>
              </div>
            </div>
            <Badge tone="brand">
              {formatNumber(activeRate.pointsPerMtt)} Points = 1 {MTT_SYMBOL}
            </Badge>
          </div>

          {/* From / to */}
          <div className="mt-6 space-y-3">
            <div className="rounded-xl border border-border-subtle bg-surface-inset p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  <Sparkles className="size-3.5" /> You convert
                </span>
                <button
                  onClick={() => setAmount(maxConvertible)}
                  disabled={maxConvertible <= 0}
                  className="text-xs font-medium text-[var(--accent-hover)] hover:underline disabled:text-text-muted disabled:no-underline"
                >
                  Max {formatNumber(maxConvertible)}
                </button>
              </div>
              <input
                type="number"
                value={amount}
                min={0}
                max={maxConvertible}
                onChange={(e) => setAmount(clamp(Number(e.target.value) || 0, 0, maxConvertible))}
                aria-label="Points to convert"
                className="tnum mt-2 w-full bg-transparent font-display text-3xl font-semibold tracking-tight text-text-primary outline-none placeholder:text-text-muted"
              />
              <p className="mt-1 text-xs text-text-muted">
                Balance {formatNumber(balances.points)} Points
              </p>
            </div>

            <div className="flex justify-center">
              <span className="grid size-8 place-items-center rounded-full border border-border-default bg-surface-2 text-text-muted">
                <ArrowRight className="size-4 rotate-90" />
              </span>
            </div>

            <div className="rounded-xl border border-[var(--accent-ring)] bg-accent-soft p-4">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--accent-hover)]">
                <Coins className="size-3.5" /> You receive
              </span>
              <p className="tnum mt-2 font-display text-3xl font-semibold tracking-tight text-text-primary">
                {formatToken(mttOut, 4)}
                <span className="ml-2 text-base font-medium text-text-muted">{MTT_SYMBOL}</span>
              </p>
              <p className="mt-1 text-xs text-text-muted">
                ≈ {formatCurrency(mttOut * balances.usdRate)} at the current estimate
              </p>
            </div>
          </div>

          <Slider
            className="mt-5"
            label="Adjust amount"
            value={amount}
            onValueChange={setAmount}
            min={0}
            max={Math.max(maxConvertible, 1)}
            step={100}
            formatValue={(v) => `${formatNumber(v)} pts`}
          />

          <div className="mt-5 rounded-xl border border-border-subtle bg-surface-inset p-4">
            <CapMeter
              used={usedToday + amount}
              cap={caps.perUserDaily}
              label={
                <span className="inline-flex items-center gap-1">
                  Daily conversion cap
                  <InfoHint>
                    Per-user daily and monthly caps are enforced server-side to control token
                    emission and make Points farming unprofitable. Unused allowance does not roll
                    over.
                  </InfoHint>
                </span>
              }
            />
            <p className="tnum mt-2 text-xs text-text-muted">
              {formatNumber(capRemaining)} Points of today&apos;s allowance remaining ·
              monthly cap {formatNumber(caps.perUserMonthly)}
            </p>
          </div>

          {capBinding && (
            <Callout tone="warning" title="You're at today's cap" icon={<TriangleAlert />} className="mt-4">
              <p className="mt-1">
                You hold more Points than you can convert today. The remainder stays in your balance —
                convert it tomorrow when the allowance resets at 00:00 UTC.
              </p>
            </Callout>
          )}

          <Button
            fullWidth
            size="lg"
            className="mt-5"
            disabled={!kycOk || amount <= 0 || amount > maxConvertible}
            onClick={() => setConfirmOpen(true)}
          >
            {kycOk ? `Convert ${formatNumber(amount)} Points` : "Verify identity to convert"}
          </Button>

          {kycOk && <KycBadge tier={user.kycTier} className="mt-3" />}
        </div>

        {/* Rate transparency */}
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatTile
              label="Points balance"
              value={balances.points}
              icon={<Sparkles />}
              deltaLabel={`+${formatNumber(balances.pointsToday)} today`}
              compact
            />
            <StatTile
              label="Lifetime converted"
              value={history.reduce((s, h) => s + Math.abs(h.amount), 0)}
              icon={<Repeat />}
              deltaLabel={`Across ${history.length} conversions`}
              compact
            />
          </div>

          <div className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
            <h3 className="text-sm font-semibold text-text-primary">How this rate is set</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              A Finance Admin proposes the rate and a second authorised admin must approve it — the
              four-eyes principle. Changes take a scheduled effective date and are never applied
              retroactively. The full history is permanently retained and published on the{" "}
              <Link href="/tokenomics" className="text-[var(--accent-hover)] underline underline-offset-2">
                public Tokenomics page
              </Link>.
            </p>

            {scheduled && (
              <Callout tone="info" title="Rate change ahead" icon={<Info />} className="mt-4">
                <p className="mt-1">
                  From {formatDate(scheduled.effectiveFrom)} the rate becomes{" "}
                  <span className="tnum font-medium text-text-primary">
                    {formatNumber(scheduled.pointsPerMtt)} Points = 1 {MTT_SYMBOL}
                  </span>
                  . Converting before then uses the current rate.
                </p>
              </Callout>
            )}

            <ul className="mt-4 divide-y divide-border-subtle border-t border-border-subtle">
              {[activeRate, ...(scheduled ? [scheduled] : [])].map((r) => (
                <li key={r.effectiveFrom} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="tnum text-text-secondary">
                    {formatNumber(r.pointsPerMtt)} : 1
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tnum text-xs text-text-muted">{formatDate(r.effectiveFrom)}</span>
                    {r.status === "active" ? (
                      <Badge tone="good" dot>Active</Badge>
                    ) : (
                      <Badge tone="warning" dot>Scheduled</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1">
            <div className="border-b border-border-subtle px-5 py-4">
              <h3 className="text-sm font-semibold text-text-primary">Your conversion history</h3>
            </div>
            <DataTable
              columns={columns}
              rows={history}
              keyOf={(e) => e.id}
              pageSize={6}
              dense
              caption="Your past Points to MTT conversions"
              empty={{ title: "No conversions yet", description: "Your first conversion will appear here." }}
            />
          </div>
        </div>
      </div>

      {/* Confirm */}
      <Modal
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false); setAck(false); }}
        title="Confirm conversion"
        description="Points are debited immediately; MTT arrives after one block confirmation."
        icon={<Repeat className="size-5" />}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setConfirmOpen(false); setAck(false); }}>Cancel</Button>
            <Button loading={busy} disabled={!ack} onClick={convert}>Confirm conversion</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
            <DetailRow label="Points debited" value={formatNumber(amount)} />
            <DetailRow label="Rate applied" value={`${formatNumber(activeRate.pointsPerMtt)} : 1`} />
            <DetailRow
              label={`${MTT_SYMBOL} received`}
              value={<span className="text-[var(--accent-hover)]">{formatToken(mttOut, 4)}</span>}
            />
            <DetailRow label="Destination" value={<span className="font-mono-num text-xs">{user.walletAddress?.slice(0, 10)}…{user.walletAddress?.slice(-6)}</span>} />
            <DetailRow label="Network fee" value="Paid by the platform" />
          </div>

          <Callout tone="info" title="This is a one-way conversion" icon={<Info />}>
            <p className="mt-1">
              Points cannot be recovered once converted. MTT is drawn from the pre-allocated
              Play-to-Earn pool — there is no mint function, so conversions never inflate supply.
            </p>
          </Callout>

          <Checkbox
            checked={ack}
            onCheckedChange={setAck}
            label={`I understand this converts ${formatNumber(amount)} Points into ${formatToken(mttOut, 4)} ${MTT_SYMBOL} at the current published rate, and that it cannot be reversed.`}
          />
        </div>
      </Modal>

      {/* Success */}
      <Modal
        open={doneAmount != null}
        onClose={() => setDoneAmount(null)}
        title="Conversion submitted"
        icon={<CheckCircle2 className="size-5" />}
        size="sm"
        footer={
          <>
            <Button variant="ghost" href="/app/wallet/history">View history</Button>
            <Button onClick={() => setDoneAmount(null)}>Done</Button>
          </>
        }
      >
        <div className="py-2 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-good-500/12 text-good-400">
            <CheckCircle2 className="size-7" />
          </span>
          <p className="mt-4 font-semibold text-text-primary">
            {formatNumber(doneAmount ?? 0)} Points → {formatToken((doneAmount ?? 0) / activeRate.pointsPerMtt, 4)} {MTT_SYMBOL}
          </p>
          <p className="mx-auto mt-2 max-w-xs text-sm text-text-muted">
            Your Points ledger is already debited. The on-chain transfer typically confirms within one
            BSC block — you&apos;ll get a notification with the transaction hash.
          </p>
        </div>
      </Modal>
    </>
  );
}
