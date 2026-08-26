"use client";

/* Featured-games rail on the landing page. Pulled from the Games Catalog hook
 * (P-01: "Featured games carousel — dynamic, pulled from Games Catalog"). */

import Link from "next/link";
import { ArrowRight, Star, Users } from "lucide-react";
import { Badge, Button, SkeletonCard } from "@/components/ui";
import { HoloCard, RevealGroup, RevealItem } from "@/components/fx";
import { useGames } from "@/lib/hooks/use-data";
import { formatCompact, formatNumber } from "@/lib/utils";
import { GameArt } from "./game-art";

export function FeaturedGames() {
  const { data: games, isLoading } = useGames();
  const featured = games.filter((g) => g.active).slice(0, 6);

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} className="h-64" />)}
      </div>
    );
  }

  return (
    <>
      {/* Horizontal snap rail on mobile, grid from md up — the "carousel" affordance. */}
      <RevealGroup
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-3"
        stagger={0.06}
      >
        {featured.map((g) => (
          <RevealItem key={g.id} className="w-[17rem] shrink-0 snap-start md:w-auto">
            <HoloCard max={6} lift={26} className="h-full rounded-[var(--radius-card)]">
              <article
                className="group flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1
                           [box-shadow:var(--shadow-e2),inset_0_1px_0_0_var(--rim-light)]
                           transition-[border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-tide)]
                           hover:border-[color-mix(in_oklab,var(--accent)_38%,var(--border-default))]
                           hover:[box-shadow:var(--shadow-e4),inset_0_1px_0_0_var(--rim-light-strong)]"
              >
                {/* The cover art zooms very slightly inside its own clip on
                    hover. It is the one "media" element on these cards, and
                    scaling it rather than the card keeps the text crisp — a
                    scaled card resamples its own type. */}
                <div className="overflow-hidden">
                  <GameArt
                    hue={g.thumbnailHue}
                    title={g.title}
                    className="transition-transform duration-[var(--dur-cinema)] ease-[var(--ease-tide)] group-hover:scale-[1.06] motion-reduce:transform-none"
                  />
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-text-primary">{g.title}</h3>
                    <Badge tone="neutral">{g.genre}</Badge>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-muted">{g.blurb}</p>

                  <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border-subtle pt-3 text-xs">
                    <div>
                      <dt className="text-text-muted">Points / session</dt>
                      <dd className="tnum mt-0.5 font-semibold text-text-primary">
                        {formatNumber(g.pointsPerSessionMin)}–{formatNumber(g.pointsPerSessionMax)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">Entry</dt>
                      <dd className="mt-0.5 font-semibold text-text-primary">
                        {g.entryType === "free" ? "Free" : g.entryType === "paid" ? "Paid" : "Free + paid"}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-4 flex items-center justify-between gap-2 text-xs text-text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Star className="size-3.5 text-[var(--accent)]" aria-hidden />
                      <span className="tnum">{g.rating.toFixed(1)}</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" aria-hidden />
                      <span className="tnum">{formatCompact(g.players30d)}</span> players / 30d
                    </span>
                  </div>
                </div>
              </article>
            </HoloCard>
          </RevealItem>
        ))}
      </RevealGroup>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button href="/games" variant="outline" iconRight={<ArrowRight className="size-4" />}>
          Browse the full catalog
        </Button>
        <p className="text-xs text-text-muted">
          Points ranges are per scored session and vary with performance and{" "}
          <Link href="/how-it-works#caps" className="link-slide text-[var(--accent-hover)]">
            daily caps
          </Link>
          . They are not an earnings estimate.
        </p>
      </div>
    </>
  );
}
