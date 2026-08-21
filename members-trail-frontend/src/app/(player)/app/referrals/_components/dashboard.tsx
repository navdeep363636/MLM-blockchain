"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight, Ban, Check, Copy, Gift, Info, Landmark, Link2, QrCode, Scale,
  Share2, ShieldCheck, TrendingUp, Users,
} from "lucide-react";
import {
  Badge, Button, Callout, CapMeter, DetailRow, InfoHint, KycBadge, LevelBadge,
  Modal, StatTile, useToast,
} from "@/components/ui";
import { BarSeries } from "@/components/charts";
import { Reveal } from "@/components/fx";
import { TxModal } from "@/components/web3";
import {
  useBalances, useCommissionHistory, useCurrentUser, useReferralSummary,
} from "@/lib/hooks/use-data";
import { useClaimCommission, useCommissionOnChain } from "@/lib/hooks/use-web3";
import { CONTRACTS_CONFIGURED, MTT_SYMBOL } from "@/lib/web3";
import { copyToClipboard, formatCurrency, formatToken } from "@/lib/utils";

const SHARE_TARGETS = [
  { label: "WhatsApp", href: (u: string, t: string) => `https://wa.me/?text=${encodeURIComponent(`${t} ${u}`)}` },
  { label: "Telegram", href: (u: string, t: string) => `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}` },
  { label: "X", href: (u: string, t: string) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}` },
  { label: "Email", href: (u: string, t: string) => `mailto:?subject=${encodeURIComponent("Members Trail")}&body=${encodeURIComponent(`${t}\n\n${u}`)}` },
];

/* Pre-approved copy — deliberately contains no income or earnings claims. */
const SHARE_TEXT =
  "I've been playing skill games on Members Trail. Free to join, no deposit needed — have a look if you're curious.";

export function ReferralDashboard() {
  const { data: summary } = useReferralSummary();
  const { data: commissions } = useCommissionHistory();
  const { data: balances } = useBalances();
  const { data: user } = useCurrentUser();
  const onChain = useCommissionOnChain();
  const { claim, ...tx } = useClaimCommission();
  const toast = useToast();

  const [qrOpen, setQrOpen] = useState(false);
  const [txOpen, setTxOpen] = useState(false);

  const claimable = onChain.balance ?? balances.commissionAvailable;
  const kycOk = user.kycTier === "tier1" || user.kycTier === "tier2";

  const copy = async (text: string, what: string) => {
    if (await copyToClipboard(text)) toast.success(`${what} copied`);
  };

  const doClaim = async () => {
    setTxOpen(true);
    if (CONTRACTS_CONFIGURED) await claim();
  };

  const byLevel = summary.byLevel.map((l) => ({
    level: `Level ${l.level}`,
    earned: l.earned,
    count: l.count,
  }));

  return (
    <>
      <Callout tone="brand" title="Referring is optional, capped, and never required to earn" icon={<Info />} className="mb-5">
        <p className="mt-1">
          Gameplay and staking already give you access to everything Members Trail pays out. This page
          exists in case you want to share the platform — not because you need to. Commission is paid
          on a referred player&apos;s real-money spend only, never on their stake or deposit, and it is
          capped monthly.
        </p>
      </Callout>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Direct referrals"
          value={summary.directCount}
          icon={<Users />}
          deltaLabel={`${summary.totalDownline} across all three levels`}
        />
        <StatTile
          label="Earned this month"
          value={summary.earnedThisMonth}
          decimals={2}
          suffix=" ₹"
          icon={<TrendingUp />}
          deltaLabel={`${formatToken(summary.earnedLifetime)} lifetime`}
        />
        <StatTile
          tone="brand"
          label="Available to claim"
          value={claimable}
          decimals={2}
          suffix={` ${MTT_SYMBOL}`}
          icon={<Gift />}
          deltaLabel={kycOk ? `≈ ${formatCurrency(claimable * balances.usdRate)}` : "Requires Tier 1 KYC to release"}
          footer={
            <Button
              size="xs"
              fullWidth
              disabled={!kycOk || claimable <= 0}
              onClick={doClaim}
            >
              {kycOk ? "Claim commission" : "Verify to claim"}
            </Button>
          }
        />
        <StatTile
          label="Pending release"
          value={balances.commissionPending}
          decimals={2}
          suffix={` ${MTT_SYMBOL}`}
          icon={<Landmark />}
          hint="Accrued but not yet released — either awaiting your KYC or awaiting the next Treasury deposit into the commission pool."
          deltaLabel="Awaiting KYC or pool funding"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        {/* Share tools */}
        <Reveal>
          <div className="h-full rounded-[var(--radius-panel)] border border-border-subtle bg-surface-1 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]">
                  <Link2 className="size-5" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-text-primary">Your referral link</h2>
                  <p className="text-xs text-text-muted">Free to share, free to join</p>
                </div>
              </div>
              <KycBadge tier={user.kycTier} />
            </div>

            <div className="mt-5 space-y-3">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">Code</p>
                <div className="flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-inset p-3">
                  <span className="font-mono-num min-w-0 flex-1 truncate text-lg font-semibold text-text-primary">
                    {summary.code}
                  </span>
                  <Button size="xs" variant="ghost" onClick={() => copy(summary.code, "Code")} icon={<Copy className="size-3.5" />}>
                    Copy
                  </Button>
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">Link</p>
                <div className="flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-inset p-3">
                  <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">{summary.link}</span>
                  <Button size="xs" variant="ghost" onClick={() => copy(summary.link, "Link")} icon={<Copy className="size-3.5" />}>
                    Copy
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setQrOpen(true)} icon={<QrCode className="size-3.5" />}>
                    QR
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Share with pre-approved copy
              </p>
              <div className="flex flex-wrap gap-2">
                {SHARE_TARGETS.map((t) => (
                  <Button
                    key={t.label}
                    size="sm"
                    variant="secondary"
                    href={t.href(summary.link, SHARE_TEXT)}
                    icon={<Share2 className="size-3.5" />}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
              <p className="mt-2.5 text-xs leading-relaxed text-text-muted">
                The message contains no earnings claims by design. Adding your own income claims
                breaches the{" "}
                <Link href="/legal/referral-terms" className="text-[var(--accent-hover)] underline underline-offset-2">
                  Referral Program Terms
                </Link>.
              </p>
            </div>

            <div className="mt-5 rounded-xl border border-border-subtle bg-surface-inset p-4">
              <CapMeter
                used={summary.monthlyCapUsed}
                cap={summary.monthlyCap}
                unit="₹"
                label={
                  <span className="inline-flex items-center gap-1">
                    Monthly commission cap
                    <InfoHint>
                      min(₹50,000 absolute, 5 × your trailing-3-month average real-money spend +
                      ₹5,000 base allowance). Amounts above the cap are not paid and do not carry
                      over to next month.
                    </InfoHint>
                  </span>
                }
              />
              <p className="tnum mt-2 text-xs text-text-muted">
                ₹{formatToken(summary.monthlyCap - summary.monthlyCapUsed, 0)} of headroom left this month
              </p>
            </div>
          </div>
        </Reveal>

        {/* By level */}
        <Reveal delay={0.08}>
          <div className="flex h-full flex-col gap-5">
            <BarSeries
              data={byLevel}
              xKey="level"
              series={[{ key: "earned", label: "Commission earned (₹)" }]}
              title="Earnings by level"
              description="Rates decrease sharply with depth: 8% / 3% / 1% of eligible spend."
              valueFormatter={(v) => `₹${formatToken(v)}`}
              height={200}
              footnote="Depth is capped at three levels. It does not go further, however large your network becomes."
            />

            <div className="flex-1 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
              <h3 className="text-sm font-semibold text-text-primary">Your network</h3>
              <ul className="mt-3 divide-y divide-border-subtle border-t border-border-subtle">
                {summary.byLevel.map((l) => (
                  <li key={l.level} className="flex items-center justify-between gap-3 py-2.5">
                    <LevelBadge level={l.level} />
                    <span className="tnum text-sm text-text-secondary">
                      {l.count} member{l.count === 1 ? "" : "s"}
                      <span className="ml-2 font-medium text-text-primary">₹{formatToken(l.earned)}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Button href="/app/referrals/tree" size="sm" variant="outline" iconRight={<ArrowRight className="size-3.5" />}>
                  Downline tree
                </Button>
                <Button href="/app/referrals/payouts" size="sm" variant="outline" iconRight={<ArrowRight className="size-3.5" />}>
                  Payout history
                </Button>
              </div>
            </div>
          </div>
        </Reveal>
      </div>

      {/* On-chain solvency */}
      <div className="mt-5 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]">
            <ShieldCheck className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">The on-chain solvency invariant</h3>
            <p className="text-xs text-text-muted">
              {onChain.onChain ? "Read live from the distributor contract" : "Contract not configured — showing the rule that applies"}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            { label: "Deposited from revenue", value: onChain.totalDeposited, tone: "text-good-400" },
            { label: "Recorded to users", value: onChain.totalRecorded, tone: "text-text-primary" },
            { label: "Claimed by users", value: onChain.totalClaimed, tone: "text-text-secondary" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border-subtle bg-surface-inset p-3.5">
              <p className="text-xs text-text-muted">{s.label}</p>
              <p className={`tnum mt-1 text-sm font-semibold ${s.tone}`}>
                {s.value != null ? `${formatToken(s.value)} ${MTT_SYMBOL}` : "—"}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3.5 text-sm leading-relaxed text-text-muted">
          The distributor contract enforces{" "}
          <code className="rounded bg-surface-3 px-1 font-mono text-[11px]">totalRecorded ≤ totalDeposited</code>{" "}
          as a hard requirement — a commission that would breach it reverts rather than being recorded.
          That is the on-chain expression of the rule that payouts come from real revenue and never
          from another member&apos;s deposit.
        </p>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {[
          { icon: <Ban className="size-4 text-good-400" />, title: "No joining fee", body: "Nobody pays to join through your link, and no part of any fee is passed upward." },
          { icon: <Scale className="size-4 text-warning-400" />, title: "Capped monthly", body: "Your ceiling is tied to your own genuine spending, keeping referral income secondary." },
          { icon: <Check className="size-4 text-info-400" />, title: "Real spend only", body: "Commission is calculated on purchases, entry fees and subscriptions — never stakes or deposits." },
        ].map((c) => (
          <div key={c.title} className="flex gap-3 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-4">
            <span className="mt-0.5 shrink-0">{c.icon}</span>
            <div>
              <p className="text-sm font-medium text-text-primary">{c.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{c.body}</p>
            </div>
          </div>
        ))}
      </div>

      {/* QR */}
      <Modal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title="Share your referral link"
        description="Anyone scanning this joins with your code pre-filled."
        icon={<QrCode className="size-5" />}
        size="sm"
        footer={<Button variant="ghost" onClick={() => setQrOpen(false)}>Close</Button>}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="grid size-44 place-items-center rounded-xl border border-border-default bg-white p-3">
            <svg viewBox="0 0 21 21" className="size-full" aria-label="Referral link QR code">
              <rect width="21" height="21" fill="#fff" />
              {Array.from({ length: 21 }).flatMap((_, y) =>
                Array.from({ length: 21 }).map((__, x) => {
                  const c = summary.code.charCodeAt((x * 3 + y * 5) % summary.code.length);
                  const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
                  const on = finder
                    ? !(x % 6 === 1 || y % 6 === 1) && !(x === 3 && y === 3)
                    : (c + x * 7 + y * 11) % 7 < 3;
                  return on ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#14110f" /> : null;
                }),
              )}
            </svg>
          </div>
          <p className="break-all text-center text-xs text-text-secondary">{summary.link}</p>
          <Button fullWidth variant="outline" onClick={() => copy(summary.link, "Link")} icon={<Copy className="size-4" />}>
            Copy link
          </Button>
        </div>
      </Modal>

      <TxModal
        open={txOpen}
        onClose={() => setTxOpen(false)}
        state={CONTRACTS_CONFIGURED ? tx : { phase: "success", reset: () => {} }}
        title="Claim commission"
        successMessage={
          CONTRACTS_CONFIGURED
            ? "Commission transferred to your wallet."
            : "Recorded against the demo ledger — no contract addresses are configured."
        }
        summary={
          <>
            <DetailRow label="Amount" value={`${formatToken(claimable)} ${MTT_SYMBOL}`} />
            <DetailRow label="KYC status" value={kycOk ? "Tier 1 approved" : "Not verified"} />
            <DetailRow label="Funded from" value="Commission pool (real revenue)" />
          </>
        }
      />
    </>
  );
}
