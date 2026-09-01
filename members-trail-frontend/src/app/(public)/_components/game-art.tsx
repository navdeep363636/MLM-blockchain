/* Game artwork: a per-title cover drawn over a procedural ground.
 *
 * The ground is still derived from `game.thumbnailHue` — data, not a design
 * decision — so a title added tomorrow with no cover of its own is a coherent
 * tile rather than a broken image. On top of it sits `public/games/<slug>.svg`,
 * which depicts what the title actually plays like: a lit grid for the reflex
 * titles, a well and a stack for the block titles, letter tiles for the word
 * ones. Every cover is vector and a few kilobytes, and each is authored in its
 * own hue so the art and the ground agree.
 *
 * The cover is decorative: the ground already carries the accessible label, so
 * a cover that fails to load costs nothing but the picture. */

import { cn } from "@/lib/utils";

/** Titles with a cover in `public/games`. Anything else falls back to the
 *  monogram, which is why adding a game never ships a broken tile. */
const COVERS = new Set([
  "neon-rush", "cipher-break", "turbo-drift", "block-forge",
  "sky-siege", "word-vault", "hex-tactics", "pulse-beat",
]);

function monogram(title: string) {
  const parts = title.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return title.slice(0, 2).toUpperCase();
}

export function GameArt({
  hue, title, slug, className, ratio = "aspect-[16/10]", compact, monogramClass,
}: {
  hue: number;
  title: string;
  /** Selects the cover. Omitted, or unknown, and the monogram is used. */
  slug?: string;
  className?: string;
  ratio?: string;
  compact?: boolean;
  monogramClass?: string;
}) {
  const cover = slug && COVERS.has(slug) ? `/games/${slug}.svg` : null;
  const h2 = (hue + 46) % 360;
  const h3 = (hue + 312) % 360;

  return (
    <div
      className={cn("relative w-full overflow-hidden", ratio, className)}
      style={{
        backgroundColor: `hsl(${hue} 34% 9%)`,
        backgroundImage: [
          `radial-gradient(115% 105% at 12% 6%, hsl(${hue} 92% 60% / 0.85), transparent 58%)`,
          `radial-gradient(95% 95% at 88% 92%, hsl(${h2} 88% 48% / 0.8), transparent 55%)`,
          `radial-gradient(70% 70% at 60% 30%, hsl(${h3} 90% 55% / 0.32), transparent 62%)`,
          `linear-gradient(155deg, hsl(${hue} 45% 14%), hsl(${h2} 50% 7%))`,
        ].join(", "),
      }}
      role="img"
      aria-label={`${title} — generated cover art`}
    >
      {/* structural overlay: thin rings + grid, all derived from the same hue */}
      <span
        aria-hidden
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            `repeating-linear-gradient(115deg, hsl(0 0% 100% / 0.055) 0 1px, transparent 1px 14px)`,
        }}
      />
      <span
        aria-hidden
        className="absolute -right-10 -top-12 size-40 rounded-full border"
        style={{ borderColor: `hsl(0 0% 100% / 0.16)` }}
      />
      <span
        aria-hidden
        className="absolute -bottom-16 -left-8 size-44 rounded-full border"
        style={{ borderColor: `hsl(0 0% 100% / 0.12)` }}
      />
      {cover ? (
        /* eslint-disable-next-line @next/next/no-img-element -- a static, known-size
           SVG in /public: next/image would add a loader and a layout wrapper to
           something that is already one request and infinitely scalable. */
        <img
          src={cover}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 grid place-items-center font-display font-semibold tracking-tight",
            compact ? "text-3xl" : "text-5xl sm:text-6xl",
            monogramClass,
          )}
          style={{ color: "hsl(0 0% 100% / 0.9)", textShadow: "0 6px 24px hsl(0 0% 0% / 0.45)" }}
        >
          {monogram(title)}
        </span>
      )}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{ backgroundImage: "linear-gradient(to top, hsl(0 0% 0% / 0.55), transparent)" }}
      />
    </div>
  );
}

/** Small square chip version — used in marquees and list rows. */
export function GameChip({ hue, title, slug }: { hue: number; title: string; slug?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5 rounded-full border border-border-subtle bg-surface-1 py-1.5 pl-1.5 pr-4 [box-shadow:var(--shadow-e1),inset_0_1px_0_0_var(--rim-light)]">
      <GameArt hue={hue} title={title} slug={slug} ratio="size-7" className="rounded-full" compact monogramClass="text-[9px]" />
      <span className="whitespace-nowrap text-sm font-medium text-text-secondary">{title}</span>
    </span>
  );
}
