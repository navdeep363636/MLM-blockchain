"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

function useLockScroll(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);
}

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  /** Hide the close affordance for flows the user must resolve (e.g. tx pending). */
  hideClose?: boolean;
  icon?: React.ReactNode;
}

const widths = {
  sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl", "2xl": "max-w-6xl",
} as const;

export function Modal({
  open, onClose, title, description, children, footer, size = "md", hideClose, icon,
}: ModalProps) {
  useLockScroll(open);
  useEscape(open, onClose);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="scene fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={hideClose ? undefined : onClose}
            className="absolute inset-0 bg-[radial-gradient(120%_100%_at_50%_0%,rgb(0_0_0_/_0.55),rgb(0_0_0_/_0.82))] backdrop-blur-md"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === "string" ? title : "Dialog"}
            /* Arrives by rotating up from below the viewer's eye line and
               settling — it reads as a card being placed on the page, where a
               pure scale reads as a popup. */
            initial={{ opacity: 0, y: 28, rotateX: 9, translateZ: -120 }}
            animate={{ opacity: 1, y: 0, rotateX: 0, translateZ: 0 }}
            exit={{ opacity: 0, y: 14, rotateX: 5, translateZ: -60 }}
            transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
            className={cn(
              "relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[var(--radius-panel)] sm:rounded-[var(--radius-panel)]",
              "border border-border-default bg-surface-raised",
              "[box-shadow:var(--shadow-e5),inset_0_1px_0_0_var(--rim-light-strong)]",
              widths[size],
            )}
          >
            {/* accent hairline at the top edge */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--accent),transparent)] opacity-70"
            />
            {/* A wide, very faint accent glow behind the top edge. It is what
                makes the dialog look lit from above rather than pasted on. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,var(--accent-soft),transparent)] opacity-60"
            />

            {(title || !hideClose) && (
              <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
                <div className="flex min-w-0 items-start gap-3">
                  {icon && (
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]">
                      {icon}
                    </span>
                  )}
                  <div className="min-w-0">
                    {title && <h2 className="text-base font-semibold text-text-primary">{title}</h2>}
                    {description && <p className="mt-0.5 text-sm text-text-muted">{description}</p>}
                  </div>
                </div>
                {!hideClose && (
                  <button
                    onClick={onClose}
                    aria-label="Close dialog"
                    className="-mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            )}

            {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}

            {footer && (
              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border-subtle bg-surface-inset/50 px-5 py-4">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Right-side drawer — used for admin detail panels and mobile nav. */
export function Drawer({
  open, onClose, title, children, footer, side = "right", width = "max-w-xl",
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  side?: "right" | "left";
  width?: string;
}) {
  useLockScroll(open);
  useEscape(open, onClose);
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100]">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }} onClick={onClose}
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            initial={{ x: side === "right" ? "100%" : "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: side === "right" ? "100%" : "-100%" }}
            transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "absolute inset-y-0 flex w-full flex-col border-border-default bg-surface-1",
              side === "right" ? "right-0 border-l" : "left-0 border-r",
              width,
            )}
          >
            <div className="flex items-center justify-between gap-4 border-b border-border-subtle px-5 py-4">
              {title && <h2 className="text-base font-semibold text-text-primary">{title}</h2>}
              <button
                onClick={onClose}
                aria-label="Close panel"
                className="grid size-8 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && (
              <div className="flex items-center justify-end gap-3 border-t border-border-subtle px-5 py-4">
                {footer}
              </div>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, children, confirmLabel = "Confirm",
  cancelLabel = "Cancel", tone = "primary", loading, requireAcknowledge,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string
  tone?: "primary" | "danger";
  loading?: boolean;
  requireAcknowledge?: React.ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      icon={tone === "danger" ? <AlertTriangle className="size-5" /> : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>{cancelLabel}</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-text-secondary">
        {children}
        {requireAcknowledge}
      </div>
    </Modal>
  );
}
