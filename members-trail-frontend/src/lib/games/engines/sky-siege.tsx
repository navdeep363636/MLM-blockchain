"use client";

/* Sky Siege — the wave-defence engine.
 *
 * Raiders descend six columns toward a shield line; a turret tracks left and
 * right along the bottom and fires up the column it is standing in. Waves get
 * faster and denser on a fixed clock, so the run ends when the player's reading
 * of the board falls behind the escalation — or when the shields are gone.
 *
 * The one mechanic that makes this its own game rather than a decorated reflex
 * test is that a shot takes time to travel. Tapping a raider does nothing; the
 * player has to fire where a raider is going to be, and has to choose which of
 * six columns is worth the turret's next second. Nothing about that is
 * measurable in a game where clicking the target is the whole interaction.
 *
 * Intensity raises the descent speed and tightens the spawn interval; the
 * escalation per wave is on top of it, so a high-intensity title starts hard
 * rather than merely arriving there sooner. */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { EngineDefinition, EngineProps } from "../types";

const COLUMNS = 6;
const SHIELDS = 3;

/** Seconds of play before the next difficulty tier. */
const WAVE_SECONDS = 14;

/** Fractions of the field per second. The field is 0 (top) … 1 (shield line). */
const SHOT_SPEED = 1.55;
const HIT_RADIUS = 0.05;

const FIRE_COOLDOWN_MS = 240;

interface Raider {
  id: number;
  column: number;
  y: number;
  speed: number;
  /** Armoured raiders take two hits and are worth double. */
  hp: number;
  armoured: boolean;
}

interface Shot {
  id: number;
  column: number;
  y: number;
}

