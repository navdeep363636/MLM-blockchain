"use client";

import { AlertTriangle, CheckCircle2, Clock, Info, ShieldAlert, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "brand" | "good" | "warning" | "serious" | "critical" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-3 text-text-secondary ring-border-default",
  brand: "bg-accent-soft text-[var(--accent-hover)] ring-[var(--accent-ring)]",
  good: "bg-good-500/12 text-good-400 ring-good-500/30",
  warning: "bg-warning-500/12 text-warning-400 ring-warning-500/30",
  serious: "bg-serious-500/12 text-serious-400 ring-serious-500/30",
  critical: "bg-critical-500/12 text-critical-400 ring-critical-500/30",
  info: "bg-info-500/12 text-info-400 ring-info-500/30",
};

export function Badge({
  children, tone = "neutral", className, icon, dot,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
  icon?: React.ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        /* One hairline of light on the top edge. At badge scale it is barely
           perceptible individually and completely changes a dense table, where
           forty of them otherwise read as flat printed stickers. */
        "[box-shadow:inset_0_1px_0_0_rgb(255_255_255_/_0.07)]",
        tones[tone], className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {icon}
      {children}
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Status pills. Status colour is reserved and always ships with an icon +
 * label, never colour alone — required for colourblind and forced-colors users.
 * ------------------------------------------------------------------------ */

export type StatusKind =
  | "pending" | "processing" | "completed" | "failed" | "cancelled"
  | "approved" | "rejected" | "review" | "active" | "inactive"
  | "frozen" | "unclaimed" | "claimed" | "paid" | "queued" | "expired";

const statusMap: Record<StatusKind, { tone: Tone; label: string; Icon: typeof Clock }> = {
  pending:    { tone: "warning",  label: "Pending",       Icon: Clock },
  queued:     { tone: "warning",  label: "Queued",        Icon: Clock },
  processing: { tone: "info",     label: "Processing",    Icon: Clock },
  review:     { tone: "serious",  label: "In review",     Icon: ShieldAlert },
  completed:  { tone: "good",     label: "Completed",     Icon: CheckCircle2 },
  approved:   { tone: "good",     label: "Approved",      Icon: CheckCircle2 },
  paid:       { tone: "good",     label: "Paid",          Icon: CheckCircle2 },
  claimed:    { tone: "good",     label: "Claimed",       Icon: CheckCircle2 },
  active:     { tone: "good",     label: "Active",        Icon: CheckCircle2 },
  unclaimed:  { tone: "brand",    label: "Unclaimed",     Icon: Info },
  failed:     { tone: "critical", label: "Failed",        Icon: XCircle },
  rejected:   { tone: "critical", label: "Rejected",      Icon: XCircle },
  frozen:     { tone: "critical", label: "Frozen",        Icon: ShieldAlert },
  cancelled:  { tone: "neutral",  label: "Cancelled",     Icon: XCircle },
  inactive:   { tone: "neutral",  label: "Inactive",      Icon: XCircle },
  expired:    { tone: "neutral",  label: "Expired",       Icon: AlertTriangle },
};

export function StatusPill({ status, className }: { status: StatusKind; className?: string }) {
  const { tone, label, Icon } = statusMap[status];
  return (
    <Badge tone={tone} className={className} icon={<Icon className="size-3.5" />}>
      {label}
    </Badge>
  );
}

export type KycTier = "none" | "pending" | "tier1" | "tier2" | "rejected";

export function KycBadge({ tier, className }: { tier: KycTier; className?: string }) {
  const map: Record<KycTier, { tone: Tone; label: string; Icon: typeof Clock }> = {
    none:     { tone: "neutral",  label: "KYC not started", Icon: AlertTriangle },
    pending:  { tone: "warning",  label: "KYC pending",     Icon: Clock },
    tier1:    { tone: "good",     label: "KYC Tier 1",      Icon: CheckCircle2 },
    tier2:    { tone: "good",     label: "KYC Tier 2",      Icon: CheckCircle2 },
    rejected: { tone: "critical", label: "KYC rejected",    Icon: XCircle },
  };
  const { tone, label, Icon } = map[tier];
  return <Badge tone={tone} className={className} icon={<Icon className="size-3.5" />}>{label}</Badge>;
}

/** Level 1 / 2 / 3 referral tier chip. Uses chart series slots in order. */
export function LevelBadge({ level, className }: { level: 1 | 2 | 3; className?: string }) {
  const color = level === 1 ? "var(--series-1)" : level === 2 ? "var(--series-2)" : "var(--series-3)";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-3 px-2.5 py-0.5 text-xs font-medium text-text-secondary ring-1 ring-inset ring-border-default",
        className,
      )}
    >
      <span className="size-2 rounded-full" style={{ background: color }} />
      Level {level}
    </span>
  );
}

/** Inline compliance/regulatory callout. Used on every earnings-adjacent page. */
export function Callout({
  tone = "info", title, children, icon, className,
}: {
  tone?: Tone;
  title?: React.ReactNode;
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  const border: Record<Tone, string> = {
    neutral: "border-l-border-strong",
    brand: "border-l-[var(--accent)]",
    good: "border-l-good-500",
    warning: "border-l-warning-500",
    serious: "border-l-serious-500",
    critical: "border-l-critical-500",
    info: "border-l-info-500",
  };
  const text: Record<Tone, string> = {
    neutral: "text-text-muted", brand: "text-[var(--accent-hover)]", good: "text-good-400",
    warning: "text-warning-400", serious: "text-serious-400", critical: "text-critical-400",
    info: "text-info-400",
  };
  return (
    <div
      className={cn(
        "relative flex gap-3 overflow-hidden rounded-r-xl rounded-l-sm border-l-2 px-4 py-3",
        "bg-[linear-gradient(90deg,color-mix(in_oklab,var(--surface-2)_92%,transparent),color-mix(in_oklab,var(--surface-2)_45%,transparent))]",
        "[box-shadow:inset_0_1px_0_0_var(--rim-light)]",
        border[tone], className,
      )}
    >
      {icon && <span className={cn("mt-0.5 shrink-0 [&>svg]:size-4", text[tone])}>{icon}</span>}
      <div className="min-w-0 text-sm">
        {title && <p className={cn("font-semibold", text[tone])}>{title}</p>}
        <div className="text-text-secondary [&_a]:text-[var(--accent-hover)] [&_a]:underline [&_a]:underline-offset-2">
          {children}
        </div>
      </div>
    </div>
  );
}
