"use client";

/* AD-06 · Staking pool configuration — pools, lock periods, and reward-pool
 * funding as a multisig on-chain transfer out of the Revenue Treasury. */

import { useMemo, useState } from "react";
import {
  AlertTriangle, Ban, CheckCircle2, Coins, Download, KeyRound, Landmark, Layers,
  Link2, Pencil, Plus, ShieldCheck, Users, Wallet,
} from "lucide-react";
import {
  Badge, Button, Callout, ConfirmDialog, DetailRow, InfoHint, Input, ProgressBar, Switch,
  useToast, type Column,
} from "@/components/ui";
import {
  useStaff, useStakingPools, useTreasuryOutflows, useTreasuryTotals,
} from "@/lib/hooks/use-data";
import { csvDownload, daysLabel, formatDate, formatNumber, formatPercent, timeAgo } from "@/lib/utils";
import { CONTRACTS_CONFIGURED, IS_TESTNET, MTT_SYMBOL, contracts, isDeployed } from "@/lib/web3";
import type { StakingPool, TreasuryOutflow } from "@/types";
import { FourEyesModal, ROLE_LABEL } from "../../_components/four-eyes-modal";
import { LedgerTable } from "../../_components/ledger-table";
import { AddressLink, AuditNote, MiniStat, Panel, TxLink } from "../../_components/panel";

/** Treasury multisig policy: this many distinct signers per fund movement. */
const REQUIRED_SIGNERS = 3;

interface PoolDraft {
  name: string;
  lockDays: string;
  rewardsDurationDays: string;
  earlyPenaltyBps: string;
}

const EMPTY_DRAFT: PoolDraft = { name: "", lockDays: "", rewardsDurationDays: "30", earlyPenaltyBps: "" };

/* ------------------------------ header actions ---------------------------- */

export function StakingActions() {
  const { data: pools } = useStakingPools();
  const { data: outflows } = useTreasuryOutflows();
  return (
    <Button
      variant="outline"
      size="sm"
      icon={<Download className="size-4" />}
      onClick={() =>
        csvDownload("members-trail-staking-pools.csv", [
          ...pools.map((p) => ({
            record: "pool",
            pool_id: p.poolId,
            name: p.name,
            lock_days: p.lockDays,
            rewards_duration_days: p.rewardsDurationDays,
            early_penalty_bps: p.earlyPenaltyBps,
            active: p.active,
            total_staked: p.totalStaked,
            rewards_funded: p.totalRewardsFunded,
            rewards_paid: p.totalRewardsPaid,
            current_variable_apr: p.currentApr,
          })),
          ...outflows
            .filter((o) => o.destination === "staking_pool")
            .map((o) => ({
              record: "funding",
              pool_id: o.poolId ?? "",
              name: o.id,
              lock_days: "",
              rewards_duration_days: "",
              early_penalty_bps: "",
              active: "",
              total_staked: "",
              rewards_funded: o.amount,
              rewards_paid: "",
              current_variable_apr: "",
              tx_hash: o.txHash,
              date: o.date,
              approved_by: o.approvedBy.join(" | "),
            })),
        ])
      }
    >
      Export pools & funding
    </Button>
  );
}

/* --------------------------------- pool card ------------------------------ */

