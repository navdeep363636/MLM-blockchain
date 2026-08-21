"use client";

import { forwardRef } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "success" | "glass";
type Size = "xs" | "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-[var(--accent)] text-white shadow-[0_1px_0_0_rgba(255,255,255,0.18)_inset,0_6px_20px_-8px_var(--accent-ring)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-press)]",
  secondary:
    "bg-surface-3 text-text-primary ring-1 ring-border-default hover:bg-[color-mix(in_oklab,var(--surface-3)_80%,var(--accent)_8%)] hover:ring-border-strong",
  outline:
    "bg-transparent text-text-primary ring-1 ring-border-strong hover:bg-surface-2 hover:ring-[var(--accent)]",
  ghost: "bg-transparent text-text-secondary hover:bg-surface-2 hover:text-text-primary",
  danger: "bg-critical-500 text-white hover:bg-critical-400",
  success: "bg-good-500 text-white hover:bg-good-400",
  glass: "glass text-text-primary ring-1 ring-border-default hover:ring-[var(--accent)]",
};

const sizes: Record<Size, string> = {
  xs: "h-7 px-2.5 text-xs gap-1.5 rounded-lg",
  sm: "h-9 px-3.5 text-sm gap-1.5 rounded-lg",
  md: "h-11 px-5 text-sm gap-2 rounded-xl",
  lg: "h-13 px-7 text-base gap-2.5 rounded-xl",
  icon: "h-10 w-10 rounded-xl",
};

const base =
  "relative inline-flex select-none items-center justify-center overflow-hidden font-medium " +
  "transition-[background-color,box-shadow,transform,color] duration-200 ease-[var(--ease-out-expo)] " +
  "active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

/** Sheen that sweeps across on hover — the platform's signature button effect. */
const sheen =
  "before:pointer-events-none before:absolute before:inset-0 before:-translate-x-full " +
  "before:bg-[linear-gradient(100deg,transparent,rgba(255,255,255,0.22),transparent)] " +
  "before:transition-transform before:duration-700 before:ease-[var(--ease-out-expo)] " +
  "hover:before:translate-x-full motion-reduce:before:hidden";

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
    (variant === "primary" || variant === "danger" || variant === "success") && sheen,
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