function SkySiege({ rng, tuning, onScore, onFinish, paused }: EngineProps) {
  const raiders = useRef<Raider[]>([]);
  const shots = useRef<Shot[]>([]);
  const nextId = useRef(0);
  const lastFrame = useRef(0);
  const nextSpawn = useRef(0);
  const lastFired = useRef(0);
  const runMs = useRef(0);

  const [, setTick] = useState(0);
  const [turret, setTurret] = useState(Math.floor(COLUMNS / 2));
  const [shields, setShields] = useState(SHIELDS);
  const [wave, setWave] = useState(1);
  const [breach, setBreach] = useState(0);

  const turretRef = useRef(turret);
  turretRef.current = turret;
  const waveRef = useRef(wave);
  waveRef.current = wave;

  const fire = useCallback(() => {
    if (paused) return;
    const now = performance.now();
    if (now - lastFired.current < FIRE_COOLDOWN_MS) return;
    lastFired.current = now;
    shots.current.push({ id: nextId.current++, column: turretRef.current, y: 1 });
  }, [paused]);

  const moveTo = useCallback(
    (column: number) => {
      if (paused) return;
      setTurret(Math.max(0, Math.min(COLUMNS - 1, column)));
    },
    [paused],
  );

  /* Tapping a column both aims and fires. On touch there is no second input to
   * spend on a separate trigger, and an aim-only tap would leave the player
   * double-tapping every raider. */
  const tapColumn = useCallback(
    (column: number) => {
      moveTo(column);
      turretRef.current = column;
      fire();
    },
    [moveTo, fire],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "a") {
        e.preventDefault();
        moveTo(turretRef.current - 1);
      } else if (k === "arrowright" || k === "d") {
        e.preventDefault();
        moveTo(turretRef.current + 1);
      } else if (k === " " || k === "arrowup" || k === "w") {
        e.preventDefault();
        fire();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveTo, fire]);

  useEffect(() => {
    if (breach === 0) return;
    const id = window.setTimeout(() => setBreach(0), 320);
    return () => window.clearTimeout(id);
  }, [breach]);

  /* A single simulation loop. Spawning, movement, collision and the shield
   * check all read the same `dt`, so a slow frame degrades the whole board
   * evenly instead of letting raiders outrun the shots that were fired at
   * them. */
  useEffect(() => {
    if (paused) {
      lastFrame.current = 0;
      return;
    }
    let raf = 0;
    const step = () => {
      const now = performance.now();
      const dt = lastFrame.current === 0 ? 0 : Math.min(0.05, (now - lastFrame.current) / 1_000);
      lastFrame.current = now;
      runMs.current += dt * 1_000;

      const tier = Math.floor(runMs.current / (WAVE_SECONDS * 1_000)) + 1;
      if (tier !== waveRef.current) setWave(tier);

      const descent = (0.09 + tuning.intensity * 0.09) * (1 + (tier - 1) * 0.16);
      const spawnEveryMs = Math.max(
        320,
        (1_250 - tuning.intensity * 500) * Math.pow(0.87, tier - 1),
      );

      if (now >= nextSpawn.current) {
        nextSpawn.current = now + spawnEveryMs;
        /* Armour appears from the second tier on, and gets commoner: it is the
         * escalation the player can answer with aim rather than with speed. */
        const armoured = tier > 1 && rng.next() < Math.min(0.4, 0.1 * (tier - 1));
        raiders.current.push({
          id: nextId.current++,
          column: rng.int(0, COLUMNS - 1),
          y: -0.05,
          speed: descent * (0.85 + rng.next() * 0.4) * (armoured ? 0.8 : 1),
          hp: armoured ? 2 : 1,
          armoured,
        });
      }

      for (const shot of shots.current) shot.y -= SHOT_SPEED * dt;
      for (const raider of raiders.current) raider.y += raider.speed * dt;

      const spent = new Set<number>();
      for (const shot of shots.current) {
        if (shot.y < -0.05) {
          spent.add(shot.id);
          continue;
        }
        /* Lowest raider first: a shot should meet the one nearest the shields,
         * not whichever happens to sit earliest in the array. */
        const target = raiders.current
          .filter((r) => r.column === shot.column && Math.abs(r.y - shot.y) <= HIT_RADIUS)
          .sort((a, b) => b.y - a.y)[0];
        if (!target) continue;
        spent.add(shot.id);
        target.hp -= 1;
        if (target.hp <= 0) {
          target.y = 99;
          onScore(Math.round(tuning.baseScore * (1 + 0.2 * (tier - 1)) * (target.armoured ? 2 : 1)));
        }
      }
      if (spent.size > 0) shots.current = shots.current.filter((s) => !spent.has(s.id));

      let lost = 0;
      raiders.current = raiders.current.filter((r) => {
        if (r.y > 90) return false;
        if (r.y >= 1) {
          lost += 1;
          return false;
        }
        return true;
      });
      if (lost > 0) {
        setBreach((b) => b + lost);
        setShields((s) => {
          const left = s - lost;
          if (left <= 0) {
            /* Out of shields ends the run early — the host still owns the
             * clock, this just reaches the end of it sooner. */
            onFinish();
            return 0;
          }
          return left;
        });
      }

      setTick((t) => t + 1);
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [paused, rng, tuning.intensity, tuning.baseScore, onScore, onFinish]);

  const columns = Array.from({ length: COLUMNS }, (_, i) => i);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-text-muted">Wave {wave} · lead your shots</span>
        <span className="flex items-center gap-1.5">
          {Array.from({ length: SHIELDS }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                "size-2.5 rounded-sm",
                i < shields ? "bg-success-500" : "border border-border-default",
              )}
            />
          ))}
          <span className="sr-only">{shields} shields remaining</span>
        </span>
      </div>

      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden rounded-xl border bg-surface-inset transition-colors duration-150",
          breach > 0 ? "border-danger-400" : "border-border-subtle",
        )}
      >
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))` }}>
          {columns.map((column) => (
            <button
              key={column}
              type="button"
              onPointerDown={() => tapColumn(column)}
              aria-label={`Column ${column + 1} — aim and fire`}
              className={cn(
                "relative border-r border-border-subtle last:border-r-0",
                "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]",
                turret === column && "bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]",
              )}
            >
              {raiders.current
                .filter((r) => r.column === column && r.y > -0.1 && r.y < 1.05)
                .map((r) => (
                  <span
                    key={r.id}
                    aria-hidden
                    className={cn(
                      "absolute inset-x-[18%] rounded-md",
                      r.armoured
                        ? "h-4 border-2 border-warning-400 bg-warning-500/40"
                        : "h-3.5 bg-danger-500 [box-shadow:0_0_16px_-4px_var(--color-danger-500,#ef4444)]",
                    )}
                    style={{ top: `calc(${r.y * 100}% - 7px)` }}
                  />
                ))}
              {shots.current
                .filter((s) => s.column === column)
                .map((s) => (
                  <span
                    key={s.id}
                    aria-hidden
                    className="absolute inset-x-[44%] h-4 rounded-full bg-[var(--accent-hover)]"
                    style={{ top: `calc(${s.y * 100}% - 8px)` }}
                  />
                ))}
            </button>
          ))}
        </div>

        {/* Shield line, and the turret sitting on it. */}
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-success-500/70" />
        <span
          aria-hidden
          className="absolute bottom-0 h-3 rounded-t-md bg-[var(--accent)] transition-[left] duration-100"
          style={{ left: `${(turret + 0.28) * (100 / COLUMNS)}%`, width: `${(100 / COLUMNS) * 0.44}%` }}
        />
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: "1fr auto 1fr" }}>
        <button
          type="button"
          onPointerDown={() => moveTo(turret - 1)}
          aria-label="Move turret left"
          className="h-11 rounded-xl border border-border-default bg-surface-2 text-sm font-bold text-text-secondary"
        >
          ←
        </button>
        <button
          type="button"
          onPointerDown={fire}
          aria-label="Fire"
          className="h-11 rounded-xl bg-[var(--accent)] px-8 text-sm font-bold uppercase tracking-wide text-white"
        >
          Fire
        </button>
        <button
          type="button"
          onPointerDown={() => moveTo(turret + 1)}
          aria-label="Move turret right"
          className="h-11 rounded-xl border border-border-default bg-surface-2 text-sm font-bold text-text-secondary"
        >
          →
        </button>
      </div>
    </div>
  );
}

export const skySiege: EngineDefinition = {
  key: "sky-siege",
  name: "Wave Defence",
  howToPlay:
    "Track the turret with ← → or A / D and fire with space — or tap a column to do both at once. Shots travel, so aim ahead of a raider rather than at it. Amber raiders are armoured: two hits, double the points. Every raider that reaches the shield line costs a shield, and losing all three ends the run. A new wave lands every fourteen seconds, faster and heavier than the last.",
  keyboard: false,
  Component: SkySiege,
};
