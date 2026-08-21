"use client";

/* AD-02 · User management — searchable directory, full detail drawer, and the
 * three privileged actions (suspend, force reset, manual balance adjustment). */

import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowUpRight, Ban, CheckCircle2, Coins, Download, Fingerprint, KeyRound,
  Network, ScrollText, ShieldAlert, ShieldCheck, Sparkles, UserCheck, Users, Wallet,
} from "lucide-react";
import {
  Badge, Button, Callout, ConfirmDialog, DetailRow, KycBadge, LevelBadge,
  SegmentedControl, useToast, type Column,
} from "@/components/ui";
import { useAdminUsers, useAuditLog, useBalances } from "@/lib/hooks/use-data";
import {
  csvDownload, formatDate, formatNumber, formatToken, seeded, timeAgo,
} from "@/lib/utils";
import type { User } from "@/types";
import { DetailDrawer, DrawerSection, Timeline } from "../../_components/detail-drawer";
import { FilterBar } from "../../_components/filter-bar";
import { FourEyesModal, type FourEyesSubmission } from "../../_components/four-eyes-modal";
import { LedgerTable } from "../../_components/ledger-table";
import { AddressLink, AuditNote, MiniStat, Panel } from "../../_components/panel";

/* ------------------------------ small pieces ----------------------------- */

const STATUS_META: Record<
  User["status"],
  { label: string; tone: "good" | "warning" | "critical" | "neutral" | "serious"; Icon: typeof CheckCircle2 }
> = {
  active: { label: "Active", tone: "good", Icon: CheckCircle2 },
  verified_kyc_pending: { label: "KYC pending", tone: "warning", Icon: ShieldAlert },
  unverified: { label: "Unverified", tone: "neutral", Icon: AlertTriangle },
  suspended: { label: "Suspended", tone: "serious", Icon: Ban },
  frozen: { label: "Frozen", tone: "critical", Icon: ShieldAlert },
};

function AccountStatus({ status }: { status: User["status"] }) {
  const m = STATUS_META[status];
  return <Badge tone={m.tone} icon={<m.Icon className="size-3.5" />}>{m.label}</Badge>;
}

function RiskCell({ user }: { user: User }) {
  const tone = user.riskScore >= 85 ? "critical" : user.riskScore >= 70 ? "warning" : "neutral";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={tone} icon={tone === "neutral" ? undefined : <ShieldAlert className="size-3.5" />}>
        <span className="tnum">{user.riskScore}</span>
      </Badge>
      {user.riskFlags.map((f) => (
        <Badge key={f} tone="serious">{f.replace(/_/g, " ")}</Badge>
      ))}
    </div>
  );
}

/** Per-user balances derived deterministically from the balances hook, so the
 *  admin view stays consistent with the player-side numbers. */
function useUserBalances(user: User | null) {
  const { data: base } = useBalances();
  return useMemo(() => {
    if (!user) return null;
    const r = seeded(user.id);
    const f = 0.25 + r() * 2.4;
    const g = 0.2 + r() * 1.9;
    return {
      points: Math.round(base.points * f),
      mttAvailable: Number((base.mttAvailable * g).toFixed(2)),
      mttStaked: Number((base.mttStaked * f).toFixed(2)),
      commissionPending: Number((base.commissionPending * g).toFixed(2)),
      commissionAvailable: Number((base.commissionAvailable * g).toFixed(2)),
      commissionLifetime: Number((base.commissionLifetime * f).toFixed(2)),
    };
  }, [user, base]);
}

/* -------------------------------- the drawer ------------------------------ */

