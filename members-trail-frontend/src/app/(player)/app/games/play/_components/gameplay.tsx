"use client";

/* G-02 · Gameplay screen — FRD 5.4
 *
 * The canvas is a placeholder for the real game client, but every rule around
 * it is real: the score shown here is a local preview, Points are only credited
 * after the server validates the signed session result, and the per-game daily
 * cap is visible the whole time. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity, ArrowLeft, Gamepad2, Gauge, LogOut, Pause, Play, RotateCcw, ShieldCheck, Sparkles,
  Timer, TriangleAlert,
} from "lucide-react";
import {
  Badge, Button, Callout, CapMeter, DetailRow, EmptyState, Modal, SkeletonCard, Select,
} from "@/components/ui";
import { AnimatedCounter, LiveDot, Reveal, motion } from "@/components/fx";
import { GameArt } from "@/app/(public)/_components/game-art";
import { useBalances, useGames } from "@/lib/hooks/use-data";
import type { Game } from "@/types";
import { clamp, cn, formatDuration, formatNumber, formatToken } from "@/lib/utils";
import { dailyCapRemaining, dailyCapUsed, draw } from "../../../_components/derive";
import { WidgetCard, WidgetStat } from "../../../_components/widget-card";

type Phase = "ready" | "playing" | "paused" | "ended";

/** Deterministic per-title scoring pace — same on the server and the client. */
function pace(game: Game) {
  const perTick = 30 + Math.round(draw(`tick:${game.slug}`) * 45);
  return { perTick, targetScore: perTick * 90 };
}

function scoreAt(game: Game, ticks: number) {
  const { perTick } = pace(game);
  let total = 0;
  for (let i = 0; i < ticks; i++) total += perTick + ((i * 7) % 13);
  return total;
}

function pointsFor(game: Game, score: number, capRemaining: number) {
  const { targetScore } = pace(game);
  const ratio = clamp(score / targetScore, 0, 1);
  const raw = Math.round(
    game.pointsPerSessionMin + (game.pointsPerSessionMax - game.pointsPerSessionMin) * ratio,
  );
  return { raw, credited: Math.min(raw, capRemaining), throttled: raw > capRemaining };
}

