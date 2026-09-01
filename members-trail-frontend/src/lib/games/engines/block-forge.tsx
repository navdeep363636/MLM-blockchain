"use client";

/* Block Forge — the strategy engine.
 *
 * Falling tetrominoes on a narrow well. Clearing rows scores, and clearing
 * several at once scores far more, so the strategy is building a stack you can
 * cash in rather than surviving one piece at a time.
 *
 * The piece order comes from the session seed, so two players on the same board
 * get the same pieces in the same order — which is the only way a puzzle title
 * can be ranked fairly. */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EngineDefinition, EngineProps } from "../types";

const COLS = 8;
const ROWS = 16;

/** Each shape as a list of [row, col] offsets, in its four rotations. */
const SHAPES: readonly (readonly [number, number][])[] = [
  [[0, 0], [0, 1], [1, 0], [1, 1]], // O
  [[0, 0], [0, 1], [0, 2], [0, 3]], // I
  [[0, 0], [1, 0], [1, 1], [1, 2]], // J
  [[0, 2], [1, 0], [1, 1], [1, 2]], // L
  [[0, 1], [0, 2], [1, 0], [1, 1]], // S
  [[0, 0], [0, 1], [1, 1], [1, 2]], // Z
  [[0, 1], [1, 0], [1, 1], [1, 2]], // T
];

/** Score per simultaneous line clear. Four at once is worth more than four ones. */
const LINE_MULTIPLIER = [0, 1, 3, 6, 11] as const;

type Grid = (number | null)[][];
type Piece = { cells: [number, number][]; row: number; col: number; shape: number };

const emptyGrid = (): Grid => Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null));

function rotate(cells: [number, number][]): [number, number][] {
  const maxRow = Math.max(...cells.map(([r]) => r));
  return cells.map(([r, c]) => [c, maxRow - r] as [number, number]);
}

