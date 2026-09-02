"use client";

/* Cipher Break — the deduction engine.
 *
 * A hidden code of coloured glyphs; the player proposes a code and is told only
 * how many glyphs are exactly right and how many are right but misplaced. There
 * is no reaction element and nothing to click faster: a run is decided purely by
 * how much information the player extracts from each guess.
 *
 * Why this and not another timed grid: the catalogue advertises Cipher Break as
 * the ranked logic title, and a ranked ladder needs a game where two players
 * given the same board can be separated by thought rather than by hardware. The
 * code is derived from the session seed, so "everyone solves the same cipher"
 * is literally true — the same claim the daily word boards make.
 *
 * Intensity widens the glyph palette and lengthens the code, which is what
 * actually makes a cipher hard; the attempt budget stays generous so a harder
 * title is a longer deduction, not a coin flip. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { EngineDefinition, EngineProps } from "../types";

/** Glyphs carry a letter as well as a colour: colour alone is not a label. */
const GLYPHS = [
  { id: 0, label: "A", className: "bg-[var(--accent)] text-white" },
  { id: 1, label: "B", className: "bg-success-500 text-[#07120c]" },
  { id: 2, label: "C", className: "bg-warning-500 text-[#141004]" },
  { id: 3, label: "D", className: "bg-danger-500 text-white" },
  { id: 4, label: "E", className: "bg-info-500 text-white" },
  { id: 5, label: "F", className: "bg-[#a78bfa] text-[#120a1f]" },
] as const;

const MAX_ATTEMPTS = 8;

interface Attempt {
  guess: number[];
  /** Right glyph, right slot. */
  exact: number;
  /** Right glyph, wrong slot. Counted without reusing a glyph already matched. */
  partial: number;
}

/**
 * Standard mastermind scoring. Exacts are removed first, then the leftovers are
 * matched by multiset intersection — otherwise a guess of AAAA against a code
 * holding one A reports four partials and the feedback stops meaning anything.
 */
export function grade(guess: readonly number[], code: readonly number[]): { exact: number; partial: number } {
  let exact = 0;
  const codeRest: number[] = [];
  const guessRest: number[] = [];

  for (let i = 0; i < code.length; i += 1) {
    if (guess[i] === code[i]) exact += 1;
    else {
      codeRest.push(code[i]);
      guessRest.push(guess[i]);
    }
  }

  let partial = 0;
  for (const g of guessRest) {
    const at = codeRest.indexOf(g);
    if (at !== -1) {
      partial += 1;
      codeRest.splice(at, 1);
    }
  }
  return { exact, partial };
}

