"use client";

/* Shared admin chrome: panels, inline notes, on-chain links, document tiles.
 * Built once here and reused by every AD-xx page. */

import Link from "next/link";
import { ExternalLink, FileText, Lock } from "lucide-react";
import { cn, shortenHash } from "@/lib/utils";
import { txUrl, addressUrl } from "@/lib/web3";

export function Panel({
  title, description, icon, action, children, footnote, className, padded = true, tone,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  footnote?: React.ReactNode;
  className?: string;
  padded?: boolean;
  tone?: "default" | "critical" | "warning";
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-[var(--radius-card)] border bg-surface-1",
        tone === "critical" ? "border-critical-500/40"
          : tone === "warning" ? "border-warning-500/40"
          : "border-border-subtle",
        className,
      )}
    >
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {icon && (
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-[var(--accent)] [&>svg]:size-4">
                {icon}
              </span>
            )}
            <div className="min-w-0">
              {title && <h3 className="text-sm font-semibold text-text-primary">{title}</h3>}
              {description && <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{description}</p>}
            </div>
          </div>
          {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
        </div>
      )}
      {children && <div className={cn(padded && "px-5 py-4")}>{children}</div>}
      {footnote && (
        <p className="border-t border-border-subtle bg-surface-inset/40 px-5 py-2.5 text-xs leading-relaxed text-text-muted">
          {footnote}
        </p>
      )}
    </section>
  );
}

/** The recurring "this is written to append-only storage" reassurance. */
export function AuditNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 text-xs leading-relaxed text-text-muted", className)}>
      <Lock className="mt-0.5 size-3.5 shrink-0 text-[var(--accent)]" />
      <span>{children}</span>
    </p>
  );
}

export function TxLink({ hash, className }: { hash: string; className?: string }) {
  return (
    <Link
      href={txUrl(hash)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "font-mono-num inline-flex items-center gap-1 text-xs text-[var(--accent-hover)] hover:underline",
        className,
      )}
    >
      {shortenHash(hash)}
      <ExternalLink className="size-3" />
    </Link>
  );
}

export function AddressLink({ address, className }: { address: string; className?: string }) {
  return (
    <Link
      href={addressUrl(address)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "font-mono-num inline-flex items-center gap-1 text-xs text-[var(--accent-hover)] hover:underline",
        className,
      )}
    >
      {shortenHash(address)}
      <ExternalLink className="size-3" />
    </Link>
  );
}

/** KYC document stand-in. Deliberately a labelled tile, never a real image. */
export function DocTile({
  label, filename, onOpen, note,
}: {
  label: string;
  filename: string;
  onOpen?: () => void;
  note?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full flex-col gap-2 rounded-xl border border-border-default bg-surface-inset p-3 text-left transition-colors hover:border-[var(--accent)] hover:bg-surface-2"
    >
      <span className="flex h-20 items-center justify-center rounded-lg bg-surface-3 bg-grid text-text-muted ring-1 ring-inset ring-border-subtle">
        <FileText className="size-6 transition-colors group-hover:text-[var(--accent)]" />
      </span>
      <span className="text-xs font-semibold text-text-primary">{label}</span>
      <span className="font-mono-num truncate text-[11px] text-text-muted">{filename}</span>
      {note && <span className="text-[11px] leading-snug text-warning-400">{note}</span>}
    </button>
  );
}

/** Compact stat used inside panels where a full StatTile is too heavy. */
export function MiniStat({
  label, value, sub, tone,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "good" | "warning" | "critical";
}) {
  const color =
    tone === "good" ? "text-good-400"
    : tone === "warning" ? "text-warning-400"
    : tone === "critical" ? "text-critical-400"
    : "text-text-primary";
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-text-muted">{label}</p>
      <p className={cn("tnum mt-1 text-lg font-semibold", color)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-text-muted">{sub}</p>}
    </div>
  );
}