function PoolCard({
  pool, onEdit, onToggle, onFund, fundedFromTreasury,
}: {
  pool: StakingPool;
  onEdit: () => void;
  onToggle: () => void;
  onFund: () => void;
  fundedFromTreasury: number;
}) {
  const depletion = pool.totalRewardsFunded === 0 ? 0 : (pool.totalRewardsPaid / pool.totalRewardsFunded) * 100;
  const remaining = pool.totalRewardsFunded - pool.totalRewardsPaid;

  return (
    <Panel
      icon={<Layers />}
      tone={depletion >= 90 ? "critical" : depletion >= 75 ? "warning" : "default"}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {pool.name}
          <span className="font-mono-num text-xs text-text-muted">pool {pool.poolId}</span>
          {pool.active ? <Badge tone="good" dot>Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
        </span>
      }
      description={`${daysLabel(pool.lockDays)} lock · ${pool.rewardsDurationDays}-day reward epoch · ${pool.earlyPenaltyBps / 100}% early-exit penalty on unclaimed rewards only`}
      action={
        <>
          <Button variant="ghost" size="xs" icon={<Pencil className="size-3.5" />} onClick={onEdit}>
            Edit
          </Button>
          <Button variant="outline" size="xs" icon={<Coins className="size-3.5" />} onClick={onFund}>
            Fund rewards
          </Button>
        </>
      }
      footnote="Reward rate is variable and recalculated each epoch from Treasury inflows. No fixed or guaranteed APR is published to members, here or in the app."
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MiniStat label="Total staked" value={`${formatNumber(pool.totalStaked)}`} sub={MTT_SYMBOL} />
          <MiniStat
            label="Variable rate"
            value={formatPercent(pool.currentApr, 1)}
            sub="current epoch, recalculated"
          />
          <MiniStat label="Rewards funded" value={formatNumber(pool.totalRewardsFunded)} sub={`${MTT_SYMBOL} from Treasury`} />
          <MiniStat
            label="Remaining"
            value={formatNumber(remaining)}
            sub="unpaid reward balance"
            tone={depletion >= 90 ? "critical" : depletion >= 75 ? "warning" : "good"}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 text-text-muted">
              Reward pool depletion
              <InfoHint>
                Paid as a share of funded. Above 75% Finance is prompted to schedule the next
                Treasury transfer so the pool never runs dry mid-epoch.
              </InfoHint>
            </span>
            <span className="tnum font-semibold text-text-secondary">{formatPercent(depletion, 1)}</span>
          </div>
          <ProgressBar
            value={depletion}
            max={100}
            tone={depletion >= 90 ? "critical" : depletion >= 75 ? "warning" : "good"}
            height="h-2"
          />
        </div>

        <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
          <DetailRow label="Lock period" value={daysLabel(pool.lockDays)} />
          <DetailRow label="Reward epoch" value={`${pool.rewardsDurationDays} days`} />
          <DetailRow
            label="Early-exit penalty"
            value={`${pool.earlyPenaltyBps / 100}% of unclaimed rewards`}
            hint="Principal is never penalised. The penalty applies only to rewards not yet claimed, and returns to the reward pool."
          />
          <DetailRow label="Funded from Treasury (all time)" value={<span className="tnum">{formatNumber(fundedFromTreasury)} {MTT_SYMBOL}</span>} />
          <DetailRow
            label="Status"
            value={
              <Switch
                checked={pool.active}
                onCheckedChange={onToggle}
                label={pool.active ? "Accepting new stakes" : "Closed to new stakes"}
              />
            }
          />
        </div>
      </div>
    </Panel>
  );
}

/* ---------------------------------- view --------------------------------- */

