"use client";

/* Hex Tactics — the turn-based strategy engine.
 *
 * A hex board of coloured cells. The player holds the bottom-left corner, the
 * opponent the top-right. On your turn you name a colour: everything you own
 * becomes that colour, and every adjacent cell already of that colour joins you.
 * Then the opponent does the same. The board fills, and whoever holds more of it
 * when it does has won the skirmish.
 *
 * Nothing here is timed and nothing is reflex. A turn is worth thinking about
 * because the colour that captures most cells now is frequently the colour that
 * hands the opponent a frontier next turn — and because a colour the opponent
 * currently holds is illegal, so a good move also denies one.
 *
 * That is the reason this exists as its own engine rather than as Block Forge
 * with slower pieces: a tile-dropping game measures how fast you can place, and
 * the ladder this title advertises is meant to measure something else.
 *
 * Intensity widens the palette and the board — more colours is a wider search,
 * a bigger board is a longer one. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { EngineDefinition, EngineProps } from "../types";

/** Cells carry an index into this, never a raw colour: the label is what makes
 *  the board readable to a player who cannot separate the hues. */
const PALETTE = [
  { label: "1", css: "var(--accent)" },
  { label: "2", css: "var(--color-success-500, #22c55e)" },
  { label: "3", css: "var(--color-warning-500, #f59e0b)" },
  { label: "4", css: "var(--color-danger-500, #ef4444)" },
  { label: "5", css: "var(--color-info-500, #3b82f6)" },
  { label: "6", css: "#a78bfa" },
  { label: "7", css: "#22d3ee" },
] as const;

const HEX_CLIP = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";

export type Owner = 0 | 1 | 2;
const NONE: Owner = 0;
const PLAYER: Owner = 1;
const RIVAL: Owner = 2;

export interface Board {
  cols: number;
  rows: number;
  colour: number[];
  owner: Owner[];
}

/**
 * Odd-r offset neighbours. Getting this wrong is invisible on a rectangular
 * grid and fatal on a hex one: the flood silently leaks along the wrong
 * diagonal and captures territory the player cannot see a path to.
 */
export function neighbours(index: number, cols: number, rows: number): number[] {
  const r = Math.floor(index / cols);
  const c = index % cols;
  const odd = r % 2 === 1;
  const candidates: Array<[number, number]> = [
    [r, c - 1],
    [r, c + 1],
    [r - 1, odd ? c : c - 1],
    [r - 1, odd ? c + 1 : c],
    [r + 1, odd ? c : c - 1],
    [r + 1, odd ? c + 1 : c],
  ];
  const out: number[] = [];
  for (const [nr, nc] of candidates) {
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
    out.push(nr * cols + nc);
  }
  return out;
}

/** Cells a side would absorb by claiming `colour`, not counting what it holds. */
export function gainFor(board: Board, side: Owner, colour: number): number {
  const { cols, rows } = board;
  const claimed = new Set<number>();
  const queue: number[] = [];

  for (let i = 0; i < board.owner.length; i += 1) {
    if (board.owner[i] === side) queue.push(i);
  }
  while (queue.length > 0) {
    const at = queue.pop() as number;
    for (const n of neighbours(at, cols, rows)) {
      if (board.owner[n] !== NONE || claimed.has(n) || board.colour[n] !== colour) continue;
      claimed.add(n);
      queue.push(n);
    }
  }
  return claimed.size;
}

/** Applies a claim in place and returns how many cells it took. */
export function claim(board: Board, side: Owner, colour: number): number {
  const { cols, rows } = board;
  const queue: number[] = [];
  for (let i = 0; i < board.owner.length; i += 1) {
    if (board.owner[i] === side) {
      board.colour[i] = colour;
      queue.push(i);
    }
  }
  let taken = 0;
  while (queue.length > 0) {
    const at = queue.pop() as number;
    for (const n of neighbours(at, cols, rows)) {
      if (board.owner[n] !== NONE || board.colour[n] !== colour) continue;
      board.owner[n] = side;
      taken += 1;
      queue.push(n);
    }
  }
  return taken;
}

function count(board: Board, side: Owner): number {
  let n = 0;
  for (const o of board.owner) if (o === side) n += 1;
  return n;
}