export function GameplayScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const slug = params.get("game");
  const { data: games, isLoading } = useGames();
  const { data: balances } = useBalances();

  const game = useMemo(
    () => games.find((g) => g.slug === slug) ?? null,
    [games, slug],
  );

  const [phase, setPhase] = useState<Phase>("ready");
  const [ticks, setTicks] = useState(0);
  const [sessions, setSessions] = useState(0);
  const [summaryOpen, setSummaryOpen] = useState(false);

  useEffect(() => {
    // A new title always starts a fresh session.
    setPhase("ready");
    setTicks(0);
  }, [slug]);

  useEffect(() => {
    if (phase !== "playing") return;
    const id = window.setInterval(() => setTicks((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  const score = game ? scoreAt(game, ticks) : 0;
  const capUsed = game ? dailyCapUsed(game) : 0;
  const capRemaining = game ? dailyCapRemaining(game) : 0;
  const award = game ? pointsFor(game, score, capRemaining) : { raw: 0, credited: 0, throttled: false };

  const exit = useCallback(() => {
    setPhase("ended");
    setSessions((s) => s + 1);
    setSummaryOpen(true);
  }, []);

  const restart = useCallback(() => {
    setTicks(0);
    setPhase("playing");
    setSummaryOpen(false);
  }, []);

  if (isLoading) {
    return (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <SkeletonCard className="h-[26rem]" />
        <SkeletonCard className="h-[26rem]" />
      </div>
    );
  }

  if (!game) {
    return (
      <EmptyState
        className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1"
        icon={<Gamepad2 />}
        title={slug ? `No live title matches “${slug}”` : "Pick a title to play"}
        description="Launch a game from the lobby and it will open here. Free mode is always available."
        action={{ label: "Open the game lobby", href: "/app/games" }}
      />
    );
  }

  const { targetScore } = pace(game);
  const progress = clamp((score / targetScore) * 100, 0, 100);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ------------------------------- canvas ------------------------------ */}
        <Reveal className="min-w-0">
          <div className="overflow-hidden rounded-[var(--radius-panel)] border border-border-default bg-surface-1">
            <div className="relative">
              <GameArt hue={game.thumbnailHue} title={game.title} ratio="aspect-[16/9]" />

              {/* HUD */}
              <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="rounded-xl bg-surface-0/70 px-3 py-2 backdrop-blur-sm ring-1 ring-border-default">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Score</p>
                  <p className="font-display text-2xl font-semibold tracking-tight text-text-primary">
                    <AnimatedCounter value={score} />
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-xl bg-surface-0/70 px-3 py-2 backdrop-blur-sm ring-1 ring-border-default">
                    <Timer className="size-3.5 text-text-muted" />
                    <span className="tnum text-sm font-semibold text-text-primary">
                      {formatDuration(ticks)}
                    </span>
                  </span>
                  <span className="rounded-xl bg-surface-0/70 px-3 py-2 backdrop-blur-sm ring-1 ring-border-default">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                      Points preview
                    </span>
                    <span className="tnum block text-sm font-semibold text-[var(--accent-hover)]">
                      +{formatNumber(award.credited)}
                    </span>
                  </span>
                </div>
              </div>

              {/* live pulse while playing */}
              {phase === "playing" && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-0/70 px-3 py-2 backdrop-blur-sm ring-1 ring-border-default">
                    <LiveDot label="Session running · results signed server-side" />
                    <span className="tnum text-xs font-semibold text-text-secondary">
                      {progress.toFixed(0)}% of a maximum-value session
                    </span>
                  </div>
                  <motion.div
                    aria-hidden
                    className="mt-2 h-1 origin-left rounded-full bg-[var(--accent)]"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: progress / 100 }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
              )}

              {/* ready / paused overlays */}
              {phase !== "playing" && (
                <div className="absolute inset-0 grid place-items-center bg-surface-0/78 backdrop-blur-sm">
                  <div className="max-w-sm px-6 text-center">
                    <span
                      className={cn(
                        "mx-auto grid size-12 place-items-center rounded-2xl",
                        phase === "paused" ? "bg-warning-500/12 text-warning-400" : "bg-accent-soft text-[var(--accent)]",
                      )}
                    >
                      {phase === "paused" ? <Pause className="size-5" /> : <Play className="size-5" />}
                    </span>
                    <p className="mt-3 font-display text-lg font-semibold text-text-primary">
                      {phase === "ready"
                        ? `${game.title} — free mode`
                        : phase === "paused"
                          ? "Session paused"
                          : "Session ended"}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-text-muted">
                      {phase === "ready"
                        ? "No entry fee, no purchase, no ads required. Points credit after the server validates your result."
                        : phase === "paused"
                          ? "The timer and scoring are frozen. Nothing is submitted while paused."
                          : "Your result has been sent for validation. Points appear in your ledger once it passes."}
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {phase === "ended" ? (
                        <>
                          <Button onClick={restart} icon={<RotateCcw className="size-4" />}>
                            Play again
                          </Button>
                          <Button href="/app/games" variant="outline" icon={<ArrowLeft className="size-4" />}>
                            Back to lobby
                          </Button>
                        </>
                      ) : (
                        <Button onClick={() => setPhase("playing")} icon={<Play className="size-4" />}>
                          {phase === "paused" ? "Resume session" : "Start session"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 truncate font-display text-base font-semibold text-text-primary">
                    {game.title}
                    <Badge tone="good" dot>Free mode</Badge>
                    {capRemaining === 0 && (
                      <Badge tone="warning" icon={<TriangleAlert className="size-3" />}>Cap reached</Badge>
                    )}
                  </p>
                  <p className="text-xs text-text-muted">
                    {game.genre} · session {sessions + (phase === "ended" ? 0 : 1)} today
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {phase === "playing" ? (
                  <Button size="sm" variant="outline" onClick={() => setPhase("paused")} icon={<Pause className="size-4" />}>
                    Pause
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => setPhase("playing")}
                    icon={<Play className="size-4" />}
                    disabled={!game.active}
                  >
                    {phase === "paused" ? "Resume" : "Play"}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={restart} icon={<RotateCcw className="size-4" />}>
                  Restart
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={exit}
                  disabled={phase === "ready"}
                  icon={<LogOut className="size-4" />}
                >
                  Exit session
                </Button>
              </div>
            </div>
          </div>
        </Reveal>

        {/* ------------------------------- sidebar ----------------------------- */}
        <div className="space-y-4">
          <WidgetCard
            title="This session"
            icon={<Activity />}
            live={phase === "playing"}
            description="A local preview only — the server has the final word."
            footnote="Points are calculated server-side from the verified session result. A score submitted by the client is never trusted on its own."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <WidgetStat label="Score" value={formatNumber(score)} sub="engine score" />
              <WidgetStat label="Elapsed" value={formatDuration(ticks)} sub="session timer" />
              <WidgetStat
                label="Points preview"
                value={`+${formatNumber(award.credited)}`}
                sub="pending validation"
                tone="brand"
              />
              <WidgetStat
                label="State"
                value={
                  phase === "playing" ? "Running" : phase === "paused" ? "Paused" : phase === "ended" ? "Submitted" : "Ready"
                }
                sub={phase === "paused" ? "nothing is submitted" : "free mode"}
                tone={phase === "playing" ? "good" : phase === "paused" ? "warning" : "default"}
              />
            </div>
          </WidgetCard>

          <WidgetCard
            title="Daily Points cap"
            icon={<Gauge />}
            description={`Your remaining cap on ${game.title}.`}
            footnote="Caps are per player, per game, per day and reset at 00:00 UTC. They apply identically to free and paid modes — paying never raises your cap."
            tone={capRemaining === 0 ? "warning" : "default"}
          >
            <CapMeter
              used={Math.min(game.dailyPointsCap, capUsed + award.credited)}
              cap={game.dailyPointsCap}
              label="Credited today on this title"
            />
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              {capRemaining === 0
                ? "You have reached today's cap on this title. You can keep playing for score and leaderboard position, but no further Points will be credited until reset."
                : `${formatNumber(capRemaining)} Points still creditable today. Play continues either way — the cap limits issuance, not access.`}
            </p>
            {award.throttled && capRemaining > 0 && (
              <Callout className="mt-3" tone="warning" title="This session will be capped" icon={<TriangleAlert />}>
                <p className="mt-1">
                  The result is worth {formatNumber(award.raw)} Points but only{" "}
                  {formatNumber(award.credited)} fit under today&apos;s cap. The remainder is not
                  carried over — caps are a limit, not a queue.
                </p>
              </Callout>
            )}
          </WidgetCard>

          <WidgetCard
            title="Switch title"
            icon={<Gamepad2 />}
            description="Jump straight into another game."
            href="/app/games"
            hrefLabel="Full lobby"
          >
            <Select
              aria-label="Choose a game to play"
              value={game.slug}
              onChange={(e) => router.push(`/app/games/play?game=${e.target.value}`)}
              options={games
                .filter((g) => g.active)
                .map((g) => ({ value: g.slug, label: `${g.title} · ${g.genre}` }))}
            />
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              Your Points balance is{" "}
              <span className="tnum font-semibold text-text-secondary">
                {formatNumber(balances.points)}
              </span>{" "}
              with {formatNumber(balances.pointsToday)} earned today across all titles.
            </p>
          </WidgetCard>
        </div>
      </div>

      <Callout tone="info" title="Anti-cheat, in plain terms" icon={<ShieldCheck />}>
        <p className="mt-1">
          Each session is signed by the game server and replayed against the scoring rules before any
          Points are written. Disconnected, tampered or automated sessions credit nothing and are
          referred to the fraud engine. This is why the counter above is labelled a preview: it is what
          you are on course to earn, not a promise of credit.
        </p>
      </Callout>

      {/* ---------------------------- session summary ---------------------------- */}
      <Modal
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        title="Session summary"
        description={`${game.title} · free mode`}
        icon={<Sparkles className="size-5" />}
        footer={
          <>
            <Button variant="ghost" href="/app/games">Back to lobby</Button>
            <Button onClick={restart} icon={<RotateCcw className="size-4" />}>Play again</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
            <DetailRow label="Final score" value={<span className="tnum">{formatNumber(score)}</span>} />
            <DetailRow label="Session length" value={<span className="tnum">{formatDuration(ticks)}</span>} />
            <DetailRow
              label="Points submitted for validation"
              value={<span className="tnum text-[var(--accent-hover)]">+{formatNumber(award.credited)}</span>}
              hint="Shown as pending in your Points history until the server confirms the result."
            />
            <DetailRow
              label="Uncapped session value"
              value={<span className="tnum">{formatNumber(award.raw)} Points</span>}
              hint="What the result would be worth with no daily cap applied."
            />
            <DetailRow
              label="Remaining cap after this session"
              value={
                <span className="tnum">
                  {formatNumber(Math.max(0, capRemaining - award.credited))} of{" "}
                  {formatNumber(game.dailyPointsCap)}
                </span>
              }
            />
            <DetailRow
              label="Entry cost"
              value={<span className="tnum">{formatToken(0)} MTT · free mode</span>}
            />
          </div>

          <Callout tone="info" title="Points credit only after server-side validation" icon={<ShieldCheck />}>
            <p className="mt-1">
              Nothing above is credited yet. The signed session result is validated against the scoring
              rules and the anti-cheat checks first; a client-reported score is never trusted on its
              own. Validated credits normally appear in your Points history within a few seconds, and a
              rejected session credits nothing.
            </p>
          </Callout>

          <CapMeter
            used={Math.min(game.dailyPointsCap, capUsed + award.credited)}
            cap={game.dailyPointsCap}
            label={`Daily Points cap on ${game.title} after this session`}
          />
        </div>
      </Modal>
    </div>
  );
}
