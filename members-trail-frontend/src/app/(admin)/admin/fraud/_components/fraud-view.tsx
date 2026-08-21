"use client";

/* AD-09 · Transaction monitoring & fraud alerts — alert queue, investigation
 * drawer, and the rule thresholds that generate the alerts. */

import { useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Ban, CheckCircle2, Download, Fingerprint, Flag, Gauge,
  Layers, Network, Radar, RefreshCcw, ShieldAlert, ShieldCheck, Snowflake, Users, Zap,
} from "lucide-react";
import {
  Badge, Button, Callout, ConfirmDialog, DetailRow, SegmentedControl, Slider, Textarea,
  useToast, type Column,
} from "@/components/ui";
import { BarSeries } from "@/components/charts";
import { useAdminUsers, useFraudAlerts } from "@/lib/hooks/use-data";
import { csvDownload, formatDate, formatNumber, timeAgo } from "@/lib/utils";
import type { FraudAlert } from "@/types";
import { DetailDrawer, DrawerSection } from "../../_components/detail-drawer";
import { FilterBar } from "../../_components/filter-bar";
import { FourEyesModal } from "../../_components/four-eyes-modal";
import { LedgerTable } from "../../_components/ledger-table";
import { AuditNote, MiniStat, Panel } from "../../_components/panel";

const KIND_META: Record<FraudAlert["kind"], { label: string; Icon: typeof Radar; pattern: string }> = {
  self_referral_ring: {
    label: "Circular referral ring",
    Icon: Network,
    pattern: "Accounts referring each other in a closed loop to manufacture commission from their own spend.",
  },
  multi_account: {
    label: "Multi-account creation",
    Icon: Users,
    pattern: "Rapid creation of several accounts from one device fingerprint or IP range, usually to farm sign-up value or build a fake downline.",
  },
  bot_farming: {
    label: "Points-farming velocity",
    Icon: Zap,
    pattern: "Automated or scripted play producing Points at a rate no human sustains, with unnaturally low variance between sessions.",
  },
  device_cluster: {
    label: "Device cluster",
    Icon: Fingerprint,
    pattern: "A group of accounts sharing hardware and behavioural fingerprints, converting at the cap in lockstep.",
  },
  velocity: {
    label: "Withdrawal velocity",
    Icon: Activity,
    pattern: "A burst of withdrawal requests to newly seen destinations in a short window.",
  },
  structuring: {
    label: "Structuring",
    Icon: Layers,
    pattern: "Repeated activity deliberately sized just under a review or approval threshold to avoid manual checks.",
  },
};

const SEVERITY_TONE: Record<FraudAlert["severity"], "critical" | "serious" | "warning" | "neutral"> = {
  critical: "critical",
  high: "serious",
  medium: "warning",
  low: "neutral",
};

const STATUS_BADGE: Record<FraudAlert["status"], React.ReactNode> = {
  open: <Badge tone="critical" icon={<ShieldAlert className="size-3.5" />}>Open</Badge>,
  investigating: <Badge tone="warning" icon={<Radar className="size-3.5" />}>Investigating</Badge>,
  actioned: <Badge tone="good" icon={<CheckCircle2 className="size-3.5" />}>Actioned</Badge>,
  dismissed: <Badge tone="neutral" icon={<CheckCircle2 className="size-3.5" />}>Dismissed</Badge>,
};

/* ----------------------------- investigation ----------------------------- */