function HexTactics({ rng, tuning, onScore, paused }: EngineProps) {
  const cols = 9 + Math.round(tuning.intensity * 3);
  const rows = 9 + Math.round(tuning.intensity * 3);
  const paletteSize = 5 + Math.round(tuning.intensity * 2);

  const make = useCallback((): Board => {
    const colour = Array.from({ length: cols * rows }, () => rng.int(0, paletteSize - 1));
    const owner = new Array<Owner>(cols * rows).fill(NONE);
    const playerStart = (rows - 1) * cols;
    const rivalStart = cols - 1;
    /* The two starts must differ, or the first player to move captures the
     * other outright and the skirmish is over before it begins. */
    if (colour[playerStart] === colour[rivalStart]) {
      colour[rivalStart] = (colour[rivalStart] + 1) % paletteSize;
    }
    owner[playerStart] = PLAYER;
    owner[rivalStart] = RIVAL;
    return { cols, rows, colour, owner };
  }, [rng, cols, rows, paletteSize]);

  /* Dealt during the first render rather than from a mount effect. Dealing in
   * an effect left `board` null for a frame, so the engine rendered nothing at
   * all on mount — a blank canvas where the board should be. */
  const [round, setRound] = useState(1);
  const [board, setBoard] = useState<Board>(make);
  const [turn, setTurn] = useState<"player" | "rival">("player");
  const [banner, setBanner] = useState<string | null>(null);

  const deal = useCallback(() => {
    setBoard(make());
    setTurn("player");
    setBanner(null);
  }, [make]);

  const settle = useCallback(
    (next: Board) => {
      const mine = count(next, PLAYER);
      const theirs = count(next, RIVAL);
      if (mine + theirs < next.owner.length) return false;
      /* Holding the board is the objective, so the win is where the points are.
       * Per-cell scoring alone would reward a player who grabs a big early
       * frontier and then loses the board. */
      if (mine > theirs) onScore(Math.round(tuning.baseScore * 12));
      setBanner(mine > theirs ? `Board taken ${mine}–${theirs}` : `Board lost ${mine}–${theirs}`);
      return true;
    },
    [onScore, tuning.baseScore],
  );

  const rivalColour = board.colour[board.owner.indexOf(RIVAL)] ?? -1;
  const playerColour = board.colour[board.owner.indexOf(PLAYER)] ?? -1;

  /* The opponent plays greedy: the legal colour that takes the most cells this
   * turn. It is beatable by anyone who thinks a move ahead, which is the point —
   * a perfect opponent would make the ladder a coin flip on who moves first. */
  useEffect(() => {
    if (turn !== "rival" || paused || banner) return;
    const id = window.setTimeout(() => {
      const next: Board = { ...board, colour: [...board.colour], owner: [...board.owner] };
      const mine = next.colour[next.owner.indexOf(RIVAL)];
      const theirs = next.colour[next.owner.indexOf(PLAYER)];
      let best = -1;
      let bestGain = -1;
      for (let c = 0; c < paletteSize; c += 1) {
        if (c === mine || c === theirs) continue;
        const gain = gainFor(next, RIVAL, c);
        if (gain > bestGain) {
          bestGain = gain;
          best = c;
        }
      }
      if (best >= 0) claim(next, RIVAL, best);
      setBoard(next);
      if (!settle(next)) setTurn("player");
    }, 420);
    return () => window.clearTimeout(id);
  }, [board, turn, paused, banner, paletteSize, settle]);

  /* A finished board rolls into the next one, harder by a colour, until the
   * host's clock runs out. */
  useEffect(() => {
    if (!banner || paused) return;
    const id = window.setTimeout(() => {
      setRound((r) => r + 1);
      deal();
    }, 1_500);
    return () => window.clearTimeout(id);
  }, [banner, paused, deal]);

  const play = useCallback(
    (colour: number) => {
      if (paused || turn !== "player" || banner) return;
      if (colour === playerColour || colour === rivalColour) return;
      const next: Board = { ...board, colour: [...board.colour], owner: [...board.owner] };
      const taken = claim(next, PLAYER, colour);
      if (taken > 0) onScore(Math.round(tuning.baseScore * 0.35 * taken));
      setBoard(next);
      if (!settle(next)) setTurn("rival");
    },
    [board, paused, turn, banner, playerColour, rivalColour, onScore, tuning.baseScore, settle],
  );

  const geometry = useMemo(() => {
    /* Pointy-top hexes overlap vertically by a quarter, so the board is
     * (cols + 0.5) wide and (rows * 0.75 + 0.25) tall in hex units. */
    const w = 100 / (cols + 0.5);
    const h = 100 / (rows * 0.75 + 0.25);
    return { w, h, ratio: (cols + 0.5) / ((rows * 0.75 + 0.25) * 1.1547) };
  }, [cols, rows]);

  const mine = count(board, PLAYER);
  const theirs = count(board, RIVAL);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-text-muted">Skirmish {round} · claim a colour to grow</span>
        <span className="tnum flex items-center gap-2">
          <span className="text-[var(--accent-hover)]">You {mine}</span>
          <span className="text-text-muted">/</span>
          <span className="text-text-muted">Rival {theirs}</span>
        </span>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {/* The play canvas is 16/9 and the board is roughly square, so the fit
            is height-driven: fix the height, let the aspect ratio pick the
            width, and clamp it in case a narrow viewport inverts that. */}
        <div
          className="relative h-full max-w-full"
          style={{ aspectRatio: String(geometry.ratio) }}
        >
          {board.colour.map((c, i) => {
            const r = Math.floor(i / cols);
            const col = i % cols;
            const owner = board.owner[i];
            return (
              <span
                key={i}
                aria-hidden
                className="absolute grid place-items-center text-[9px] font-bold"
                style={{
                  left: `${(col + (r % 2 === 1 ? 0.5 : 0)) * geometry.w}%`,
                  top: `${r * 0.75 * geometry.h}%`,
                  width: `${geometry.w}%`,
                  height: `${geometry.h}%`,
                  clipPath: HEX_CLIP,
                  backgroundColor: PALETTE[c].css,
                  /* Owned cells are ringed rather than recoloured — recolouring
                   * them would destroy the only information the board carries. */
                  boxShadow:
                    owner === PLAYER
                      ? "inset 0 0 0 3px rgb(255 255 255 / 0.95)"
                      : owner === RIVAL
                        ? "inset 0 0 0 3px rgb(0 0 0 / 0.65)"
                        : "none",
                  color: "rgb(0 0 0 / 0.45)",
                }}
              >
                {PALETTE[c].label}
              </span>
            );
          })}
        </div>

        {banner && (
          <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-surface-0/85 py-3 text-center font-display text-base font-bold text-text-primary backdrop-blur-sm">
            {banner}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {PALETTE.slice(0, paletteSize).map((p, c) => {
          const locked = c === playerColour || c === rivalColour;
          return (
            <button
              key={p.label}
              type="button"
              onPointerDown={() => play(c)}
              disabled={locked || turn !== "player" || Boolean(banner)}
              aria-label={`Claim colour ${p.label}${locked ? " — held, unavailable" : ""}`}
              className={cn(
                "size-10 rounded-xl border-2 text-xs font-bold transition-transform duration-100",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
                "disabled:cursor-not-allowed disabled:opacity-30",
                c === playerColour ? "border-white" : c === rivalColour ? "border-black/70" : "border-transparent",
                !locked && turn === "player" && "hover:scale-110 active:scale-95",
              )}
              style={{ backgroundColor: p.css, color: "rgb(0 0 0 / 0.55)" }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <p className="text-center text-[11px] text-text-muted">
        {turn === "player" ? "Your move — a colour either side already holds is locked." : "Rival is thinking…"}
      </p>
    </div>
  );
}

export const hexTactics: EngineDefinition = {
  key: "hex-tactics",
  name: "Hex Capture",
  howToPlay:
    "You hold the bottom-left hex, your rival the top-right. Claim a colour and everything you own becomes it, absorbing every touching hex already of that colour; then the rival claims one back. A colour either side currently holds is locked, so a strong move also takes one away from them. Each hex you take scores, and taking more than half the board scores far more — play for the board, not the turn.",
  keyboard: false,
  Component: HexTactics,
};