function BlockForge({ rng, tuning, onScore, onFinish, paused }: EngineProps) {
  const [grid, setGrid] = useState<Grid>(emptyGrid);
  const [piece, setPiece] = useState<Piece | null>(null);
  const [lines, setLines] = useState(0);
  const [flash, setFlash] = useState(false);
  const stateRef = useRef({ grid, piece });
  stateRef.current = { grid, piece };

  const dropMs = 620 - Math.round(tuning.intensity * 320);

  const fits = useCallback((g: Grid, cells: [number, number][], row: number, col: number) =>
    cells.every(([r, c]) => {
      const rr = row + r;
      const cc = col + c;
      return cc >= 0 && cc < COLS && rr < ROWS && (rr < 0 || g[rr][cc] === null);
    }), []);

  const spawn = useCallback(() => {
    const shape = rng.int(0, SHAPES.length - 1);
    const cells = SHAPES[shape].map(([r, c]) => [r, c] as [number, number]);
    const width = Math.max(...cells.map(([, c]) => c)) + 1;
    const col = rng.int(0, COLS - width);
    const next: Piece = { cells, row: -1, col, shape };
    if (!fits(stateRef.current.grid, cells, next.row, next.col)) {
      /* The well is full to the top: the run is over, not merely stuck. */
      onFinish();
      return;
    }
    setPiece(next);
  }, [rng, fits, onFinish]);

  useEffect(() => {
    if (piece === null && !paused) spawn();
  }, [piece, paused, spawn]);

  /** Freezes the piece, clears any full rows and scores them. */
  const settle = useCallback((p: Piece) => {
    setGrid((g) => {
      const next = g.map((row) => [...row]);
      for (const [r, c] of p.cells) {
        const rr = p.row + r;
        if (rr >= 0) next[rr][p.col + c] = p.shape;
      }
      const kept = next.filter((row) => row.some((cell) => cell === null));
      const cleared = ROWS - kept.length;
      if (cleared > 0) {
        setLines((n) => n + cleared);
        setFlash(true);
        onScore(tuning.baseScore * LINE_MULTIPLIER[Math.min(cleared, 4)] * 10);
        while (kept.length < ROWS) kept.unshift(Array.from({ length: COLS }, () => null));
        return kept;
      }
      /* A placement that clears nothing still moved the game forward. Scoring it
       * a little keeps a careful stack-builder from being out-scored by someone
       * who only ever clears single rows. */
      onScore(tuning.baseScore);
      return next;
    });
    setPiece(null);
  }, [onScore, tuning.baseScore]);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(false), 220);
    return () => window.clearTimeout(id);
  }, [flash]);

  /* Gravity. */
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      const p = stateRef.current.piece;
      if (!p) return;
      if (fits(stateRef.current.grid, p.cells, p.row + 1, p.col)) {
        setPiece({ ...p, row: p.row + 1 });
      } else {
        settle(p);
      }
    }, dropMs);
    return () => window.clearInterval(id);
  }, [paused, dropMs, fits, settle]);

  const nudge = useCallback((dCol: number) => {
    const p = stateRef.current.piece;
    if (!p || !fits(stateRef.current.grid, p.cells, p.row, p.col + dCol)) return;
    setPiece({ ...p, col: p.col + dCol });
  }, [fits]);

  const spin = useCallback(() => {
    const p = stateRef.current.piece;
    if (!p) return;
    const turned = rotate(p.cells);
    /* Try the rotation in place, then one column either side — a wall kick, so
     * rotating against the edge is not silently a no-op. */
    for (const shift of [0, -1, 1]) {
      if (fits(stateRef.current.grid, turned, p.row, p.col + shift)) {
        setPiece({ ...p, cells: turned, col: p.col + shift });
        return;
      }
    }
  }, [fits]);

  const drop = useCallback(() => {
    const p = stateRef.current.piece;
    if (!p) return;
    let row = p.row;
    while (fits(stateRef.current.grid, p.cells, row + 1, p.col)) row += 1;
    settle({ ...p, row });
  }, [fits, settle]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paused) return;
      const map: Record<string, () => void> = {
        ArrowLeft: () => nudge(-1), a: () => nudge(-1),
        ArrowRight: () => nudge(1), d: () => nudge(1),
        ArrowUp: spin, w: spin,
        ArrowDown: drop, s: drop, " ": drop,
      };
      const fn = map[e.key];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nudge, spin, drop, paused]);

  const filled = new Set<string>();
  if (piece) {
    for (const [r, c] of piece.cells) filled.add(`${piece.row + r}:${piece.col + c}`);
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-text-muted">← → move · ↑ rotate · ↓ drop</span>
        <span className="tnum text-text-muted">{lines} lines</span>
      </div>

      <div className="flex min-h-0 flex-1 justify-center">
        <div
          className={cn(
            "grid gap-[2px] rounded-xl border p-1 transition-colors duration-150",
            flash ? "border-success-400 bg-success-500/10" : "border-border-subtle bg-surface-inset",
          )}
          style={{
            gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))`,
            aspectRatio: `${COLS} / ${ROWS}`,
          }}
        >
          {grid.flatMap((row, r) =>
            row.map((cell, c) => {
              const active = filled.has(`${r}:${c}`);
              return (
                <div
                  key={`${r}:${c}`}
                  className={cn(
                    "rounded-[3px]",
                    active && "bg-[var(--accent)]",
                    !active && cell !== null && "bg-text-muted/55",
                    !active && cell === null && "bg-surface-1/60",
                  )}
                />
              );
            }),
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 sm:hidden">
        <button type="button" onPointerDown={() => nudge(-1)} aria-label="Move left"
          className="grid place-items-center rounded-xl border border-border-default bg-surface-inset py-3 text-text-secondary active:bg-surface-1">
          <ArrowLeft className="size-5" />
        </button>
        <button type="button" onPointerDown={spin} aria-label="Rotate"
          className="grid place-items-center rounded-xl border border-border-default bg-surface-inset py-3 text-text-secondary active:bg-surface-1">
          <RotateCw className="size-5" />
        </button>
        <button type="button" onPointerDown={drop} aria-label="Drop"
          className="grid place-items-center rounded-xl border border-border-default bg-surface-inset py-3 text-text-secondary active:bg-surface-1">
          <ArrowDown className="size-5" />
        </button>
        <button type="button" onPointerDown={() => nudge(1)} aria-label="Move right"
          className="grid place-items-center rounded-xl border border-border-default bg-surface-inset py-3 text-text-secondary active:bg-surface-1">
          <ArrowRight className="size-5" />
        </button>
      </div>
    </div>
  );
}

export const blockForge: EngineDefinition = {
  key: "block-forge",
  name: "Block Forge",
  howToPlay:
    "Move with ← →, rotate with ↑, hard-drop with ↓ or space. Clearing rows scores; clearing two, three or four at once is worth three, six and eleven times a single. Filling the well to the top ends the run.",
  keyboard: true,
  Component: BlockForge,
};
