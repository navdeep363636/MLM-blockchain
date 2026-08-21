"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, Bell, BellOff, Check, CheckCheck, Coins, Gift, Megaphone, Receipt,
  Settings, ShieldCheck, Trophy, UserCheck,
} from "lucide-react";
import {
  Badge, Button, EmptyState, PillTabs, StatTile,
} from "@/components/ui";
import { useNotifications } from "@/lib/hooks/use-data";
import { cn } from "@/lib/utils";
import type { AppNotification, NotificationKind } from "@/types";
import { RelativeTime } from "../../_components/time";

const KIND_META: Record<NotificationKind, { label: string; icon: React.ReactNode; tone: string }> = {
  transaction: { label: "Transactions", icon: <Receipt className="size-4" />, tone: "bg-surface-3 text-text-secondary" },
  security: { label: "Security", icon: <ShieldCheck className="size-4" />, tone: "bg-critical-500/12 text-critical-400" },
  kyc: { label: "Verification", icon: <UserCheck className="size-4" />, tone: "bg-info-500/12 text-info-400" },
  reward: { label: "Rewards", icon: <Coins className="size-4" />, tone: "bg-accent-soft text-[var(--accent)]" },
  commission: { label: "Commission", icon: <Gift className="size-4" />, tone: "bg-good-500/12 text-good-400" },
  tournament: { label: "Tournaments", icon: <Trophy className="size-4" />, tone: "bg-warning-500/12 text-warning-400" },
  system: { label: "System", icon: <Bell className="size-4" />, tone: "bg-surface-3 text-text-secondary" },
  promo: { label: "Offers", icon: <Megaphone className="size-4" />, tone: "bg-surface-3 text-text-muted" },
};

export function NotificationsView() {
  const { data: notifications, isLoading } = useNotifications();
  const [filter, setFilter] = useState<"all" | "unread" | NotificationKind>("all");
  const [readOverride, setReadOverride] = useState<Record<string, boolean>>({});

  const isRead = (n: AppNotification) => readOverride[n.id] ?? n.read;

  const shown = useMemo(
    () =>
      notifications.filter((n) => {
        if (filter === "all") return true;
        if (filter === "unread") return !isRead(n);
        return n.kind === filter;
      }),
    [notifications, filter, readOverride],
  );

  const unread = notifications.filter((n) => !isRead(n));
  const kinds = Array.from(new Set(notifications.map((n) => n.kind)));

  const markAll = () => {
    const next: Record<string, boolean> = {};
    for (const n of notifications) next[n.id] = true;
    setReadOverride(next);
  };

  const toggle = (n: AppNotification) =>
    setReadOverride((m) => ({ ...m, [n.id]: !isRead(n) }));

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Unread" value={unread.length} icon={<Bell />} tone={unread.length > 0 ? "brand" : "default"} deltaLabel={`of ${notifications.length} total`} compact />
        <StatTile label="Needs action" value={unread.filter((n) => n.href).length} icon={<ArrowRight />} deltaLabel="Unread items with a destination" compact />
        <StatTile label="Security alerts" value={notifications.filter((n) => n.kind === "security").length} icon={<ShieldCheck />} deltaLabel="Review any you don't recognise" compact />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <PillTabs
          value={filter}
          onValueChange={(v) => setFilter(v as typeof filter)}
          items={[
            { value: "all", label: "All", count: notifications.length },
            { value: "unread", label: "Unread", count: unread.length },
            ...kinds.map((k) => ({
              value: k,
              label: KIND_META[k].label,
              count: notifications.filter((n) => n.kind === k).length,
            })),
          ]}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={markAll}
            disabled={unread.length === 0}
            icon={<CheckCheck className="size-3.5" />}
          >
            Mark all read
          </Button>
          <Button href="/app/settings" size="sm" variant="ghost" icon={<Settings className="size-3.5" />}>
            Preferences
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="shimmer h-20 rounded-xl" />)}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          className="mt-4 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1"
          icon={<BellOff />}
          title={filter === "unread" ? "You're all caught up" : "Nothing in this category"}
          description={
            filter === "unread"
              ? "Every notification has been read. New ones will appear here."
              : "Try a different filter to see other notifications."
          }
          action={filter !== "all" ? { label: "Show all", onClick: () => setFilter("all") } : undefined}
        />
      ) : (
        <ul className="mt-4 space-y-2">
          {shown.map((n) => {
            const meta = KIND_META[n.kind];
            const read = isRead(n);
            return (
              <li key={n.id}>
                <div
                  className={cn(
                    "flex gap-3.5 rounded-xl border p-4 transition-colors",
                    read
                      ? "border-border-subtle bg-surface-1"
                      : "border-[color-mix(in_oklab,var(--accent)_30%,var(--border-default))] bg-surface-1",
                  )}
                >
                  <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", meta.tone)}>
                    {meta.icon}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={cn("text-sm", read ? "font-medium text-text-secondary" : "font-semibold text-text-primary")}>
                        {n.title}
                      </p>
                      {!read && <span className="size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />}
                      <Badge tone="neutral">{meta.label}</Badge>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-text-muted">{n.body}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="text-xs text-text-muted">
                        <RelativeTime date={n.createdAt} />
                      </span>
                      {n.href && (
                        <Link
                          href={n.href}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-hover)] hover:underline"
                        >
                          Open <ArrowRight className="size-3" />
                        </Link>
                      )}
                      <button
                        onClick={() => toggle(n)}
                        className="inline-flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-text-primary"
                      >
                        <Check className="size-3" />
                        Mark as {read ? "unread" : "read"}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-6 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]">
              <Settings className="size-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Control what reaches you</h3>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-text-muted">
                Choose per channel and per event type in your profile settings. Security notifications
                are always delivered — we don&apos;t let you switch off the alerts that tell you
                someone signed into your account.
              </p>
            </div>
          </div>
          <Button href="/app/settings" size="sm" variant="outline">Notification preferences</Button>
        </div>
      </div>
    </>
  );
}