function InvestigationDrawer({ alert, onClose }: { alert: FraudAlert | null; onClose: () => void }) {
  const { data: users } = useAdminUsers();
  const toast = useToast();
  const [freeze, setFreeze] = useState(false);
  const [dismiss, setDismiss] = useState(false);
  const [escalate, setEscalate] = useState(false);
  const [notes, setNotes] = useState("");

  if (!alert) return null;
  const meta = KIND_META[alert.kind];
  const affected = alert.affectedUsers
    .map((a) => users.find((u) => u.id === a.id) ?? null)
    .filter((u): u is NonNullable<typeof u> => !!u);

  return (
    <>
      <DetailDrawer
        open={!!alert}
        onClose={onClose}
        width="max-w-3xl"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {meta.label}
            <span className="font-mono-num text-xs text-text-muted">{alert.id}</span>
          </span>
        }
        subtitle={alert.summary}
        badges={
          <>
            <Badge tone={SEVERITY_TONE[alert.severity]} icon={<AlertTriangle className="size-3.5" />}>
              {alert.severity} severity
            </Badge>
            <Badge tone={alert.riskScore >= 85 ? "critical" : "warning"} icon={<Gauge className="size-3.5" />}>
              Risk <span className="tnum">{alert.riskScore}</span>
            </Badge>
            {STATUS_BADGE[alert.status]}
            <Badge tone="neutral">Raised {timeAgo(alert.raisedAt)}</Badge>
          </>
        }
        footer={
          <>
            <Button variant="ghost" size="sm" icon={<CheckCircle2 className="size-4" />} onClick={() => setDismiss(true)}>
              Dismiss with notes
            </Button>
            <Button variant="outline" size="sm" icon={<Flag className="size-4" />} onClick={() => setEscalate(true)}>
              Escalate
            </Button>
            <Button variant="danger" size="sm" icon={<Snowflake className="size-4" />} onClick={() => setFreeze(true)}>
              Freeze accounts
            </Button>
          </>
        }
      >
        <DrawerSection
          title="Signals that fired"
          description="The specific evidence, not a score. Every alert must be explainable to the member and to a regulator."
        >
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle">
            {alert.signals.map((s) => (
              <li key={s} className="flex gap-3 bg-surface-1 px-4 py-3">
                <Radar className="mt-0.5 size-4 shrink-0 text-warning-400" />
                <span className="text-sm text-text-secondary">{s}</span>
              </li>
            ))}
          </ul>
          <Callout tone="info" title="Pattern definition" icon={<meta.Icon />}>
            <p className="mt-1">{meta.pattern}</p>
          </Callout>
        </DrawerSection>

        <DrawerSection
          title={`Affected accounts (${alert.affectedUsers.length})`}
          description="Freezing applies to every account listed here unless you narrow it in the confirmation step."
        >
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle">
            {alert.affectedUsers.map((a) => {
              const u = affected.find((x) => x.id === a.id);
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 bg-surface-1 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-text-primary">{a.name}</span>
                    <span className="font-mono-num block text-xs text-text-muted">
                      {a.id}
                      {u && ` · ${u.country} · joined ${formatDate(u.joinedAt)}`}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {u && (
                      <Badge tone={u.riskScore >= 85 ? "critical" : u.riskScore >= 70 ? "warning" : "neutral"}>
                        risk <span className="tnum">{u.riskScore}</span>
                      </Badge>
                    )}
                    {u?.riskFlags.map((f) => (
                      <Badge key={f} tone="serious">{f.replace(/_/g, " ")}</Badge>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
          <Button variant="ghost" size="sm" href="/admin/users">
            Open in user management
          </Button>
        </DrawerSection>

        <DrawerSection title="Investigation notes" description="Required for a dismissal, recommended for everything else.">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Reviewed 24h session log for USR-10528: input jitter present, device shared with a household member confirmed by prior support ticket TK-2991. Velocity explained by a tournament weekend."
            className="min-h-28"
            hint="Notes stay on the alert permanently and are visible to the MLRO if the case is later escalated."
          />
        </DrawerSection>

        <AuditNote>
          Freezing, dismissing and escalating are all logged with your identity, the alert ID, the
          affected accounts and your notes. A dismissal is as auditable as a freeze — closing an alert
          without evidence is itself a finding.
        </AuditNote>
      </DetailDrawer>

      <ConfirmDialog
        open={freeze}
        onClose={() => setFreeze(false)}
        onConfirm={() => {
          setFreeze(false);
          onClose();
          toast.toast({
            tone: "warning",
            title: `${alert.affectedUsers.length} account(s) frozen`,
            description: "Withdrawals and conversions are held pending review. Members are notified.",
          });
        }}
        title="Freeze these accounts pending review?"
        tone="danger"
        confirmLabel="Freeze pending review"
        requireAcknowledge={
          <Callout tone="warning" title="What a freeze does and does not do" icon={<Snowflake />}>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li>Withdrawals, conversions and commission release are held.</li>
              <li>Balances and staked positions are preserved, not confiscated.</li>
              <li>Members are told their account is under review and how to respond.</li>
              <li>A freeze must be resolved or lifted within the review SLA, not left open indefinitely.</li>
            </ul>
          </Callout>
        }
      >
        <p>
          {alert.affectedUsers.map((a) => a.id).join(", ")} — {alert.severity} severity{" "}
          {KIND_META[alert.kind].label.toLowerCase()} with a risk score of {alert.riskScore}.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={dismiss}
        onClose={() => setDismiss(false)}
        onConfirm={() => {
          setDismiss(false);
          onClose();
          toast.success("Alert dismissed", "Your notes are attached and the pattern is fed back to the rule tuning set.");
        }}
        title="Dismiss this alert?"
        confirmLabel="Dismiss with notes"
        requireAcknowledge={
          notes.trim().length < 15 ? (
            <Callout tone="critical" title="Notes are required to dismiss" icon={<AlertTriangle />}>
              <p className="mt-1">
                Close the drawer, write at least a sentence explaining why this is benign, and try
                again. An unexplained dismissal is the single easiest way for a real ring to survive
                review.
              </p>
            </Callout>
          ) : (
            <Callout tone="good" title="Feeds back into rule tuning" icon={<RefreshCcw />}>
              <p className="mt-1">
                Dismissed alerts are sampled monthly to measure the false-positive rate per rule, which
                is how the thresholds below get tightened or relaxed.
              </p>
            </Callout>
          )
        }
      >
        <p>
          The accounts stay active and unrestricted. The alert remains in the history as dismissed,
          with your identity and notes.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={escalate}
        onClose={() => setEscalate(false)}
        onConfirm={() => {
          setEscalate(false);
          onClose();
          toast.toast({
            tone: "warning",
            title: "Escalated to the MLRO",
            description: "Enhanced monitoring is on. Do not discuss the escalation with the members involved.",
          });
        }}
        title="Escalate to the Money Laundering Reporting Officer?"
        tone="danger"
        confirmLabel="Escalate case"
        requireAcknowledge={
          <Callout tone="critical" title="Tipping-off rules apply" icon={<ShieldAlert />}>
            <p className="mt-1">
              Once escalated, communication with the affected members about the investigation stops.
              Any account action taken is communicated with its own independent reason, never
              referencing the report.
            </p>
          </Callout>
        }
      >
        <p>
          Opens a financial-crime case with the signal list, the affected accounts, their device and
          transaction history, and your notes attached.
        </p>
      </ConfirmDialog>
    </>
  );
}

/* ------------------------------ rule config ------------------------------ */

interface Thresholds {
  velocitySigma: number;
  accountsPerDevice: number;
  accountsPerIpDay: number;
  ringMaxCycle: number;
  structuringPct: number;
  structuringCount: number;
  autoFreezeScore: number;
}

const DEFAULT_THRESHOLDS: Thresholds = {
  velocitySigma: 4,
  accountsPerDevice: 3,
  accountsPerIpDay: 5,
  ringMaxCycle: 4,
  structuringPct: 95,
  structuringCount: 5,
  autoFreezeScore: 90,
};

function RuleConfig() {
  const [t, setT] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [publish, setPublish] = useState(false);
  const toast = useToast();
  const dirty = Object.keys(t).some((k) => t[k as keyof Thresholds] !== DEFAULT_THRESHOLDS[k as keyof Thresholds]);

  return (
    <Panel
      icon={<Radar />}
      title="Rule configuration"
      description="Thresholds that decide when a pattern becomes an alert. Loosen them and real rings survive; tighten them and compliance officers drown in false positives."
      action={
        <>
          <Button variant="ghost" size="sm" icon={<RefreshCcw className="size-4" />} disabled={!dirty} onClick={() => setT(DEFAULT_THRESHOLDS)}>
            Reset
          </Button>
          <Button size="sm" icon={<ShieldCheck className="size-4" />} disabled={!dirty} onClick={() => setPublish(true)}>
            Publish thresholds
          </Button>
        </>
      }
      footnote="Threshold changes apply to future evaluation windows only. Open alerts keep the thresholds that generated them, so an alert can never be made to disappear by relaxing a rule."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-5">
          <Slider
            label="Points-farming velocity trigger"
            value={t.velocitySigma}
            min={2}
            max={10}
            step={0.5}
            formatValue={(v) => `${v}σ above cohort mean`}
            onValueChange={(v) => setT((c) => ({ ...c, velocitySigma: v }))}
          />
          <p className="-mt-3 text-xs text-text-muted">
            Standard deviations above the cohort&apos;s mean Points-per-hour before an alert opens.
            Paired with a session-variance check so a genuinely skilled player is not flagged.
          </p>

          <Slider
            label="Accounts per device fingerprint"
            value={t.accountsPerDevice}
            min={1}
            max={10}
            step={1}
            formatValue={(v) => `${v} accounts`}
            onValueChange={(v) => setT((c) => ({ ...c, accountsPerDevice: v }))}
          />
          <p className="-mt-3 text-xs text-text-muted">
            Shared households are real, so this is deliberately not 1. Above the threshold the cluster
            is reviewed, not auto-banned.
          </p>

          <Slider
            label="New accounts per IP, 24 hours"
            value={t.accountsPerIpDay}
            min={1}
            max={20}
            step={1}
            formatValue={(v) => `${v} accounts / day`}
            onValueChange={(v) => setT((c) => ({ ...c, accountsPerIpDay: v }))}
          />
          <p className="-mt-3 text-xs text-text-muted">
            Catches rapid multi-account creation from one connection. Carrier-grade NAT ranges are
            excluded from this rule and handled by device fingerprint instead.
          </p>
        </div>

        <div className="space-y-5">
          <Slider
            label="Referral ring — maximum cycle length checked"
            value={t.ringMaxCycle}
            min={2}
            max={8}
            step={1}
            formatValue={(v) => `${v} hops`}
            onValueChange={(v) => setT((c) => ({ ...c, ringMaxCycle: v }))}
          />
          <p className="-mt-3 text-xs text-text-muted">
            The sponsor graph is searched for closed loops up to this length. A loop of any length is
            an automatic alert, because a genuine referral chain never closes on itself.
          </p>

          <Slider
            label="Structuring — proximity to threshold"
            value={t.structuringPct}
            min={80}
            max={99}
            step={1}
            formatValue={(v) => `${v}% of the review limit`}
            onValueChange={(v) => setT((c) => ({ ...c, structuringPct: v }))}
          />
          <Slider
            label="Structuring — repetitions before alert"
            value={t.structuringCount}
            min={2}
            max={20}
            step={1}
            formatValue={(v) => `${v} in 14 days`}
            onValueChange={(v) => setT((c) => ({ ...c, structuringCount: v }))}
          />
          <p className="-mt-3 text-xs text-text-muted">
            Repeated withdrawals sized just under the manual-review limit. One is a coincidence;{" "}
            {t.structuringCount} in a fortnight is a pattern.
          </p>

          <Slider
            label="Auto-freeze risk score"
            value={t.autoFreezeScore}
            min={70}
            max={100}
            step={1}
            formatValue={(v) => `score ≥ ${v}`}
            onValueChange={(v) => setT((c) => ({ ...c, autoFreezeScore: v }))}
          />
          <Callout tone="warning" title="Auto-freeze is a held withdrawal, not a ban" icon={<Snowflake />}>
            <p className="mt-1">
              Above this score, withdrawals are held for human review automatically. Balances are
              never seized and the member is told their withdrawal is under review with an expected
              response time.
            </p>
          </Callout>
        </div>
      </div>

      <FourEyesModal
        open={publish}
        onClose={() => setPublish(false)}
        onSubmit={(s) => {
          setPublish(false);
          toast.success("Threshold change submitted", `Routed to ${s.secondApprover} for compliance approval.`);
        }}
        title="Publish detection thresholds"
        description="Detection rules are compliance controls, so changing them needs a second approver."
        submitLabel="Submit for approval"
        icon={<Radar className="size-5" />}
        reasonLabel="Reason for the threshold change"
        reasonHint="Cite the false-positive or missed-detection evidence behind the change."
        acknowledgement={
          <span>
            I confirm this change is based on measured detection performance, that it does not weaken
            a control below the AML policy minimum, and that open alerts retain the thresholds under
            which they were raised.
          </span>
        }
      >
        <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
          <DetailRow label="Velocity trigger" value={`${DEFAULT_THRESHOLDS.velocitySigma}σ → ${t.velocitySigma}σ`} />
          <DetailRow label="Accounts / device" value={`${DEFAULT_THRESHOLDS.accountsPerDevice} → ${t.accountsPerDevice}`} />
          <DetailRow label="Accounts / IP / day" value={`${DEFAULT_THRESHOLDS.accountsPerIpDay} → ${t.accountsPerIpDay}`} />
          <DetailRow label="Ring cycle length" value={`${DEFAULT_THRESHOLDS.ringMaxCycle} → ${t.ringMaxCycle} hops`} />
          <DetailRow label="Structuring proximity" value={`${DEFAULT_THRESHOLDS.structuringPct}% → ${t.structuringPct}%`} />
          <DetailRow label="Structuring repetitions" value={`${DEFAULT_THRESHOLDS.structuringCount} → ${t.structuringCount}`} />
          <DetailRow label="Auto-freeze score" value={`${DEFAULT_THRESHOLDS.autoFreezeScore} → ${t.autoFreezeScore}`} />
        </div>
      </FourEyesModal>
    </Panel>
  );
}

/* ------------------------------ header actions --------------------------- */

export function FraudActions() {
  const { data: alerts } = useFraudAlerts();
  return (
    <Button
      variant="outline"
      size="sm"
      icon={<Download className="size-4" />}
      onClick={() =>
        csvDownload(
          "members-trail-fraud-alerts.csv",
          alerts.map((a) => ({
            alert_id: a.id,
            raised_at: a.raisedAt,
            kind: a.kind,
            severity: a.severity,
            risk_score: a.riskScore,
            status: a.status,
            affected_users: a.affectedUsers.map((u) => u.id).join(" | "),
            summary: a.summary,
            signals: a.signals.join(" | "),
          })),
        )
      }
    >
      Export alerts
    </Button>
  );
}

/* ---------------------------------- view --------------------------------- */

export function FraudView() {
  const { data: alerts, isLoading } = useFraudAlerts();
  const [status, setStatus] = useState<"open" | "investigating" | "actioned" | "dismissed" | "all">("open");
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("all");
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState<FraudAlert | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return alerts.filter((a) => {
      if (status !== "all" && a.status !== status) return false;
      if (severity !== "all" && a.severity !== severity) return false;
      if (kind !== "all" && a.kind !== kind) return false;
      if (
        q &&
        ![a.id, a.summary, KIND_META[a.kind].label, ...a.affectedUsers.map((u) => `${u.id} ${u.name}`)]
          .some((f) => f.toLowerCase().includes(q))
      )
        return false;
      return true;
    });
  }, [alerts, status, severity, kind, query]);

  const byKind = useMemo(
    () =>
      (Object.keys(KIND_META) as FraudAlert["kind"][]).map((k) => ({
        pattern: KIND_META[k].label,
        alerts: alerts.filter((a) => a.kind === k).length,
      })),
    [alerts],
  );

  const columns: Column<FraudAlert>[] = [
    {
      key: "alert",
      header: "Alert",
      sortValue: (a) => a.id,
      cell: (a) => {
        const meta = KIND_META[a.kind];
        return (
          <div className="flex min-w-0 items-start gap-2.5">
            <meta.Icon className="mt-0.5 size-4 shrink-0 text-warning-400" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text-primary">{meta.label}</p>
              <p className="font-mono-num truncate text-xs text-text-muted">{a.id} · {timeAgo(a.raisedAt)}</p>
            </div>
          </div>
        );
      },
    },
    {
      key: "severity",
      header: "Severity",
      sortValue: (a) => ({ critical: 4, high: 3, medium: 2, low: 1 })[a.severity],
      cell: (a) => (
        <Badge tone={SEVERITY_TONE[a.severity]} icon={<AlertTriangle className="size-3.5" />}>
          {a.severity}
        </Badge>
      ),
    },
    {
      key: "risk",
      header: "Risk",
      align: "right",
      sortValue: (a) => a.riskScore,
      cell: (a) => <span className="tnum text-sm font-medium text-text-primary">{a.riskScore}</span>,
    },
    {
      key: "users",
      header: "Affected",
      hideBelow: "md",
      sortValue: (a) => a.affectedUsers.length,
      cell: (a) => (
        <span className="flex flex-wrap gap-1">
          {a.affectedUsers.slice(0, 2).map((u) => (
            <Badge key={u.id} tone="neutral">{u.id}</Badge>
          ))}
          {a.affectedUsers.length > 2 && <Badge tone="neutral">+{a.affectedUsers.length - 2}</Badge>}
        </span>
      ),
    },
    {
      key: "signals",
      header: "Signals",
      hideBelow: "lg",
      cell: (a) => (
        <span className="text-xs text-text-muted">
          {a.signals[0]}
          {a.signals.length > 1 && ` (+${a.signals.length - 1} more)`}
        </span>
      ),
    },
    { key: "status", header: "Status", hideBelow: "sm", sortValue: (a) => a.status, cell: (a) => STATUS_BADGE[a.status] },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (a) => (
        <Button variant="outline" size="xs" icon={<Radar className="size-3.5" />} onClick={() => setSelected(a)}>
          Investigate
        </Button>
      ),
    },
  ];

  const open = alerts.filter((a) => a.status === "open").length;
  const critical = alerts.filter((a) => a.severity === "critical").length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat label="Open alerts" value={formatNumber(open)} sub="awaiting first review" tone={open > 0 ? "critical" : "good"} />
        <MiniStat
          label="Critical severity"
          value={formatNumber(critical)}
          sub="risk score above 88"
          tone={critical > 0 ? "critical" : "good"}
        />
        <MiniStat
          label="Under investigation"
          value={formatNumber(alerts.filter((a) => a.status === "investigating").length)}
          sub="assigned to an officer"
          tone="warning"
        />
        <MiniStat
          label="Accounts implicated"
          value={formatNumber(new Set(alerts.flatMap((a) => a.affectedUsers.map((u) => u.id))).size)}
          sub="across all open and closed alerts"
        />
      </div>

      <Callout tone="warning" title="An alert is a question, not a verdict" icon={<ShieldCheck />}>
        <p className="mt-1">
          The engine flags patterns; people decide. Every action taken from this queue preserves the
          member&apos;s balance — a freeze holds withdrawals pending review, it does not seize funds —
          and every dismissal needs written reasoning. Members under review are told that their
          account is being reviewed and how long it should take, except where tipping-off rules
          prevent it.
        </p>
      </Callout>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={status}
          onValueChange={setStatus}
          options={[
            { value: "open", label: `Open (${open})` },
            { value: "investigating", label: "Investigating" },
            { value: "actioned", label: "Actioned" },
            { value: "dismissed", label: "Dismissed" },
            { value: "all", label: "All" },
          ]}
        />
      </div>

      <FilterBar
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Alert ID, pattern, user ID or summary…"
        shown={filtered.length}
        total={alerts.length}
        unit="alerts"
        onReset={() => { setQuery(""); setSeverity("all"); setKind("all"); }}
        filters={[
          {
            label: "Severity",
            value: severity,
            onChange: setSeverity,
            options: [
              { value: "all", label: "Any severity" },
              { value: "critical", label: "Critical" },
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
              { value: "low", label: "Low" },
            ],
          },
          {
            label: "Pattern",
            value: kind,
            onChange: setKind,
            className: "w-full sm:w-56",
            options: [
              { value: "all", label: "Any pattern" },
              ...(Object.keys(KIND_META) as FraudAlert["kind"][]).map((k) => ({
                value: k,
                label: KIND_META[k].label,
              })),
            ],
          },
        ]}
      />

      <LedgerTable
        title="Alert queue"
        description="Highest severity first by default. Investigate opens the full signal list and the action set."
        icon={<ShieldAlert />}
        columns={columns}
        rows={filtered}
        keyOf={(a) => a.id}
        caption="Fraud and transaction-monitoring alerts with severity, risk score, affected accounts and firing signals"
        loading={isLoading}
        pageSize={10}
        dense={false}
        onRowClick={setSelected}
        empty={{ title: "No alerts match these filters", description: "Try a different status tab or clear the pattern filter." }}
        footnote="Risk score is a weighted composite of the firing signals, not a single model output — which is why the signal list is always shown alongside it."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <BarSeries
          data={byKind}
          xKey="pattern"
          horizontal
          height={280}
          series={[{ key: "alerts", label: "Alerts raised" }]}
          valueFormatter={(v) => formatNumber(v)}
          title="Alerts by detection pattern"
          description="Which rules are actually firing. A rule that never fires is either perfectly tuned or broken."
          footnote="Volume is not severity: the multi-account rule fires often and mostly resolves benignly, while a referral ring is rare and almost never benign."
        />

        <Panel
          icon={<Network />}
          title="Patterns the engine looks for"
          description="Named detection families, each with its own signals and its own false-positive profile."
        >
          <ul className="space-y-3">
            {(Object.keys(KIND_META) as FraudAlert["kind"][]).map((k) => {
              const m = KIND_META[k];
              return (
                <li key={k} className="flex gap-3 rounded-xl border border-border-subtle bg-surface-inset p-3.5">
                  <m.Icon className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary">{m.label}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{m.pattern}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <RuleConfig />

      <Panel icon={<Ban />} title="Actions available from an alert" description="Three outcomes, all reversible except the passage of time.">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { Icon: Snowflake, title: "Freeze pending review", body: "Holds withdrawals, conversions and commission release. Balances and stakes are preserved. Must be resolved inside the review SLA." },
            { Icon: CheckCircle2, title: "Dismiss with notes", body: "Closes the alert with written reasoning. Sampled monthly to measure each rule's false-positive rate." },
            { Icon: Flag, title: "Escalate", body: "Hands the case to the MLRO for SAR consideration. Communication with the member about the investigation stops." },
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
      </Panel>

      <InvestigationDrawer alert={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
