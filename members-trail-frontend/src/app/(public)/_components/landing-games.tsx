"use client";

/* Featured-games rail on the landing page. Pulled from the Games Catalog hook
 * (P-01: "Featured games carousel — dynamic, pulled from Games Catalog"). */

import Link from "next/link";
import { ArrowRight, Star, Users } from "lucide-react";
import { Badge, Button, SkeletonCard } from "@/components/ui";
import { RevealGroup, RevealItem, TiltCard } from "@/components/fx";
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
            <TiltCard max={6} className="h-full">
              <article className="flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 transition-colors hover:border-[color-mix(in_oklab,var(--accent)_38%,var(--border-default))]">
                <GameArt hue={g.thumbnailHue} title={g.title} />
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
            </TiltCard>
          </RevealItem>
        ))}
      </RevealGroup>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button href="/games" variant="outline" iconRight={<ArrowRight className="size-4" />}>
          Browse the full catalog
        </Button>
        <p className="text-xs text-text-muted">
          Points ranges are per scored session and vary with performance and{" "}
          <Link href="/how-it-works#caps" className="text-[var(--accent-hover)] underline underline-offset-2">
            daily caps
          </Link>
          . They are not an earnings estimate.
        </p>
      </div>
    </>
  );
}
