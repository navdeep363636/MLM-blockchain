"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface MenuItem {
  label: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  separatorBefore?: boolean;
}

export function Dropdown({
  trigger, items, align = "end", className, menuClassName,
}: {
  trigger: React.ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  className?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="block">
        {trigger}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "absolute z-50 mt-2 min-w-52 overflow-hidden rounded-2xl border border-border-default p-1.5",
              /* Popovers are the one place a heavy blur is worth its cost: the
                 menu must stay readable over a dashboard full of charts, and a
                 solid fill at this size hides too much of what you were
                 looking at. */
              "glass-2",
              align === "end" ? "right-0" : "left-0",
              menuClassName,
            )}
          >
            {items.map((it, i) => {
              const cls = cn(
                "group/mi relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm",
                "transition-[background-color,color,transform] duration-[var(--dur-instant)] ease-[var(--ease-tide)]",
                "hover:translate-x-0.5",
                it.tone === "danger"
                  ? "text-critical-400 hover:bg-critical-500/10"
                  : "text-text-secondary hover:bg-surface-3 hover:text-text-primary",
                it.disabled && "pointer-events-none opacity-40",
              );
              const inner = (
                <>
                  {it.icon && <span className="shrink-0 [&>svg]:size-4">{it.icon}</span>}
                  <span className="truncate">{it.label}</span>
                </>
              );
              return (
                <div key={i}>
                  {it.separatorBefore && <div className="my-1.5 h-px bg-border-subtle" />}
                  {it.href ? (
                    <a href={it.href} role="menuitem" className={cls} onClick={() => setOpen(false)}>{inner}</a>
                  ) : (
                    <button
                      role="menuitem"
                      className={cls}
                      onClick={() => { it.onClick?.(); setOpen(false); }}
                    >
                      {inner}
                    </button>
                  )}
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
