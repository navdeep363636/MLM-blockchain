"use client";

/* G-01 · Game lobby / catalog — FRD 5.4
 *
 * The authenticated lobby differs from the public catalogue in one important
 * way: it shows the player's own remaining daily Points cap per game, and it
 * states plainly that free mode is never throttled to push paid entry. */

import { useMemo, useState } from "react";
import {
  BookOpen, Gamepad2, Play, Scale, ShieldCheck, Sparkles, Ticket, Trophy,
} from "lucide-react";
import {
  Badge, Button, Callout, CapMeter, DetailRow, EmptyState, Modal, PillTabs, SearchInput,
  SegmentedControl, Select, SkeletonCard,
} from "@/components/ui";
import { Reveal, RevealGroup, RevealItem } from "@/components/fx";
import { useBalances, useGames, useTournaments } from "@/lib/hooks/use-data";
import type { Game } from "@/types";
import { formatCompact, formatNumber, formatToken } from "@/lib/utils";
import { GameCard } from "../../_components/game-card";
import { dailyCapRemaining, dailyCapUsed, issuanceCap } from "../../_components/derive";
import { WidgetStat } from "../../_components/widget-card";

type Entry = "all" | "free" | "paid";
type Sort = "popularity" | "potential" | "rating" | "name" | "cap";

const SORTS: { value: Sort; label: string }[] = [
  { value: "popularity", label: "Most played (30 days)" },
  { value: "potential", label: "Highest Points per session" },
  { value: "rating", label: "Highest rated" },
  { value: "cap", label: "Most daily cap remaining" },
  { value: "name", label: "Title A–Z" },
];

function RulesModal({
  game, open, onClose,
}: {
  game: Game | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: tournaments } = useTournaments();
  if (!game) return null;

  const used = dailyCapUsed(game);
  const events = tournaments.filter((t) => t.gameId === game.id);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`${game.title} — rules & scoring`}
      description={`${game.genre} · skill-based scoring, no chance element`}
      icon={<BookOpen className="size-5" />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button href={`/app/games/play?game=${game.slug}`} icon={<Play className="size-4" />}>
            Play free now
          </Button>
        </>
      }
    >
      <div className="space-y-5 text-sm">
        <p className="leading-relaxed text-text-secondary">{game.blurb}</p>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">How scoring works</h4>
          <ul className="mt-2 space-y-1.5 leading-relaxed text-text-secondary">
            <li>
              Your session score is produced by the game engine and signed server-side. Points are
              derived from that verified score — a client-submitted score is never trusted on its own.
            </li>
            <li>
              A completed session credits between{" "}
              <span className="tnum font-semibold text-text-primary">
                {formatNumber(game.pointsPerSessionMin)}
              </span>{" "}
              and{" "}
              <span className="tnum font-semibold text-text-primary">
                {formatNumber(game.pointsPerSessionMax)}
              </span>{" "}
              Points, scaled by score, accuracy and completion.
            </li>
            <li>
              Abandoned or disconnected sessions credit nothing: validation requires a signed result
              from the server, not a score from your browser.
            </li>
            <li>
              Suspected automation voids the session and is reviewed by the fraud engine before any
              credit is written.
            </li>
          </ul>
        </div>

        <div className="rounded-xl border border-border-subtle bg-surface-inset p-4">
          <CapMeter
            used={used}
            cap={game.dailyPointsCap}
            label={`Your daily Points cap on ${game.title}`}
          />
          <p className="mt-2 text-xs leading-relaxed text-text-muted">
            {formatNumber(dailyCapRemaining(game))} Points still creditable today. The cap resets at
            00:00 UTC and is identical in free and paid modes — paying an entry fee never raises it.
          </p>
        </div>

        <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
          <DetailRow label="Genre" value={game.genre} />
          <DetailRow
            label="Entry options"
            value={
              game.entryType === "free"
                ? "Free mode only"
                : `Free mode + paid events${game.entryFee ? ` from ${formatToken(game.entryFee, 0)} MTT` : ""}`
            }
          />
          <DetailRow label="Players (30 days)" value={<span className="tnum">{formatCompact(game.players30d)}</span>} />
          <DetailRow label="Player rating" value={<span className="tnum">{game.rating.toFixed(1)} / 5.0</span>} />
          <DetailRow
            label="Daily Points cap"
            value={<span className="tnum">{formatNumber(game.dailyPointsCap)} Points</span>}
            hint="Per player, per day, across every mode of this game."
          />
          <DetailRow
            label="Status"
            value={game.active ? "Live" : "Temporarily in maintenance"}
          />
        </div>

        {events.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Paid events on this title
            </h4>
            <ul className="mt-2 space-y-2">
              {events.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-surface-inset px-3 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text-primary">{t.name}</span>
                    <span className="block text-xs text-text-muted">{t.format}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone={t.entryFee === 0 ? "good" : "brand"}>
                      {t.entryFee === 0 ? "Free entry" : `${formatToken(t.entryFee, 0)} MTT entry`}
                    </Badge>
                    <Button href="/app/games/tournaments" size="xs" variant="outline">
                      Details
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              Entry fees are a real revenue event: they flow into the Revenue Treasury, which is the
              only pot that funds staking rewards and referral commission. The full prize split is
              disclosed before you pay.
            </p>
          </div>
        )}

        <Callout tone="info" title="Skill, not chance" icon={<Scale />}>
          <p className="mt-1">
            Outcomes here are determined by player skill. There is no random prize draw, no wagering
            mechanic, and no way to buy a better score — purchases only ever buy cosmetics, passes or
            event entry.
          </p>
        </Callout>
      </div>
    </Modal>
  );
}

