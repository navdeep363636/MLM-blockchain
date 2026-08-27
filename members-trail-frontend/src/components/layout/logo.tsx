import Link from "next/link";
import { cn } from "@/lib/utils";

/** Wordmark + glyph. The glyph is an ascending "trail" of three bars. */
export function Logo({ className, href = "/", compact }: { className?: string; href?: string; compact?: boolean }) {
  return (
    <Link href={href} className={cn("group inline-flex shrink-0 items-center gap-2.5", className)} aria-label="Members Trail home">
      {/* The glyph is the smallest place the depth language appears, and the
          one seen most often. Two inset lines and a coloured shadow; the tilt
          on hover is 6° about X and Y, which at 36px is felt rather than seen. */}
      <span
        className="relative grid size-9 place-items-center overflow-hidden rounded-xl
                   bg-[linear-gradient(150deg,var(--color-brand-300),var(--accent)_42%,var(--color-brand-700))]
                   [box-shadow:inset_0_1px_1px_rgb(255_255_255_/_0.45),inset_0_-2px_3px_rgb(0_0_0_/_0.25),0_6px_18px_-6px_color-mix(in_oklab,var(--accent)_75%,transparent)]
                   transition-transform duration-[var(--dur-base)] ease-[var(--ease-tide)]
                   group-hover:[transform:perspective(240px)_rotateX(6deg)_rotateY(-6deg)_scale(1.04)]
                   motion-reduce:group-hover:transform-none"
      >
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
