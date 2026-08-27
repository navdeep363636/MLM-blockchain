"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function Tooltip({
  content, children, side = "top", className,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const pos = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  }[side];

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "absolute z-50 w-max max-w-64 rounded-xl border border-border-default px-2.5 py-1.5",
              "glass-2 [box-shadow:var(--shadow-e4),inset_0_1px_0_0_var(--rim-light)]",
              "text-xs leading-relaxed text-text-secondary",
              pos,
            )}
          >
            {content}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** Small "?" affordance next to a label — used heavily for APR/cap explanations. */
export function InfoHint({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Tooltip content={children} className={className}>
      <button
        type="button"
        aria-label="More information"
        className="grid size-4 place-items-center rounded-full text-text-muted transition-colors hover:text-[var(--accent)]"
      >
        <Info className="size-3.5" />
      </button>
    </Tooltip>
  );
}