export function GameLobby() {
  const { data: games, isLoading } = useGames();
  const { data: balances } = useBalances();
  const [genre, setGenre] = useState("all");
  const [entry, setEntry] = useState<Entry>("all");
  const [sort, setSort] = useState<Sort>("popularity");
  const [query, setQuery] = useState("");
  const [rulesFor, setRulesFor] = useState<Game | null>(null);

  const genres = useMemo(
    () => ["all", ...Array.from(new Set(games.map((g) => g.genre))).sort()],
    [games],
  );

  /* Offering "Highest rated" when no title carries a rating is a sort that
     silently does nothing - the reader picks it, the grid does not move, and the
     filter looks broken. It appears once ratings exist. */
  const sorts = useMemo(
    () => (games.some((g) => g.rating > 0) ? SORTS : SORTS.filter((s) => s.value !== "rating")),
    [games],
  );

  const shown = useMemo(() => {
    const filtered = games.filter((g) => {
      if (genre !== "all" && g.genre !== genre) return false;
      if (entry === "free" && g.entryType === "paid") return false;
      if (entry === "paid" && g.entryType === "free") return false;
      if (query && !`${g.title} ${g.genre} ${g.blurb}`.toLowerCase().includes(query.toLowerCase())) {
        return false;
      }
      return true;
    });

    const sorted = [...filtered];
    switch (sort) {
      case "popularity":
        sorted.sort((a, b) => b.players30d - a.players30d);
        break;
      case "potential":
        sorted.sort((a, b) => b.pointsPerSessionMax - a.pointsPerSessionMax);
        break;
      case "rating":
        sorted.sort((a, b) => b.rating - a.rating);
        break;
      case "cap":
        sorted.sort((a, b) => dailyCapRemaining(b) - dailyCapRemaining(a));
        break;
      case "name":
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
    }
    return sorted;
  }, [games, genre, entry, sort, query]);

  const cap = issuanceCap(games);
  const freeCount = games.filter((g) => g.entryType !== "paid").length;

  return (
    <div className="space-y-6">
      <Reveal>
        <Callout tone="good" title="Free play always earns — and is never throttled" icon={<ShieldCheck />}>
          <p className="mt-1">
            {freeCount} of {games.length} titles are playable at no cost, and free-mode Points earning
            is never slowed, degraded or capped lower than paid entry to nudge you into spending. Paid
            events buy access to a prize pool funded by entry fees; they do not buy a higher earn rate,
            a higher daily cap or a better score.
          </p>
        </Callout>
      </Reveal>

      <Reveal delay={0.05}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <WidgetStat
            label="Points balance"
            value={formatNumber(balances.points)}
            sub={`+${formatNumber(balances.pointsToday)} earned today`}
            tone="brand"
          />
          <WidgetStat
            label="Daily issuance headroom"
            value={formatNumber(Math.max(0, cap - balances.pointsToday))}
            sub={`of ${formatNumber(cap)} Points across all live games`}
          />
          <WidgetStat
            label="Titles available"
            value={`${games.filter((g) => g.active).length}`}
            sub={`${freeCount} playable free`}
          />
          <WidgetStat
            label="Free-mode earning"
            value="Unthrottled"
            sub="identical rate to paid modes"
            tone="good"
          />
        </div>
      </Reveal>

      <div className="space-y-3">
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
          <SegmentedControl<Entry>
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

        <div className="flex flex-wrap items-center gap-3">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search titles, genres or mechanics…"
            className="min-w-56 flex-1"
          />
          <Select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            options={sorts}
            className="w-full sm:w-64"
            aria-label="Sort games"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} className="h-96" />)}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1"
          icon={<Gamepad2 />}
          title="No games match those filters"
          description="Clear the entry-type filter, pick another genre, or search for a different title."
          action={{
            label: "Reset filters",
            onClick: () => {
              setGenre("all");
              setEntry("all");
              setQuery("");
            },
          }}
        />
      ) : (
        <RevealGroup className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((game) => (
            <RevealItem key={game.id}>
              <GameCard game={game} onViewRules={setRulesFor} />
            </RevealItem>
          ))}
        </RevealGroup>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Callout tone="brand" title="Want a prize pool instead?" icon={<Trophy />}>
          <p className="mt-1">
            Tournaments are the paid side of the lobby. Every entry fee, the full prize split and the
            format are disclosed before you pay, and the fee is booked as platform revenue rather than
            redistributed from other players&apos; deposits.
          </p>
          <Button className="mt-3" href="/app/games/tournaments" size="xs" variant="outline" icon={<Ticket className="size-3.5" />}>
            Open the tournament hub
          </Button>
        </Callout>

        <Callout tone="neutral" title="Where your Points go next" icon={<Sparkles />}>
          <p className="mt-1">
            Points are an off-chain loyalty balance. They convert to MTT at the published rate once
            Tier 1 KYC is complete, subject to a daily conversion cap that is shown on the conversion
            screen before you commit.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button href="/app/wallet/convert" size="xs" variant="outline">Convert Points</Button>
            <Button href="/app/games/points-history" size="xs" variant="ghost">Points history</Button>
          </div>
        </Callout>
      </div>

      <RulesModal game={rulesFor} open={!!rulesFor} onClose={() => setRulesFor(null)} />
    </div>
  );
}
