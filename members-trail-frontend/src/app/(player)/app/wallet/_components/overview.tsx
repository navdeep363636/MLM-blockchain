"use client";

import { useState } from "react";
import {
  ArrowDownToLine, ArrowUpFromLine, Coins, Copy, ExternalLink, Gift, Landmark,
  QrCode, Repeat, Sparkles, Store, Wallet as WalletIcon,
} from "lucide-react";
import {
  Badge, Button, Callout, KycBadge, Modal, StatTile, DetailRow, useToast,
} from "@/components/ui";
import { Reveal } from "@/components/fx";
import { WalletConnectButton } from "@/components/web3";
import { useBalances, useCurrentUser } from "@/lib/hooks/use-data";
import { useMttBalance, useWallet } from "@/lib/hooks/use-web3";
import { MTT_SYMBOL, addressUrl } from "@/lib/web3";
import { copyToClipboard, formatCurrency, formatNumber, formatToken, shortenAddress } from "@/lib/utils";
import { ActivityFeed } from "../../_components/activity-feed";

export function WalletOverview() {
  const { data: balances } = useBalances();
  const { data: user } = useCurrentUser();
  const { isConnected, address } = useWallet();
  const { balance: onChain, onChain: isOnChain } = useMttBalance();
  const toast = useToast();
  const [qrOpen, setQrOpen] = useState(false);

  const available = onChain ?? balances.mttAvailable;
  const linked = address ?? user.walletAddress ?? null;
  const usd = (n: number) => formatCurrency(n * balances.usdRate);

  const copy = async () => {
    if (!linked) return;
    if (await copyToClipboard(linked)) toast.success("Address copied");
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Points balance"
          value={balances.points}
          icon={<Sparkles />}
          deltaLabel={`+${formatNumber(balances.pointsToday)} earned today`}
          footer={
            <Button href="/app/wallet/convert" size="xs" variant="ghost" fullWidth icon={<Repeat className="size-3.5" />}>
              Convert to {MTT_SYMBOL}
            </Button>
          }
        />
        <StatTile
          tone="brand"
          label={`${MTT_SYMBOL} available`}
          value={available}
          decimals={2}
          icon={<WalletIcon />}
          deltaLabel={`≈ ${usd(available)} · ${isOnChain ? "live from chain" : "ledger balance"}`}
          hint="Unstaked, unlocked balance you can withdraw, stake or spend right now."
          footer={
            <Button href="/app/wallet/withdraw" size="xs" variant="ghost" fullWidth icon={<ArrowUpFromLine className="size-3.5" />}>
              Withdraw
            </Button>
          }
        />
        <StatTile
          label={`${MTT_SYMBOL} staked`}
          value={balances.mttStaked}
          decimals={2}
          icon={<Coins />}
          deltaLabel={`≈ ${usd(balances.mttStaked)} locked across pools`}
          hint="Principal in staking pools. Always returned in full on unstake — early exit only ever penalises unclaimed rewards."
          footer={
            <Button href="/app/staking" size="xs" variant="ghost" fullWidth icon={<Coins className="size-3.5" />}>
              Manage staking
            </Button>
          }
        />
        <StatTile
          label="Pending rewards"
          value={balances.mttPendingRewards}
          decimals={2}
          icon={<Gift />}
          deltaLabel={`≈ ${usd(balances.mttPendingRewards)} accrued, unclaimed`}
          hint="Accrued staking rewards. Funded from the Revenue Treasury, not from other stakers' principal."
          footer={
            <Button href="/app/staking/rewards" size="xs" variant="ghost" fullWidth icon={<Gift className="size-3.5" />}>
              Claim rewards
            </Button>
          }
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        {/* Wallet address */}
        <Reveal>
          <div className="h-full rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]">
                  <WalletIcon className="size-5" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-text-primary">Your {MTT_SYMBOL} address</h2>
                  <p className="text-xs text-text-muted">
                    {user.walletType === "custodial" ? "Platform wallet (MPC-managed keys)" : "External wallet — you hold the keys"}
                  </p>
                </div>
              </div>
              <KycBadge tier={user.kycTier} />
            </div>

            {linked ? (
              <>
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border-subtle bg-surface-inset p-3">
                  <span className="font-mono-num min-w-0 flex-1 truncate text-sm text-text-secondary">{linked}</span>
                  <Button size="xs" variant="ghost" onClick={copy} icon={<Copy className="size-3.5" />}>Copy</Button>
                  <Button size="xs" variant="ghost" onClick={() => setQrOpen(true)} icon={<QrCode className="size-3.5" />}>QR</Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    href={addressUrl(linked)}
                    iconRight={<ExternalLink className="size-3" />}
                  >
                    BscScan
                  </Button>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-text-muted">
                  This address is linked to your verified identity. Changing it requires
                  re-verification — an anti-fraud control that stops anyone who compromises your
                  account from redirecting your withdrawals.
                </p>
              </>
            ) : (
              <div className="mt-4">
                <Callout tone="warning" title="No wallet linked yet">
                  <p className="mt-1">
                    You need a destination address before your first conversion. Connect an external
                    wallet or generate a platform wallet.
                  </p>
                </Callout>
                <Button href="/connect-wallet" size="sm" className="mt-3">Set up a wallet</Button>
              </div>
            )}

            {!isConnected && (
              <div className="mt-4 border-t border-border-subtle pt-4">
                <p className="mb-2.5 text-xs text-text-muted">
                  Connect your wallet in this browser to read live on-chain balances and sign staking
                  transactions.
                </p>
                <WalletConnectButton />
              </div>
            )}

            <dl className="mt-5 border-t border-border-subtle pt-1">
              <DetailRow
                label="Total portfolio value"
                value={usd(available + balances.mttStaked + balances.mttPendingRewards)}
                hint="Available plus staked plus unclaimed rewards, at the current MTT estimate."
              />
              <DetailRow label={`${MTT_SYMBOL} estimate`} value={`${formatCurrency(balances.usdRate)} per ${MTT_SYMBOL}`} />
              <DetailRow
                label="Commission available"
                value={`${formatToken(balances.commissionAvailable)} ${MTT_SYMBOL}`}
                hint="Released referral commission you can claim. Requires Tier 1 KYC."
              />
              <DetailRow
                label="Commission pending"
                value={`${formatToken(balances.commissionPending)} ${MTT_SYMBOL}`}
                hint="Accrued but not yet released — either awaiting KYC or awaiting the next Treasury deposit."
              />
            </dl>
          </div>
        </Reveal>

        {/* Actions + activity */}
        <Reveal delay={0.08}>
          <div className="h-full rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
            <h2 className="text-sm font-semibold text-text-primary">Move your balance</h2>
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {[
                { href: "/app/wallet/convert", label: "Convert Points", icon: <Repeat className="size-4" /> },
                { href: "/app/wallet/deposit", label: "Deposit", icon: <ArrowDownToLine className="size-4" /> },
                { href: "/app/wallet/withdraw", label: "Withdraw", icon: <ArrowUpFromLine className="size-4" /> },
                { href: "/app/wallet/store", label: "Store", icon: <Store className="size-4" /> },
              ].map((a) => (
                <Button key={a.href} href={a.href} variant="secondary" size="sm" icon={a.icon} className="justify-start">
                  {a.label}
                </Button>
              ))}
            </div>

            <Callout tone="info" title="Where rewards come from" icon={<Landmark />} className="mt-4">
              <p className="mt-1">
                Staking rewards and referral commissions are funded from the Revenue Treasury — real
                platform revenue, never another member&apos;s deposit. Yield is variable and
                recalculated each period from actual inflows.
              </p>
            </Callout>

            <div className="mt-5 border-t border-border-subtle pt-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Recent wallet activity
              </h3>
              <ActivityFeed limit={5} />
            </div>
          </div>
        </Reveal>
      </div>

      <Modal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title={`Receive ${MTT_SYMBOL}`}
        description="BNB Smart Chain (BEP-20) only."
        icon={<QrCode className="size-5" />}
        size="sm"
        footer={<Button variant="ghost" onClick={() => setQrOpen(false)}>Close</Button>}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="grid size-44 place-items-center rounded-xl border border-border-default bg-white p-3">
            {/* Deterministic block pattern stands in for a real QR encoder. */}
            <svg viewBox="0 0 21 21" className="size-full" aria-label="Wallet address QR code">
              <rect width="21" height="21" fill="#fff" />
              {Array.from({ length: 21 }).flatMap((_, y) =>
                Array.from({ length: 21 }).map((__, x) => {
                  const seed = (x * 31 + y * 17 + (linked?.charCodeAt((x + y) % (linked.length || 1)) ?? 0)) % 7;
                  const finder =
                    (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
                  const on = finder
                    ? !(x % 6 === 1 || y % 6 === 1) && !(x === 3 && y === 3)
                    : seed < 3;
                  return on ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#14110f" /> : null;
                }),
              )}
            </svg>
          </div>
          <p className="font-mono-num break-all text-center text-xs text-text-secondary">{linked}</p>
          <Callout tone="warning" title="BEP-20 network only">
            <p className="mt-1">
              Sending {MTT_SYMBOL} or any token from a different network to this address will lose the
              funds permanently. Always confirm the network in your sending wallet first.
            </p>
          </Callout>
          <Button fullWidth variant="outline" onClick={copy} icon={<Copy className="size-4" />}>
            Copy address
          </Button>
        </div>
      </Modal>
    </>
  );
}
