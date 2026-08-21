"use client";

import { cn, seeded } from "@/lib/utils";

const SERIES = [
  "var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)",
  "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)",
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function Avatar({
  name, src, size = "md", className, ring,
}: {
  name: string;
  src?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  ring?: boolean;
}) {
  const sizes = {
    xs: "size-6 text-[10px]", sm: "size-8 text-xs", md: "size-10 text-sm",
    lg: "size-14 text-base", xl: "size-20 text-xl",
  } as const;

  // Deterministic colour from the name — stable across SSR and client.
  const idx = Math.floor(seeded(name)() * SERIES.length);

  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white select-none",
        sizes[size],
        ring && "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--surface-1)]",
        className,
      )}
      style={src ? undefined : { background: `linear-gradient(140deg, ${SERIES[idx]}, color-mix(in oklab, ${SERIES[idx]} 55%, #000))` }}
      aria-label={name}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="size-full object-cover" />
      ) : (
        initials(name) || "?"
      )}
    </span>
  );
}

export function AvatarStack({ names, max = 4, size = "sm" }: { names: string[]; max?: number; size?: "xs" | "sm" }) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((n, i) => (
        <Avatar
          key={n + i}
          name={n}
          size={size}
          className="-ml-2 ring-2 ring-[var(--surface-1)] first:ml-0"
        />
      ))}
      {rest > 0 && (
        <span className="-ml-2 grid size-8 place-items-center rounded-full bg-surface-3 text-[11px] font-semibold text-text-secondary ring-2 ring-[var(--surface-1)]">
          +{rest}
        </span>
      )}
    </div>
  );
}
