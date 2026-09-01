"use client";

/* Lane Dodge — the racing engine.
 *
 * The first version was legible only to whoever wrote it. Nine rows of five
 * identical rounded squares, the player's car drawn as a RING OUTLINE on one of
 * them — same size and shape as every obstacle — and every empty cell painted as
 * a visible box, so there was no figure and no ground, just forty-five blinking
 * tiles. Nothing said "road", nothing moved, nothing warned which row was about
 * to arrive, and nothing showed progress. It was a grid puzzle wearing a racing
 * title's name.
 *
 * This version is built around one idea: it should look like driving.
 *
 *  • The road is a road — asphalt, edge lines, dashed lane dividers that STREAM
 *    downward at the current speed. Streaming markings are what sells motion in
 *    a top-down racer, and they cost one animated gradient.
 *  • Empty road draws nothing. Only hazards and gates have ink, so the eye finds
 *    them instantly.
 *  • Barriers span their lane and carry hazard stripes. Gates are chevrons and
 *    sit narrow and centred. They differ in SHAPE, not only colour, so the game
 *    is playable without colour vision.
 *  • The car is an actual car silhouette, brighter than anything else, and it
 *    slides between lanes rather than teleporting.
 *  • The row about to reach you is lit. You can read the next decision.
 *  • Speed climbs with distance and is on screen in km/h beside the metres
 *    travelled, so there is a visible reason to keep going.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Gauge, Heart } from "lucide-react";
import { motion } from "@/components/fx";
import { cn } from "@/lib/utils";
import type { EngineDefinition, EngineProps } from "../types";

const LANES = 5;
/** Rows of road on screen. The car occupies the last one. */
const ROWS = 9;
const LIVES = 3;

/** Metres of road per row cleared. Only used for the readout. */
const METRES_PER_ROW = 12;

/** The tick floor: below this a five-lane read is not humanly possible. */
const MIN_TICK_MS = 210;

type Cell = "empty" | "block" | "boost";

