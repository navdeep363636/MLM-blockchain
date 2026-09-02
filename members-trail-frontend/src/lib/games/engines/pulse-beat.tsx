"use client";

/* Pulse Beat — the rhythm engine.
 *
 * Notes fall down four lanes toward a judgement line; the player hits the lane
 * as a note crosses it. What is being measured is timing precision, and nothing
 * else: every note is worth the same before its judgement, so the only way to
 * score is to be accurate, and the only way to score well is to stay accurate.
 *
 * The whole chart is generated up front from the session seed rather than
 * spawned as the run goes. Two reasons: a chart that is a pure function of the
 * seed is the same chart for every player in a tournament, which is the claim
 * the lobby makes; and a rhythm game whose notes are decided frame-by-frame
 * cannot guarantee a playable gap between consecutive notes in a lane.
 *
 * Intensity raises the note density and the fall speed together — a dense chart
 * at a crawl is busy rather than hard, and a sparse one at speed is just a
 * reaction test. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { EngineDefinition, EngineProps } from "../types";

const LANES = 4;
const LANE_KEYS = ["d", "f", "j", "k"] as const;

/** Judgement windows in milliseconds, measured either side of the line. */
const PERFECT_MS = 55;
const GREAT_MS = 110;
const GOOD_MS = 180;

const MAX_COMBO = 12;

type Judgement = "perfect" | "great" | "good" | "miss";

const JUDGEMENT_STYLE: Record<Judgement, { label: string; className: string; multiplier: number }> = {
  perfect: { label: "PERFECT", className: "text-[var(--accent-hover)]", multiplier: 1 },
  great: { label: "GREAT", className: "text-success-400", multiplier: 0.65 },
  good: { label: "GOOD", className: "text-warning-400", multiplier: 0.3 },
  miss: { label: "MISS", className: "text-danger-400", multiplier: 0 },
};

interface Note {
  id: number;
  lane: number;
  /** Milliseconds from the start of the run at which the note meets the line. */
  atMs: number;
}

/**
 * Builds the chart for a whole run.
 *
 * The per-lane cooldown is the important part: without it the seed will
 * eventually place two notes 30ms apart in one lane, which is not a hard
 * passage, it is an unhittable one. Chords across *different* lanes are left
 * alone — those are the interesting bits.
 */
export function buildChart(rng: { next(): number; int(min: number, max: number): number }, durationMs: number, intensity: number): Note[] {
  const gapMs = 620 - Math.round(intensity * 300);
  const laneCooldownMs = 260;
  const lastInLane = new Array<number>(LANES).fill(-Infinity);
  const notes: Note[] = [];

  /* Two bars of lead-in, so the first note is readable rather than already at
   * the line when the run starts. */
  let t = 1_800;
  let id = 0;

  while (t < durationMs - 600) {
    /* A chord is one to three simultaneous notes; denser charts see them more
     * often, which is what makes a high-intensity title feel heavier without
     * simply speeding everything up. */
    const chordSize = rng.next() < 0.18 + intensity * 0.22 ? rng.int(2, 3) : 1;
    const lanes = new Set<number>();
    for (let i = 0; i < chordSize * 2 && lanes.size < chordSize; i += 1) {
      const lane = rng.int(0, LANES - 1);
      if (t - lastInLane[lane] >= laneCooldownMs) lanes.add(lane);
    }
    for (const lane of lanes) {
      notes.push({ id: id++, lane, atMs: t });
      lastInLane[lane] = t;
    }
    /* Swing the gap a little so the chart reads as a rhythm rather than a
     * metronome, but never below the cooldown. */
    t += Math.max(laneCooldownMs, Math.round(gapMs * (0.7 + rng.next() * 0.7)));
  }
  return notes;
}

