"use client";

/* Lane Dodge — the racing engine.
 *
 * Five lanes, scrolling traffic, three lives. Distance scores slowly and boost
 * gates score in bursts, so the optimal line is not the safest one — which is
 * the whole game.
 *
 * Rendered as absolutely-positioned rows rather than a canvas: the row count is
 * small, the DOM handles it, and it inherits the platform's theme tokens instead
 * of hard-coding colours a canvas would have to be told about. */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EngineDefinition, EngineProps } from "../types";

const LANES = 5;
/** Rows of track on screen. The car sits on the last one. */
const ROWS = 9;
const LIVES = 3;

type Cell = "empty" | "block" | "boost";

function LaneDodge({ rng, tuning, onScore, onFinish, paused }: EngineProps) {
  const [lane, setLane] = useState(Math.floor(LANES / 2));
  const [rows, setRows] = useState<Cell[][]>(() =>
    Array.from({ length: ROWS }, () => Array.from({ length: LANES }, () => "empty" as Cell)),
  );
  const [lives, setLives] = useState(LIVES);
  const [bump, setBump] = useState<"hit" | "boost" | null>(null);
  const laneRef = useRef(lane);
  laneRef.current = lane;
  const livesRef = useRef(lives);
  livesRef.current = lives;

  /* Rows per second, not milliseconds, is the number that matters here: the
   * player has one tick to read the incoming row and move. The first pass ran
   * 4.4 rows a second at the racing title's intensity, which is faster than a
   * human can react and made a three-life run last two seconds. */
  const tickMs = 520 - Math.round(tuning.intensity * 200);
  const density = 0.3 + tuning.intensity * 0.22;

  const move = useCallback((delta: number) => {
    setLane((l) => Math.max(0, Math.min(LANES - 1, l + delta)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paused) return;
      if (e.key === "ArrowLeft" || e.key === "a") { e.preventDefault(); move(-1); }
      if (e.key === "ArrowRight" || e.key === "d") { e.preventDefault(); move(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, paused]);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setRows((current) => {
        /* Generate the new top row, then shift everything down one. The row that
         * falls off the bottom is the one the car has just driven through. */
        const incoming: Cell[] = Array.from({ length: LANES }, () => "empty");
        /* At least one lane is always clear: a wall across all five is not
         * difficulty, it is a death sentence the player cannot read. */
        const blocked = rng.shuffle(Array.from({ length: LANES }, (_, i) => i))
          .slice(0, Math.max(1, Math.min(LANES - 1, Math.round(density * LANES))));
        for (const i of blocked) incoming[i] = "block";
        const openLanes = incoming.map((c, i) => (c === "empty" ? i : -1)).filter((i) => i >= 0);
        if (openLanes.length > 0 && rng.next() < 0.35) {
          incoming[rng.pick(openLanes)] = "boost";
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
          onScore(tuning.baseScore * 6);
        } else {
          /* Surviving a row is worth something, or hugging one clear lane for a
           * whole session would score the same as driving it well. */
          onScore(tuning.baseScore);
        }
        return next;
      });
    }, tickMs);
    return () => window.clearInterval(id);
  }, [paused, rng, density, tickMs, onScore, onFinish, tuning.baseScore]);

  useEffect(() => {
    if (!bump) return;
    const id = window.setTimeout(() => setBump(null), 200);
    return () => window.clearTimeout(id);
  }, [bump]);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-text-muted">← → or A / D to change lane</span>
        <span className="flex items-center gap-1">
          {Array.from({ length: LIVES }, (_, i) => (
            <Heart
              key={i}
              className={cn("size-3.5", i < lives ? "fill-danger-400 text-danger-400" : "text-border-default")}
            />
          ))}
        </span>
      </div>

      <div
        className={cn(
          "grid min-h-0 flex-1 gap-1 rounded-xl border p-1 transition-colors duration-150",
          bump === "hit" && "border-danger-400 bg-danger-500/10",
          bump === "boost" && "border-success-400 bg-success-500/10",
          !bump && "border-border-subtle bg-surface-inset",
        )}
        style={{ gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))` }}
      >
        {rows.map((row, r) => (
          <div key={r} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${LANES}, minmax(0, 1fr))` }}>
            {row.map((cell, c) => {
              const isCar = r === ROWS - 1 && c === lane;
              return (
                <div
                  key={c}
                  className={cn(
                    "rounded-md",
                    cell === "block" && "bg-danger-500/70",
                    cell === "boost" && "bg-success-500/70",
                    cell === "empty" && "bg-surface-1/60",
                    isCar && "ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-surface-inset",
                  )}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Touch controls: the keyboard hint above is useless on a phone. */}
      <div className="grid grid-cols-2 gap-2 sm:hidden">
        <button
          type="button"
          onPointerDown={() => move(-1)}
          className="grid place-items-center rounded-xl border border-border-default bg-surface-inset py-3 text-text-secondary active:bg-surface-1"
          aria-label="Move left"
        >
          <ArrowLeft className="size-5" />
        </button>
        <button
          type="button"
          onPointerDown={() => move(1)}
          className="grid place-items-center rounded-xl border border-border-default bg-surface-inset py-3 text-text-secondary active:bg-surface-1"
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
    "Steer with the arrow keys, A / D, or the on-screen buttons. Every row you clear scores; green boost gates score six times as much; red traffic costs a life, and three lives ends the run.",
  keyboard: true,
  Component: LaneDodge,
};
