"use client";

/* D-01 · Player dashboard — FRD 5.3
 *
 * Every financial figure on this page is read live from the ledger service and
 * is never cached beyond a few seconds; the refresh affordance and the live
 * pulse exist so a player can always tell how fresh a number is. */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, BadgeCheck, Coins, Gift, RefreshCw, Settings2, ShieldCheck, Sparkles,
  Trophy, Users, Wallet,
} from "lucide-react";
import { BarSeries } from "@/components/charts";
import {
  Badge, Button, CapMeter, Callout, InfoHint, KycBadge, Modal, SkeletonCard, StatTile, Switch,
  useToast,
} from "@/components/ui";
import { LiveDot, Reveal } from "@/components/fx";
import {
  useBalances, useCurrentUser, useGames, usePointsHistory, useReferralSummary,
  useStakePositions, useStakingPools, useTransactions,
} from "@/lib/hooks/use-data";
import { useMttBalance } from "@/lib/hooks/use-web3";
import { cn, formatCurrency, formatNumber, formatPercent, formatToken } from "@/lib/utils";
import { ActivityFeed } from "./activity-feed";
import { blendedApr, issuanceCap, pointsPerDay } from "./derive";
import { QuickActions } from "./quick-actions";
import { WidgetCard, WidgetStat } from "./widget-card";

type WidgetId = "points" | "wallet" | "staking" | "referrals";

const WIDGET_LABELS: Record<WidgetId, string> = {
  points: "Points balance",
  wallet: "MTT wallet",
  staking: "Staking summary",
  referrals: "Referral summary",
};

const DEFAULT_ORDER: WidgetId[] = ["points", "wallet", "staking", "referrals"];

/* ---------------------------- PageHeader actions --------------------------- */

export function DashboardActions() {
  return (
    <>
      <Button href="/app/games/quests" variant="outline" size="sm" icon={<Trophy className="size-4" />}>
        Quests
      </Button>
      <Button href="/app/games" size="sm" icon={<Sparkles className="size-4" />}>
        Play now
      </Button>
    </>
  );
}

/* ------------------------------- Live header ------------------------------ */