function LaneDodge({ rng, tuning, onScore, onFinish, paused }: EngineProps) {
  const [lane, setLane] = useState(Math.floor(LANES / 2));
  const [rows, setRows] = useState<Cell[][]>(() =>
    Array.from({ length: ROWS }, () => Array.from({ length: LANES }, () => "empty" as Cell)),
  );
  const [lives, setLives] = useState(LIVES);
  const [cleared, setCleared] = useState(0);
  const [bump, setBump] = useState<"hit" | "boost" | null>(null);

  /* The lane the guaranteed clear path runs through on the row being generated.
   * See the generator below for why this exists. */
  const pathRef = useRef(Math.floor(LANES / 2));

  const laneRef = useRef(lane);
  laneRef.current = lane;
  const livesRef = useRef(lives);
  livesRef.current = lives;
  const clearedRef = useRef(cleared);
  clearedRef.current = cleared;

  /* Speed ramps with distance. A flat difficulty gives a player nothing to reach
   * for and no sense of having got better at anything. */
  const baseTickMs = 560 - Math.round(tuning.intensity * 170);
  const tickMs = Math.max(MIN_TICK_MS, baseTickMs - cleared * 2);
  /* Barriers per row, out of five lanes. The first pass put two or three in
   * every row with nothing thinning them out, which filled the screen with
   * bright hazard stripes and left almost no road to read. */
  const barriers = 1 + Math.round(tuning.intensity * 1.4);

  /* Presented, not simulated: a readout the player can feel against the speed of
   * the markings. Tuned so the opening pace reads as motorway-ish. */
  const kmh = Math.round((METRES_PER_ROW / (tickMs / 1000)) * 3.6);
  const metres = cleared * METRES_PER_ROW;

  const move = useCallback((delta: number) => {
    setLane((l) => Math.max(0, Math.min(LANES - 1, l + delta)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paused) return;
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") { e.preventDefault(); move(-1); }
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") { e.preventDefault(); move(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, paused]);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setRows((current) => {
        /* THE FAIRNESS RULE, and the reason the first version felt arbitrary.
         *
         * Rows were generated independently, so both clear lanes in the arriving
         * row could be two or more lanes away from the car — and a car moves one
         * lane per tick. The player was killed by a road they had no legal move
         * against, which reads as the game being broken rather than as their own
         * mistake.
         *
         * So the track now carries a continuous path: a lane that drifts by at
         * most one per row and is always clear. Every row is therefore reachable
         * from the row before it, one step at a time. Finding and following that
         * line is the game; being cornered by the generator is not. It also gives
         * the road a visible snaking gap, which is what makes it readable at
         * speed.
         */
        const path = Math.max(0, Math.min(LANES - 1, pathRef.current + rng.int(-1, 1)));
        pathRef.current = path;

        const incoming: Cell[] = Array.from({ length: LANES }, () => "empty");
        const candidates = rng
          .shuffle(Array.from({ length: LANES }, (_, i) => i))
          .filter((i) => i !== path);
        for (const i of candidates.slice(0, Math.min(barriers, LANES - 1))) {
          incoming[i] = "block";
        }

        /* A gate on the path rewards driving it; a gate off the path is a choice
         * to leave the safe line for it. Both are legible, and neither can kill
         * you on its own. */
        if (rng.next() < 0.3) {
          const open = incoming.map((c, i) => (c === "empty" ? i : -1)).filter((i) => i >= 0);
          if (open.length > 0) incoming[rng.next() < 0.6 ? path : rng.pick(open)] = "boost";
        }

        const next = [incoming, ...current.slice(0, ROWS - 1)];
        const arriving = current[ROWS - 1][laneRef.current];

        if (arriving === "block") {
          setBump("hit");
          const left = livesRef.current - 1;
          setLives(left);
          if (left <= 0) onFinish();
        } else if (arriving === "boost") {
          setBump("boost");
          setCleared((n) => n + 1);
          onScore(tuning.baseScore * 6);
        } else {
          setBump(null);
          setCleared((n) => n + 1);
          /* Distance scores. Otherwise sitting in one safe lane for a whole
           * session would be worth as much as driving it well. */
          onScore(tuning.baseScore);
        }
        return next;
      });
    }, tickMs);
    return () => window.clearInterval(id);
  }, [paused, rng, barriers, tickMs, onScore, onFinish, tuning.baseScore]);

  useEffect(() => {
    if (!bump) return;
    const id = window.setTimeout(() => setBump(null), 260);
    return () => window.clearTimeout(id);
  }, [bump]);

  const laneWidthPct = 100 / LANES;
  const lanePositions = useMemo(
    () => Array.from({ length: LANES - 1 }, (_, i) => (i + 1) * laneWidthPct),
    [laneWidthPct],
  );

  return (
    <div className="flex h-full flex-col gap-2.5 p-4">
      {/* --------------------------------- HUD -------------------------------- */}
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-text-muted">
          <Gauge className="size-3.5" />
          <span className="tnum text-sm text-text-primary">{kmh}</span> km/h
          <span className="text-border-default">·</span>
          <span className="tnum text-sm text-text-primary">{metres}</span> m
        </span>
        <span className="flex items-center gap-1" aria-label={`${lives} lives left`}>
          {Array.from({ length: LIVES }, (_, i) => (
            <Heart
              key={i}
              className={cn(
                "size-4 transition-colors",
                i < lives ? "fill-danger-400 text-danger-400" : "text-border-default",
              )}
            />
          ))}
        </span>
      </div>

      {/* --------------------------------- road ------------------------------- */}
      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden rounded-xl border transition-colors duration-150",
          bump === "hit" && "border-danger-400",
          bump === "boost" && "border-success-400",
          !bump && "border-border-default",
        )}
        style={{ backgroundColor: "hsl(0 0% 8%)" }}
      >
        {/* Streaming lane markings. The one element that makes this read as
            driving rather than as a grid of tiles: dashes scrolling downward at
            the current speed. */}
        {lanePositions.map((left) => (
          <motion.span
            key={left}
            aria-hidden
            className="absolute top-0 h-full w-[2px]"
            style={{
              left: `${left}%`,
              backgroundImage:
                "repeating-linear-gradient(to bottom, hsl(0 0% 100% / 0.34) 0 14px, transparent 14px 40px)",
              backgroundSize: "2px 40px",
            }}
            animate={paused ? {} : { backgroundPositionY: ["0px", "40px"] }}
            transition={{ duration: Math.max(0.18, tickMs / 1000), ease: "linear", repeat: Infinity }}
          />
        ))}
        {/* Road edges */}
        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[hsl(42_92%_58%/0.55)]" />
        <span aria-hidden className="absolute inset-y-0 right-0 w-[3px] bg-[hsl(42_92%_58%/0.55)]" />

        {/* Hazards and gates. Empty road draws nothing at all. */}
        <div
          className="absolute inset-0 grid"
          style={{ gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))` }}
        >
          {rows.map((row, r) => {
            /* The row that arrives next tick. Lighting it is what lets a player
               read the decision instead of reacting to it too late. */
            const imminent = r === ROWS - 2;
            return (
              <div
                key={r}
                className={cn(
                  "relative grid",
                  imminent && "bg-[hsl(0_0%_100%/0.045)]",
                )}
                style={{ gridTemplateColumns: `repeat(${LANES}, minmax(0, 1fr))` }}
              >
                {row.map((cell, c) => (
                  <div key={c} className="relative grid place-items-center">
                    {cell === "block" && (
                      /* Wide, flat, striped: a barrier. Shape distinguishes it
                         from a gate without relying on colour. */
                      <span
                        className="h-[52%] w-[84%] rounded-[3px] border border-[hsl(0_74%_64%/0.75)]"
                        style={{
                          backgroundImage:
                            "repeating-linear-gradient(135deg, hsl(0 74% 52%) 0 6px, hsl(0 30% 16%) 6px 12px)",
                        }}
                      />
                    )}
                    {cell === "boost" && (
                      /* Narrow chevrons: a speed gate you aim for. */
                      <span className="flex flex-col items-center justify-center gap-[2px] text-[hsl(150_76%_58%)]">
                        <svg viewBox="0 0 24 10" className="h-[7px] w-5" aria-hidden>
                          <path d="M2 8 L12 2 L22 8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                        <svg viewBox="0 0 24 10" className="h-[7px] w-5" aria-hidden>
                          <path d="M2 8 L12 2 L22 8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {/* The car. A silhouette, not a ring on a tile, and it slides between
            lanes so the player can see the move they just made. */}
        <motion.div
          className="pointer-events-none absolute bottom-0 grid place-items-center"
          style={{ width: `${laneWidthPct}%`, height: `${100 / ROWS}%` }}
          animate={{ left: `${lane * laneWidthPct}%` }}
          transition={{ type: "spring", stiffness: 700, damping: 34 }}
        >
          <svg
            viewBox="0 0 24 34"
            className={cn(
              /* Sized off the LANE, not the row. A car is longer than it is
                 wide, and a sliver a quarter of the lane's width is something
                 the player has to hunt for on a busy road. */
              "w-[52%] h-auto drop-shadow-[0_0_16px_var(--accent)]",
              bump === "hit" && "opacity-40",
            )}
            aria-label="Your car"
            role="img"
          >
            <path
              d="M12 1 L20 12 L20 27 Q20 32 15 32 L9 32 Q4 32 4 27 L4 12 Z"
              fill="var(--accent)"
              stroke="hsl(0 0% 100% / 0.75)"
              strokeWidth="1.2"
            />
            <path d="M9 9 L15 9 L17 15 L7 15 Z" fill="hsl(0 0% 100% / 0.42)" />
          </svg>
        </motion.div>

        {/* Crash flash, brief and unmistakable. */}
        {bump === "hit" && (
          <span aria-hidden className="absolute inset-0 bg-danger-500/22" />
        )}
        {bump === "boost" && (
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-success-500/25 to-transparent" />
        )}
      </div>

      {/* ------------------------------- controls ----------------------------- */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onPointerDown={() => move(-1)}
          className="grid place-items-center rounded-xl border border-border-default bg-surface-inset py-2.5 text-text-secondary transition-colors hover:border-[var(--accent)] hover:text-text-primary active:bg-surface-1"
          aria-label="Move left"
        >
          <ArrowLeft className="size-5" />
        </button>
        <button
          type="button"
          onPointerDown={() => move(1)}
          className="grid place-items-center rounded-xl border border-border-default bg-surface-inset py-2.5 text-text-secondary transition-colors hover:border-[var(--accent)] hover:text-text-primary active:bg-surface-1"
          aria-label="Move right"
        >
          <ArrowRight className="size-5" />
        </button>
      </div>
    </div>
  );
}

export const laneDodge: EngineDefinition = {
  key: "lane-dodge",
  name: "Lane Dodge",
  howToPlay:
    "Steer between the striped barriers with the arrow keys, A / D, or the buttons below the road. Every stretch of road you clear scores; the green chevron gates score six times as much; hitting a barrier costs one of your three lives. The faster you go, the more the road is worth — and the less time you have to read it.",
  keyboard: true,
  Component: LaneDodge,
};