function PulseBeat({ rng, tuning, onScore, onFinish, paused }: EngineProps) {
  const durationMs = tuning.durationSeconds * 1_000;
  /* How long a note is on screen. Faster charts give less reading time, which
   * is the difficulty; below ~700ms it stops being readable at all. */
  const travelMs = 1_500 - Math.round(tuning.intensity * 700);

  const chart = useMemo(
    () => buildChart(rng, durationMs, tuning.intensity),
    [rng, durationMs, tuning.intensity],
  );

  /* Elapsed time is derived from the clock, not accumulated per frame: a frame
   * drop must not shift the whole chart out from under the player. */
  const startedAt = useRef(0);
  const pausedSince = useRef(0);
  const pausedTotal = useRef(0);
  const judged = useRef(new Map<number, Judgement>());
  const comboRef = useRef(1);

  const [, setTick] = useState(0);
  const [combo, setCombo] = useState(1);
  const [flash, setFlash] = useState<{ judgement: Judgement; at: number } | null>(null);
  const [lit, setLit] = useState<number[]>([]);
  const [tally, setTally] = useState<Record<Judgement, number>>({ perfect: 0, great: 0, good: 0, miss: 0 });

  const elapsed = useCallback(() => {
    if (startedAt.current === 0) return 0;
    const frozen = pausedSince.current > 0 ? performance.now() - pausedSince.current : 0;
    return performance.now() - startedAt.current - pausedTotal.current - frozen;
  }, []);

  /* Pausing has to stop the chart, not just the render loop — otherwise the
   * notes a player paused in front of are gone when they come back. */
  useEffect(() => {
    if (paused) {
      if (pausedSince.current === 0) pausedSince.current = performance.now();
      return;
    }
    if (pausedSince.current > 0) {
      pausedTotal.current += performance.now() - pausedSince.current;
      pausedSince.current = 0;
    }
    if (startedAt.current === 0) startedAt.current = performance.now();
  }, [paused]);

  const record = useCallback(
    (judgement: Judgement) => {
      setTally((t) => ({ ...t, [judgement]: t[judgement] + 1 }));
      setFlash({ judgement, at: performance.now() });
      if (judgement === "miss") {
        comboRef.current = 1;
        setCombo(1);
        return;
      }
      const value = Math.round(tuning.baseScore * JUDGEMENT_STYLE[judgement].multiplier * comboRef.current);
      if (value > 0) onScore(value);
      /* Only a clean hit builds the chain. A "good" keeps it alive but does not
       * grow it, so a sloppy run plateaus instead of coasting to the ceiling. */
      if (judgement === "perfect" || judgement === "great") {
        comboRef.current = Math.min(MAX_COMBO, comboRef.current + 1);
        setCombo(comboRef.current);
      }
    },
    [tuning.baseScore, onScore],
  );

  /* One rAF loop: advances the render, retires notes that fell past the window,
   * and ends the run when the chart is spent. */
  useEffect(() => {
    if (paused) return;
    let raf = 0;
    const step = () => {
      const now = elapsed();
      for (const note of chart) {
        if (judged.current.has(note.id)) continue;
        if (now - note.atMs > GOOD_MS) {
          judged.current.set(note.id, "miss");
          record("miss");
        }
      }
      if (now >= durationMs) {
        onFinish();
        return;
      }
      setTick((t) => t + 1);
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [paused, chart, elapsed, record, durationMs, onFinish]);

  const strike = useCallback(
    (lane: number) => {
      if (paused) return;
      setLit((l) => (l.includes(lane) ? l : [...l, lane]));
      window.setTimeout(() => setLit((l) => l.filter((x) => x !== lane)), 90);

      const now = elapsed();
      let best: Note | null = null;
      let bestDelta = Infinity;
      for (const note of chart) {
        if (note.lane !== lane || judged.current.has(note.id)) continue;
        const delta = Math.abs(note.atMs - now);
        if (delta < bestDelta) {
          best = note;
          bestDelta = delta;
        }
      }
      /* A press with no note anywhere near it is ignored rather than punished.
       * Punishing it would make lane-mashing risky but still viable on a dense
       * chart; ignoring it makes it worth exactly nothing, which is the point. */
      if (!best || bestDelta > GOOD_MS) return;

      const judgement: Judgement =
        bestDelta <= PERFECT_MS ? "perfect" : bestDelta <= GREAT_MS ? "great" : "good";
      judged.current.set(best.id, judgement);
      record(judgement);
    },
    [paused, chart, elapsed, record],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const lane = LANE_KEYS.indexOf(e.key.toLowerCase() as (typeof LANE_KEYS)[number]);
      if (lane === -1) return;
      e.preventDefault();
      strike(lane);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [strike]);

  const now = elapsed();
  const hits = tally.perfect + tally.great + tally.good;
  const accuracy = hits + tally.miss === 0 ? 100 : Math.round((hits / (hits + tally.miss)) * 100);
  const showFlash = flash && performance.now() - flash.at < 420 ? flash.judgement : null;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-text-muted">Hit each lane as its note crosses the line</span>
        <span className="flex items-center gap-3">
          <span className="tnum text-text-muted">{accuracy}% acc</span>
          <span className={cn("tnum", combo > 1 ? "text-[var(--accent-hover)]" : "text-text-muted")}>
            ×{combo} chain
          </span>
        </span>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border-subtle bg-surface-inset">
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${LANES}, minmax(0, 1fr))` }}>
          {Array.from({ length: LANES }, (_, lane) => (
            <div key={lane} className="relative border-r border-border-subtle last:border-r-0">
              {chart.map((note) => {
                if (note.lane !== lane) return null;
                const progress = (now - (note.atMs - travelMs)) / travelMs;
                if (progress < -0.05 || progress > 1.2) return null;
                const verdict = judged.current.get(note.id);
                if (verdict && verdict !== "miss") return null;
                return (
                  <span
                    key={note.id}
                    aria-hidden
                    className={cn(
                      "absolute inset-x-2 h-3 rounded-full",
                      verdict === "miss"
                        ? "bg-danger-500/30"
                        : "bg-[var(--accent)] [box-shadow:0_0_18px_-4px_var(--accent)]",
                    )}
                    /* Positioned as a percentage of the lane so the chart
                       scales with the viewport instead of drifting off a
                       hard-coded pixel height. */
                    style={{ top: `calc(${Math.min(100, progress * 100)}% - 6px)` }}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* Judgement line, at the bottom of the travel. */}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--accent-hover)] opacity-70"
        />

        {showFlash && (
          <span
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-[18%] text-center font-display text-lg font-bold tracking-widest",
              JUDGEMENT_STYLE[showFlash].className,
            )}
          >
            {JUDGEMENT_STYLE[showFlash].label}
          </span>
        )}
      </div>

      {/* Lane pads. Present for touch, and they double as the key legend. */}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${LANES}, minmax(0, 1fr))` }}>
        {Array.from({ length: LANES }, (_, lane) => (
          <button
            key={lane}
            type="button"
            onPointerDown={() => strike(lane)}
            aria-label={`Lane ${lane + 1} — key ${LANE_KEYS[lane].toUpperCase()}`}
            className={cn(
              "h-12 rounded-xl border text-sm font-bold uppercase transition-[background-color,border-color] duration-75",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
              lit.includes(lane)
                ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                : "border-border-default bg-surface-2 text-text-secondary",
            )}
          >
            {LANE_KEYS[lane]}
          </button>
        ))}
      </div>
    </div>
  );
}

export const pulseBeat: EngineDefinition = {
  key: "pulse-beat",
  name: "Rhythm Lanes",
  howToPlay:
    "Notes fall down four lanes. Hit D, F, J or K — or the pad below the lane — exactly as a note crosses the line at the bottom. Perfect timing scores full value, Great scores about two thirds, Good scores a little, and a note you let past scores nothing and breaks your chain. Clean hits build the chain up to ×12.",
  keyboard: false,
  Component: PulseBeat,
};
