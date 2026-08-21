"use client";

/* AD-12 · Support ticket management — agent workspace. Split view: queue on
 * the left, threaded conversation and actions on the right. */

import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowUpRight, Bot, CheckCircle2, Clock, Download, EyeOff, Flag,
  Lock, Merge, MessageSquare, Scale, Send, ShieldAlert, Sparkles, Timer, UserCog,
} from "lucide-react";
import {
  Badge, Button, Callout, ConfirmDialog, DetailRow, Modal, SegmentedControl, Select,
  Switch, Textarea, useToast,
} from "@/components/ui";
import { useStaff, useTickets } from "@/lib/hooks/use-data";
import { csvDownload, formatDate, formatDuration, formatNumber, timeAgo } from "@/lib/utils";
import type { Ticket, TicketMessage } from "@/types";
import { FilterBar } from "../../_components/filter-bar";
import { AuditNote, MiniStat, Panel } from "../../_components/panel";
import { ROLE_LABEL } from "../../_components/four-eyes-modal";
import { useNow } from "../../_components/session";

const PRIORITY_TONE: Record<Ticket["priority"], "critical" | "serious" | "warning" | "neutral"> = {
  urgent: "critical",
  high: "serious",
  normal: "warning",
  low: "neutral",
};

const STATUS_BADGE: Record<Ticket["status"], React.ReactNode> = {
  open: <Badge tone="warning" icon={<Clock className="size-3.5" />}>Open</Badge>,
  pending_user: <Badge tone="info" icon={<Clock className="size-3.5" />}>Awaiting member</Badge>,
  escalated: <Badge tone="critical" icon={<Flag className="size-3.5" />}>Escalated</Badge>,
  resolved: <Badge tone="good" icon={<CheckCircle2 className="size-3.5" />}>Resolved</Badge>,
  closed: <Badge tone="neutral" icon={<CheckCircle2 className="size-3.5" />}>Closed</Badge>,
};

const CATEGORY_LABEL: Record<Ticket["category"], string> = {
  account: "Account",
  kyc: "KYC",
  withdrawal: "Withdrawal",
  commission: "Commission",
  gameplay: "Gameplay",
  technical: "Technical",
  other: "Other",
};

const MACROS: { label: string; body: string }[] = [
  {
    label: "Withdrawal cooling-off",
    body: "Thanks for your patience. This withdrawal is going to a destination address we have not seen on your account before, so it is inside the 48-hour anti-fraud cooling-off window. Nothing is wrong with your balance — the funds are reserved for this request. Please confirm the last four characters of the destination address and we will release it as soon as the window closes.",
  },
  {
    label: "Commission calculation breakdown",
    body: "Here is the exact calculation. Commission is paid on net eligible revenue — the amount left after payment-processor fees — not on the gross amount shown on the receipt, and only on eligible event types. I have attached the source event, the rate applied at the time, and the Treasury deposit reference that funded the payment so you can trace it end to end.",
  },
  {
    label: "KYC document resubmission",
    body: "Our identity provider could not read the document clearly enough to verify it automatically. Please resubmit a photo taken in even lighting, with all four corners visible and no glare across the machine-readable strip. Nothing is wrong with your account — this is a document quality issue, and your balance and earning are unaffected while we wait.",
  },
  {
    label: "Points not credited — session validation",
    body: "Our server-side validation rejected that session as incomplete, which usually means the client disconnected before the result was signed. I can see the session in the logs, so I have raised a manual credit request with a documented reason. A second admin approves it before it lands, which normally takes under a working day.",
  },
  {
    label: "Variable yield explanation",
    body: "Staking rewards on Members Trail are variable by design: they are recalculated each epoch from what the Revenue Treasury actually took in, so we never publish a fixed or guaranteed rate. That is why the figure you see today differs from last month's. The Treasury inflows behind it are published on the Tokenomics page.",
  },
];

/* ------------------------------- SLA helper ------------------------------ */

