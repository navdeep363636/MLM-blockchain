"use client";

/* Two counter-scrolling marquees: the live game catalogue, then the
 * infrastructure the platform actually runs on. */

import { Marquee } from "@/components/fx";
import { useGames } from "@/lib/hooks/use-data";
import { GameChip } from "./game-art";

const STACK = [
  "BNB Smart Chain",
  "BEP-20 · 18 decimals",
  "Fixed supply · not mintable",
  "Non-custodial withdrawals",
  "Revenue Treasury reconciliation",
  "Tiered KYC / AML",
  "Third-party audit in progress",
  "Anti-farming fingerprinting",
  "Published conversion-rate history",
];

export function GameMarquee() {
  const { data: games, isLoading } = useGames();

  return (
    <div className="space-y-4 py-2">
      <Marquee speed={46} className="py-1">
        {isLoading
          ? Array.from({ length: 8 }, (_, i) => (
              <span key={i} className="shimmer h-9 w-36 shrink-0 rounded-full" aria-hidden />
            ))
          : games.map((g) => <GameChip key={g.id} hue={g.thumbnailHue} slug={g.slug} title={g.title} />)}
      </Marquee>

      <Marquee speed={58} reverse className="py-1">
        {STACK.map((s) => (
          <span
            key={s}
            className="whitespace-nowrap rounded-full bg-surface-2 px-4 py-1.5 text-xs font-medium text-text-muted ring-1 ring-inset ring-border-subtle
                       [box-shadow:inset_0_1px_0_0_var(--rim-light)]
                       transition-colors duration-[var(--dur-quick)] hover:text-text-secondary hover:ring-border-strong"
          >
            {s}
          </span>
        ))}
      </Marquee>
    </div>
  );
}