export function StakingView() {
  const { data: pools, isLoading } = useStakingPools();
  const { data: outflows } = useTreasuryOutflows();
  const { data: totals } = useTreasuryTotals();
  const { data: staff } = useStaff();
  const toast = useToast();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StakingPool | null>(null);
  const [funding, setFunding] = useState<StakingPool | null>(null);
  const [deactivating, setDeactivating] = useState<StakingPool | null>(null);
  const [draft, setDraft] = useState<PoolDraft>(EMPTY_DRAFT);
  const [amount, setAmount] = useState("");

  const stakingOutflows = useMemo(
    () => outflows.filter((o) => o.destination === "staking_pool"),
    [outflows],
  );

  const fundedByPool = useMemo(() => {
    const m = new Map<number, number>();
    for (const o of stakingOutflows) {
      if (o.poolId == null) continue;
      m.set(o.poolId, (m.get(o.poolId) ?? 0) + o.amount);
    }
    return m;
  }, [stakingOutflows]);

  const cosigners = useMemo(
    () => staff.filter((s) => s.active && s.twoFactorEnabled && (s.role === "super_admin" || s.role === "finance_admin")),
    [staff],
  );

  const parsedAmount = Number(amount);
  const amountInvalid = amount !== "" && (!Number.isFinite(parsedAmount) || parsedAmount <= 0);
  const exceedsHeadroom = Number.isFinite(parsedAmount) && parsedAmount > totals.headroom;

  const draftLock = Number(draft.lockDays);
  const draftPenalty = Number(draft.earlyPenaltyBps);
  const draftInvalid =
    draft.name.trim().length < 3 ||
    !Number.isFinite(draftLock) || draftLock < 0 ||
    !Number.isFinite(draftPenalty) || draftPenalty < 0 || draftPenalty > 5000;

  const fundingColumns: Column<TreasuryOutflow>[] = [
    {
      key: "id",
      header: "Transfer",
      sortValue: (o) => o.id,
      cell: (o) => (
        <div className="min-w-0">
          <p className="font-mono-num text-xs text-text-primary">{o.id}</p>
          <p className="text-[11px] text-text-muted">{timeAgo(o.date)}</p>
        </div>
      ),
    },
    {
      key: "pool",
      header: "Destination pool",
      sortValue: (o) => o.poolId ?? -1,
      cell: (o) => {
        const p = pools.find((x) => x.poolId === o.poolId);
        return (
          <span className="text-sm text-text-secondary">
            {p ? `${p.name} (pool ${p.poolId})` : `Pool ${o.poolId ?? "—"}`}
          </span>
        );
      },
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sortValue: (o) => o.amount,
      cell: (o) => (
        <span className="tnum text-sm font-medium text-text-primary">
          {formatNumber(o.amount)} {MTT_SYMBOL}
        </span>
      ),
    },
    {
      key: "date",
      header: "Date",
      hideBelow: "md",
      align: "right",
      sortValue: (o) => o.date,
      cell: (o) => <span className="tnum text-xs text-text-secondary">{formatDate(o.date)}</span>,
    },
    {
      key: "signers",
      header: "Co-signers",
      hideBelow: "lg",
      cell: (o) => (
        <span className="flex flex-wrap gap-1.5">
          {o.approvedBy.map((a) => (
            <Badge key={a} tone="neutral">{a}</Badge>
          ))}
        </span>
      ),
    },
    {
      key: "tx",
      header: "On-chain tx",
      hideBelow: "sm",
      align: "right",
      cell: (o) => <TxLink hash={o.txHash} />,
    },
  ];

  const totalStakingFunded = stakingOutflows.reduce((s, o) => s + o.amount, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat label="Pools" value={formatNumber(pools.length)} sub={`${pools.filter((p) => p.active).length} accepting stakes`} />
        <MiniStat
          label="Total value locked"
          value={formatNumber(pools.reduce((s, p) => s + p.totalStaked, 0))}
          sub={MTT_SYMBOL}
        />
        <MiniStat
          label="Rewards funded from Treasury"
          value={formatNumber(totalStakingFunded)}
          sub={`${stakingOutflows.length} on-chain transfers`}
        />
        <MiniStat
          label="Treasury headroom"
          value={formatNumber(totals.headroom)}
          sub="reconciled inflow not yet committed"
          tone={totals.headroom <= 0 ? "critical" : "good"}
        />
      </div>

      <Callout tone="warning" title="Reward funding must trace to real revenue" icon={<Landmark />}>
        <p className="mt-1">
          Every transfer into a reward pool leaves the Treasury wallet as an on-chain transaction with
          a public hash, and every rupee in that wallet is matched against a payment-processor
          settlement before it can be spent. That is what makes yield here revenue-funded rather than
          deposit-funded: the chain proves where the reward came from, and the reconciliation ledger
          proves the Treasury earned it. Funding is never taken from members&apos; staked principal.
        </p>
      </Callout>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-text-primary">Pools</h2>
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => { setDraft(EMPTY_DRAFT); setCreating(true); }}>
          Create pool
        </Button>
      </div>

      {isLoading ? (
        <Panel title="Loading pools…"><div className="h-40" /></Panel>
      ) : (
        <div className="space-y-4">
          {pools.map((p) => (
            <PoolCard
              key={p.poolId}
              pool={p}
              fundedFromTreasury={fundedByPool.get(p.poolId) ?? 0}
              onEdit={() => {
                setDraft({
                  name: p.name,
                  lockDays: String(p.lockDays),
                  rewardsDurationDays: String(p.rewardsDurationDays),
                  earlyPenaltyBps: String(p.earlyPenaltyBps),
                });
                setEditing(p);
              }}
              onToggle={() => setDeactivating(p)}
              onFund={() => { setAmount(""); setFunding(p); }}
            />
          ))}
        </div>
      )}

      {/* ------------------------- multisig explainer ---------------------- */}
      <Panel
        icon={<KeyRound />}
        title="Treasury multisig"
        description={`Every reward-pool funding transfer needs ${REQUIRED_SIGNERS} distinct hardware-key signatures.`}
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,20rem)]">
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle">
            {cosigners.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 bg-surface-1 px-4 py-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-text-primary">{s.name}</span>
                  <span className="block text-xs text-text-muted">{ROLE_LABEL[s.role]} · {s.email}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone="good" icon={<KeyRound className="size-3.5" />}>Hardware key</Badge>
                  <Badge tone="neutral">Active {timeAgo(s.lastActiveAt)}</Badge>
                </span>
              </li>
            ))}
          </ul>
          <div className="space-y-3 rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
            <DetailRow label="Signature threshold" value={`${REQUIRED_SIGNERS} of ${cosigners.length}`} />
            <DetailRow label="Password-only approval" value="Not accepted for fund movement" />
            <DetailRow label="Network" value={IS_TESTNET ? "BSC Testnet (chain 97)" : "BSC Mainnet (chain 56)"} />
            <DetailRow
              label="Staking contract"
              value={
                CONTRACTS_CONFIGURED && isDeployed(contracts.staking) ? (
                  <AddressLink address={contracts.staking} />
                ) : (
                  "Published once deployed and verified"
                )
              }
            />
            <DetailRow label="Timelock" value="24h on parameter changes" />
          </div>
        </div>
      </Panel>

      {/* --------------------------- funding log --------------------------- */}
      <LedgerTable
        title="Reward pool funding log"
        description="Treasury → staking reward pool transfers, each with its co-signers and its on-chain hash."
        icon={<Link2 />}
        columns={fundingColumns}
        rows={stakingOutflows}
        keyOf={(o) => o.id}
        caption="Treasury transfers into staking reward pools with co-signers and on-chain transaction hashes"
        pageSize={10}
        empty={{ title: "No funding transfers yet", description: "Transfers appear here the moment the multisig transaction confirms." }}
        footnote="Hashes open on BscScan. A funding transfer with no confirmed hash is not a funding transfer — the ledger row and the chain must agree before the reward epoch starts."
      />

      {/* ----------------------------- create pool ------------------------- */}
      <FourEyesModal
        open={creating}
        onClose={() => setCreating(false)}
        onSubmit={(s) => {
          setCreating(false);
          toast.success("Pool creation queued", `Routed to ${s.secondApprover}, then deployed via the timelocked multisig.`);
        }}
        title="Create a staking pool"
        description="Pool parameters are on-chain. Creation is a contract call, not a database write."
        submitLabel="Submit for approval"
        icon={<Plus className="size-5" />}
        requiresMultisig
        blocked={draftInvalid}
        blockedTitle="Pool parameters are incomplete or out of policy"
        blockedMessage="Name needs at least 3 characters, lock period must be zero or more days, and the early-exit penalty may not exceed 50% (5,000 bps) of unclaimed rewards."
        reasonLabel="Why this pool exists"
        reasonHint="Explain the member need and the funding plan. Retained on the pool record."
        acknowledgement={
          <span>
            I confirm this pool&apos;s rewards will be funded exclusively from reconciled Treasury
            inflows, that no fixed or guaranteed APR will be advertised for it, and that the
            early-exit penalty applies to unclaimed rewards only and never to staked principal.
          </span>
        }
      >
        <PoolForm draft={draft} setDraft={setDraft} />
      </FourEyesModal>

      {/* ------------------------------ edit pool -------------------------- */}
      <FourEyesModal
        open={!!editing}
        onClose={() => setEditing(null)}
        onSubmit={(s) => {
          setEditing(null);
          toast.success("Parameter change queued", `Routed to ${s.secondApprover}. A 24-hour timelock runs before it applies on-chain.`);
        }}
        title={`Edit ${editing?.name ?? "pool"}`}
        description="Existing stakes keep the terms they were entered under."
        submitLabel="Submit for approval"
        icon={<Pencil className="size-5" />}
        requiresMultisig
        blocked={draftInvalid}
        blockedTitle="Parameters are out of policy"
        blockedMessage="Check the name, lock period and penalty. The penalty ceiling is 50% of unclaimed rewards."
        reasonLabel="Reason for the parameter change"
        acknowledgement={
          <span>
            I confirm this change applies to new stakes only, that members with open positions keep
            the lock period and penalty terms in force when they staked, and that the change passes
            through the 24-hour timelock before taking effect on-chain.
          </span>
        }
      >
        <>
          <PoolForm draft={draft} setDraft={setDraft} />
          <Callout tone="info" title="Existing positions are grandfathered" icon={<ShieldCheck />} className="mt-4">
            <p className="mt-1">
              {editing ? formatNumber(editing.totalStaked) : "0"} {MTT_SYMBOL} is currently staked in
              this pool. Those positions continue under their original terms; the contract stores the
              terms per stake, not per pool.
            </p>
          </Callout>
        </>
      </FourEyesModal>

      {/* --------------------------- fund reward pool ---------------------- */}
      <FourEyesModal
        open={!!funding}
        onClose={() => setFunding(null)}
        onSubmit={(s) => {
          setFunding(null);
          toast.toast({
            tone: "info",
            title: "Multisig transaction proposed",
            description: `${s.secondApprover} and one further co-signer must sign before the transfer broadcasts.`,
          });
        }}
        title={`Fund ${funding?.name ?? "pool"} reward pool from Treasury`}
        description="An on-chain transfer out of the Treasury wallet, signed by the multisig."
        submitLabel="Propose multisig transfer"
        icon={<Wallet className="size-5" />}
        requiresMultisig
        blocked={amount === "" || amountInvalid || exceedsHeadroom}
        blockedTitle={
          amount === "" ? "Enter an amount"
          : amountInvalid ? "Amount is not valid"
          : "Exceeds reconciled Treasury headroom"
        }
        blockedMessage={
          amount === "" || amountInvalid
            ? "State the transfer amount in MTT. The multisig proposal is built from this exact figure."
            : `Reconciled inflow minus committed outflow leaves ${formatNumber(totals.headroom)} ${MTT_SYMBOL} of headroom. Funding a reward pool beyond that would mean paying rewards out of unreconciled or unearned revenue, which is blocked at the policy layer — reconcile the outstanding settlement batches first.`
        }
        reasonLabel="Funding justification"
        reasonHint="Reference the reward epoch and the settlement batches backing the transfer."
        acknowledgement={
          <span>
            I confirm this transfer is funded from reconciled real revenue in the Treasury wallet, is
            traceable on-chain from that wallet to this reward pool, and does not draw on staked
            principal or on another member&apos;s deposit.
          </span>
        }
      >
        <div className="space-y-4">
          <Input
            label="Transfer amount"
            required
            type="number"
            min={0}
            suffix={MTT_SYMBOL}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 42800"
            className="tnum"
            hint={`Available headroom: ${formatNumber(totals.headroom)} ${MTT_SYMBOL}`}
            error={exceedsHeadroom && "Above reconciled headroom."}
          />

          <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
            <DetailRow label="Source" value="Revenue Treasury wallet (multisig)" />
            <DetailRow label="Destination" value={`${funding?.name ?? "—"} reward pool (on-chain)`} />
            <DetailRow label="Reconciled inflow" value={<span className="tnum">{formatNumber(totals.reconciledInflow)} {MTT_SYMBOL}</span>} />
            <DetailRow label="Committed outflow" value={<span className="tnum">{formatNumber(totals.totalOutflow)} {MTT_SYMBOL}</span>} />
            <DetailRow
              label="Headroom after this transfer"
              value={
                <span className={exceedsHeadroom ? "tnum text-critical-400" : "tnum text-good-400"}>
                  {formatNumber(totals.headroom - (Number.isFinite(parsedAmount) ? parsedAmount : 0))} {MTT_SYMBOL}
                </span>
              }
            />
            <DetailRow label="Unreconciled (unusable)" value={<span className="tnum">{formatNumber(totals.unreconciledInflow)} {MTT_SYMBOL}</span>} />
          </div>

          <div className="rounded-xl border border-border-default bg-surface-inset p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Users className="size-4 text-[var(--accent)]" />
              Required co-signers ({REQUIRED_SIGNERS} of {cosigners.length})
            </p>
            <ul className="mt-3 space-y-2">
              {cosigners.slice(0, REQUIRED_SIGNERS + 1).map((s, i) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-text-secondary">
                    {s.name} — {ROLE_LABEL[s.role]}
                  </span>
                  <Badge tone={i < REQUIRED_SIGNERS ? "warning" : "neutral"} icon={<KeyRound className="size-3" />}>
                    {i < REQUIRED_SIGNERS ? "Signature required" : "Backup signer"}
                  </Badge>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-text-muted">
              You are proposing the transaction, not executing it. It broadcasts only once the
              threshold of hardware-key signatures is collected, and the resulting hash is written
              back to the funding log above.
            </p>
          </div>
        </div>
      </FourEyesModal>

      {/* ------------------------- deactivate / activate ------------------- */}
      <ConfirmDialog
        open={!!deactivating}
        onClose={() => setDeactivating(null)}
        onConfirm={() => {
          const p = deactivating;
          setDeactivating(null);
          toast.toast({
            tone: "info",
            title: p?.active ? `${p?.name} closed to new stakes` : `${p?.name} reopened`,
            description: "Existing positions are untouched and continue to accrue.",
          });
        }}
        title={deactivating?.active ? `Close ${deactivating?.name} to new stakes?` : `Reopen ${deactivating?.name}?`}
        tone={deactivating?.active ? "danger" : "primary"}
        confirmLabel={deactivating?.active ? "Close to new stakes" : "Reopen pool"}
        requireAcknowledge={
          deactivating?.active ? (
            <Callout tone="warning" title="Nothing is confiscated" icon={<Ban />}>
              <p className="mt-1">
                Deactivating stops new deposits only. Open positions keep accruing to the end of their
                lock, members can still unstake and claim, and the reward pool stays funded until the
                last position exits.
              </p>
            </Callout>
          ) : (
            <Callout tone="good" title="Reopening needs funded rewards" icon={<CheckCircle2 />}>
              <p className="mt-1">
                Confirm the reward pool has enough funded balance for at least one full epoch before
                accepting new stakes.
              </p>
            </Callout>
          )
        }
      >
        <p>
          {deactivating ? formatNumber(deactivating.totalStaked) : "0"} {MTT_SYMBOL} is staked here
          across live positions. This action is reversible and is written to the audit log.
        </p>
      </ConfirmDialog>

      <AuditNote>
        Pool creation, parameter edits and reward funding are all logged with the requester, the
        approver, the multisig signers and — for funding — the on-chain transaction hash. The chain
        record and the audit record are cross-referenced so neither can be quietly amended.
      </AuditNote>
    </div>
  );
}

