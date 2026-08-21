"use client";

/* GameCard — authenticated game tile. Unlike the public catalogue card this one
 * shows the player's own remaining daily Points cap, because a cap that bites
 * has to be visible at the point of play (FRD G-01 / G-02). */

import { BookOpen, Play, Star, Ticket, Users } from "lucide-react";
import { Badge, Button, CapMeter } from "@/components/ui";
import { SpotlightCard } from "@/components/fx";
import { GameArt } from "@/app/(public)/_components/game-art";
import type { Game } from "@/types";
import { cn, formatCompact, formatNumber, formatToken } from "@/lib/utils";
import { dailyCapRemaining, dailyCapUsed } from "./derive";

export function GameCard({
  game, onViewRules, className,
}: {
  game: Game;
  onViewRules: (game: Game) => void;
  className?: string;
}) {
  const used = dailyCapUsed(game);
  const remaining = dailyCapRemaining(game);
  const capped = remaining === 0;

  return (
    <SpotlightCard
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1",
        "transition-colors duration-300 hover:border-[color-mix(in_oklab,var(--accent)_38%,var(--border-default))]",
        className,
      )}
    >
      <div className="relative">
        <GameArt hue={game.thumbnailHue} title={game.title} />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {game.entryType !== "paid" && <Badge tone="good" dot>Free entry</Badge>}
          {game.entryType !== "free" && (
            <Badge tone="brand" icon={<Ticket className="size-3" />}>
              Paid events{game.entryFee ? ` · ${formatToken(game.entryFee, 0)} MTT` : ""}
            </Badge>
          )}
        </div>
        {!game.active && (
          <div className="absolute inset-0 grid place-items-center bg-surface-0/70 backdrop-blur-sm">
            <Badge tone="neutral">In maintenance</Badge>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-display text-base font-semibold text-text-primary">{game.title}</h3>
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-text-muted">{game.genre}</p>
          </div>
          <span className="tnum inline-flex shrink-0 items-center gap-1 rounded-lg bg-surface-3 px-2 py-1 text-xs font-semibold text-text-secondary">
            <Star className="size-3 fill-current text-[var(--accent)]" />
            {game.rating.toFixed(1)}
          </span>
        </div>

        <p className="mt-2.5 line-clamp-2 text-sm leading-relaxed text-text-muted">{game.blurb}</p>

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border-subtle pt-4 text-xs">
          <div>
            <dt className="text-text-muted">Points per session</dt>
            <dd className="tnum mt-0.5 font-semibold text-text-primary">
              {formatNumber(game.pointsPerSessionMin)}–{formatNumber(game.pointsPerSessionMax)}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-text-muted">
              <Users className="size-3" /> Players (30d)
            </dt>
            <dd className="tnum mt-0.5 font-semibold text-text-primary">{formatCompact(game.players30d)}</dd>
          </div>
        </dl>

        <CapMeter
          className="mt-4"
          used={used}
          cap={game.dailyPointsCap}
          label="Your daily Points cap for this game"
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">
          {capped
            ? "Cap reached for today — you can still play, but this game will not credit further Points until the cap resets."
            : `${formatNumber(remaining)} Points still creditable today. Caps reset at 00:00 UTC and apply to free and paid modes alike.`}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            href={`/app/games/play?game=${game.slug}`}
            size="sm"
            className="flex-1"
            disabled={!game.active}
            icon={<Play className="size-3.5" />}
          >
            Launch
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onViewRules(game)}
            icon={<BookOpen className="size-3.5" />}
          >
            Rules
          </Button>
        </div>
      </div>
    </SpotlightCard>
  );
}
