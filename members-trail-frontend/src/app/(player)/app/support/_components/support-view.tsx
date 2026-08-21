"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle, Clock, LifeBuoy, MessageSquare, Paperclip, Plus, Send,
  ShieldAlert, Star, TriangleAlert,
} from "lucide-react";
import {
  Avatar, Badge, Button, Callout, EmptyState, Input, Modal, PillTabs, Select,
  StatTile, Textarea, useToast,
} from "@/components/ui";
import { useCurrentUser, useTickets } from "@/lib/hooks/use-data";
import { cn, formatDate, formatDuration } from "@/lib/utils";
import type { Ticket, TicketCategory, TicketMessage, TicketStatus } from "@/types";
import { RelativeTime, useLiveNow } from "../../_components/time";

const CATEGORIES: { value: TicketCategory; label: string; financial?: boolean }[] = [
  { value: "account", label: "Account & login" },
  { value: "kyc", label: "KYC / verification" },
  { value: "withdrawal", label: "Withdrawal", financial: true },
  { value: "commission", label: "Referral commission", financial: true },
  { value: "gameplay", label: "Gameplay / Points" },
  { value: "technical", label: "Technical problem" },
  { value: "other", label: "Something else" },
];

const STATUS_TONE: Record<TicketStatus, "warning" | "info" | "serious" | "good" | "neutral"> = {
  open: "warning",
  pending_user: "info",
  escalated: "serious",
  resolved: "good",
  closed: "neutral",
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  pending_user: "Awaiting your reply",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
};

