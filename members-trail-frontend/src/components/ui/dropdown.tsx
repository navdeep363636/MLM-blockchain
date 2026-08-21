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
              "absolute z-50 mt-2 min-w-52 overflow-hidden rounded-xl border border-border-default bg-surface-2 p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]",
              align === "end" ? "right-0" : "left-0",
              menuClassName,
            )}
          >
            {items.map((it, i) => {
              const cls = cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
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
