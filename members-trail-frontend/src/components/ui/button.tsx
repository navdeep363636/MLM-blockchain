"use client";

import { forwardRef } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "success" | "glass";
type Size = "xs" | "sm" | "md" | "lg" | "icon";

/* ============================================================================
 * Variants.
 *
 * Every filled variant carries three things beyond its fill colour:
 *   · an inset top hairline  — the lit edge of a physical key
 *   · a coloured drop shadow — the fill's own hue, so the button appears to
 *                              glow onto the surface below rather than to sit
 *                              on a grey shadow that fights the brand
 *   · a press state that translates on Z, INTO the page
 *
 * The shadow colour is derived from the fill with color-mix, so a variant only
 * ever declares its colour once.
 * ========================================================================== */
const variants: Record<Variant, string> = {
  primary:
    "bg-[linear-gradient(180deg,var(--accent-hover),var(--accent)_58%,var(--accent-press))] text-white " +
    "[box-shadow:inset_0_1px_0_0_rgb(255_255_255_/_0.28),inset_0_-1px_0_0_rgb(0_0_0_/_0.18),0_8px_24px_-10px_color-mix(in_oklab,var(--accent)_70%,transparent),var(--shadow-e2)] " +
    "hover:[box-shadow:inset_0_1px_0_0_rgb(255_255_255_/_0.34),0_14px_34px_-10px_color-mix(in_oklab,var(--accent)_80%,transparent),var(--shadow-e3)]",
  secondary:
    "bg-[linear-gradient(180deg,var(--surface-3),color-mix(in_oklab,var(--surface-3)_82%,var(--surface-inset)))] text-text-primary " +
    "ring-1 ring-border-default [box-shadow:inset_0_1px_0_0_var(--rim-light),var(--shadow-e1)] " +
    "hover:ring-border-strong hover:[box-shadow:inset_0_1px_0_0_var(--rim-light-strong),var(--shadow-e2)]",
  outline:
    "bg-transparent text-text-primary ring-1 ring-border-strong " +
    "hover:bg-surface-2 hover:ring-[var(--accent)] hover:[box-shadow:0_0_0_1px_var(--accent-ring),var(--shadow-e2)]",
  ghost: "bg-transparent text-text-secondary hover:bg-surface-2 hover:text-text-primary",
  danger:
    "bg-[linear-gradient(180deg,var(--color-critical-400),var(--color-critical-500))] text-white " +
    "[box-shadow:inset_0_1px_0_0_rgb(255_255_255_/_0.26),0_8px_24px_-10px_color-mix(in_oklab,var(--color-critical-500)_65%,transparent)] " +
    "hover:brightness-110",
  success:
    "bg-[linear-gradient(180deg,var(--color-good-400),var(--color-good-500))] text-white " +
    "[box-shadow:inset_0_1px_0_0_rgb(255_255_255_/_0.26),0_8px_24px_-10px_color-mix(in_oklab,var(--color-good-500)_65%,transparent)] " +
    "hover:brightness-110",
  glass:
    "glass-1 text-text-primary ring-1 ring-border-default hover:ring-[var(--accent)] " +
    "hover:[box-shadow:inset_0_1px_0_0_var(--rim-light-strong),var(--shadow-e3)]",
};

const sizes: Record<Size, string> = {
  xs: "h-7 px-2.5 text-xs gap-1.5 rounded-lg",
  sm: "h-9 px-3.5 text-sm gap-1.5 rounded-lg",
  md: "h-11 px-5 text-sm gap-2 rounded-xl",
  lg: "h-13 px-7 text-base gap-2.5 rounded-2xl",
  icon: "h-10 w-10 rounded-xl",
};

const base =
  "group/btn relative inline-flex select-none items-center justify-center overflow-hidden font-medium " +
  "transition-[background-color,box-shadow,transform,color,filter] duration-[var(--dur-quick)] ease-[var(--ease-tide)] " +
  /* Press goes INTO the page. On a button with a coloured shadow this reads as
     the key being depressed, where a plain scale reads as the whole thing
     shrinking. */
  "active:translate-y-px active:scale-[0.985] " +
  "disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

/**
 * Sheen that sweeps across on hover — the platform's signature button effect.
 *
 * `before` rather than a wrapper element, so it costs no DOM and inherits the
 * border radius. Hidden under reduced motion.
 */
const sheen =
  "before:pointer-events-none before:absolute before:inset-0 before:-translate-x-full " +
  "before:bg-[linear-gradient(100deg,transparent,rgba(255,255,255,0.24),transparent)] " +
  "before:transition-transform before:duration-700 before:ease-[var(--ease-tide)] " +
  "hover:before:translate-x-full motion-reduce:before:hidden";

/**
 * A faint highlight that stays on the top half of a filled button, giving it a
 * curved face. Applied to the same variants as the sheen.
 */
const face =
  "after:pointer-events-none after:absolute after:inset-x-0 after:top-0 after:h-1/2 " +
  "after:bg-[linear-gradient(180deg,rgb(255_255_255_/_0.14),transparent)] after:opacity-70";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  /** Renders an <a>/Link instead of a <button>. */
  href?: string;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className, variant = "primary", size = "md", loading, icon, iconRight,
    href, fullWidth, children, disabled, ...props
  },
  ref,
) {
  const classes = cn(
    base, variants[variant], sizes[size],
    (variant === "primary" || variant === "danger" || variant === "success") && cn(sheen, face),
    fullWidth && "w-full",
    className,
  );

  const content = (
    <>
      {loading ? <Loader2 className="size-4 shrink-0 animate-spin" /> : icon}
      {children != null && <span className="relative truncate">{children}</span>}
      {!loading && iconRight}
    </>
  );

  if (href && !disabled && !loading) {
    const external = /^https?:\/\//.test(href);
    if (external) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>
          {content}
        </a>
      );
    }
    return <Link href={href} className={classes}>{content}</Link>;
  }

  return (
    <button ref={ref} className={classes} disabled={disabled || loading} {...props}>
      {content}
    </button>
  );
});

/** Icon-only button with an accessible label. */
export function IconButton({
  label, className, variant = "ghost", ...props
}: Omit<ButtonProps, "size" | "children"> & { label: string }) {
  return (
    <Button
      variant={variant}
      size="icon"
      aria-label={label}
      title={label}
      className={cn("shrink-0", className)}
      {...props}
    />
  );
}
