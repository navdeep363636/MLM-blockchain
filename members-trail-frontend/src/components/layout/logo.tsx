import Link from "next/link";
import { cn } from "@/lib/utils";

/** Wordmark + glyph. The glyph is an ascending "trail" of three bars. */
export function Logo({ className, href = "/", compact }: { className?: string; href?: string; compact?: boolean }) {
  return (
    <Link href={href} className={cn("group inline-flex shrink-0 items-center gap-2.5", className)} aria-label="Members Trail home">
      <span className="relative grid size-9 place-items-center overflow-hidden rounded-xl bg-[linear-gradient(140deg,var(--color-brand-400),var(--color-brand-700))] shadow-[0_4px_14px_-4px_var(--accent-ring)]">
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
          <g fill="#fff">
            <rect x="3" y="14" width="4" height="7" rx="1.4" opacity="0.72" />
            <rect x="10" y="9" width="4" height="12" rx="1.4" opacity="0.88" />
            <rect x="17" y="3" width="4" height="18" rx="1.4" />
          </g>
        </svg>
        <span className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(100deg,transparent,rgba(255,255,255,0.35),transparent)] transition-transform duration-700 group-hover:translate-x-full" />
      </span>
      {!compact && (
        <span className="font-display text-[0.98rem] font-semibold leading-none tracking-tight text-text-primary">
          Members<span className="text-[var(--accent)]">Trail</span>
        </span>
      )}
    </Link>
  );
}