export function SupportView() {
  const { data: tickets, isLoading } = useTickets();
  const { data: user } = useCurrentUser();
  const now = useLiveNow(30_000);
  const toast = useToast();

  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [extraMessages, setExtraMessages] = useState<Record<string, TicketMessage[]>>({});
  const [form, setForm] = useState({ category: "", subject: "", body: "" });
  const [busy, setBusy] = useState(false);

  const shown = useMemo(
    () =>
      tickets.filter((t) => {
        if (filter === "open") return t.status !== "resolved" && t.status !== "closed";
        if (filter === "resolved") return t.status === "resolved" || t.status === "closed";
        return true;
      }),
    [tickets, filter],
  );

  const openCount = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed").length;
  const disputes = tickets.filter((t) => t.financialDispute).length;

  const isFinancial = CATEGORIES.find((c) => c.value === form.category)?.financial ?? false;

  const messagesFor = (t: Ticket) => [...t.messages, ...(extraMessages[t.id] ?? [])];

  const submitTicket = async () => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 900));
    setBusy(false);
    setNewOpen(false);
    toast.success(
      "Ticket opened",
      isFinancial
        ? "Routed to a compliance-trained agent with SLA tracking."
        : "We'll reply by email and here in your ticket list.",
    );
    setForm({ category: "", subject: "", body: "" });
  };

  const sendReply = () => {
    if (!selected || reply.trim().length < 2) return;
    setExtraMessages((m) => ({
      ...m,
      [selected.id]: [
        ...(m[selected.id] ?? []),
        {
          id: `M-new-${(m[selected.id]?.length ?? 0) + 1}`,
          author: user.displayName,
          authorRole: "user",
          body: reply.trim(),
          createdAt: new Date(now).toISOString(),
        },
      ],
    }));
    setReply("");
    toast.success("Reply sent");
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Open tickets" value={openCount} icon={<LifeBuoy />} tone={openCount > 0 ? "brand" : "default"} deltaLabel={`${tickets.length} total, all time`} compact />
        <StatTile label="Financial disputes" value={disputes} icon={<ShieldAlert />} deltaLabel="Handled by compliance-trained agents" compact />
        <StatTile
          label="Awaiting your reply"
          value={tickets.filter((t) => t.status === "pending_user").length}
          icon={<MessageSquare />}
          deltaLabel="Tickets paused until you respond"
          compact
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <PillTabs
          value={filter}
          onValueChange={(v) => setFilter(v as typeof filter)}
          items={[
            { value: "all", label: "All", count: tickets.length },
            { value: "open", label: "Open", count: openCount },
            { value: "resolved", label: "Closed", count: tickets.length - openCount },
          ]}
        />
        <Button size="sm" onClick={() => setNewOpen(true)} icon={<Plus className="size-4" />}>
          New ticket
        </Button>
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="shimmer h-24 rounded-xl" />)}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          className="mt-4 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1"
          icon={<LifeBuoy />}
          title="No tickets here"
          description="Open one whenever something looks wrong — especially anything involving money."
          action={{ label: "Open a ticket", onClick: () => setNewOpen(true) }}
        />
      ) : (
        <ul className="mt-4 space-y-3">
          {shown.map((t) => {
            const slaMs = Date.parse(t.slaDueAt) - now;
            const breached = slaMs < 0 && t.status !== "resolved" && t.status !== "closed";
            const msgs = messagesFor(t);
            return (
              <li key={t.id}>
                <button
                  onClick={() => setSelected(t)}
                  className={cn(
                    "w-full rounded-[var(--radius-card)] border bg-surface-1 p-4 text-left transition-colors hover:border-border-strong",
                    t.financialDispute ? "border-l-2 border-l-warning-500 border-border-subtle" : "border-border-subtle",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono-num text-xs text-text-muted">{t.id}</span>
                        <Badge tone={STATUS_TONE[t.status]} dot>{STATUS_LABEL[t.status]}</Badge>
                        {t.financialDispute && (
                          <Badge tone="warning" icon={<ShieldAlert className="size-3" />}>Financial dispute</Badge>
                        )}
                        {t.priority === "urgent" && <Badge tone="critical">Urgent</Badge>}
                      </div>
                      <p className="mt-1.5 text-sm font-semibold text-text-primary">{t.subject}</p>
                      <p className="mt-1 line-clamp-1 text-xs text-text-muted">
                        {msgs[msgs.length - 1]?.body}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      {t.assignee && (
                        <div className="flex items-center justify-end gap-2">
                          <Avatar name={t.assignee} size="xs" />
                          <span className="text-xs text-text-secondary">{t.assignee}</span>
                        </div>
                      )}
                      <p className="mt-1.5 text-xs text-text-muted">
                        Updated <RelativeTime date={t.updatedAt} />
                      </p>
                      {t.status !== "resolved" && t.status !== "closed" && (
                        <p
                          className={cn(
                            "tnum mt-1 inline-flex items-center gap-1 text-xs font-medium",
                            breached ? "text-critical-400" : "text-text-muted",
                          )}
                        >
                          <Clock className="size-3" />
                          {breached ? `SLA overdue by ${formatDuration(-slaMs / 1000)}` : `SLA in ${formatDuration(slaMs / 1000)}`}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Callout tone="info" title="Money questions never sit in a general queue" icon={<ShieldAlert />} className="mt-6">
        <p className="mt-1">
          Withdrawal and commission tickets are auto-routed to compliance-trained agents with SLA
          tracking. Include the reference — <span className="font-mono-num text-xs">TX-…</span> or{" "}
          <span className="font-mono-num text-xs">CM-…</span> — and we can usually resolve it in one
          round instead of three.
        </p>
      </Callout>

      {/* Thread */}
      <Modal
        open={!!selected}
        onClose={() => { setSelected(null); setReply(""); }}
        title={selected?.subject}
        description={selected ? `${selected.id} · ${CATEGORIES.find((c) => c.value === selected.category)?.label}` : undefined}
        icon={<MessageSquare className="size-5" />}
        size="lg"
        footer={
          selected && selected.status !== "resolved" && selected.status !== "closed" ? (
            <>
              <Button variant="ghost" onClick={() => { setSelected(null); setReply(""); }}>Close</Button>
              <Button onClick={sendReply} disabled={reply.trim().length < 2} icon={<Send className="size-3.5" />}>
                Send reply
              </Button>
            </>
          ) : (
            <Button onClick={() => setSelected(null)}>Close</Button>
          )
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[selected.status]} dot>{STATUS_LABEL[selected.status]}</Badge>
              {selected.financialDispute && (
                <Badge tone="warning" icon={<ShieldAlert className="size-3" />}>Compliance-routed</Badge>
              )}
              <span className="text-xs text-text-muted">Opened {formatDate(selected.createdAt, true)}</span>
            </div>

            {selected.financialDispute && (
              <Callout tone="serious" title="Handled by a compliance-trained agent" icon={<ShieldAlert />}>
                <p className="mt-1">
                  Financial disputes bypass general support entirely and carry SLA tracking. The agent
                  can pull the underlying revenue event and Treasury deposit reference for you.
                </p>
              </Callout>
            )}

            <ul className="space-y-3">
              {messagesFor(selected).map((m) => {
                const mine = m.authorRole === "user";
                const system = m.authorRole === "system";
                return (
                  <li key={m.id} className={cn("flex gap-3", mine && "flex-row-reverse")}>
                    {!system && <Avatar name={m.author} size="sm" />}
                    <div
                      className={cn(
                        "max-w-[85%] rounded-xl px-3.5 py-2.5",
                        system
                          ? "mx-auto bg-surface-inset text-center"
                          : mine
                            ? "bg-accent-soft"
                            : "bg-surface-2",
                      )}
                    >
                      {!system && (
                        <p className="text-xs font-semibold text-text-primary">
                          {m.author}
                          <span className="ml-2 font-normal text-text-muted">
                            {m.authorRole === "agent" ? "Support" : "You"}
                          </span>
                        </p>
                      )}
                      <p className={cn("text-sm leading-relaxed", system ? "text-text-muted" : "mt-1 text-text-secondary")}>
                        {m.body}
                      </p>
                      <p className="mt-1.5 text-[11px] text-text-muted">
                        <RelativeTime date={m.createdAt} />
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>

            {selected.status !== "resolved" && selected.status !== "closed" ? (
              <div className="border-t border-border-subtle pt-4">
                <Textarea
                  label="Your reply"
                  rows={3}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Add anything that would help…"
                  hint="Never include your password, 2FA codes or wallet seed phrase — support will never ask for them."
                />
                <Button size="xs" variant="ghost" className="mt-2" icon={<Paperclip className="size-3.5" />}>
                  Attach a file
                </Button>
              </div>
            ) : (
              <div className="border-t border-border-subtle pt-4">
                <p className="mb-2 text-sm font-medium text-text-primary">How did we do?</p>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => toast.success("Thanks for the feedback")}
                      aria-label={`Rate ${n} out of 5`}
                      className="grid size-9 place-items-center rounded-lg bg-surface-3 text-text-muted transition-colors hover:bg-surface-2 hover:text-[var(--accent)]"
                    >
                      <Star className="size-4" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* New ticket */}
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Open a support ticket"
        description="Pick the closest category so it reaches the right team."
        icon={<LifeBuoy className="size-5" />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button
              loading={busy}
              disabled={!form.category || form.subject.trim().length < 4 || form.body.trim().length < 20}
              onClick={submitTicket}
            >
              Submit ticket
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Category"
            required
            placeholder="Choose one…"
            options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
          />

          {isFinancial && (
            <Callout tone="serious" title="This will be treated as a financial dispute" icon={<TriangleAlert />}>
              <p className="mt-1">
                It routes straight to a compliance-trained agent with SLA tracking. Include the
                transaction or commission reference if you have it.
              </p>
            </Callout>
          )}

          <Input
            label="Subject"
            required
            placeholder="Short summary"
            value={form.subject}
            onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
          />

          <Textarea
            label="Description"
            required
            rows={6}
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            placeholder="What happened, what you expected, and any references…"
            hint="Minimum 20 characters. Never include passwords, 2FA codes or seed phrases."
            error={form.body.length > 0 && form.body.trim().length < 20 && "A little more detail, please."}
          />

          <Button size="xs" variant="ghost" icon={<Paperclip className="size-3.5" />}>
            Attach screenshots or documents
          </Button>

          <Callout tone="warning" title="We will never ask for your secrets" icon={<AlertTriangle />}>
            <p className="mt-1">
              No Members Trail agent will ever ask for your password, 2FA codes, seed phrase or a
              private key — and we never ask you to send MTT or BNB anywhere to &ldquo;unlock&rdquo; a
              withdrawal. Anyone who does is attempting fraud.
            </p>
          </Callout>
        </div>
      </Modal>
    </>
  );
}
