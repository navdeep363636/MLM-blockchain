"use client";

/* AD-14 · Audit log — append-only, searchable, exportable. Read-only by
 * construction: there is no edit control on this page because there is no edit
 * operation behind it. */

import { useMemo, useState } from "react";
import {
  Archive, CheckCircle2, Clock, Download, FileSpreadsheet, Globe, History, Lock,
  ScrollText, ShieldCheck, UserCheck, Users,
} from "lucide-react";
import {
  Badge, Button, Callout, DetailRow, Input, SegmentedControl, useToast, type Column,
} from "@/components/ui";
import { BarSeries } from "@/components/charts";
import { useAuditLog } from "@/lib/hooks/use-data";
import { csvDownload, formatDate, formatNumber, timeAgo } from "@/lib/utils";
import type { AuditLogEntry } from "@/types";
import { DetailDrawer, DrawerSection } from "../../_components/detail-drawer";
import { FilterBar } from "../../_components/filter-bar";
import { LedgerTable } from "../../_components/ledger-table";
import { AuditNote, MiniStat, Panel } from "../../_components/panel";
import { ROLE_LABEL } from "../../_components/four-eyes-modal";

const RETENTION_YEARS = 7;

export function AuditActions() {
  const { data: log } = useAuditLog();
  const toast = useToast();
  return (
    <Button
      variant="outline"
      size="sm"
      icon={<FileSpreadsheet className="size-4" />}
      onClick={() => {
        csvDownload(
          "members-trail-audit-log.csv",
          log.map((e) => ({
            entry_id: e.id,
            timestamp: e.timestamp,
            actor: e.actor,
            actor_role: e.actorRole,
            action: e.action,
            target: e.target,
            before: e.before ?? "",
            after: e.after ?? "",
            ip: e.ip,
            requires_second_approval: e.requiresSecondApproval,
            approved_by: e.approvedBy ?? "",
          })),
        );
        toast.success("Audit extract generated", "The export itself is logged, including your identity and the row range.");
      }}
    >
      Export for external audit
    </Button>
  );
}

