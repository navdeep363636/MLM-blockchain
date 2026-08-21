"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, X, XCircle, AlertTriangle, ExternalLink } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  /** Optional link — used for "View on BscScan" after a transaction. */
  href?: string;
  hrefLabel?: string;
  duration?: number;
}

interface ToastCtx {
  toast: (t: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast must be used inside <ToastProvider>");
  return c;
}

const icons: Record<ToastTone, typeof Info> = {
  success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle,
};
const accents: Record<ToastTone, string> = {
  success: "text-good-400", error: "text-critical-400",
  info: "text-info-400", warning: "text-warning-400",
};
const bars: Record<ToastTone, string> = {
  success: "bg-good-500", error: "bg-critical-500", info: "bg-info-500", warning: "bg-warning-500",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((s) => s.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setItems((s) => [...s.slice(-4), { ...t, id }]);
    const ms = t.duration ?? (t.tone === "error" ? 7000 : 4800);
    if (ms > 0) window.setTimeout(() => dismiss(id), ms);
    return id;
  }, [dismiss]);

  const api = useMemo<ToastCtx>(() => ({
    toast, dismiss,
    success: (title, description) => toast({ tone: "success", title, description }),
    error: (title, description) => toast({ tone: "error", title, description }),
    info: (title, description) => toast({ tone: "info", title, description }),
  }), [toast, dismiss]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const Icon = icons[t.tone];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 20, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, scale: 0.96 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                className="pointer-events-auto relative overflow-hidden rounded-xl border border-border-default bg-surface-2 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)]"
              >
                <span className={cn("absolute inset-y-0 left-0 w-0.5", bars[t.tone])} />
                <div className="flex items-start gap-3 p-3.5 pl-4">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", accents[t.tone])} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-text-primary">{t.title}</p>
                    {t.description && (
                      <p className="mt-0.5 break-words text-xs leading-relaxed text-text-muted">{t.description}</p>
                    )}
                    {t.href && (
                      <a
                        href={t.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-hover)] hover:underline"
                      >
                        {t.hrefLabel ?? "View on BscScan"}
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                  <button
                    onClick={() => dismiss(t.id)}
                    aria-label="Dismiss notification"
                    className="grid size-6 shrink-0 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