/* --------------------------------- pool form ------------------------------ */

function PoolForm({ draft, setDraft }: { draft: PoolDraft; setDraft: (d: PoolDraft) => void }) {
  const penalty = Number(draft.earlyPenaltyBps);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Input
        label="Pool name"
        required
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        placeholder="e.g. 180-Day"
        hint="Shown to members exactly as typed."
      />
      <Input
        label="Lock period"
        required
        type="number"
        min={0}
        suffix="days"
        value={draft.lockDays}
        onChange={(e) => setDraft({ ...draft, lockDays: e.target.value })}
        placeholder="0 for flexible"
        className="tnum"
        hint="0 makes the pool flexible — withdrawable at any time."
      />
      <Input
        label="Reward epoch length"
        required
        type="number"
        min={1}
        suffix="days"
        value={draft.rewardsDurationDays}
        onChange={(e) => setDraft({ ...draft, rewardsDurationDays: e.target.value })}
        className="tnum"
        hint="How often the variable rate is recalculated from Treasury inflow."
      />
      <Input
        label="Early-exit penalty"
        required
        type="number"
        min={0}
        max={5000}
        suffix="bps"
        value={draft.earlyPenaltyBps}
        onChange={(e) => setDraft({ ...draft, earlyPenaltyBps: e.target.value })}
        className="tnum"
        hint={
          Number.isFinite(penalty) && draft.earlyPenaltyBps !== ""
            ? `${penalty / 100}% of unclaimed rewards — principal is never touched.`
            : "Applies to unclaimed rewards only. Maximum 5,000 bps."
        }
        error={Number.isFinite(penalty) && penalty > 5000 && "Policy ceiling is 5,000 bps (50%)."}
      />
      <div className="sm:col-span-2">
        <Callout tone="critical" title="Never publish a fixed APR" icon={<AlertTriangle />}>
          <p className="mt-1">
            The rate a member sees is computed from the reward balance actually funded for the current
            epoch. Pools carry no promised return, and the UI labels every rate &ldquo;variable,
            recalculated from Treasury inflows&rdquo;. A guaranteed-yield claim would turn this
            product into something we are not licensed to offer.
          </p>
        </Callout>
      </div>
    </div>
  );
}