export function AuditView() {
  const { data: log, isLoading } = useAuditLog();

  const [query, setQuery] = useState("");
  const [actor, setActor] = useState("all");
  const [action, setAction] = useState("all");
  const [approval, setApproval] = useState<"all" | "required" | "not_required">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  const actors = useMemo(() => [...new Set(log.map((e) => e.actor))].sort(), [log]);
  const actions = useMemo(() => [...new Set(log.map((e) => e.action))].sort(), [log]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const fromTs = from ? new Date(from).getTime() : null;
    const toTs = to ? new Date(to).getTime() + 86_399_000 : null;
    return log.filter((e) => {
      if (actor !== "all" && e.actor !== actor) return false;
      if (action !== "all" && e.action !== action) return false;
      if (approval === "required" && !e.requiresSecondApproval) return false;
      if (approval === "not_required" && e.requiresSecondApproval) return false;
      const ts = new Date(e.timestamp).getTime();
      if (fromTs && ts < fromTs) return false;
      if (toTs && ts > toTs) return false;
      if (
        q &&
        ![e.id, e.actor, e.action, e.target, e.before ?? "", e.after ?? "", e.ip, e.approvedBy ?? ""]
          .some((f) => f.toLowerCase().includes(q))
      )
        return false;
      return true;
    });
  }, [log, query, actor, action, approval, from, to]);

  const byAction = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of log) m.set(e.action, (m.get(e.action) ?? 0) + 1);
    return [...m.entries()]
      .map(([name, entries]) => ({ action: name, entries }))
      .sort((a, b) => b.entries - a.entries)
      .slice(0, 8);
  }, [log]);

  const columns: Column<AuditLogEntry>[] = [
    {
      key: "timestamp",
      header: "Timestamp",
      sortValue: (e) => e.timestamp,
      cell: (e) => (
        <span className="text-xs text-text-secondary">
          <span className="tnum block">{formatDate(e.timestamp, true)}</span>
          <span className="block text-[11px] text-text-muted">{timeAgo(e.timestamp)}</span>
        </span>
      ),
    },
    {
      key: "actor",
      header: "Actor",
      sortValue: (e) => e.actor,
      cell: (e) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">{e.actor}</p>
          <p className="truncate text-xs text-text-muted">{ROLE_LABEL[e.actorRole]}</p>
        </div>
      ),
    },
    {
      key: "action",
      header: "Action",
      sortValue: (e) => e.action,
      cell: (e) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-text-primary">{e.action}</span>
          {e.requiresSecondApproval && (
            <Badge tone="warning" icon={<UserCheck className="size-3.5" />}>4-eyes</Badge>
          )}
        </span>
      ),
    },
    {
      key: "target",
      header: "Target",
      hideBelow: "md",
      sortValue: (e) => e.target,
      cell: (e) => <span className="font-mono-num text-xs text-text-secondary">{e.target}</span>,
    },
    {
      key: "change",
      header: "Before → after",
      hideBelow: "lg",
      cell: (e) => (
        <span className="text-xs">
          <span className="text-text-muted">{e.before ?? "—"}</span>
          <span className="mx-1 text-text-muted">→</span>
          <span className="font-medium text-text-primary">{e.after ?? "—"}</span>
        </span>
      ),
    },
    {
      key: "approver",
      header: "Second approver",
      hideBelow: "xl",
      sortValue: (e) => e.approvedBy ?? "",
      cell: (e) =>
        e.approvedBy ? (
          <span className="text-xs text-text-secondary">{e.approvedBy}</span>
        ) : e.requiresSecondApproval ? (
          <Badge tone="critical" icon={<Clock className="size-3.5" />}>Awaiting</Badge>
        ) : (
          <span className="text-xs text-text-muted">Not required</span>
        ),
    },
    {
      key: "ip",
      header: "IP",
      hideBelow: "xl",
      align: "right",
      sortValue: (e) => e.ip,
      cell: (e) => <span className="font-mono-num text-xs text-text-muted">{e.ip}</span>,
    },
  ];

  const fourEyes = log.filter((e) => e.requiresSecondApproval);
  const awaiting = fourEyes.filter((e) => !e.approvedBy);

  return (
    <div className="space-y-6">
      <Callout tone="critical" title="This log is write-once and cannot be edited by anyone" icon={<Lock />}>
        <p className="mt-1">
          Entries are appended to immutable storage the moment an action is taken. There is no update
          or delete path — not for Support, not for Compliance, not for Super Admin, not for the
          engineers who built it. Records are retained for approximately {RETENTION_YEARS} years to
          meet financial record-keeping requirements, and a correction is made by adding a new entry
          that references the old one, never by changing history. If the numbers in this log ever
          disagree with the numbers on another admin page, this log is the record of truth.
        </p>
      </Callout>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat label="Entries" value={formatNumber(log.length)} sub="in the retained window" />
        <MiniStat
          label="Four-eyes actions"
          value={formatNumber(fourEyes.length)}
          sub="required a second approver"
          tone="warning"
        />
        <MiniStat
          label="Awaiting approval"
          value={formatNumber(awaiting.length)}
          sub="proposed, not yet confirmed"
          tone={awaiting.length > 0 ? "critical" : "good"}
        />
        <MiniStat
          label="Distinct operators"
          value={formatNumber(actors.length)}
          sub="named humans, no shared accounts"
        />
      </div>

      <FilterBar
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Entry ID, actor, target, value or IP…"
        shown={filtered.length}
        total={log.length}
        unit="entries"
        onReset={() => { setQuery(""); setActor("all"); setAction("all"); setApproval("all"); setFrom(""); setTo(""); }}
        filters={[
          {
            label: "Actor",
            value: actor,
            onChange: setActor,
            options: [{ value: "all", label: "Any actor" }, ...actors.map((a) => ({ value: a, label: a }))],
          },
          {
            label: "Action type",
            value: action,
            onChange: setAction,
            className: "w-full sm:w-56",
            options: [{ value: "all", label: "Any action" }, ...actions.map((a) => ({ value: a, label: a }))],
          },
        ]}
      >
        <div className="w-full sm:w-36">
          <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="tnum h-10" />
        </div>
        <div className="w-full sm:w-36">
          <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="tnum h-10" />
        </div>
      </FilterBar>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={approval}
          onValueChange={setApproval}
          options={[
            { value: "all", label: "All actions" },
            { value: "required", label: `Requires second approval (${fourEyes.length})` },
            { value: "not_required", label: "Single-operator actions" },
          ]}
        />
        <p className="text-xs text-text-muted">
          Read-only view. Sorting and filtering never change what is stored.
        </p>
      </div>

      <LedgerTable
        title="Administrative audit log"
        description="Newest first. Click any row for the full record including the second approver and the exact before/after values."
        icon={<ScrollText />}
        columns={columns}
        rows={filtered}
        keyOf={(e) => e.id}
        caption="Immutable log of sensitive administrative actions with actor, role, target, before and after values, IP address and second approver"
        loading={isLoading}
        pageSize={15}
        dense={false}
        onRowClick={setSelected}
        empty={{
          title: "No entries match these filters",
          description: "Widen the date range or clear the actor and action filters.",
        }}
        footnote={`Retained for approximately ${RETENTION_YEARS} years. Exports are themselves logged, including the requester's identity and the row range extracted — an audit export is an auditable event.`}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <BarSeries
          data={byAction}
          xKey="action"
          horizontal
          height={300}
          series={[{ key: "entries", label: "Log entries" }]}
          valueFormatter={(v) => formatNumber(v)}
          title="Most frequent logged actions"
          description="What the back office actually spends its privileged access on."
          footnote="A sudden change in this distribution is itself a signal — a spike in manual balance adjustments or account freezes gets reviewed even when each individual entry is properly documented."
        />

        <Panel
          icon={<ShieldCheck />}
          title="What makes this evidence rather than a changelog"
          description="Four properties, each of which a court or regulator will ask about."
        >
          <div className="space-y-3">
            {[
              { Icon: Lock, title: "Append-only storage", body: "Writes go to storage with no update or delete API. Entries are chained so a removal would break the hash sequence and be detectable." },
              { Icon: Users, title: "Named humans, never shared logins", body: "Shared admin accounts are prohibited, so every entry attributes to one person who can be asked about it." },
              { Icon: UserCheck, title: "The approver is part of the record", body: "Four-eyes actions store both identities. An action showing a requester but no approver never took effect." },
              { Icon: Globe, title: "Full context, not just the verb", body: "Timestamp, IP, target, and the before and after values — enough to reconstruct the state at any past moment." },
            ].map((c) => (
              <div key={c.title} className="flex gap-3 rounded-xl border border-border-subtle bg-surface-inset p-3.5">
                <c.Icon className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary">{c.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{c.body}</p>
                </div>
              </div>
            ))}
          </div>
          <AuditNote className="mt-4">
            Retention is a regulatory obligation and outlives both the account and the staff member.
            Data-deletion requests are honoured for marketing data but cannot remove financial or AML
            records inside the statutory period.
          </AuditNote>
        </Panel>
      </div>

      {/* ------------------------------- detail --------------------------- */}
      <DetailDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        width="max-w-2xl"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {selected?.action}
            <span className="font-mono-num text-xs text-text-muted">{selected?.id}</span>
          </span>
        }
        subtitle={selected ? `${selected.actor} · ${ROLE_LABEL[selected.actorRole]} · ${formatDate(selected.timestamp, true)}` : undefined}
        badges={
          selected && (
            <>
              {selected.requiresSecondApproval ? (
                <Badge tone="warning" icon={<UserCheck className="size-3.5" />}>Four-eyes action</Badge>
              ) : (
                <Badge tone="neutral">Single-operator action</Badge>
              )}
              {selected.approvedBy ? (
                <Badge tone="good" icon={<CheckCircle2 className="size-3.5" />}>Approved by {selected.approvedBy}</Badge>
              ) : selected.requiresSecondApproval ? (
                <Badge tone="critical" icon={<Clock className="size-3.5" />}>Awaiting approval</Badge>
              ) : null}
              <Badge tone="neutral" icon={<Archive className="size-3.5" />}>Immutable</Badge>
            </>
          )
        }
        footer={
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
            Close
          </Button>
        }
      >
        {selected && (
          <>
            <DrawerSection title="Record">
              <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
                <DetailRow label="Entry ID" value={<span className="font-mono-num text-xs">{selected.id}</span>} />
                <DetailRow label="Timestamp (UTC)" value={<span className="tnum">{formatDate(selected.timestamp, true)}</span>} />
                <DetailRow label="Actor" value={selected.actor} />
                <DetailRow label="Actor role" value={ROLE_LABEL[selected.actorRole]} />
                <DetailRow label="Action" value={selected.action} />
                <DetailRow label="Target" value={<span className="font-mono-num text-xs">{selected.target}</span>} />
                <DetailRow label="Source IP" value={<span className="font-mono-num text-xs">{selected.ip}</span>} />
                <DetailRow
                  label="Second approval"
                  value={
                    selected.requiresSecondApproval
                      ? selected.approvedBy ?? "Awaiting"
                      : "Not required for this action type"
                  }
                />
              </div>
            </DrawerSection>

            <DrawerSection title="Value change" description="Exactly what the state was, and what it became.">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border-subtle bg-surface-inset p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Before</p>
                  <p className="tnum mt-1.5 text-sm text-text-secondary">{selected.before ?? "—"}</p>
                </div>
                <div className="rounded-xl border border-[var(--accent-ring)] bg-accent-soft p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">After</p>
                  <p className="tnum mt-1.5 text-sm font-medium text-text-primary">{selected.after ?? "—"}</p>
                </div>
              </div>
            </DrawerSection>

            <DrawerSection title="Integrity" description="Why this entry can be relied on.">
              <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
                <DetailRow label="Storage" value="Append-only, hash-chained" />
                <DetailRow label="Editable" value="No — by any role, including Super Admin" />
                <DetailRow label="Retention" value={`~${RETENTION_YEARS} years`} />
                <DetailRow label="Export trail" value="Every extract is itself logged" />
              </div>
              <AuditNote>
                If this action turns out to have been wrong, the correction is a new entry referencing{" "}
                {selected.id}. The original stays exactly as it is — that is what makes the log worth
                keeping.
              </AuditNote>
            </DrawerSection>
          </>
        )}
      </DetailDrawer>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" href="/admin/roles" icon={<Users className="size-4" />}>
          Roles & permissions
        </Button>
        <Button variant="ghost" size="sm" href="/admin/treasury" icon={<History className="size-4" />}>
          Treasury ledgers
        </Button>
        <Button variant="ghost" size="sm" href="/admin/reports" icon={<Download className="size-4" />}>
          Reports & analytics
        </Button>
      </div>
    </div>
  );
}