function UserDrawer({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { data: users } = useAdminUsers();
  const { data: audit } = useAuditLog();
  const balances = useUserBalances(user);
  const toast = useToast();

  const [confirm, setConfirm] = useState<null | "suspend" | "reactivate" | "reset">(null);
  const [adjust, setAdjust] = useState(false);

  const downline = useMemo(
    () => (user ? users.filter((u) => u.referredBy === user.id) : []),
    [users, user],
  );
  const sponsor = useMemo(
    () => (user ? users.find((u) => u.id === user.referredBy) ?? null : null),
    [users, user],
  );
  const accountAudit = useMemo(
    () => (user ? audit.filter((a) => a.target === user.id) : []),
    [audit, user],
  );

  if (!user) return null;
  const suspended = user.status === "suspended" || user.status === "frozen";

  const activity = [
    ...accountAudit.map((a) => ({
      title: a.action,
      meta: timeAgo(a.timestamp),
      tone: (a.requiresSecondApproval ? "warning" : "default") as "warning" | "default",
      body: (
        <>
          <span className="text-text-muted">{a.before ?? "—"}</span> →{" "}
          <span className="font-medium text-text-primary">{a.after ?? "—"}</span>
          <span className="block text-[11px] text-text-muted">
            {a.actor} · {a.actorRole.replace(/_/g, " ")} · IP {a.ip}
            {a.approvedBy && ` · approved by ${a.approvedBy}`}
          </span>
        </>
      ),
    })),
    {
      title: "Last active session",
      meta: timeAgo(user.lastActiveAt),
      tone: "default" as const,
      body: <>Session activity recorded from the player app.</>,
    },
    {
      title: "Account created",
      meta: formatDate(user.joinedAt, true),
      tone: "good" as const,
      body: <>Registered with email and phone verification, referral code {user.referralCode}.</>,
    },
  ];

  return (
    <>
      <DetailDrawer
        open={!!user}
        onClose={onClose}
        width="max-w-3xl"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {user.fullName}
            <span className="font-mono-num text-xs text-text-muted">{user.id}</span>
          </span>
        }
        subtitle={`${user.email} · ${user.phone} · ${user.country}`}
        badges={
          <>
            <AccountStatus status={user.status} />
            <KycBadge tier={user.kycTier} />
            <Badge tone={user.twoFactorEnabled ? "good" : "critical"} icon={<KeyRound className="size-3.5" />}>
              2FA {user.twoFactorEnabled ? "enabled" : "disabled"}
            </Badge>
            {user.riskFlags.length > 0 && (
              <Badge tone="serious" icon={<ShieldAlert className="size-3.5" />}>
                {user.riskFlags.length} risk flag{user.riskFlags.length > 1 ? "s" : ""}
              </Badge>
            )}
          </>
        }
        footer={
          <>
            <Button variant="ghost" size="sm" href="/admin/audit" iconRight={<ArrowUpRight className="size-4" />}>
              Full audit trail
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<KeyRound className="size-4" />}
              onClick={() => setConfirm("reset")}
            >
              Force password reset
            </Button>
            {suspended ? (
              <Button size="sm" icon={<UserCheck className="size-4" />} onClick={() => setConfirm("reactivate")}>
                Reactivate
              </Button>
            ) : (
              <Button variant="danger" size="sm" icon={<Ban className="size-4" />} onClick={() => setConfirm("suspend")}>
                Suspend account
              </Button>
            )}
          </>
        }
      >
        <DrawerSection title="Profile">
          <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
            <DetailRow label="Full name" value={user.fullName} />
            <DetailRow label="Display name" value={user.displayName} />
            <DetailRow label="Email" value={user.email} />
            <DetailRow label="Phone" value={<span className="tnum">{user.phone}</span>} />
            <DetailRow label="Date of birth" value={<span className="tnum">{user.dateOfBirth}</span>} />
            <DetailRow label="Country" value={user.country} />
            <DetailRow label="Joined" value={<span className="tnum">{formatDate(user.joinedAt, true)}</span>} />
            <DetailRow
              label="Wallet"
              value={
                user.walletAddress ? (
                  <span className="flex items-center gap-2">
                    <Badge tone="neutral">{user.walletType === "custodial" ? "Custodial" : "Self-custody"}</Badge>
                    <AddressLink address={user.walletAddress} />
                  </span>
                ) : (
                  "Not connected"
                )
              }
            />
          </div>
        </DrawerSection>

        <DrawerSection
          title="Balances"
          description="Read-only. Any change to a balance goes through the adjustment flow below and is logged."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat label="Points" value={formatNumber(balances?.points ?? 0)} sub="off-chain loyalty balance" />
            <MiniStat label="MTT available" value={formatToken(balances?.mttAvailable ?? 0)} sub="withdrawable" />
            <MiniStat label="MTT staked" value={formatToken(balances?.mttStaked ?? 0)} sub="locked in pools" />
            <MiniStat
              label="Commission pending"
              value={formatToken(balances?.commissionPending ?? 0)}
              sub="held until KYC Tier 1"
              tone={user.kycTier === "none" || user.kycTier === "pending" ? "warning" : "default"}
            />
            <MiniStat label="Commission available" value={formatToken(balances?.commissionAvailable ?? 0)} sub="claimable" />
            <MiniStat label="Commission lifetime" value={formatToken(balances?.commissionLifetime ?? 0)} sub="all-time" />
          </div>
          <Button
            variant="outline"
            size="sm"
            icon={<Coins className="size-4" />}
            onClick={() => setAdjust(true)}
          >
            Manual balance adjustment
          </Button>
        </DrawerSection>

        <DrawerSection title="KYC & AML" description="Documents live in the KYC queue; this is the current standing.">
          <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
            <DetailRow label="Verification tier" value={<KycBadge tier={user.kycTier} />} />
            <DetailRow
              label="Withdrawal eligibility"
              value={
                user.kycTier === "tier1" || user.kycTier === "tier2" ? (
                  <Badge tone="good" icon={<CheckCircle2 className="size-3.5" />}>Eligible</Badge>
                ) : (
                  <Badge tone="warning" icon={<AlertTriangle className="size-3.5" />}>Blocked until Tier 1</Badge>
                )
              }
            />
            <DetailRow label="Risk score" value={<span className="tnum">{user.riskScore} / 100</span>} />
            <DetailRow
              label="Risk flags"
              value={
                user.riskFlags.length ? (
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {user.riskFlags.map((f) => (
                      <Badge key={f} tone="serious">{f.replace(/_/g, " ")}</Badge>
                    ))}
                  </span>
                ) : (
                  "None"
                )
              }
            />
          </div>
          <Button variant="ghost" size="sm" href="/admin/kyc" iconRight={<ArrowUpRight className="size-4" />}>
            Open KYC review queue
          </Button>
        </DrawerSection>

        <DrawerSection
          title="Referral tree position"
          description="Aggregate only. An admin sees structure; a member never sees another member's balances."
        >
          <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
            <DetailRow
              label="Sponsor (upline)"
              value={
                sponsor ? (
                  <span className="flex items-center gap-2">
                    <LevelBadge level={1} />
                    <span className="font-mono-num text-xs">{sponsor.id}</span>
                  </span>
                ) : (
                  "None — joined directly"
                )
              }
            />
            <DetailRow label="Own referral code" value={<span className="font-mono-num text-xs">{user.referralCode}</span>} />
            <DetailRow label="Direct (L1) downline" value={<span className="tnum">{downline.length}</span>} />
            <DetailRow
              label="Active downline"
              value={<span className="tnum">{downline.filter((d) => d.status === "active").length}</span>}
            />
          </div>
          {downline.length > 0 && (
            <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle">
              {downline.slice(0, 6).map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 bg-surface-1 px-4 py-2.5">
                  <span className="flex items-center gap-2 text-sm text-text-primary">
                    <Network className="size-3.5 text-[var(--accent)]" />
                    {d.fullName}
                    <span className="font-mono-num text-xs text-text-muted">{d.id}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <KycBadge tier={d.kycTier} />
                    <AccountStatus status={d.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-text-muted">
            Referring is optional and free. Commission is capped monthly and is never a condition of
            earning, converting or withdrawing.
          </p>
        </DrawerSection>

        <DrawerSection title="Activity & audit log" description="Newest first. Sensitive actions carry the second approver.">
          <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-4">
            <Timeline items={activity} />
          </div>
          <AuditNote>
            Every entry above is append-only. Admin actions on this account are retained for the
            regulatory record-keeping period and are disclosable to the member on request.
          </AuditNote>
        </DrawerSection>
      </DetailDrawer>

      {/* ---------------------------- suspend / reactivate ------------------ */}
      <ConfirmDialog
        open={confirm === "suspend"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          toast.toast({
            tone: "warning",
            title: `${user.id} suspended`,
            description: "Login, conversion and withdrawal are blocked. Written to the audit log.",
          });
        }}
        title="Suspend this account?"
        tone="danger"
        confirmLabel="Suspend account"
        requireAcknowledge={
          <Callout tone="warning" title="What suspension does" icon={<Ban />}>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li>Login, Points conversion and withdrawals are blocked immediately.</li>
              <li>Accrued commission is held, not forfeited, pending review.</li>
              <li>Staked positions continue to accrue; nothing is confiscated.</li>
              <li>The member is notified with the reason category and appeal route.</li>
            </ul>
          </Callout>
        }
      >
        <p>
          {user.fullName} ({user.id}) will lose access pending review. This is a reversible
          administrative action, recorded against your operator identity.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === "reactivate"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          toast.success(`${user.id} reactivated`, "Access restored. Written to the audit log.");
        }}
        title="Reactivate this account?"
        confirmLabel="Reactivate"
      >
        <p>
          Access, conversion and withdrawals are restored for {user.fullName}. Any open fraud alert
          on the account stays open until a compliance officer closes it separately.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === "reset"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          toast.success("Password reset forced", "All sessions revoked; a reset link was emailed to the member.");
        }}
        title="Force a password reset?"
        confirmLabel="Force reset"
        requireAcknowledge={
          <Callout tone="info" title="Sessions are revoked too" icon={<ShieldCheck />}>
            <p className="mt-1">
              Every active session and refresh token is invalidated. The member sets a new password
              from an emailed one-time link. Admins never see or set member passwords.
            </p>
          </Callout>
        }
      >
        <p>A reset link is emailed to {user.email}. The member&apos;s balances are untouched.</p>
      </ConfirmDialog>

      {/* -------------------------- balance adjustment ---------------------- */}
      <BalanceAdjustmentModal
        open={adjust}
        onClose={() => setAdjust(false)}
        user={user}
        onSubmit={(s) => {
          setAdjust(false);
          toast.toast({
            tone: "info",
            title: "Adjustment queued for approval",
            description: `Routed to ${s.secondApprover}. It does not affect the balance until they approve.`,
          });
        }}
      />
    </>
  );
}

