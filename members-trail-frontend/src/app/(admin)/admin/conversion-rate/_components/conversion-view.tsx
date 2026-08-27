"use client";

/* AD-05 · Conversion rate configuration — the single most important economic
 * lever on the platform, so it is the most tightly governed screen. */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRightLeft, CalendarClock, CheckCircle2, Download, Eye, Gauge,
  Globe, Lock, ShieldCheck, ThumbsUp, TrendingDown, XCircle,
} from "lucide-react";
import Link from "next/link";
import {
  Badge, Button, CapMeter, Callout, ConfirmDialog, DetailRow, InfoHint, Input, Tooltip,
  useToast, type Column,
} from "@/components/ui";
import { LineSeries } from "@/components/charts";
import { useConversionRates } from "@/lib/hooks/use-data";
import { useAdminConversionCaps } from "@/lib/hooks/use-data";
import { csvDownload, formatDate, formatNumber, formatPercent, timeAgo } from "@/lib/utils";
import type { ConversionRateConfig } from "@/types";
import { FourEyesModal, ROLE_LABEL } from "../../_components/four-eyes-modal";
import { LedgerTable } from "../../_components/ledger-table";
import { AuditNote, MiniStat, Panel } from "../../_components/panel";
import { useSession } from "../../_components/session";

/** A single change larger than this is treated as material and needs notice. */
const MATERIAL_CHANGE_PCT = 5;

const STATUS_BADGE: Record<ConversionRateConfig["status"], React.ReactNode> = {
  active: <Badge tone="good" dot>Active</Badge>,
  pending_approval: <Badge tone="warning" dot>Awaiting second approval</Badge>,
  scheduled: <Badge tone="info" dot>Scheduled</Badge>,
  superseded: <Badge tone="neutral">Superseded</Badge>,
};

export function ConversionActions() {
  const { data: rates } = useConversionRates();
  return (
    <Button
      variant="outline"
      size="sm"
      icon={<Download className="size-4" />}
      onClick={() =>
        csvDownload(
          "members-trail-conversion-rate-history.csv",
          rates.map((r) => ({
            points_per_mtt: r.pointsPerMtt,
            effective_from: r.effectiveFrom,
            status: r.status,
            proposed_by: r.proposedBy ?? "",
            approved_by: r.approvedBy ?? "",
          })),
        )
      }
    >
      Export rate history
    </Button>
  );
}

