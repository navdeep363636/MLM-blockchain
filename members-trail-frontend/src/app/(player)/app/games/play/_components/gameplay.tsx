"use client";

/* G-02 · Gameplay screen — FRD 5.4
 *
 * This screen used to run a local timer, add a number to a counter every second
 * and call it a score. Nothing was ever sent to the server, so no session was
 * ever validated and no Points were ever credited from gameplay — which is also
 * why the leaderboards, the quest counters and the catalogue's play counts were
 * all empty. One missing call, five empty screens.
 *
 * Now the screen hosts a real engine and a real session:
 *
 *   • The board is generated from the seed the SERVER issued, so it cannot be
 *     rerolled by reloading and is identical for everyone on a shared board.
 *   • Every scoring event is written to a telemetry stream. The server replays
 *     that stream, scores it ITSELF, and credits from its own number.
 *   • Nothing on this page claims a Points figure before the server has settled
 *     one. A "preview" the client computed is a guess dressed as a promise.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity, ArrowLeft, Gamepad2, Gauge, Keyboard, LogOut, Pause, Play, RotateCcw, ShieldCheck,
  Sparkles, Timer, TriangleAlert, Trophy,
} from "lucide-react";
import {
  Badge, Button, Callout, CapMeter, DetailRow, EmptyState, Modal, SkeletonCard, Select,
} from "@/components/ui";
import { AnimatedCounter, LiveDot, Reveal, motion } from "@/components/fx";
import { GameArt } from "@/app/(public)/_components/game-art";
import { useBalances, useGames, useTournaments } from "@/lib/hooks/use-data";
import { useGameSession } from "@/lib/games/session";
import { engineFor } from "@/lib/games/registry";
import { rngFrom } from "@/lib/games/rng";
import { clamp, cn, formatClock, formatNumber, formatToken } from "@/lib/utils";
import { dailyCapRemaining, dailyCapUsed } from "../../../_components/derive";
import { WidgetCard, WidgetStat } from "../../../_components/widget-card";

/** What a validated session's status means to a reader. */
const OUTCOME: Record<string, { label: string; tone: "good" | "warning" | "default"; detail: string }> = {
  validated: {
    label: "Validated",
    tone: "good",
    detail: "The server replayed your session, agreed with the score, and credited the Points below.",
  },
  submitted: {
    label: "Still validating",
    tone: "default",
    detail:
      "Validation is queued and will finish without you here. The credit appears in your Points history when it does.",
  },
  rejected: {
    label: "Rejected",
    tone: "warning",
    detail:
      "The replay did not agree with the submitted result, so nothing was credited. The session is on record and reviewable.",
  },
  flagged: {
    label: "Held for review",
    tone: "warning",
    detail:
      "The anti-cheat checks flagged something in this session. It credits nothing until a human has looked at it.",
  },
};

