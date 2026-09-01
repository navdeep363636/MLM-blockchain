"use client";

/* Reflex Grid — the arcade/action engine.
 *
 * Cells light up and decay. Hitting one before it dies scores, and consecutive
 * hits build a multiplier that a miss or a lapse resets. Skill is entirely
 * reaction time and target selection: there is nothing to buy and no random
 * payout, which is what keeps the catalogue on the right side of "skill, not
 * chance".
 *
 * Intensity shortens each target's life and shortens the gap between spawns. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { EngineDefinition, EngineProps } from "../types";

const COLS = 5;
const ROWS = 4;
const CELLS = COLS * ROWS;

/** Multiplier ceiling. Uncapped, one long streak dwarfs the rest of the run. */
const MAX_COMBO = 8;

interface Target {
  cell: number;
  bornAt: number;
  lifeMs: number;
  /** A gold target is worth triple and lives half as long. */
  gold: boolean;
}

/* The host owns the clock and ends the session, so `onFinish` is unused here:
 * the grid plays until time runs out rather than reaching a terminal state. */
function ReflexGrid({ rng, tuning, onScore, paused }: EngineProps) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [combo, setCombo] = useState(1);
  const [flash, setFlash] = useState<{ cell: number; kind: "hit" | "miss" } | null>(null);
  const nextSpawn = useRef(0);
  const comboRef = useRef(1);
  comboRef.current = combo;

  const lifeMs = 1_500 - Math.round(tuning.intensity * 750);
  const spawnEveryMs = 900 - Math.round(tuning.intensity * 480);
  const concurrent = 1 + Math.round(tuning.intensity * 2);

  /* One loop drives spawning and expiry. Two timers would let a target expire
   * between spawns and leave the grid visibly empty on a fast title. */
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      const now = performance.now();
      setTargets((current) => {
        const alive = current.filter((t) => now - t.bornAt < t.lifeMs);
        /* An expired target is a broken streak: letting one rot is a miss. */
        if (alive.length < current.length) {
          setCombo(1);
          setFlash(null);
        }
        if (now >= nextSpawn.current && alive.length < concurrent) {
          nextSpawn.current = now + spawnEveryMs;
          const taken = new Set(alive.map((t) => t.cell));
          const free = Array.from({ length: CELLS }, (_, i) => i).filter((i) => !taken.has(i));
          if (free.length > 0) {
            const gold = rng.next() < 0.12;
            alive.push({
              cell: rng.pick(free),
              bornAt: now,
              lifeMs: gold ? Math.round(lifeMs * 0.55) : lifeMs,
              gold,
            });
          }
        }
        return alive;
      });
    }, 60);
    return () => window.clearInterval(id);
  }, [paused, rng, concurrent, lifeMs, spawnEveryMs]);

  const hit = useCallback(
    (cell: number) => {
      if (paused) return;
      setTargets((current) => {
        const target = current.find((t) => t.cell === cell);
        if (!target) {
          /* Clicking empty space costs the streak. Without that, mashing every
           * cell is a strictly better strategy than aiming. */
          setCombo(1);
          setFlash({ cell, kind: "miss" });
          return current;
        }
        const speedBonus = 1 - (performance.now() - target.bornAt) / target.lifeMs;
        const value = Math.round(
          tuning.baseScore * (target.gold ? 3 : 1) * (0.6 + 0.8 * Math.max(0, speedBonus)) * comboRef.current,
        );
        onScore(value);
        setCombo((c) => Math.min(MAX_COMBO, c + 1));
        setFlash({ cell, kind: "hit" });
        return current.filter((t) => t.cell !== cell);
      });
    },
    [paused, onScore, tuning.baseScore],
  );

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 220);
    return () => window.clearTimeout(id);
  }, [flash]);

  const cells = useMemo(() => Array.from({ length: CELLS }, (_, i) => i), []);
  const byCell = new Map(targets.map((t) => [t.cell, t]));

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-text-muted">Hit the lit cells before they fade</span>
        <span className={cn("tnum", combo > 1 ? "text-[var(--accent-hover)]" : "text-text-muted")}>
          ×{combo} combo
        </span>
      </div>
      <div
        className="grid min-h-0 flex-1 gap-2"
        style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))` }}
      >
        {cells.map((cell) => {
          const target = byCell.get(cell);
          const isFlash = flash?.cell === cell;
          return (
            <button
              key={cell}
              type="button"
              onPointerDown={() => hit(cell)}
              aria-label={target ? "Target" : "Empty cell"}
              className={cn(
                "rounded-xl border transition-[background-color,border-color,transform] duration-100",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
                target?.gold && "scale-[1.04] border-warning-400 bg-warning-500/25",
                /* A solid fill, not a tint. `bg-accent-soft` over a dark
                 * surface was barely distinguishable from an empty cell, which
                 * turns a reaction game into a hunt. */
                target && !target.gold && "scale-[1.02] border-[var(--accent)] bg-[var(--accent)]",
                !target && "border-border-subtle bg-surface-inset hover:border-border-default",
                isFlash && flash.kind === "hit" && "border-success-400 bg-success-500/30",
                isFlash && flash.kind === "miss" && "border-danger-400 bg-danger-500/20",
              )}
            />
          );
        })}
      </div>
    </div>
  );
}

export const reflexGrid: EngineDefinition = {
  key: "reflex-grid",
  name: "Reflex Grid",
  howToPlay:
    "Tap or click a cell while it is lit. Faster hits score more, consecutive hits build a multiplier up to ×8, and a miss or a fade resets it. Gold cells are worth triple and last half as long.",
  keyboard: false,
  Component: ReflexGrid,
};