/* ------------------------ manual balance adjustment ---------------------- */

function BalanceAdjustmentModal({
  open, onClose, user, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  user: User;
  onSubmit: (s: FourEyesSubmission) => void;
}) {
  const [asset, setAsset] = useState<"points" | "mtt">("mtt");
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const parsed = Number(amount);
  const invalid = amount !== "" && (!Number.isFinite(parsed) || parsed <= 0);

  return (
    <FourEyesModal
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title="Manual balance adjustment"
      description={`${user.fullName} · ${user.id}`}
      submitLabel="Submit for second approval"
      icon={<Coins className="size-5" />}
      blocked={invalid || amount === ""}
      blockedTitle={amount === "" ? "Enter an amount" : "Amount is not valid"}
      blockedMessage={
        amount === ""
          ? "An adjustment needs an explicit amount. There is no “correct to expected value” shortcut — the figure has to be stated and justified."
          : "Enter a positive number. Adjustments are absolute amounts, never percentages."
      }
      reasonLabel="Documented reason (mandatory)"
      reasonHint="This text is the audit record. It should let a regulator reconstruct why the balance moved without asking you."
      acknowledgement={
        <span>
          I confirm this adjustment corrects a verified platform error or fulfils a documented
          support outcome, that it is <strong className="text-text-primary">not</strong> a
          discretionary bonus, incentive or goodwill payment, and that it will be funded from the
          operating provision rather than another member&apos;s balance.
        </span>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-text-secondary">Asset</span>
            <SegmentedControl
              value={asset}
              onValueChange={setAsset}
              options={[
                { value: "mtt", label: "MTT" },
                { value: "points", label: "Points" },
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-text-secondary">Direction</span>
            <SegmentedControl
              value={direction}
              onValueChange={setDirection}
              options={[
                { value: "credit", label: "Credit" },
                { value: "debit", label: "Debit" },
              ]}
            />
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium text-text-secondary">
            Amount <span className="text-[var(--accent)]">*</span>
          </span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder={asset === "mtt" ? "e.g. 340.00" : "e.g. 340"}
            className="tnum h-11 w-full rounded-xl border border-border-default bg-surface-3 px-3.5 text-sm text-text-primary placeholder:text-text-muted focus:border-[var(--accent)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-soft)]"
          />
          <span className="block text-xs text-text-muted">
            {direction === "credit" ? "Added to" : "Removed from"} the member&apos;s{" "}
            {asset === "mtt" ? "available MTT" : "Points"} balance on approval.
          </span>
        </label>

        <Callout tone="serious" title="Adjustments are exceptional, not routine" icon={<ShieldAlert />}>
          <p className="mt-1">
            A manual adjustment bypasses the normal earning path, so it is the most closely reviewed
            action in the back office. Volume per operator is reported to Compliance monthly, and a
            debit that reduces a member&apos;s balance additionally requires the member to be
            notified with the reason.
          </p>
        </Callout>
      </div>
    </FourEyesModal>
  );
}

/* ------------------------------- header action ---------------------------- */

export function UsersActions() {
  const { data: users } = useAdminUsers();
  return (
    <Button
      variant="outline"
      size="sm"
      icon={<Download className="size-4" />}
      onClick={() =>
        csvDownload(
          "members-trail-users.csv",
          users.map((u) => ({
            id: u.id,
            name: u.fullName,
            email: u.email,
            country: u.country,
            status: u.status,
            kyc_tier: u.kycTier,
            two_factor: u.twoFactorEnabled,
            risk_score: u.riskScore,
            risk_flags: u.riskFlags.join(" | "),
            joined: u.joinedAt,
            last_active: u.lastActiveAt,
          })),
        )
      }
    >
      Export user list
    </Button>
  );
}

/* ---------------------------------- view --------------------------------- */

export function UsersView() {
  const { data: users, isLoading } = useAdminUsers();
  const [query, setQuery] = useState("");
  const [kyc, setKyc] = useState("all");
  const [status, setStatus] = useState("all");
  const [risk, setRisk] = useState("all");
  const [selected, setSelected] = useState<User | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (q && ![u.id, u.email, u.fullName, u.displayName, u.referralCode, u.walletAddress ?? ""]
        .some((f) => f.toLowerCase().includes(q))) return false;
      if (kyc !== "all" && u.kycTier !== kyc) return false;
      if (status !== "all" && u.status !== status) return false;
      if (risk === "flagged" && u.riskFlags.length === 0) return false;
      if (risk === "clean" && u.riskFlags.length > 0) return false;
      if (risk === "high" && u.riskScore < 70) return false;
      if (risk === "no2fa" && u.twoFactorEnabled) return false;
      return true;
    });
  }, [users, query, kyc, status, risk]);

  const columns: Column<User>[] = [
    {
      key: "user",
      header: "Member",
      sortValue: (u) => u.fullName,
      cell: (u) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">{u.fullName}</p>
          <p className="font-mono-num truncate text-xs text-text-muted">{u.id} · {u.email}</p>
        </div>
      ),
    },
    {
      key: "kyc",
      header: "KYC",
      sortValue: (u) => u.kycTier,
      cell: (u) => <KycBadge tier={u.kycTier} />,
    },
    {
      key: "status",
      header: "Account",
      sortValue: (u) => u.status,
      cell: (u) => <AccountStatus status={u.status} />,
    },
    {
      key: "risk",
      header: "Risk",
      hideBelow: "md",
      sortValue: (u) => u.riskScore,
      cell: (u) => <RiskCell user={u} />,
    },
    {
      key: "country",
      header: "Country",
      hideBelow: "lg",
      align: "center",
      sortValue: (u) => u.country,
      cell: (u) => <span className="tnum text-sm text-text-secondary">{u.country}</span>,
    },
    {
      key: "2fa",
      header: "2FA",
      hideBelow: "xl",
      align: "center",
      sortValue: (u) => (u.twoFactorEnabled ? 1 : 0),
      cell: (u) =>
        u.twoFactorEnabled ? (
          <CheckCircle2 className="mx-auto size-4 text-good-400" aria-label="2FA enabled" />
        ) : (
          <AlertTriangle className="mx-auto size-4 text-warning-400" aria-label="2FA disabled" />
        ),
    },
    {
      key: "joined",
      header: "Joined",
      hideBelow: "lg",
      align: "right",
      sortValue: (u) => u.joinedAt,
      cell: (u) => <span className="tnum text-xs text-text-secondary">{formatDate(u.joinedAt)}</span>,
    },
    {
      key: "active",
      header: "Last active",
      hideBelow: "md",
      align: "right",
      sortValue: (u) => u.lastActiveAt,
      cell: (u) => <span className="text-xs text-text-muted">{timeAgo(u.lastActiveAt)}</span>,
    },
  ];

  const flagged = users.filter((u) => u.riskFlags.length > 0).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat label="Accounts" value={formatNumber(users.length)} sub="in this directory page" />
        <MiniStat
          label="KYC verified"
          value={formatNumber(users.filter((u) => u.kycTier === "tier1" || u.kycTier === "tier2").length)}
          sub="Tier 1 or Tier 2"
          tone="good"
        />
        <MiniStat
          label="Risk flagged"
          value={formatNumber(flagged)}
          sub="one or more fraud-engine flags"
          tone={flagged > 0 ? "warning" : "good"}
        />
        <MiniStat
          label="Restricted"
          value={formatNumber(users.filter((u) => u.status === "suspended" || u.status === "frozen").length)}
          sub="suspended or frozen"
          tone="critical"
        />
      </div>

      <FilterBar
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="User ID, email, name, referral code or wallet…"
        shown={filtered.length}
        total={users.length}
        unit="accounts"
        onReset={() => { setQuery(""); setKyc("all"); setStatus("all"); setRisk("all"); }}
        filters={[
          {
            label: "KYC status",
            value: kyc,
            onChange: setKyc,
            options: [
              { value: "all", label: "Any KYC status" },
              { value: "none", label: "Not started" },
              { value: "pending", label: "Pending review" },
              { value: "tier1", label: "Tier 1 approved" },
              { value: "tier2", label: "Tier 2 approved" },
              { value: "rejected", label: "Rejected" },
            ],
          },
          {
            label: "Account status",
            value: status,
            onChange: setStatus,
            options: [
              { value: "all", label: "Any account status" },
              { value: "active", label: "Active" },
              { value: "verified_kyc_pending", label: "KYC pending" },
              { value: "unverified", label: "Unverified" },
              { value: "suspended", label: "Suspended" },
              { value: "frozen", label: "Frozen" },
            ],
          },
          {
            label: "Risk",
            value: risk,
            onChange: setRisk,
            options: [
              { value: "all", label: "Any risk profile" },
              { value: "flagged", label: "Has risk flags" },
              { value: "high", label: "Risk score ≥ 70" },
              { value: "clean", label: "No flags" },
              { value: "no2fa", label: "2FA disabled" },
            ],
          },
        ]}
      />

      <LedgerTable
        title="Member directory"
        description="Click any row to open the full account record. Columns are sortable; narrow screens keep the identity, KYC and status columns."
        icon={<Users />}
        columns={columns}
        rows={filtered}
        keyOf={(u) => u.id}
        caption="All member accounts with KYC status, account status and fraud-engine risk score"
        loading={isLoading}
        pageSize={12}
        onRowClick={setSelected}
        dense={false}
        empty={{
          title: "No accounts match these filters",
          description: "Widen the KYC, status or risk filter, or clear the search box.",
        }}
        footnote="Search covers user ID, email, full name, referral code and wallet address. Personally identifiable fields are masked in exports destined outside Compliance."
      />

      <Panel
        icon={<ScrollText />}
        title="Privileged actions available on an account"
        description="Each one is a controlled flow, never a bare button."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              Icon: Ban,
              title: "Suspend / reactivate",
              body: "Blocks login, conversion and withdrawal. Reversible, notified to the member, and logged with your operator identity.",
            },
            {
              Icon: KeyRound,
              title: "Force password reset",
              body: "Revokes every session and emails a one-time reset link. Admins never see or set member passwords.",
            },
            {
              Icon: Coins,
              title: "Manual balance adjustment",
              body: "Mandatory typed reason plus a second admin's approval before the balance moves. Immutably logged.",
            },
          ].map((a) => (
            <div key={a.title} className="rounded-xl border border-border-subtle bg-surface-inset p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <a.Icon className="size-4 text-[var(--accent)]" />
                {a.title}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{a.body}</p>
            </div>
          ))}
        </div>
        <Callout tone="warning" title="Four-eyes principle on money" icon={<Fingerprint />} className="mt-4">
          <p className="mt-1">
            No single operator can move a member&apos;s balance. The requester writes a documented
            reason, a different admin with approve rights confirms it, and both identities plus the
            before/after values are written to append-only audit storage. Super Admin is not exempt.
          </p>
        </Callout>
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" href="/admin/kyc" icon={<ShieldCheck className="size-4" />}>
          KYC review queue
        </Button>
        <Button variant="ghost" size="sm" href="/admin/fraud" icon={<ShieldAlert className="size-4" />}>
          Fraud alerts
        </Button>
        <Button variant="ghost" size="sm" href="/admin/audit" icon={<ScrollText className="size-4" />}>
          Audit log
        </Button>
        <Button variant="ghost" size="sm" href="/admin/games" icon={<Sparkles className="size-4" />}>
          Points issuance rules
        </Button>
        <Button variant="ghost" size="sm" href="/admin/treasury" icon={<Wallet className="size-4" />}>
          Treasury
        </Button>
      </div>

      <UserDrawer user={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