function CipherBreak({ rng, tuning, onScore, paused }: EngineProps) {
  /* Both scale with intensity, and both are read once per round rather than per
   * render so a round cannot change shape underneath the player. */
  const codeLength = 3 + Math.round(tuning.intensity * 2);
  const paletteSize = 4 + Math.round(tuning.intensity * 2);

  const [round, setRound] = useState(1);
  const [code, setCode] = useState<number[]>([]);
  const [draft, setDraft] = useState<number[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [outcome, setOutcome] = useState<"playing" | "solved" | "failed">("playing");

  /* The engine keeps drawing from one seeded stream, so round two of a given
   * session is the same for every player who reaches it — not reseeded per
   * round, which would make later rounds identical to earlier ones. */
  const deal = useCallback(() => {
    const next = Array.from({ length: codeLength }, () => rng.int(0, paletteSize - 1));
    setCode(next);
    setDraft([]);
    setAttempts([]);
    setOutcome("playing");
  }, [rng, codeLength, paletteSize]);

  const dealt = useRef(false);
  useEffect(() => {
    if (dealt.current) return;
    dealt.current = true;
    deal();
  }, [deal]);

  /* A finished round pauses briefly so the player can read the result — and, on
   * a failure, see the code they were chasing. */
  useEffect(() => {
    if (outcome === "playing" || paused) return;
    const id = window.setTimeout(() => {
      setRound((r) => r + 1);
      deal();
    }, outcome === "solved" ? 900 : 1_600);
    return () => window.clearTimeout(id);
  }, [outcome, paused, deal]);

  const submit = useCallback(() => {
    if (paused || outcome !== "playing" || draft.length !== codeLength) return;

    const result = grade(draft, code);
    const used = attempts.length + 1;
    setAttempts((a) => [...a, { guess: draft, ...result }]);
    setDraft([]);

    if (result.exact === codeLength) {
      /* Two things are worth rewarding: solving at all, and solving early. The
       * efficiency term is the larger of the two, because a cipher cracked in
       * three guesses is a different performance from one brute-forced in
       * seven — and brute force is exactly what a flat payout would teach. */
      const efficiency = (MAX_ATTEMPTS - used + 1) / MAX_ATTEMPTS;
      const value = Math.round(tuning.baseScore * codeLength * (0.5 + 1.5 * efficiency) * (1 + 0.15 * (round - 1)));
      onScore(value);
      setOutcome("solved");
      return;
    }
    if (used >= MAX_ATTEMPTS) setOutcome("failed");
  }, [paused, outcome, draft, codeLength, code, attempts.length, tuning.baseScore, round, onScore]);

  const push = useCallback(
    (glyph: number) => {
      if (paused || outcome !== "playing") return;
      setDraft((d) => (d.length >= codeLength ? d : [...d, glyph]));
    },
    [paused, outcome, codeLength],
  );

  const pop = useCallback(() => {
    if (paused || outcome !== "playing") return;
    setDraft((d) => d.slice(0, -1));
  }, [paused, outcome]);

  /* Keyboard is a convenience, not a requirement: the same actions are all
   * reachable by pointer, so the engine is not flagged keyboard-only. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        pop();
        return;
      }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= paletteSize) {
        e.preventDefault();
        push(n - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, pop, push, paletteSize]);

  const palette = useMemo(() => GLYPHS.slice(0, paletteSize), [paletteSize]);
  const attemptsLeft = MAX_ATTEMPTS - attempts.length;

  const slot = (glyph: number | undefined, key: number, size = "size-9") => {
    const g = glyph === undefined ? null : GLYPHS[glyph];
    return (
      <span
        key={key}
        className={cn(
          "grid place-items-center rounded-lg border text-xs font-bold",
          size,
          g ? cn("border-transparent", g.className) : "border-dashed border-border-default bg-surface-inset text-text-muted",
        )}
      >
        {g ? g.label : ""}
      </span>
    );
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-text-muted">Deduce the {codeLength}-glyph cipher</span>
        <span className="tnum text-text-muted">
          Round {round} · {attemptsLeft} {attemptsLeft === 1 ? "guess" : "guesses"} left
        </span>
      </div>

      {/* History. Newest last, so the player reads downward as the deduction
          narrows — reversing it puts the most recent information furthest from
          the input they are about to use. */}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto rounded-xl border border-border-subtle bg-surface-inset p-2.5">
        {attempts.length === 0 && (
          <p className="px-1 py-6 text-center text-xs text-text-muted">
            Pick {codeLength} glyphs and submit. You are told how many are exactly right and how many
            are the right glyph in the wrong slot — never which.
          </p>
        )}
        {attempts.map((a, i) => (
          <div key={i} className="flex items-center justify-between gap-3 rounded-lg bg-surface-1 px-2 py-1.5">
            <div className="flex gap-1.5">{a.guess.map((g, j) => slot(g, j, "size-7"))}</div>
            <div className="flex shrink-0 items-center gap-2 text-xs font-semibold">
              <span className="tnum inline-flex items-center gap-1 text-success-400">
                <span className="size-2 rounded-full bg-success-500" />
                {a.exact}
              </span>
              <span className="tnum inline-flex items-center gap-1 text-warning-400">
                <span className="size-2 rounded-full border border-warning-500" />
                {a.partial}
              </span>
            </div>
          </div>
        ))}
        {outcome === "failed" && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-danger-500/40 bg-danger-500/10 px-2 py-1.5">
            <div className="flex gap-1.5">{code.map((g, j) => slot(g, j, "size-7"))}</div>
            <span className="shrink-0 text-xs font-semibold text-danger-400">The cipher was</span>
          </div>
        )}
        {outcome === "solved" && (
          <p className="rounded-lg border border-success-500/40 bg-success-500/10 px-2 py-1.5 text-center text-xs font-semibold text-success-400">
            Cracked in {attempts.length} — next cipher incoming
          </p>
        )}
      </div>

      {/* Draft row and palette. */}
      <div className="flex items-center justify-center gap-1.5">
        {Array.from({ length: codeLength }, (_, i) => slot(draft[i], i))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {palette.map((g, i) => (
          <button
            key={g.id}
            type="button"
            onPointerDown={() => push(g.id)}
            aria-label={`Glyph ${g.label}`}
            className={cn(
              "grid size-10 place-items-center rounded-lg text-sm font-bold transition-transform duration-100",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
              "hover:scale-105 active:scale-95",
              g.className,
            )}
          >
            {g.label}
            <span className="sr-only"> — key {i + 1}</span>
          </button>
        ))}
        <button
          type="button"
          onPointerDown={pop}
          disabled={draft.length === 0}
          className="h-10 rounded-lg border border-border-default bg-surface-2 px-3 text-xs font-semibold text-text-secondary disabled:opacity-40"
        >
          Undo
        </button>
        <button
          type="button"
          onPointerDown={submit}
          disabled={draft.length !== codeLength || outcome !== "playing"}
          className="h-10 rounded-lg bg-[var(--accent)] px-4 text-xs font-bold text-white disabled:opacity-40"
        >
          Submit
        </button>
      </div>
    </div>
  );
}

export const cipherBreak: EngineDefinition = {
  key: "cipher-break",
  name: "Code Deduction",
  howToPlay:
    "Build a code from the glyphs and submit it. A filled dot counts glyphs that are exactly right; a hollow dot counts glyphs that belong somewhere else in the code — you are never told which is which. Crack it in eight guesses; the fewer you use, the more it scores, and each cipher you break is worth more than the last. Number keys, Backspace and Enter work too.",
  keyboard: false,
  Component: CipherBreak,
};