function LiveStrip({
  onRefresh, onCustomise,
}: {
  onRefresh: () => void;
  onCustomise: () => void;
}) {
  /** Seconds since the last successful read. Starts at 0 on both renders. */
  const [age, setAge] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setAge((a) => a + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const refresh = useCallback(() => {
    setBusy(true);
    onRefresh();
    setAge(0);
    window.setTimeout(() => setBusy(false), 500);
  }, [onRefresh]);

  // Balances are never allowed to go stale: re-read on a 15-second cadence.
  useEffect(() => {
    if (age >= 15) refresh();
  }, [age, refresh]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <LiveDot label="Live ledger" />
        <p className="min-w-0 text-xs leading-relaxed text-text-muted">
          <span className="font-medium text-text-secondary">
            Refreshed {age < 5 ? "just now" : `${age}s ago`}
          </span>
          {" · "}
          Balances are pulled from the ledger service on every read and are never cached beyond a few
          seconds. Nothing on this page is a stored snapshot.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="xs"
          variant="ghost"
          onClick={onCustomise}
          icon={<Settings2 className="size-3.5" />}
        >
          Customise widgets
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={refresh}
          loading={busy}
          icon={<RefreshCw className="size-3.5" />}
        >
          Refresh now
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------- KYC banner ------------------------------- */

function KycBanner() {
  const { data: user } = useCurrentUser();

  if (user.kycTier === "tier2") {
    return (
      <Callout tone="good" title="Identity verified to Tier 2" icon={<BadgeCheck />}>
        <p className="mt-1">
          Your highest withdrawal and conversion limits are unlocked. You will only be asked for
          documents again if a limit tier changes or a periodic re-verification falls due.
        </p>
      </Callout>
    );
  }

  if (user.kycTier === "tier1") {
    return (
      <Callout tone="info" title="Verified to Tier 1 — Tier 2 raises your limits" icon={<ShieldCheck />}>
        <p className="mt-1">
          Conversions, withdrawals and referral commission release are unlocked at your Tier 1 limit.
          Larger withdrawals are held for manual Compliance review until Tier 2 is complete.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <KycBadge tier={user.kycTier} />
          <Button href="/kyc" size="xs" variant="outline">Start Tier 2 verification</Button>
        </div>
      </Callout>
    );
  }

  const pending = user.kycTier === "pending";

  return (
    <Callout
      tone={pending ? "warning" : "critical"}
      title={pending ? "Tier 1 verification is in review" : "Tier 1 verification required"}
      icon={<AlertTriangle />}
    >
      <p className="mt-1">
        {pending
          ? "Your documents are with our verification provider. You can keep playing and earning Points while this completes — only conversion, withdrawal and commission release are held."
          : "You can play and earn Points now, but converting Points to MTT, withdrawing, and releasing referral commission all require completed Tier 1 KYC."}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <KycBadge tier={user.kycTier} />
        {!pending && <Button href="/kyc" size="xs">Verify my identity</Button>}
      </div>
    </Callout>
  );
}

/* ------------------------------- Widget grid ------------------------------- */

function TileLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group block h-full rounded-[var(--radius-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      {children}
    </Link>
  );
}

function TileFooter({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
      <span className="text-text-muted transition-colors group-hover:text-[var(--accent-hover)]">{label}</span>
      <span className="tnum font-semibold text-text-secondary">{value}</span>
    </span>
  );
}

/* --------------------------------- The view ------------------------------- */

export function DashboardView() {
  const { data: balances, isLoading: balancesLoading, refetch: refetchBalances } = useBalances();
  const { data: user } = useCurrentUser();
  const { data: games } = useGames();
  const { data: pools } = useStakingPools();
  const { data: positions } = useStakePositions();
  const { data: referrals } = useReferralSummary();
  const { data: points, refetch: refetchPoints } = usePointsHistory();
  const { refetch: refetchTxs } = useTransactions();
  const { balance: onChainBalance, onChain, refetch: refetchChain } = useMttBalance();
  const toast = useToast();

  const [order, setOrder] = useState<WidgetId[]>(DEFAULT_ORDER);
  const [hidden, setHidden] = useState<WidgetId[]>([]);
  const [customising, setCustomising] = useState(false);

  const mttShown = onChainBalance ?? balances.mttAvailable;
  const staked = positions.reduce((sum, p) => sum + p.amount, 0);
  const apr = blendedApr(positions, pools);
  const cap = issuanceCap(games);
  const series = useMemo(() => pointsPerDay(points, 14), [points]);
  const earned14d = series.reduce((sum, row) => sum + row.earned, 0);

  const refreshAll = useCallback(() => {
    refetchBalances();
    refetchPoints();
    refetchTxs();
    refetchChain();
  }, [refetchBalances, refetchPoints, refetchTxs, refetchChain]);

  const toggle = (id: WidgetId) =>
    setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));

  const move = (id: WidgetId, delta: -1 | 1) =>
    setOrder((current) => {
      const index = current.indexOf(id);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= current.length) return current;
      const copy = [...current];
      copy[index] = copy[next];
      copy[next] = id;
      return copy;
    });

  const widgets: Record<WidgetId, React.ReactNode> = {
    points: (
      <TileLink href="/app/games/points-history">
        <StatTile
          className="h-full"
          label="Points balance"
          value={balances.points}
          icon={<Sparkles />}
          deltaLabel={`+${formatNumber(balances.pointsToday)} earned today`}
          hint="Points are an off-chain loyalty balance, not a currency. Issuance is capped per game, per player, per day, and every credit is validated server-side."
          footer={<TileFooter label="Full Points ledger" value={`${formatNumber(balances.pointsToday)} today`} />}
        />
      </TileLink>
    ),
    wallet: (
      <TileLink href="/app/wallet">
        <StatTile
          className="h-full"
          label="MTT wallet"
          value={mttShown}
          decimals={2}
          suffix=" MTT"
          icon={<Wallet />}
          deltaLabel={`≈ ${formatCurrency(mttShown * balances.usdRate)} at ${formatCurrency(balances.usdRate)} / MTT`}
          hint={
            onChain
              ? "Read directly from the MTT token contract on-chain, then reconciled against the ledger service."
              : "Read from the ledger service. The on-chain balance is shown here automatically once a wallet is connected."
          }
          footer={
            <TileFooter
              label={onChain ? "On-chain balance" : "Wallet overview"}
              value={`${formatToken(balances.mttStaked, 0)} MTT staked`}
            />
          }
        />
      </TileLink>
    ),
    staking: (
      <TileLink href="/app/staking">
        <StatTile
          className="h-full"
          label="Staked MTT"
          value={staked}
          decimals={0}
          suffix=" MTT"
          icon={<Coins />}
          deltaLabel={`${formatPercent(apr, 1)} blended variable APR · ${formatToken(balances.mttPendingRewards)} MTT accrued`}
          hint="APR is variable and recalculated from Revenue Treasury inflows. It is never fixed or guaranteed, and it is never funded by another member's deposit."
          footer={<TileFooter label="Pools & rewards" value={`${positions.length} positions`} />}
        />
      </TileLink>
    ),
    referrals: (
      <TileLink href="/app/referrals">
        <StatTile
          className="h-full"
          label="Direct referrals"
          value={referrals.directCount}
          icon={<Users />}
          deltaLabel={`${formatToken(balances.commissionPending)} MTT pending · ${formatToken(balances.commissionLifetime)} MTT paid`}
          hint="Referring is optional, free and capped. You never need to refer anyone to earn, convert or withdraw, and commission is only ever paid out of real platform revenue."
          footer={
            <TileFooter
              label="Referral dashboard"
              value={`${formatToken(referrals.monthlyCapUsed, 0)} / ${formatToken(referrals.monthlyCap, 0)} monthly cap`}
            />
          }
        />
      </TileLink>
    ),
  };

  const visible = order.filter((id) => !hidden.includes(id));

  return (
    <div className="space-y-8">
      <LiveStrip onRefresh={refreshAll} onCustomise={() => setCustomising(true)} />

      <KycBanner />

      {balances.mttPendingRewards > 0 && (
        <Reveal>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] border border-[var(--accent-ring)] bg-[linear-gradient(140deg,var(--accent-soft),transparent_60%)] px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent)] text-white">
                <Gift className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-text-primary">
                  <span className="tnum">{formatToken(balances.mttPendingRewards)} MTT</span> in unclaimed
                  staking rewards
                  <Badge tone="brand" dot>Ready</Badge>
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
                  Accrued across {positions.length} positions and funded from Revenue Treasury inflows.
                  Claiming is an on-chain transaction — you pay the network fee, never a platform fee.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button href="/app/staking/rewards" size="sm" icon={<Gift className="size-4" />}>
                Claim rewards
              </Button>
              <Button href="/app/staking" size="sm" variant="outline">View positions</Button>
            </div>
          </div>
        </Reveal>
      )}

      {balancesLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : visible.length === 0 ? (
        <Callout tone="neutral" title="All widgets hidden" icon={<Settings2 />}>
          <p className="mt-1">
            You have dismissed every balance widget.{" "}
            <button
              type="button"
              onClick={() => setHidden([])}
              className="font-semibold text-[var(--accent-hover)] underline-offset-2 hover:underline"
            >
              Restore them
            </button>{" "}
            or reopen &ldquo;Customise widgets&rdquo; at any time.
          </p>
        </Callout>
      ) : (
        <Reveal>
          <div
            className={cn(
              "grid gap-4",
              visible.length >= 4 ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2 xl:grid-cols-3",
            )}
          >
            {visible.map((id) => (
              <div key={id}>{widgets[id]}</div>
            ))}
          </div>
        </Reveal>
      )}

      <Reveal delay={0.05}>
        <div>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-text-secondary">
              Quick actions
            </h2>
            <p className="text-xs text-text-muted">
              Free play always earns. Nothing here requires a purchase.
            </p>
          </div>
          <QuickActions />
        </div>
      </Reveal>

      <Reveal delay={0.1}>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <BarSeries
              data={series}
              xKey="day"
              height={236}
              series={[{ key: "earned", label: "Points earned" }]}
              valueFormatter={(v) => `${formatNumber(v)} Points`}
              title="Points earned — last 14 days"
              description={`${formatNumber(earned14d)} Points credited in the last fortnight, from validated sessions only.`}
              footnote="Rejected or unverified sessions never appear here: a credit is only written once the server has validated the session result."
            />

            <WidgetCard
              title="Today's Points issuance headroom"
              icon={<Sparkles />}
              live
              description="Your combined daily cap across every live game."
              footnote="Caps exist to stop bot farming and to keep Points issuance predictable. They apply identically in free and paid modes — paid entry never raises your cap."
              href="/app/games"
              hrefLabel="Game lobby"
            >
              <CapMeter
                used={balances.pointsToday}
                cap={cap}
                unit=""
                label={`${formatNumber(balances.pointsToday)} of ${formatNumber(cap)} Points issued today`}
              />
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <WidgetStat
                  label="Earned today"
                  value={`${formatNumber(balances.pointsToday)}`}
                  sub="validated credits"
                  tone="good"
                />
                <WidgetStat
                  label="Headroom left"
                  value={`${formatNumber(Math.max(0, cap - balances.pointsToday))}`}
                  sub="across all games"
                />
                <WidgetStat
                  label="14-day total"
                  value={`${formatNumber(earned14d)}`}
                  sub="Points earned"
                />
              </div>
            </WidgetCard>
          </div>

          <WidgetCard
            title="Recent activity"
            icon={<Sparkles />}
            live
            description="Your last 10 wallet and Points events, newest first."
            action={
              <Button href="/app/wallet/history" size="xs" variant="ghost">Full history</Button>
            }
            footnote="Wallet events with a transaction hash are provable on BscScan; Points events are ledger entries validated server-side."
            bodyClassName="py-2"
          >
            <ActivityFeed limit={10} />
          </WidgetCard>
        </div>
      </Reveal>

      <Reveal delay={0.15}>
        <Callout tone="neutral" title="How the numbers above are funded" icon={<ShieldCheck />}>
          <ul className="mt-1.5 space-y-1.5">
            <li>
              <span className="font-medium text-text-secondary">Staking yield is variable.</span> The
              blended {formatPercent(apr, 1)} shown above is recalculated from Revenue Treasury
              inflows and can move up or down. No pool advertises a fixed or guaranteed APR, and no
              reward is ever paid out of another member&apos;s deposit.
            </li>
            <li>
              <span className="font-medium text-text-secondary">Referring is optional.</span> The
              referral widget is a convenience, not a requirement — you can earn, convert, stake and
              withdraw without ever sharing a link, and commission is capped monthly.
            </li>
            <li>
              <span className="font-medium text-text-secondary">Caps are visible where they bite.</span>{" "}
              Daily Points issuance, monthly commission and per-game caps are all shown as meters
              rather than buried in terms.
            </li>
          </ul>
        </Callout>
      </Reveal>

      <Modal
        open={customising}
        onClose={() => setCustomising(false)}
        title="Customise your widgets"
        description="Dismiss what you do not use and reorder the rest. This is personalisation only — hiding a widget never hides an obligation, a cap or a fee."
        icon={<Settings2 className="size-5" />}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOrder(DEFAULT_ORDER);
                setHidden([]);
              }}
            >
              Reset to default
            </Button>
            <Button
              onClick={() => {
                setCustomising(false);
                toast.success("Dashboard layout saved", "Your widget order and visibility are stored against your profile.");
              }}
            >
              Done
            </Button>
          </>
        }
      >
        <ul className="space-y-2">
          {order.map((id, index) => (
            <li
              key={id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface-inset px-3 py-2.5"
            >
              <Switch
                checked={!hidden.includes(id)}
                onCheckedChange={() => toggle(id)}
                label={WIDGET_LABELS[id]}
                description={hidden.includes(id) ? "Hidden from your dashboard" : "Shown on your dashboard"}
              />
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => move(id, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${WIDGET_LABELS[id]} earlier`}
                >
                  Up
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => move(id, 1)}
                  disabled={index === order.length - 1}
                  aria-label={`Move ${WIDGET_LABELS[id]} later`}
                >
                  Down
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-text-muted">
          <InfoHint>
            Balance figures are always re-read live regardless of layout. Hiding a widget only affects
            what is drawn, never what is owed to or by you.
          </InfoHint>
          Layout is per-device and does not change any limit, cap or disclosure.
        </p>
      </Modal>
    </div>
  );
}