function SlaChip({ ticket, now }: { ticket: Ticket; now: number }) {
  const settled = ticket.status === "resolved" || ticket.status === "closed";
  const secondsLeft = (new Date(ticket.slaDueAt).getTime() - now) / 1000;
  const breached = secondsLeft <= 0;

  if (settled) {
    return (
      <Badge tone="neutral" icon={<CheckCircle2 className="size-3.5" />}>
        SLA closed
      </Badge>
    );
  }
  if (breached) {
    return (
      <Badge tone="critical" icon={<AlertTriangle className="size-3.5" />}>
        SLA breached by <span className="tnum">{formatDuration(Math.abs(secondsLeft))}</span>
      </Badge>
    );
  }
  const tight = secondsLeft < 4 * 3600;
  return (
    <Badge tone={tight ? "warning" : "good"} icon={<Timer className="size-3.5" />}>
      <span className="tnum">{formatDuration(secondsLeft)}</span> to SLA
    </Badge>
  );
}

/* ------------------------------ conversation ----------------------------- */

function Thread({ messages, showInternal }: { messages: TicketMessage[]; showInternal: boolean }) {
  const visible = messages.filter((m) => showInternal || !m.internal);
  return (
    <ol className="space-y-3">
      {visible.map((m) => {
        const isAgent = m.authorRole === "agent";
        const isSystem = m.authorRole === "system";
        return (
          <li
            key={m.id}
            className={
              m.internal
                ? "rounded-xl border border-warning-500/40 bg-warning-500/[0.06] px-4 py-3"
                : isSystem
                ? "rounded-xl border border-border-subtle bg-surface-inset px-4 py-3"
                : isAgent
                ? "rounded-xl border border-border-default bg-surface-2 px-4 py-3"
                : "rounded-xl border border-border-subtle bg-surface-1 px-4 py-3"
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                {isSystem && <Bot className="size-3.5 text-text-muted" />}
                {m.author}
                <Badge tone={isAgent ? "brand" : isSystem ? "neutral" : "info"}>
                  {isAgent ? "Agent" : isSystem ? "System" : "Member"}
                </Badge>
                {m.internal && (
                  <Badge tone="warning" icon={<EyeOff className="size-3.5" />}>
                    Internal note
                  </Badge>
                )}
              </span>
              <span className="tnum text-xs text-text-muted">{timeAgo(m.createdAt)}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">{m.body}</p>
          </li>
        );
      })}
      {visible.length === 0 && (
        <li className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-6 text-center text-sm text-text-muted">
          No messages to show with the current visibility setting.
        </li>
      )}
    </ol>
  );
}

/* ------------------------------ header actions --------------------------- */

export function TicketsActions() {
  const { data: tickets } = useTickets();
  return (
    <Button
      variant="outline"
      size="sm"
      icon={<Download className="size-4" />}
      onClick={() =>
        csvDownload(
          "members-trail-tickets.csv",
          tickets.map((t) => ({
            ticket_id: t.id,
            subject: t.subject,
            category: t.category,
            status: t.status,
            priority: t.priority,
            user_id: t.userId,
            user: t.userName,
            assignee: t.assignee ?? "",
            financial_dispute: t.financialDispute,
            created_at: t.createdAt,
            updated_at: t.updatedAt,
            sla_due_at: t.slaDueAt,
            messages: t.messages.length,
          })),
        )
      }
    >
      Export queue
    </Button>
  );
}

/* ---------------------------------- view --------------------------------- */

export function TicketsView() {
  const { data: tickets, isLoading } = useTickets();
  const { data: staff } = useStaff();
  const toast = useToast();
  const now = useNow(30_000);

  const [tab, setTab] = useState<"active" | "escalated" | "resolved" | "all">("active");
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState("all");
  const [category, setCategory] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(tickets[0]?.id ?? null);
  const [showInternal, setShowInternal] = useState(true);
  const [reply, setReply] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [notes, setNotes] = useState<Record<string, TicketMessage[]>>({});
  const [assignTo, setAssignTo] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeTarget, setMergeTarget] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets.filter((t) => {
      if (tab === "active" && !["open", "pending_user"].includes(t.status)) return false;
      if (tab === "escalated" && t.status !== "escalated") return false;
      if (tab === "resolved" && !["resolved", "closed"].includes(t.status)) return false;
      if (priority !== "all" && t.priority !== priority) return false;
      if (category !== "all" && t.category !== category) return false;
      if (q && ![t.id, t.subject, t.userId, t.userName, t.assignee ?? ""].some((f) => f.toLowerCase().includes(q)))
        return false;
      return true;
    });
  }, [tickets, tab, priority, category, query]);

  const selected = tickets.find((t) => t.id === selectedId) ?? filtered[0] ?? tickets[0] ?? null;
  const thread = selected ? [...selected.messages, ...(notes[selected.id] ?? [])] : [];

  const breached = tickets.filter(
    (t) => !["resolved", "closed"].includes(t.status) && new Date(t.slaDueAt).getTime() <= now,
  ).length;
  const disputes = tickets.filter((t) => t.financialDispute).length;

  const agentOptions = staff
    .filter((s) => s.active)
    .map((s) => ({ value: s.name, label: `${s.name} — ${ROLE_LABEL[s.role]}` }));

  const sendReply = () => {
    if (!selected || reply.trim().length < 2) return;
    const msg: TicketMessage = {
      id: `M-local-${Date.now()}`,
      author: "You",
      authorRole: "agent",
      body: reply.trim(),
      createdAt: new Date(now).toISOString(),
      internal: internalNote,
    };
    setNotes((cur) => ({ ...cur, [selected.id]: [...(cur[selected.id] ?? []), msg] }));
    setReply("");
    toast.success(
      internalNote ? "Internal note added" : "Reply sent",
      internalNote
        ? "Visible to agents and compliance only — never to the member."
        : "The member has been emailed and notified in-app.",
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat
          label="Active tickets"
          value={formatNumber(tickets.filter((t) => ["open", "pending_user", "escalated"].includes(t.status)).length)}
          sub="open, awaiting member or escalated"
        />
        <MiniStat
          label="SLA breached"
          value={formatNumber(breached)}
          sub="past due and unresolved"
          tone={breached > 0 ? "critical" : "good"}
        />
        <MiniStat
          label="Financial disputes"
          value={formatNumber(disputes)}
          sub="auto-routed to compliance-trained agents"
          tone={disputes > 0 ? "warning" : "good"}
        />
        <MiniStat
          label="Agents on duty"
          value={formatNumber(staff.filter((s) => s.active && (s.role === "support" || s.role === "compliance")).length)}
          sub="support and compliance"
        />
      </div>

      <Callout tone="warning" title="Financial disputes are not ordinary tickets" icon={<Scale />}>
        <p className="mt-1">
          Anything touching a withdrawal, a commission calculation or a balance adjustment is flagged a
          financial dispute at creation and routed automatically to an agent with compliance training.
          Those agents can read the Treasury reference that funded a payment and explain a calculation
          from source, rather than guessing — and they know not to promise an outcome before the record
          is checked.
        </p>
      </Callout>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={tab}
          onValueChange={setTab}
          options={[
            { value: "active", label: "Active" },
            { value: "escalated", label: "Escalated" },
            { value: "resolved", label: "Resolved" },
            { value: "all", label: "All" },
          ]}
        />
        <p className="text-xs text-text-muted">
          SLA clocks run on open and escalated tickets. Waiting on the member pauses nothing — the
          clock is ours.
        </p>
      </div>

      <FilterBar
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Ticket ID, subject, member or assignee…"
        shown={filtered.length}
        total={tickets.length}
        unit="tickets"
        onReset={() => { setQuery(""); setPriority("all"); setCategory("all"); }}
        filters={[
          {
            label: "Priority",
            value: priority,
            onChange: setPriority,
            options: [
              { value: "all", label: "Any priority" },
              { value: "urgent", label: "Urgent" },
              { value: "high", label: "High" },
              { value: "normal", label: "Normal" },
              { value: "low", label: "Low" },
            ],
          },
          {
            label: "Category",
            value: category,
            onChange: setCategory,
            options: [
              { value: "all", label: "Any category" },
              ...(Object.keys(CATEGORY_LABEL) as Ticket["category"][]).map((c) => ({
                value: c,
                label: CATEGORY_LABEL[c],
              })),
            ],
          },
        ]}
      />

      {/* ------------------------------ split view ------------------------ */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,24rem)_1fr] xl:items-start">
        <Panel icon={<MessageSquare />} title="Queue" description="Priority, SLA countdown and assignee." padded={false}>
          <ul className="divide-y divide-border-subtle">
            {isLoading && <li className="px-4 py-6 text-sm text-text-muted">Loading tickets…</li>}
            {!isLoading && filtered.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-text-muted">
                No tickets match these filters.
              </li>
            )}
            {filtered.map((t) => {
              const on = selected?.id === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    aria-pressed={on}
                    className={
                      on
                        ? "w-full border-l-2 border-l-[var(--accent)] bg-accent-soft px-4 py-3.5 text-left"
                        : t.financialDispute
                        ? "w-full border-l-2 border-l-warning-500 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
                        : "w-full border-l-2 border-l-transparent px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
                    }
                  >
                    <span className="flex flex-wrap items-start justify-between gap-2">
                      <span className={on ? "text-sm font-semibold text-[var(--accent-hover)]" : "text-sm font-medium text-text-primary"}>
                        {t.subject}
                      </span>
                      <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
                    </span>
                    <span className="font-mono-num mt-1 block text-xs text-text-muted">
                      {t.id} · {t.userId} · {CATEGORY_LABEL[t.category]}
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-1.5">
                      {STATUS_BADGE[t.status]}
                      <SlaChip ticket={t} now={now} />
                      {t.financialDispute && (
                        <Badge tone="warning" icon={<Scale className="size-3.5" />}>Financial dispute</Badge>
                      )}
                    </span>
                    <span className="mt-1.5 block text-[11px] text-text-muted">
                      {t.assignee ? `Assigned to ${t.assignee}` : "Unassigned"} · updated {timeAgo(t.updatedAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>

        {selected ? (
          <div className="space-y-4">
            <Panel
              tone={selected.financialDispute ? "warning" : "default"}
              icon={selected.financialDispute ? <Scale /> : <MessageSquare />}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {selected.subject}
                  <span className="font-mono-num text-xs text-text-muted">{selected.id}</span>
                </span>
              }
              description={`${selected.userName} (${selected.userId}) · ${CATEGORY_LABEL[selected.category]} · opened ${formatDate(selected.createdAt, true)}`}
              action={
                <>
                  <Button variant="ghost" size="xs" icon={<UserCog className="size-3.5" />} onClick={() => setAssigning(true)}>
                    Assign
                  </Button>
                  <Button variant="ghost" size="xs" icon={<Merge className="size-3.5" />} onClick={() => setMerging(true)}>
                    Merge
                  </Button>
                  <Button variant="outline" size="xs" icon={<Flag className="size-3.5" />} onClick={() => setEscalating(true)}>
                    Escalate
                  </Button>
                  <Button size="xs" icon={<CheckCircle2 className="size-3.5" />} onClick={() => setResolving(true)}>
                    Resolve
                  </Button>
                </>
              }
            >
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  {STATUS_BADGE[selected.status]}
                  <Badge tone={PRIORITY_TONE[selected.priority]} icon={<AlertTriangle className="size-3.5" />}>
                    {selected.priority} priority
                  </Badge>
                  <SlaChip ticket={selected} now={now} />
                  <Badge tone="neutral">{selected.assignee ?? "Unassigned"}</Badge>
                  {selected.financialDispute && (
                    <Badge tone="warning" icon={<Scale className="size-3.5" />}>
                      Compliance-routed
                    </Badge>
                  )}
                </div>

                {selected.financialDispute && (
                  <Callout tone="warning" title="Financial dispute handling" icon={<ShieldAlert />}>
                    <p className="mt-1">
                      Quote the Treasury deposit reference and the rate in force when the entry was
                      created. Do not promise an adjustment in the thread: a balance change needs a
                      documented reason and a second admin&apos;s approval, so the member should be told
                      it is being requested, not that it is done.
                    </p>
                  </Callout>
                )}

                <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
                  <DetailRow label="Member" value={<span className="font-mono-num text-xs">{selected.userId}</span>} />
                  <DetailRow label="Created" value={<span className="tnum">{formatDate(selected.createdAt, true)}</span>} />
                  <DetailRow label="Last update" value={timeAgo(selected.updatedAt)} />
                  <DetailRow label="SLA due" value={<span className="tnum">{formatDate(selected.slaDueAt, true)}</span>} />
                  <DetailRow label="Messages" value={<span className="tnum">{thread.length}</span>} />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Conversation</h3>
                  <Switch
                    checked={showInternal}
                    onCheckedChange={setShowInternal}
                    label="Show internal notes"
                  />
                </div>

                <Thread messages={thread} showInternal={showInternal} />

                {/* ---------------------------- reply ------------------------ */}
                <div className="space-y-3 rounded-xl border border-border-default bg-surface-inset p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                      <Send className="size-4 text-[var(--accent)]" />
                      {internalNote ? "Internal note" : "Reply to member"}
                    </p>
                    <Switch
                      checked={internalNote}
                      onCheckedChange={setInternalNote}
                      label="Internal only"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {MACROS.map((m) => (
                      <button
                        key={m.label}
                        type="button"
                        onClick={() => setReply(m.body)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border-default px-3 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-[var(--accent)] hover:text-text-primary"
                      >
                        <Sparkles className="size-3" />
                        {m.label}
                      </button>
                    ))}
                  </div>

                  <Textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder={
                      internalNote
                        ? "Context for the next agent or for compliance. Never shown to the member."
                        : "Write to the member. Plain language, no jargon, no promises the record does not support."
                    }
                    className="min-h-28"
                    hint={
                      internalNote
                        ? "Internal notes are part of the ticket record and are disclosable to a regulator, though never to the member."
                        : "Replies are emailed and shown in-app. They become part of the permanent ticket record."
                    }
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-text-muted">
                      {internalNote ? "Visible to agents and compliance only." : `Goes to ${selected.userName}.`}
                    </span>
                    <Button size="sm" icon={<Send className="size-4" />} disabled={reply.trim().length < 2} onClick={sendReply}>
                      {internalNote ? "Add internal note" : "Send reply"}
                    </Button>
                  </div>
                </div>

                <AuditNote>
                  Replies, internal notes, assignment changes, escalations and merges are all recorded
                  against the ticket with your identity and timestamp. Financial-dispute tickets are
                  additionally retained for the AML record-keeping period.
                </AuditNote>
              </div>
            </Panel>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="ghost" size="sm" href="/admin/users" icon={<ArrowUpRight className="size-4" />}>
                Open member record
              </Button>
              <Button variant="ghost" size="sm" href="/admin/treasury" icon={<Lock className="size-4" />}>
                Check the funding reference
              </Button>
              <Button variant="ghost" size="sm" href="/admin/kyc" icon={<CheckCircle2 className="size-4" />}>
                KYC queue
              </Button>
            </div>
          </div>
        ) : (
          <Panel title="No ticket selected" description="Pick a ticket from the queue to open the conversation." />
        )}
      </div>

      {/* ------------------------------- assign --------------------------- */}
      <Modal
        open={assigning}
        onClose={() => setAssigning(false)}
        title="Assign or reassign ticket"
        description={selected ? `${selected.id} — currently ${selected.assignee ?? "unassigned"}` : undefined}
        icon={<UserCog className="size-5" />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAssigning(false)}>Cancel</Button>
            <Button
              disabled={!assignTo}
              onClick={() => {
                setAssigning(false);
                toast.success("Ticket reassigned", `${selected?.id} is now with ${assignTo}.`);
              }}
            >
              Assign ticket
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Assign to"
            required
            value={assignTo}
            onChange={(e) => setAssignTo(e.target.value)}
            placeholder="Select an agent…"
            options={agentOptions}
            hint={
              selected?.financialDispute
                ? "This is a financial dispute — only compliance-trained agents should take it."
                : "Any active support or compliance agent can take this ticket."
            }
          />
          {selected?.financialDispute && (
            <Callout tone="warning" title="Compliance routing applies" icon={<Scale />}>
              <p className="mt-1">
                Assigning a financial dispute to an agent without compliance training is logged as a
                routing exception and reviewed. If nobody trained is available, escalate instead.
              </p>
            </Callout>
          )}
        </div>
      </Modal>

      {/* -------------------------------- merge --------------------------- */}
      <Modal
        open={merging}
        onClose={() => setMerging(false)}
        title="Merge duplicate tickets"
        description={selected ? `Merge another ticket into ${selected.id}` : undefined}
        icon={<Merge className="size-5" />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMerging(false)}>Cancel</Button>
            <Button
              disabled={!mergeTarget}
              onClick={() => {
                setMerging(false);
                toast.success("Tickets merged", `${mergeTarget} merged into ${selected?.id}. The member sees one thread.`);
              }}
            >
              Merge tickets
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Ticket to merge in"
            required
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
            placeholder="Select a ticket…"
            options={tickets
              .filter((t) => t.id !== selected?.id)
              .map((t) => ({ value: t.id, label: `${t.id} — ${t.subject}` }))}
            hint="Only tickets from the same member should be merged. Merging across members would expose one member's messages to another."
          />
          <Callout tone="info" title="Merging keeps both histories" icon={<Merge />}>
            <p className="mt-1">
              Messages from both tickets are interleaved chronologically into the surviving thread. The
              merged ticket ID stays resolvable so any earlier reference still works, and the SLA of the
              earlier ticket carries over — merging never resets a clock.
            </p>
          </Callout>
        </div>
      </Modal>

      {/* ------------------------------- resolve -------------------------- */}
      <ConfirmDialog
        open={resolving}
        onClose={() => setResolving(false)}
        onConfirm={() => {
          setResolving(false);
          toast.success("Ticket resolved", "The member can reopen it within 14 days if the answer did not land.");
        }}
        title="Resolve this ticket?"
        confirmLabel="Mark resolved"
        requireAcknowledge={
          <Callout tone="info" title="Resolution is the member's judgement, not ours" icon={<CheckCircle2 />}>
            <p className="mt-1">
              The member is asked to confirm the outcome and can reopen the ticket within 14 days with
              one click. A reopened ticket resumes the original SLA clock rather than starting a new one.
            </p>
          </Callout>
        }
      >
        <p>
          {selected?.id} — {selected?.subject}. Confirm the member has an actual answer and, if a
          balance change was involved, that it has either been made or been queued with an approval
          reference they can see.
        </p>
      </ConfirmDialog>

      {/* ------------------------------- escalate ------------------------- */}
      <ConfirmDialog
        open={escalating}
        onClose={() => setEscalating(false)}
        onConfirm={() => {
          setEscalating(false);
          toast.toast({
            tone: "warning",
            title: "Ticket escalated",
            description: "Routed to the compliance queue with the full thread attached.",
          });
        }}
        title="Escalate this ticket?"
        tone="danger"
        confirmLabel="Escalate to compliance"
        requireAcknowledge={
          <Callout tone="warning" title="Escalation is for judgement calls, not for volume" icon={<Flag />}>
            <p className="mt-1">
              Escalate when the answer needs a decision an agent is not authorised to make — a balance
              adjustment, a frozen account, a disputed calculation, or anything that might become a
              regulatory matter. Escalation shortens the SLA rather than extending it.
            </p>
          </Callout>
        }
      >
        <p>
          {selected?.id} moves to the compliance queue with the full conversation, the member&apos;s
          account record and any linked fraud alert attached.
        </p>
      </ConfirmDialog>
    </div>
  );
}