export function GameplayScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const slug = params.get("game");
  /* A ranked session is addressed by the event's public ref, the same identifier
   * every other tournament route takes. The server decides whether it is allowed
   * — the entry, the title and the window are all checked there. */
  const tournamentRef = params.get("tournament");
  const { data: games, isLoading } = useGames();
  const { data: balances } = useBalances();
  const { data: tournaments } = useTournaments();

  const game = useMemo(() => games.find((g) => g.slug === slug) ?? null, [games, slug]);
  const tournament = useMemo(
    () => (tournamentRef ? tournaments.find((t) => t.id === tournamentRef) ?? null : null),
    [tournaments, tournamentRef],
  );

  const session = useGameSession(game?.id ?? null, tournamentRef);
  const { engine, tuning } = useMemo(
    () => engineFor(game?.slug ?? "", game?.genre ?? ""),
    [game?.slug, game?.genre],
  );

  const [paused, setPaused] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(tuning.durationSeconds);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [sessionsToday, setSessionsToday] = useState(0);

  /* The host owns the clock, not the engine: the HUD, the engine and the
   * submission all have to agree on when the session ended. */
  const finishRef = useRef(session.finish);
  finishRef.current = session.finish;

  useEffect(() => {
    if (session.stage !== "playing" || paused) return;
    const id = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          window.clearInterval(id);
          void finishRef.current();
          return 0;
        }
        return s - 1;
      });
    }, 1_000);
    return () => window.clearInterval(id);
  }, [session.stage, paused]);

  useEffect(() => {
    if (session.stage === "settled") {
      setSessionsToday((n) => n + 1);
      setSummaryOpen(true);
    }
  }, [session.stage]);

  const start = useCallback(() => {
    setSecondsLeft(tuning.durationSeconds);
    setPaused(false);
    setSummaryOpen(false);
    void session.begin();
  }, [session, tuning.durationSeconds]);

  const endEarly = useCallback(() => {
    setPaused(false);
    void session.finish();
  }, [session]);

  /* A board is a pure function of the server's seed, so it is derived rather
   * than stored — remounting the engine on the same seed replays the same board,
   * which is exactly the property the ranked formats depend on. */
  const rng = useMemo(() => (session.seed ? rngFrom(session.seed) : null), [session.seed]);

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

  const capUsed = dailyCapUsed(game);
  const capRemaining = dailyCapRemaining(game);
  const Engine = engine.Component;
  const settled = session.settlement;
  const outcome = settled ? (OUTCOME[settled.status] ?? OUTCOME.submitted) : null;
  const elapsed = tuning.durationSeconds - secondsLeft;
  const clockProgress = clamp((elapsed / tuning.durationSeconds) * 100, 0, 100);
  const playing = session.stage === "playing";
  const busy = session.stage === "starting" || session.stage === "submitting" || session.stage === "validating";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ------------------------------- canvas ------------------------------ */}
        <Reveal className="min-w-0">
          <div className="overflow-hidden rounded-[var(--radius-panel)] border border-border-default bg-surface-1">
            <div className="relative aspect-[16/10] sm:aspect-[16/9]">
              {playing && rng ? (
                <div className="absolute inset-0 bg-surface-0">
                  <Engine
                    key={session.seed}
                    rng={rng}
                    tuning={tuning}
                    onScore={session.addScore}
                    onFinish={endEarly}
                    secondsLeft={secondsLeft}
                    paused={paused}
                  />
                </div>
              ) : (
                <GameArt hue={game.thumbnailHue} slug={game.slug} title={game.title} ratio="absolute inset-0 h-full" />
              )}

              {/* HUD, over the cover art only.
                  It used to float over the canvas unconditionally, which was
                  fine when the canvas was a picture and wrong the moment it
                  became a playfield: the score chip sat on the instruction line
                  and the bottom bar covered the last row of cells, so those
                  cells could not be clicked at all. While an engine is running
                  the same numbers live in the strip below, clear of it. */}
              {!playing && (
              <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="rounded-xl bg-surface-0/70 px-3 py-2 backdrop-blur-sm ring-1 ring-border-default">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Score</p>
                  <p className="font-display text-2xl font-semibold tracking-tight text-text-primary">
                    <AnimatedCounter value={session.score} />
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-xl bg-surface-0/70 px-3 py-2 backdrop-blur-sm ring-1 ring-border-default">
                    <Timer className="size-3.5 text-text-muted" />
                    <span className="tnum text-sm font-semibold text-text-primary">
                      {formatClock(secondsLeft)}
                    </span>
                  </span>
                  {session.headroom !== null && (
                    <span className="rounded-xl bg-surface-0/70 px-3 py-2 backdrop-blur-sm ring-1 ring-border-default">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                        Creditable today
                      </span>
                      <span className="tnum block text-sm font-semibold text-[var(--accent-hover)]">
                        {formatNumber(session.headroom)}
                      </span>
                    </span>
                  )}
                </div>
              </div>
              )}

              {/* ready / paused / settling overlays */}
              {!playing && (
                <div className="absolute inset-0 grid place-items-center bg-surface-0/82 backdrop-blur-sm">
                  <div className="max-w-md px-6 text-center">
                    <span
                      className={cn(
                        "mx-auto grid size-12 place-items-center rounded-2xl",
                        paused ? "bg-warning-500/12 text-warning-400" : "bg-accent-soft text-[var(--accent)]",
                      )}
                    >
                      {paused ? <Pause className="size-5" /> : <Play className="size-5" />}
                    </span>
                    <p className="mt-3 font-display text-lg font-semibold text-text-primary">
                      {session.stage === "starting" && "Opening a session…"}
                      {session.stage === "submitting" && "Submitting your result…"}
                      {session.stage === "validating" && "Server is replaying your session…"}
                      {session.stage === "settled" && "Session complete"}
                      {session.stage === "error" && (session.blockedByOpenRef
                        ? "You already have a session open here"
                        : "Could not start this session")}
                      {session.stage === "idle" && `${game.title} — ${engine.name}`}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-text-muted">
                      {session.stage === "error"
                        ? (session.blockedByOpenRef
                            ? "One session per title at a time, so a best-of-several cannot be farmed. Abandoning it forfeits that run — nothing from it is scored or credited."
                            : (session.error ?? "Something went wrong opening the session."))
                        : session.stage === "validating" || session.stage === "submitting"
                          ? "Points are written from the server's own score, not the one your browser reported."
                          : session.stage === "settled"
                            ? (outcome?.detail ?? "")
                            : engine.howToPlay}
                    </p>
                    {session.stage === "idle" && engine.keyboard && (
                      <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                        <Keyboard className="size-3.5" />
                        Keyboard controls — on-screen buttons are provided on touch devices
                      </p>
                    )}
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {session.blockedByOpenRef ? (
                        <>
                          <Button
                            onClick={() => void session.abandonAndStart()}
                            icon={<RotateCcw className="size-4" />}
                          >
                            Abandon it and start fresh
                          </Button>
                          <Button href="/app/games" variant="outline" icon={<ArrowLeft className="size-4" />}>
                            Back to lobby
                          </Button>
                        </>
                      ) : session.stage === "settled" || session.stage === "error" ? (
                        <>
                          <Button onClick={start} icon={<RotateCcw className="size-4" />}>Play again</Button>
                          <Button href="/app/games" variant="outline" icon={<ArrowLeft className="size-4" />}>
                            Back to lobby
                          </Button>
                        </>
                      ) : (
                        <Button
                          onClick={paused ? () => setPaused(false) : start}
                          disabled={busy || !game.active}
                          icon={<Play className="size-4" />}
                        >
                          {paused ? "Resume session" : busy ? "Working…" : "Start session"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Live strip: score, clock and progress, in the layout rather than
                on top of it. Below the playfield so it can never swallow an
                input, and above the controls so the eye finds it without
                leaving the game. */}
            {playing && (
              <div className="border-t border-border-subtle px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <LiveDot label="Session running · results replayed server-side" />
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-semibold text-text-muted">
                      Score{" "}
                      <span className="tnum font-display text-base text-text-primary">
                        <AnimatedCounter value={session.score} />
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                      <Timer className="size-3.5" />
                      <span className={cn("tnum text-base", secondsLeft <= 10 ? "text-warning-400" : "text-text-primary")}>
                        {formatClock(secondsLeft)}
                      </span>
                    </span>
                  </div>
                </div>
                <motion.div
                  aria-hidden
                  className="mt-2 h-1 origin-left rounded-full bg-[var(--accent)]"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: clockProgress / 100 }}
                  transition={{ duration: 0.6, ease: "linear" }}
                />
              </div>
            )}

            {/* controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-5 py-4">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 truncate font-display text-base font-semibold text-text-primary">
                  {game.title}
                  {tournamentRef ? (
                    <Badge tone="brand" icon={<Trophy className="size-3" />}>Ranked entry</Badge>
                  ) : (
                    <Badge tone="good" dot>Free mode</Badge>
                  )}
                  {capRemaining === 0 && (
                    <Badge tone="warning" icon={<TriangleAlert className="size-3" />}>Cap reached</Badge>
                  )}
                </p>
                <p className="text-xs text-text-muted">
                  {game.genre} · {engine.name} · {sessionsToday} completed here today
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {playing ? (
                  <Button size="sm" variant="outline" onClick={() => setPaused((p) => !p)} icon={paused ? <Play className="size-4" /> : <Pause className="size-4" />}>
                    {paused ? "Resume" : "Pause"}
                  </Button>
                ) : (
                  <Button size="sm" onClick={start} disabled={busy || !game.active} icon={<Play className="size-4" />}>
                    Play
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={endEarly}
                  disabled={!playing}
                  icon={<LogOut className="size-4" />}
                >
                  End &amp; submit
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
            live={playing && !paused}
            description="The score is yours; the Points are the server's to decide."
            footnote="Points are credited from the score the server recomputes by replaying your session. A score submitted by the client is never trusted on its own."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <WidgetStat label="Score" value={formatNumber(session.score)} sub="this session" />
              <WidgetStat label="Time left" value={formatClock(secondsLeft)} sub={`${tuning.durationSeconds}s session`} />
              <WidgetStat
                label={settled ? "Points credited" : "Points"}
                value={settled ? `+${formatNumber(settled.pointsAwarded)}` : "—"}
                sub={settled ? (outcome?.label ?? "") : "decided after validation"}
                tone={settled && settled.pointsAwarded > 0 ? "brand" : "default"}
              />
              <WidgetStat
                label="State"
                value={
                  playing ? (paused ? "Paused" : "Running")
                    : session.stage === "validating" ? "Validating"
                      : session.stage === "settled" ? (outcome?.label ?? "Done") : "Ready"
                }
                sub={paused ? "nothing is submitted" : "free mode"}
                tone={playing && !paused ? "good" : paused ? "warning" : "default"}
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
            <CapMeter used={capUsed} cap={game.dailyPointsCap} label="Credited today on this title" />
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              {capRemaining === 0
                ? "You have reached today's cap on this title. You can keep playing for score and leaderboard position, but no further Points will be credited until reset."
                : `${formatNumber(capRemaining)} Points still creditable today. Play continues either way — the cap limits issuance, not access.`}
            </p>
            {session.sessionCap !== null && (
              <p className="mt-2 text-xs leading-relaxed text-text-muted">
                A single session on this title can credit at most{" "}
                <span className="tnum font-semibold text-text-secondary">
                  {formatNumber(session.sessionCap)}
                </span>{" "}
                Points, however well it goes.
              </p>
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
          Your session is opened by the server, which issues the board seed and a one-time token. Every
          scoring event is recorded and sent back with the result; the server replays that stream, scores
          it itself, and credits from its own number. That is why this page shows a score while you play
          and a Points figure only once the result has settled — anything else would be a guess.
        </p>
      </Callout>

      {/* ---------------------------- session summary ---------------------------- */}
      <Modal
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        title="Session summary"
        description={`${game.title} · ${engine.name} · ${tournament ? tournament.name : "free mode"}`}
        icon={<Sparkles className="size-5" />}
        footer={
          <>
            <Button variant="ghost" href="/app/games">Back to lobby</Button>
            <Button onClick={start} icon={<RotateCcw className="size-4" />}>Play again</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
            <DetailRow
              label="Your score"
              value={<span className="tnum">{formatNumber(session.score)}</span>}
              hint="What the engine recorded and submitted."
            />
            <DetailRow
              label="Server's replayed score"
              value={
                <span className="tnum">
                  {settled?.serverScore === null || settled?.serverScore === undefined
                    ? "pending"
                    : formatNumber(settled.serverScore)}
                </span>
              }
              hint="Recomputed from your telemetry. This is the number Points are derived from."
            />
            <DetailRow
              label="Points credited"
              value={
                <span className="tnum text-[var(--accent-hover)]">
                  +{formatNumber(settled?.pointsAwarded ?? 0)}
                </span>
              }
            />
            <DetailRow label="Outcome" value={outcome?.label ?? "—"} />
            <DetailRow
              label="Session length"
              value={<span className="tnum">{formatClock(elapsed)}</span>}
            />
            <DetailRow
              label="Entry cost"
              value={
                <span className="tnum">
                  {tournament
                    ? `${formatToken(tournament.entryFee)} MTT · paid on registration`
                    : `${formatToken(0)} MTT · free mode`}
                </span>
              }
              hint={tournament ? "The fee was charged when you registered, not per session." : undefined}
            />
          </div>

          {settled && settled.flags.length > 0 && (
            <Callout tone="warning" title="This session was flagged" icon={<TriangleAlert />}>
              <p className="mt-1">
                The anti-cheat checks raised: {settled.flags.join(", ").replace(/_/g, " ")}. A flagged
                session credits nothing until it has been reviewed.
              </p>
            </Callout>
          )}

          <Callout
            tone={outcome?.tone === "good" ? "good" : "info"}
            title={outcome?.label ?? "Awaiting validation"}
            icon={<ShieldCheck />}
          >
            <p className="mt-1">{outcome?.detail ?? ""}</p>
          </Callout>

          <CapMeter
            used={Math.min(game.dailyPointsCap, capUsed + (settled?.pointsAwarded ?? 0))}
            cap={game.dailyPointsCap}
            label={`Daily Points cap on ${game.title} after this session`}
          />
        </div>
      </Modal>
    </div>
  );
}