export function ConversionView() {
  const { data: rates, isLoading } = useConversionRates();
  const { me } = useSession();
  const toast = useToast();

  const [propose, setPropose] = useState(false);
  const [newRate, setNewRate] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [approving, setApproving] = useState<ConversionRateConfig | null>(null);
  const [rejecting, setRejecting] = useState<ConversionRateConfig | null>(null);
  /* The ceilings in force, read from the server. Seeded into local state once
   * they arrive so the form is editable, and re-seeded if they change underneath
   * — an operator editing a stale ceiling would submit a value derived from a
   * number that is no longer true. */
  const { data: live } = useAdminConversionCaps();
  const [caps, setCaps] = useState({ perUserDaily: 0, perUserMonthly: 0, globalDaily: 0 });
  const [capsTouched, setCapsTouched] = useState(false);

  useEffect(() => {
    if (capsTouched) return;
    setCaps({
      perUserDaily: live.perUserDailyPoints,
      perUserMonthly: live.perUserMonthlyPoints,
      globalDaily: live.globalDailyPoints ?? 0,
    });
  }, [live, capsTouched]);

  const globalUsed = Number(live.globalDailyUsedPoints);

  const active = rates.find((r) => r.status === "active");
  const pending = rates.filter((r) => r.status === "pending_approval" || r.status === "scheduled");
  const history = useMemo(
    () => [...rates].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1)),
    [rates],
  );

  /** 4-eyes: the proposer can never be the approver. */
  const iProposed = (r: ConversionRateConfig) =>
    !!me && !!r.proposedBy && r.proposedBy.toLowerCase().includes(me.name.toLowerCase());

  const parsedRate = Number(newRate);
  const rateInvalid = newRate !== "" && (!Number.isFinite(parsedRate) || parsedRate <= 0);
  const changePct =
    active && Number.isFinite(parsedRate) && parsedRate > 0
      ? ((parsedRate - active.pointsPerMtt) / active.pointsPerMtt) * 100
      : 0;
  const material = Math.abs(changePct) >= MATERIAL_CHANGE_PCT;
  const effectiveDate = effectiveAt ? new Date(effectiveAt) : null;
  /* Gated behind mount: reading the clock during the server pass would
   * produce a different result from the client pass and break hydration. */
  // Clock is read only on the client, after the first paint.
  const [mountedNow, setMountedNow] = useState<number | null>(null);
  useEffect(() => {
    setMountedNow(Date.now());
    const t = window.setInterval(() => setMountedNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const dateInPast = mountedNow != null && !!effectiveDate && effectiveDate.getTime() <= mountedNow;

  const chartData = useMemo(
    () =>
      [...rates]
        .filter((r) => r.status !== "pending_approval")
        .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))
        .map((r) => ({ date: formatDate(r.effectiveFrom), pointsPerMtt: r.pointsPerMtt })),
    [rates],
  );

  const columns: Column<ConversionRateConfig>[] = [
    {
      key: "rate",
      header: "Rate",
      sortValue: (r) => r.pointsPerMtt,
      cell: (r) => (
        <span className="tnum text-sm font-medium text-text-primary">
          {formatNumber(r.pointsPerMtt)} Points = 1 MTT
        </span>
      ),
    },
    {
      key: "effective",
      header: "Effective from",
      sortValue: (r) => r.effectiveFrom,
      cell: (r) => (
        <span className="text-xs text-text-secondary">
          <span className="tnum block">{formatDate(r.effectiveFrom, true)}</span>
          <span className="block text-[11px] text-text-muted">{timeAgo(r.effectiveFrom)}</span>
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (r) => STATUS_BADGE[r.status] },
    {
      key: "proposed",
      header: "Proposed by",
      hideBelow: "md",
      cell: (r) => <span className="text-xs text-text-secondary">{r.proposedBy ?? "—"}</span>,
    },
    {
      key: "approved",
      header: "Second approver",
      hideBelow: "lg",
      cell: (r) => (
        <span className="text-xs text-text-secondary">
          {r.approvedBy ?? (r.status === "pending_approval" ? "—" : "n/a")}
        </span>
      ),
    },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (r) =>
        r.status === "pending_approval" ? (
          iProposed(r) ? (
            <Tooltip content="You proposed this rate. Under the four-eyes rule the proposer can never approve their own change.">
              <span className="inline-flex">
                <Button variant="outline" size="xs" disabled icon={<Lock className="size-3.5" />}>
                  You proposed this
                </Button>
              </span>
            </Tooltip>
          ) : (
            <span className="flex justify-end gap-1.5">
              <Button variant="ghost" size="xs" icon={<XCircle className="size-3.5" />} onClick={() => setRejecting(r)}>
                Reject
              </Button>
              <Button size="xs" icon={<ThumbsUp className="size-3.5" />} onClick={() => setApproving(r)}>
                Approve
              </Button>
            </span>
          )
        ) : (
          <span className="text-xs text-text-muted">—</span>
        ),
    },
  ];

  /* No configured global ceiling means no brake, not a breached one. A division
   * by zero here used to render Infinity% on the gauge. */
  const globalUsagePct = caps.globalDaily > 0 ? (globalUsed / caps.globalDaily) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* ------------------------------ current rate ---------------------- */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <Panel
          icon={<ArrowRightLeft />}
          title="Live conversion rate"
          description="What one MTT costs in Points right now."
          footnote="Conversion is optional. A member can hold Points indefinitely; nothing expires because the rate moved."
        >
          <p className="font-display text-3xl font-semibold tracking-tight text-text-primary">
            <span className="tnum">{formatNumber(active?.pointsPerMtt ?? 0)}</span>
            <span className="ml-2 text-base font-medium text-text-muted">Points = 1 MTT</span>
          </p>
          <div className="mt-4 space-y-0 rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
            <DetailRow
              label="Effective since"
              value={<span className="tnum">{active ? formatDate(active.effectiveFrom) : "—"}</span>}
            />
            <DetailRow label="Proposed by" value={active?.proposedBy ?? "—"} />
            <DetailRow label="Approved by" value={active?.approvedBy ?? "—"} />
            <DetailRow
              label="Publicly visible"
              value={
                <Link href="/tokenomics" className="inline-flex items-center gap-1 text-[var(--accent-hover)] hover:underline">
                  Tokenomics page <Eye className="size-3.5" />
                </Link>
              }
            />
          </div>
          <Button
            className="mt-4"
            size="sm"
            fullWidth
            icon={<CalendarClock className="size-4" />}
            onClick={() => setPropose(true)}
          >
            Propose new rate
          </Button>
        </Panel>

        <div className="space-y-4">
          {pending.length > 0 ? (
            <Panel
              tone="warning"
              icon={<Gauge />}
              title="Scheduled and pending changes"
              description="A proposed rate is inert until a second admin approves it."
            >
              <ul className="space-y-3">
                {pending.map((p) => {
                  const delta = active ? ((p.pointsPerMtt - active.pointsPerMtt) / active.pointsPerMtt) * 100 : 0;
                  return (
                    <li
                      key={p.effectiveFrom}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-default bg-surface-inset px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="tnum text-sm font-semibold text-text-primary">
                          {formatNumber(p.pointsPerMtt)} Points = 1 MTT
                          <span className={delta > 0 ? "ml-2 text-xs font-medium text-warning-400" : "ml-2 text-xs font-medium text-good-400"}>
                            {delta > 0 ? "+" : ""}{formatPercent(delta, 1)} vs live
                          </span>
                        </p>
                        <p className="mt-0.5 text-xs text-text-muted">
                          Effective {formatDate(p.effectiveFrom, true)} · proposed by {p.proposedBy}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {STATUS_BADGE[p.status]}
                        {p.status === "pending_approval" &&
                          (iProposed(p) ? (
                            <Button variant="outline" size="xs" disabled icon={<Lock className="size-3.5" />}>
                              You proposed this
                            </Button>
                          ) : (
                            <Button size="xs" icon={<ThumbsUp className="size-3.5" />} onClick={() => setApproving(p)}>
                              Approve
                            </Button>
                          ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {pending.some(iProposed) && (
                <Callout tone="warning" title="Four-eyes: you cannot approve your own proposal" icon={<ShieldCheck />} className="mt-4">
                  <p className="mt-1">
                    You ({me?.name} — {me ? ROLE_LABEL[me.role] : "admin"}) proposed a change in this
                    list, so the approve control is disabled for you. Another admin holding approve
                    rights on this module must confirm it. This is enforced server-side, not just in
                    the UI.
                  </p>
                </Callout>
              )}
            </Panel>
          ) : (
            <Panel icon={<CheckCircle2 />} title="No pending rate changes" description="The live rate is the only rate in force.">
              <p className="text-sm text-text-secondary">
                Propose a change when Treasury inflow, Points issuance volume or MTT market depth move
                enough to make the current rate unsustainable in either direction.
              </p>
            </Panel>
          )}

          {chartData.length > 1 && (
            <LineSeries
              data={chartData}
              xKey="date"
              series={[{ key: "pointsPerMtt", label: "Points per 1 MTT" }]}
              height={200}
              valueFormatter={(v) => `${formatNumber(v)} pts`}
              title="Rate history"
              description="Every rate that has ever been in force, in order."
              footnote="A rising line means Points buy less MTT. The full series is retained permanently and published on the Tokenomics page."
            />
          )}
        </div>
      </div>

      {/* -------------------------------- caps ---------------------------- */}
      <Panel
        icon={<Globe />}
        title="Conversion caps"
        description="Caps bound how much Points supply can hit the MTT float in one day — the throttle that keeps a rate change orderly."
        footnote="Caps apply to conversion only. A member's Points balance and their ability to keep earning are never capped by these values."
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,22rem)]">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Per-user daily cap"
              hint="Points a single member may convert in one UTC day."
              type="number"
              min={0}
              suffix="pts"
              value={String(caps.perUserDaily)}
              onChange={(e) => setCaps((c) => ({ ...c, perUserDaily: Number(e.target.value) || 0 }))}
              className="tnum"
            />
            <Input
              label="Per-user monthly cap"
              hint="Rolling 30-day ceiling per member."
              type="number"
              min={0}
              suffix="pts"
              value={String(caps.perUserMonthly)}
              onChange={(e) => setCaps((c) => ({ ...c, perUserMonthly: Number(e.target.value) || 0 }))}
              className="tnum"
            />
            <Input
              label="Global daily cap"
              hint="Platform-wide ceiling across all members."
              type="number"
              min={0}
              suffix="pts"
              value={String(caps.globalDaily)}
              onChange={(e) => setCaps((c) => ({ ...c, globalDaily: Number(e.target.value) || 0 }))}
              className="tnum"
            />
            <div className="rounded-xl border border-border-subtle bg-surface-inset p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Per-user share of global
                <InfoHint>
                  No single member should be able to consume a meaningful share of the global daily
                  cap. If this ratio climbs, lower the per-user cap rather than raising the global one.
                </InfoHint>
              </p>
              <p className="tnum mt-1 text-lg font-semibold text-text-primary">
                {formatPercent((caps.perUserDaily / caps.globalDaily) * 100, 4)}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">of the global daily ceiling</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-border-subtle bg-surface-inset p-4">
              <CapMeter
                used={globalUsed}
                cap={caps.globalDaily}
                label="Global daily conversion — today"
                unit=""
              />
              <p className="mt-3 text-xs leading-relaxed text-text-muted">
                {formatPercent(globalUsagePct, 1)} of today&apos;s platform-wide ceiling is used.
                Beyond 90% new conversion requests are queued to the next UTC day rather than
                rejected, and the member is told the queue position.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <MiniStat
                label="Converted today"
                value={formatNumber(globalUsed)}
                sub="Points platform-wide"
              />
              <MiniStat
                label="Remaining headroom"
                value={formatNumber(Math.max(0, caps.globalDaily - globalUsed))}
                sub="before queueing starts"
                tone={globalUsagePct >= 90 ? "critical" : globalUsagePct >= 75 ? "warning" : "good"}
              />
            </div>
          </div>
        </div>
      </Panel>

      {/* ------------------------------- history -------------------------- */}
      <LedgerTable
        title="Rate change history"
        description="Permanently retained. This exact table, minus the internal approval controls, is published on the public Tokenomics page."
        icon={<Lock />}
        columns={columns}
        rows={history}
        keyOf={(r) => r.effectiveFrom}
        caption="Complete history of Points-to-MTT conversion rates with proposer and second approver"
        loading={isLoading}
        pageSize={0}
        dense={false}
        footnote="Nothing in this table can be edited or removed. A mistaken rate is corrected by proposing a new one, which is why the history sometimes shows two changes close together."
      />

      <Callout tone="info" title="Why the rate is published, not just logged" icon={<Eye />}>
        <p className="mt-1">
          The conversion rate determines what a member&apos;s earned Points are actually worth, so
          keeping its history private would make every earlier statement unverifiable. The full
          series is retained permanently and shown on the{" "}
          <Link href="/tokenomics">public Tokenomics page</Link> so any member can check that the rate
          they were quoted is the rate that was in force. Rates are never applied to conversions that
          already settled.
        </p>
      </Callout>

      {/* ----------------------------- propose flow ----------------------- */}
      <FourEyesModal
        open={propose}
        onClose={() => setPropose(false)}
        onSubmit={(s) => {
          setPropose(false);
          setNewRate("");
          setEffectiveAt("");
          toast.success(
            "Rate proposal submitted",
            `Routed to ${s.secondApprover}. The rate stays unchanged until they approve it.`,
          );
        }}
        title="Propose a new conversion rate"
        description="Proposing does not change anything. A second admin must approve."
        submitLabel="Submit proposal"
        icon={<ArrowRightLeft className="size-5" />}
        blocked={newRate === "" || rateInvalid || !effectiveAt || dateInPast}
        blockedTitle={
          newRate === "" ? "Enter the proposed rate"
          : rateInvalid ? "Rate must be a positive number"
          : !effectiveAt ? "A future effective date is required"
          : "Effective date must be in the future"
        }
        blockedMessage={
          newRate === "" || rateInvalid
            ? "State the rate explicitly in Points per 1 MTT. There is no percentage shortcut — the absolute figure is what gets published."
            : "A rate change cannot be applied immediately or backdated. Conversions that already settled keep the rate that was live when they settled."
        }
        reasonLabel="Economic justification (mandatory)"
        reasonHint="Cite the inflow, issuance or float figures behind the change. This text is retained with the rate forever."
        acknowledgement={
          <span>
            I confirm this rate is derived from observed Treasury inflow and Points issuance volume,
            that it applies only from the scheduled time forward, and that the full history including
            this change will be published publicly.
          </span>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Proposed rate"
              required
              type="number"
              min={1}
              suffix="pts / MTT"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              placeholder={String(active?.pointsPerMtt ?? 1000)}
              className="tnum"
              hint={`Current: ${formatNumber(active?.pointsPerMtt ?? 0)} Points = 1 MTT`}
            />
            <label className="block space-y-1.5">
              <span className="block text-sm font-medium text-text-secondary">
                Effective from <span className="text-[var(--accent)]">*</span>
              </span>
              <input
                type="datetime-local"
                value={effectiveAt}
                onChange={(e) => setEffectiveAt(e.target.value)}
                className="tnum h-11 w-full rounded-xl border border-border-default bg-surface-3 px-3.5 text-sm text-text-primary focus:border-[var(--accent)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-soft)]"
              />
              <span className="block text-xs text-text-muted">Evaluated in UTC.</span>
            </label>
          </div>

          {newRate !== "" && !rateInvalid && active && (
            <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
              <DetailRow
                label="Change vs live rate"
                value={
                  <span className={changePct > 0 ? "tnum text-warning-400" : "tnum text-good-400"}>
                    {changePct > 0 ? "+" : ""}{formatPercent(changePct, 2)}
                  </span>
                }
              />
              <DetailRow
                label="Effect on members"
                value={
                  changePct > 0
                    ? "Points buy less MTT"
                    : changePct < 0
                    ? "Points buy more MTT"
                    : "No change"
                }
              />
              <DetailRow
                label="Materiality"
                value={
                  material ? (
                    <Badge tone="warning" icon={<AlertTriangle className="size-3.5" />}>
                      Material — advance notice required
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Routine adjustment</Badge>
                  )
                }
              />
            </div>
          )}

          {material && changePct > 0 && (
            <Callout tone="warning" title="Members must be told before this lands" icon={<TrendingDown />}>
              <p className="mt-1">
                A rate increase of {formatPercent(changePct, 1)} reduces what unconverted Points are
                worth. Anything at or above {MATERIAL_CHANGE_PCT}% triggers in-app and email notice at
                least seven days before the effective date, so members can convert at the old rate if
                they choose.
              </p>
            </Callout>
          )}
        </div>
      </FourEyesModal>

      {/* ---------------------------- approve / reject -------------------- */}
      <ConfirmDialog
        open={!!approving}
        onClose={() => setApproving(null)}
        onConfirm={() => {
          const r = approving;
          setApproving(null);
          toast.success(
            "Rate approved",
            `${formatNumber(r?.pointsPerMtt ?? 0)} Points = 1 MTT goes live ${r ? formatDate(r.effectiveFrom) : ""}.`,
          );
        }}
        title="Approve this rate change?"
        confirmLabel="Approve as second admin"
        requireAcknowledge={
          <Callout tone="info" title="You are the second pair of eyes" icon={<ShieldCheck />}>
            <p className="mt-1">
              Your approval is what makes this rate real. Both your identity and the
              proposer&apos;s are stored on the rate record permanently and published alongside it.
            </p>
          </Callout>
        }
      >
        <p>
          <span className="tnum font-semibold text-text-primary">
            {formatNumber(approving?.pointsPerMtt ?? 0)} Points = 1 MTT
          </span>{" "}
          from {approving ? formatDate(approving.effectiveFrom, true) : ""}, proposed by{" "}
          {approving?.proposedBy}. You have reviewed the justification and the Treasury inflow figures
          behind it.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        onConfirm={() => {
          setRejecting(null);
          toast.toast({
            tone: "info",
            title: "Proposal rejected",
            description: "The proposer is notified with your reason. The live rate is unchanged.",
          });
        }}
        title="Reject this proposal?"
        tone="danger"
        confirmLabel="Reject proposal"
      >
        <p>
          The proposed rate is discarded and the live rate continues. The rejection, your identity and
          the proposal itself all stay in the history — rejected proposals are retained too.
        </p>
      </ConfirmDialog>

      <AuditNote>
        Rate proposals, approvals and rejections are all written to append-only audit storage with
        the proposer, approver, timestamps and the full before/after values. The history is retained
        permanently — not for a retention window, but forever — because it is the only way a member
        can verify what their Points were worth at any point in the past.
      </AuditNote>
    </div>
  );
}
