"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface TabItem {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  content?: React.ReactNode;
}

/** Underline tabs with a sliding indicator. */
export function Tabs({
  items, value, onValueChange, className, panelClassName,
}: {
  items: TabItem[];
  value?: string;
  onValueChange?: (v: string) => void;
  className?: string;
  panelClassName?: string;
}) {
  const [internal, setInternal] = useState(items[0]?.value ?? "");
  const active = value ?? internal;
  const set = onValueChange ?? setInternal;
  const current = items.find((i) => i.value === active);

  return (
    <div className={className}>
      <div
        role="tablist"
        className="no-scrollbar -mb-px flex items-center gap-1 overflow-x-auto border-b border-border-subtle"
      >
        {items.map((it) => {
          const on = it.value === active;
          return (
            <button
              key={it.value}
              role="tab"
              aria-selected={on}
              onClick={() => set(it.value)}
              className={cn(
                "relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap px-3.5 py-2.5 text-sm font-medium transition-colors",
                on ? "text-text-primary" : "text-text-muted hover:text-text-secondary",
              )}
            >
              {it.icon}
              {it.label}
              {it.badge}
              {on && (
                <>
                  {/* The indicator is a shared layout element, so switching tabs
                      slides one bar rather than cross-fading two. */}
                  <motion.span
                    layoutId="tab-underline"
                    className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-[var(--accent)]
                               shadow-[0_0_10px_1px_var(--accent-ring)]"
                    transition={{ duration: 0.36, ease: [0.32, 0.72, 0, 1] }}
                  />
                  {/* …and a soft glow above it, which is what makes the active
                      tab read as lit from below instead of underlined. */}
                  <motion.span
                    layoutId="tab-glow"
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-8 rounded-t-lg
                               bg-[linear-gradient(to_top,var(--accent-soft),transparent)]"
                    transition={{ duration: 0.36, ease: [0.32, 0.72, 0, 1] }}
                  />
                </>
              )}
            </button>
          );
        })}
      </div>
      {current?.content && <div className={cn("pt-5", panelClassName)}>{current.content}</div>}
    </div>
  );
}

/** Pill tabs — for compact, in-card switching. */
export function PillTabs({
  items, value, onValueChange, className,
}: {
  items: { value: string; label: React.ReactNode; count?: number }[];
  value: string;
  onValueChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "no-scrollbar flex items-center gap-1 overflow-x-auto rounded-full border border-border-subtle bg-surface-inset p-1",
        "[box-shadow:inset_0_1px_3px_-1px_rgb(0_0_0_/_0.35)]",
        className,
      )}
    >
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={on}
            onClick={() => onValueChange(it.value)}
            className={cn(
              "relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
              "transition-colors duration-[var(--dur-quick)]",
              on ? "text-[var(--accent-hover)]" : "text-text-muted hover:text-text-secondary",
            )}
          >
            {/* The moving thumb. One element for the whole group — the pill
                travels between options instead of appearing under each. */}
            {on && (
              <motion.span
                layoutId="pill-thumb"
                aria-hidden
                className="absolute inset-0 rounded-full bg-surface-2 ring-1 ring-inset ring-[var(--accent-ring)]
                           [box-shadow:inset_0_1px_0_0_var(--rim-light),var(--shadow-e2)]"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative">{it.label}</span>
            {typeof it.count === "number" && (
              <span
                className={cn(
                  "tnum relative rounded-full px-1.5 text-[10px]",
                  on ? "bg-[var(--accent)]/20" : "bg-surface-3",
                )}
              >
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Accordion({
  items, className, defaultOpen,
}: {
  items: { title: React.ReactNode; content: React.ReactNode }[];
  className?: string;
  defaultOpen?: number;
}) {
  const [open, setOpen] = useState<number | null>(defaultOpen ?? null);
  return (
    <div
      className={cn(
        "divide-y divide-border-subtle overflow-hidden rounded-[var(--radius-panel)] border border-border-subtle bg-surface-1",
        "[box-shadow:var(--shadow-e2),inset_0_1px_0_0_var(--rim-light)]",
        className,
      )}
    >
      {items.map((it, i) => {
        const on = open === i;
        return (
          <div key={i}>
            <button
              onClick={() => setOpen(on ? null : i)}
              aria-expanded={on}
              className="group/acc relative flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors duration-[var(--dur-quick)] hover:bg-surface-2"
            >
              <span className={cn("text-sm font-medium", on ? "text-[var(--accent-hover)]" : "text-text-primary")}>
                {it.title}
              </span>
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border border-border-default text-text-muted",
                  "transition-[transform,border-color,color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-tide)]",
                  "group-hover/acc:border-border-strong",
                  on && "rotate-[135deg] border-[var(--accent)] text-[var(--accent)] [box-shadow:0_0_0_4px_var(--accent-soft)]",
                )}
              >
                <svg viewBox="0 0 12 12" className="size-3 fill-none stroke-current stroke-[1.6]">
                  <path d="M6 1.5v9M1.5 6h9" strokeLinecap="round" />
                </svg>
              </span>
            </button>
            <motion.div
              initial={false}
              animate={{ height: on ? "auto" : 0, opacity: on ? 1 : 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="px-5 pb-4 text-sm leading-relaxed text-text-secondary">{it.content}</div>
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}
