"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle, ArrowDownToLine, Check, Coins, Info, Landmark, Lock, ShieldCheck,
  TriangleAlert, Unlock,
} from "lucide-react";
import {
  Badge, Button, Callout, Checkbox, DetailRow, InfoHint, ProgressBar, SegmentedControl,
  Select, Slider, StatTile, Steps, useToast,
} from "@/components/ui";
import { TxModal } from "@/components/web3";
import { useBalances, useStakePositions, useStakingPools } from "@/lib/hooks/use-data";
import {
  useApproveMtt, useMttAllowance, useMttBalance, useStakeActions, useWallet,
} from "@/lib/hooks/use-web3";
import { CONTRACTS_CONFIGURED, MTT_SYMBOL, contracts } from "@/lib/web3";
import { clamp, daysLabel, formatCurrency, formatPercent, formatToken } from "@/lib/utils";
import { Countdown, useLiveNow } from "../../../_components/time";

type Mode = "stake" | "unstake";

export function ManageView() {
  const params = useSearchParams();
  const toast = useToast();

  const { data: pools } = useStakingPools();
  const { data: positions } = useStakePositions();
  const { data: balances } = useBalances();

  const { isConnected } = useWallet();
  const { balance: onChainBalance } = useMttBalance();
  const { allowance } = useMttAllowance(contracts.staking);
  const { approve, ...approveTx } = useApproveMtt();
  const { stake, unstake, ...stakeTx } = useStakeActions();

  const initialPool = Number(params.get("pool") ?? 1);
  const [poolId, setPoolId] = useState(Number.isFinite(initialPool) ? initialPool : 1);
  const [mode, setMode] = useState<Mode>("stake");
  const [amount, setAmount] = useState(1_000);
  const [ack, setAck] = useState({ variable: false, penalty: false });
  const [txOpen, setTxOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);

  useEffect(() => {
    const p = Number(params.get("pool"));
    if (Number.isFinite(p)) setPoolId(p);
  }, [params]);

  const pool = pools.find((p) => p.poolId === poolId) ?? pools[0];
  const position = positions.find((p) => p.poolId === poolId);
  const available = onChainBalance ?? balances.mttAvailable;

  const maxIn = mode === "stake" ? available : position?.amount ?? 0;
  const clamped = clamp(amount, 0, maxIn);

  /* Uses the shared ledger-derived clock rather than Date.now(): reading the
   * wall clock during render can straddle the lock boundary between the server
   * and client passes, which both breaks hydration and — worse — could show a
   * position as unlocked when it isn't. */
  const now = useLiveNow(30_000);
  const locked = useMemo(() => {
    if (!position || !pool || pool.lockDays === 0) return false;
    return Date.parse(position.lockEnd) > now;
  }, [position, pool, now]);

  const penaltyRate = (pool?.earlyPenaltyBps ?? 0) / 10_000;
  const penaltyAmount = mode === "unstake" && locked ? (position?.pendingRewards ?? 0) * penaltyRate : 0;

  /* Approval is only needed for staking, and only when the allowance is short. */
  const needsApproval =
    mode === "stake" && CONTRACTS_CONFIGURED && (allowance ?? 0) < clamped;

  const canSubmit =
    clamped > 0 &&
    clamped <= maxIn &&
    ack.variable &&
    (mode === "stake" || !locked || ack.penalty);

  const step = mode === "stake" ? (needsApproval ? 0 : 1) : 1;

  const submit = async () => {
    if (!CONTRACTS_CONFIGURED) {
      // No contracts configured — demonstrate the flow against the demo ledger.
      toast.success(
        mode === "stake" ? "Stake recorded" : "Unstake recorded",
        `${formatToken(clamped)} ${MTT_SYMBOL} in the ${pool?.name} pool (demo ledger — no contracts configured).`,
      );
      return;
    }
    setTxOpen(true);
    if (mode === "stake") await stake(poolId, clamped);
    else await unstake(poolId, clamped);
  };

  const runApproval = async () => {
    setApproveOpen(true);
    await approve(contracts.staking, clamped);
  };

  if (!pool) return null;

  return (
    <>
      {!isConnected && CONTRACTS_CONFIGURED && (
        <Callout tone="warning" title="Connect your wallet to stake" icon={<AlertTriangle />} className="mb-5">
          <p className="mt-1">
            Staking is an on-chain transaction you sign yourself. Connect a wallet from the header to
            continue — we never move your MTT without your signature.
          </p>
        </Callout>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.05fr_1fr]">
        {/* Form */}
        <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface-1 p-5 sm:p-6">
          <SegmentedControl
            value={mode}
            onValueChange={(v) => { setMode(v); setAmount(0); setAck({ variable: false, penalty: false }); }}
            options={[
              { value: "stake", label: "Stake", icon: <Lock className="size-3.5" /> },
              { value: "unstake", label: "Unstake", icon: <Unlock className="size-3.5" /> },
            ]}
          />

          <Select
            className="mt-5"
            label="Pool"
            value={String(poolId)}
            onChange={(e) => { setPoolId(Number(e.target.value)); setAmount(0); }}
            options={pools.map((p) => ({
              value: String(p.poolId),
              label: `${p.name} — ${daysLabel(p.lockDays)} · ${formatPercent(p.currentApr)} variable`,
              disabled: !p.active,
            }))}
            hint="Longer locks may carry a modestly higher rate. No pool's rate is fixed."
          />

          <div className="mt-5 rounded-xl border border-border-subtle bg-surface-inset p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {mode === "stake" ? `Amount to stake` : `Amount to unstake`}
              </span>
              <button
                onClick={() => setAmount(Math.floor(maxIn))}
                disabled={maxIn <= 0}
                className="text-xs font-medium text-[var(--accent-hover)] hover:underline disabled:text-text-muted disabled:no-underline"
              >
                Max {formatToken(maxIn)}
              </button>
            </div>
            <input
              type="number"
              min={0}
              max={maxIn}
              value={amount}
              onChange={(e) => setAmount(clamp(Number(e.target.value) || 0, 0, Math.floor(maxIn)))}
              aria-label={`Amount to ${mode} in ${MTT_SYMBOL}`}
              className="tnum mt-2 w-full bg-transparent font-display text-3xl font-semibold tracking-tight text-text-primary outline-none"
            />
            <p className="mt-1 text-xs text-text-muted">
              ≈ {formatCurrency(clamped * balances.usdRate)} ·{" "}
              {mode === "stake"
                ? `${formatToken(available)} ${MTT_SYMBOL} available`
                : `${formatToken(position?.amount ?? 0)} ${MTT_SYMBOL} staked here`}
            </p>
          </div>

          <Slider
            className="mt-4"
            label="Adjust"
            value={clamped}
            onValueChange={setAmount}
            min={0}
            max={Math.max(Math.floor(maxIn), 1)}
            step={10}
            formatValue={(v) => `${formatToken(v)} ${MTT_SYMBOL}`}
          />

          {mode === "stake" && pool.lockDays > 0 && (
            <Callout tone="info" title={`Your principal locks for ${pool.lockDays} days`} icon={<Lock />} className="mt-5">
              <p className="mt-1">
                You can still claim accrued rewards at any time during the lock. Unstaking before the
                lock expires returns your full principal but forfeits{" "}
                <strong className="text-text-primary">{pool.earlyPenaltyBps / 100}% of unclaimed
                rewards</strong> — never any of the principal itself.
              </p>
            </Callout>
          )}

          {mode === "unstake" && locked && (
            <Callout tone="critical" title="Early exit — penalty applies to rewards" icon={<TriangleAlert />} className="mt-5">
              <p className="mt-1">
                This position unlocks in{" "}
                <strong className="text-text-primary">
                  <Countdown to={position!.lockEnd} elapsedLabel="now" />
                </strong>
                . Unstaking now returns your{" "}
                <strong className="text-text-primary">full {formatToken(clamped)} {MTT_SYMBOL} principal</strong>,
                but forfeits {pool.earlyPenaltyBps / 100}% of your unclaimed rewards —{" "}
                <strong className="text-text-primary">{formatToken(penaltyAmount, 4)} {MTT_SYMBOL}</strong>{" "}
                — to the Treasury.
              </p>
            </Callout>
          )}

          {mode === "unstake" && !locked && position && (
            <Callout tone="good" title="Lock has expired — no penalty" icon={<Check />} className="mt-5">
              <p className="mt-1">
                You can unstake any amount with no penalty. Your accrued rewards remain claimable.
              </p>
            </Callout>
          )}

          {/* Two-step on-chain flow */}
          {mode === "stake" && CONTRACTS_CONFIGURED && (
            <div className="mt-5">
              <Steps steps={["Approve MTT", "Confirm stake"]} current={step} />
              <p className="mt-2 text-xs leading-relaxed text-text-muted">
                {needsApproval
                  ? "BEP-20 tokens need a one-time allowance before a contract can move them. You approve exactly this amount — nothing more."
                  : `Allowance of ${formatToken(allowance ?? 0)} ${MTT_SYMBOL} already granted. No approval needed.`}
              </p>
            </div>
          )}

          <div className="mt-5 space-y-2.5 border-t border-border-subtle pt-4">
            <Checkbox
              checked={ack.variable}
              onCheckedChange={(v) => setAck((a) => ({ ...a, variable: v }))}
              label="I understand the reward rate is variable, funded from real platform revenue, and is not fixed or guaranteed."
            />
            {mode === "unstake" && locked && (
              <Checkbox
                checked={ack.penalty}
                onCheckedChange={(v) => setAck((a) => ({ ...a, penalty: v }))}
                label={`I accept forfeiting ${formatToken(penaltyAmount, 4)} ${MTT_SYMBOL} of unclaimed rewards to exit early. My principal is returned in full.`}
              />
            )}
          </div>

          {needsApproval ? (
            <Button fullWidth size="lg" className="mt-5" disabled={!canSubmit} onClick={runApproval}>
              Approve {formatToken(clamped)} {MTT_SYMBOL}
            </Button>
          ) : (
            <Button
              fullWidth
              size="lg"
              className="mt-5"
              disabled={!canSubmit}
              variant={mode === "unstake" && locked ? "danger" : "primary"}
              onClick={submit}
            >
              {mode === "stake"
                ? `Stake ${formatToken(clamped)} ${MTT_SYMBOL}`
                : locked
                  ? `Unstake early — forfeit ${formatToken(penaltyAmount, 2)} rewards`
                  : `Unstake ${formatToken(clamped)} ${MTT_SYMBOL}`}
            </Button>
          )}

          {!CONTRACTS_CONFIGURED && (
            <p className="mt-3 text-center text-xs text-text-muted">
              No contract addresses configured — this records against the demo ledger instead of
              signing a transaction.
            </p>
          )}
        </div>

        {/* Summary */}
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatTile
              label={`${pool.name} rate`}
              value={pool.currentApr}
              decimals={2}
              suffix="%"
              icon={<Coins />}
              tone="brand"
              hint="Variable. Recalculated each period from actual Treasury inflows."
              deltaLabel="Variable, revenue-funded"
              compact
            />
            <StatTile
              label="Your position here"
              value={position?.amount ?? 0}
              decimals={2}
              suffix={` ${MTT_SYMBOL}`}
              icon={<Lock />}
              deltaLabel={
                position
                  ? pool.lockDays === 0
                    ? "Flexible — no lock"
                    : locked ? "Locked" : "Unlocked"
                  : "No position yet"
              }
              compact
            />
          </div>

          <div className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
            <h3 className="text-sm font-semibold text-text-primary">Transaction summary</h3>
            <div className="mt-3 border-t border-border-subtle pt-1">
              <DetailRow label="Action" value={mode === "stake" ? "Stake" : locked ? "Unstake (early)" : "Unstake"} />
              <DetailRow label="Pool" value={`${pool.name} · ${daysLabel(pool.lockDays)}`} />
              <DetailRow label="Amount" value={`${formatToken(clamped)} ${MTT_SYMBOL}`} />
              {mode === "stake" && pool.lockDays > 0 && (
                <DetailRow label="Unlocks after" value={`${pool.lockDays} days`} />
              )}
              {mode === "unstake" && (
                <>
                  <DetailRow
                    label="Principal returned"
                    value={<span className="text-good-400">{formatToken(clamped)} {MTT_SYMBOL}</span>}
                    hint="Always returned in full. The protocol has no path to confiscate principal."
                  />
                  <DetailRow
                    label="Rewards forfeited"
                    value={
                      penaltyAmount > 0
                        ? <span className="text-critical-400">−{formatToken(penaltyAmount, 4)} {MTT_SYMBOL}</span>
                        : "None"
                    }
                  />
                </>
              )}
              <DetailRow
                label="Rewards accrued here"
                value={`${formatToken(position?.pendingRewards ?? 0, 4)} ${MTT_SYMBOL}`}
              />
              <DetailRow label="Network" value="BNB Smart Chain" />
              <DetailRow label="Gas" value="Paid by you, in BNB" />
            </div>
          </div>

          <div className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]">
                <ShieldCheck className="size-4" />
              </span>
              <h3 className="text-sm font-semibold text-text-primary">Your principal is safe by construction</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-text-muted">
              The staking contract has no{" "}
              <code className="rounded bg-surface-3 px-1 font-mono text-[11px]">withdraw</code> or{" "}
              <code className="rounded bg-surface-3 px-1 font-mono text-[11px]">emergencyWithdraw</code>{" "}
              function — there is no call an administrator could make to move your stake. Early-exit
              penalties touch only pending, unclaimed rewards, and reward pools can only be funded by
              the Treasury multisig, never from another staker&apos;s principal.
            </p>
            <Link
              href="/legal/risk-disclosure"
              className="mt-3 inline-block text-sm font-medium text-[var(--accent-hover)] hover:underline"
            >
              Read the Risk Disclosure →
            </Link>
          </div>

          {position && (
            <div className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-text-primary">Lock progress</h3>
                {pool.lockDays === 0
                  ? <Badge tone="good" dot>Flexible</Badge>
                  : locked ? <Badge tone="warning" dot>Locked</Badge> : <Badge tone="good" dot>Unlocked</Badge>}
              </div>
              {pool.lockDays > 0 && (
                <>
                  <ProgressBar
                    className="mt-3"
                    value={Math.max(
                      0,
                      pool.lockDays * 86_400_000 - (Date.parse(position.lockEnd) - Date.parse(position.stakedAt)),
                    ) + (Date.parse(position.stakedAt) ? 0 : 0)}
                    max={pool.lockDays * 86_400_000}
                    tone={locked ? "warning" : "good"}
                  />
                  <p className="mt-2 text-xs text-text-muted">
                    {locked ? (
                      <>Unlocks in <Countdown to={position.lockEnd} elapsedLabel="now" /></>
                    ) : (
                      "Lock expired — unstake with no penalty."
                    )}
                  </p>
                </>
              )}
              <Button href="/app/staking/rewards" size="sm" variant="outline" fullWidth className="mt-4" icon={<ArrowDownToLine className="size-3.5" />}>
                Claim {formatToken(position.pendingRewards, 4)} {MTT_SYMBOL} rewards
              </Button>
            </div>
          )}
        </div>
      </div>

      <TxModal
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        state={approveTx}
        title={`Approve ${MTT_SYMBOL}`}
        successMessage="Allowance granted. You can now confirm the stake."
        summary={
          <>
            <DetailRow label="Spender" mono value="Staking contract" />
            <DetailRow label="Allowance" value={`${formatToken(clamped)} ${MTT_SYMBOL}`} />
          </>
        }
        onSuccessAction={{ label: "Continue to stake", onClick: () => { setApproveOpen(false); submit(); } }}
      />

      <TxModal
        open={txOpen}
        onClose={() => setTxOpen(false)}
        state={stakeTx}
        title={mode === "stake" ? `Stake ${MTT_SYMBOL}` : `Unstake ${MTT_SYMBOL}`}
        successMessage={
          mode === "stake"
            ? "Your stake is active and rewards begin accruing from this block."
            : "Your principal has been returned in full."
        }
        summary={
          <>
            <DetailRow label="Pool" value={pool.name} />
            <DetailRow label="Amount" value={`${formatToken(clamped)} ${MTT_SYMBOL}`} />
            {penaltyAmount > 0 && (
              <DetailRow label="Rewards forfeited" value={`${formatToken(penaltyAmount, 4)} ${MTT_SYMBOL}`} />
            )}
          </>
        }
      />
    </>
  );
}
