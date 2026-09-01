"use client";

import { useMemo, useState } from "react";
import { Gamepad2, Play, Star, Ticket, Users } from "lucide-react";
import { Badge, Button, EmptyState, SegmentedControl, SkeletonCard, PillTabs } from "@/components/ui";
import { RevealGroup, RevealItem } from "@/components/fx";
import { SpotlightCard } from "@/components/fx";
import { useGames } from "@/lib/hooks/use-data";
import { formatCompact, formatNumber } from "@/lib/utils";
import { GameArt } from "../../_components/game-art";

type Entry = "all" | "free" | "paid";

export function PublicGameCatalog() {
  const { data: games, isLoading } = useGames();
  const [entry, setEntry] = useState<Entry>("all");
  const [genre, setGenre] = useState("all");

  const genres = useMemo(
    () => ["all", ...Array.from(new Set(games.map((g) => g.genre)))],
    [games],
  );

  const shown = useMemo(
    () =>
      games.filter((g) => {
        if (genre !== "all" && g.genre !== genre) return false;
        if (entry === "free" && g.entryType === "paid") return false;
        if (entry === "paid" && g.entryType === "free") return false;
        return true;
      }),
    [games, genre, entry],
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillTabs
          value={genre}
          onValueChange={setGenre}
          items={genres.map((g) => ({
            value: g,
            label: g === "all" ? "All genres" : g,
            count: g === "all" ? games.length : games.filter((x) => x.genre === g).length,
          }))}
        />
        <SegmentedControl
          value={entry}
          onValueChange={setEntry}
          size="sm"
          options={[
            { value: "all", label: "All" },
            { value: "free", label: "Free entry" },
            { value: "paid", label: "Paid events" },
          ]}
        />
      </div>

      {isLoading ? (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} className="h-72" />)}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          className="mt-8 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1"
          icon={<Gamepad2 />}
          title="No games match those filters"
          description="Try clearing the entry-type filter or picking a different genre."
        />
      ) : (
        <RevealGroup className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((g) => (
            <RevealItem key={g.id}>
              <SpotlightCard className="group h-full overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 transition-colors duration-300 hover:border-[color-mix(in_oklab,var(--accent)_38%,var(--border-default))]">
                <div className="relative">
                  <GameArt hue={g.thumbnailHue} slug={g.slug} title={g.title} />
                  <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                    {g.entryType !== "paid" && <Badge tone="good" dot>Free entry</Badge>}
                    {g.entryType !== "free" && (
                      <Badge tone="brand" icon={<Ticket className="size-3" />}>
                        Paid events
                      </Badge>
                    )}
                  </div>
                  {!g.active && (
                    <div className="absolute inset-0 grid place-items-center bg-surface-0/70 backdrop-blur-sm">
                      <Badge tone="neutral">Coming soon</Badge>
                    </div>
                  )}
                </div>

                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-base font-semibold text-text-primary">{g.title}</h3>
                      <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-text-muted">{g.genre}</p>
                    </div>
                    {/* Hidden when unrated: see the note in game-card.tsx. */}
                    {g.rating > 0 && (
                      <span className="tnum inline-flex shrink-0 items-center gap-1 rounded-lg bg-surface-3 px-2 py-1 text-xs font-semibold text-text-secondary">
                        <Star className="size-3 fill-current text-[var(--accent)]" />
                        {g.rating.toFixed(1)}
                      </span>
                    )}
                  </div>

                  <p className="mt-2.5 line-clamp-2 text-sm leading-relaxed text-text-muted">{g.blurb}</p>

                  <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border-subtle pt-4 text-xs">
                    <div>
                      <dt className="text-text-muted">Points per session</dt>
                      <dd className="tnum mt-0.5 font-semibold text-text-primary">
                        {formatNumber(g.pointsPerSessionMin)}–{formatNumber(g.pointsPerSessionMax)}
                      </dd>
                    </div>
                    <div>
                      <dt className="flex items-center gap-1 text-text-muted">
                        <Users className="size-3" /> Players (30d)
                      </dt>
                      <dd className="tnum mt-0.5 font-semibold text-text-primary">{formatCompact(g.players30d)}</dd>
                    </div>
                  </dl>

                  <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
                    Daily Points cap {formatNumber(g.dailyPointsCap)} per player
                    {g.entryFee ? ` · paid events from ${g.entryFee} MTT` : ""}
                  </p>

                  <div className="mt-4 flex gap-2">
                    <Button
                      href="/signup"
                      size="sm"
                      fullWidth
                      disabled={!g.active}
                      icon={<Play className="size-3.5" />}
                    >
                      Play free
                    </Button>
                  </div>
                </div>
              </SpotlightCard>
            </RevealItem>
          ))}
        </RevealGroup>
      )}
    </div>
  );
}
