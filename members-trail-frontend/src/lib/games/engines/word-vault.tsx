"use client";

/* Word Vault — the word engine.
 *
 * Seven letters, one board, sixty seconds. Longer words are worth
 * disproportionately more, so the skill is spotting length rather than typing
 * volume, and a word already found scores nothing.
 *
 * The board is chosen by the session seed, which is what makes "everyone plays
 * the same board" true for the daily and tournament formats. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CornerDownLeft, Shuffle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { WORD_BOARDS } from "../data/word-boards";
import type { EngineDefinition, EngineProps } from "../types";

const MIN_LENGTH = 3;

/** Score by length. Superlinear on purpose: a 7 is worth more than two 3s. */
function wordScore(word: string, base: number): number {
  const n = word.length;
  return Math.round(base * (n - MIN_LENGTH + 1) ** 1.7);
}

type Verdict = { word: string; kind: "ok" | "dupe" | "unknown" | "short"; gained: number };

function WordVault({ rng, tuning, onScore, paused }: EngineProps) {
  const board = useMemo(() => {
    const [letters, answers] = WORD_BOARDS[rng.int(0, WORD_BOARDS.length - 1)];
    return { letters, answers: new Set(answers.split(" ")) };
  }, [rng]);

  const [order, setOrder] = useState(() => rng.shuffle(board.letters.split("")));
  const [typed, setTyped] = useState("");
  const [found, setFound] = useState<string[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!paused) inputRef.current?.focus();
  }, [paused]);

  /* The board's own letters are the only legal alphabet, and each letter may be
   * used as many times as it appears — which for these boards is once. */
  const spellable = useCallback(
    (word: string) => {
      const pool = [...board.letters];
      for (const ch of word) {
        const at = pool.indexOf(ch);
        if (at === -1) return false;
        pool.splice(at, 1);
      }
      return true;
    },
    [board.letters],
  );

  const submit = useCallback(() => {
    const word = typed.trim().toLowerCase();
    setTyped("");
    if (word.length === 0 || paused) return;

    if (word.length < MIN_LENGTH) {
      setVerdict({ word, kind: "short", gained: 0 });
      return;
    }
    if (found.includes(word)) {
      setVerdict({ word, kind: "dupe", gained: 0 });
      return;
    }
    if (!spellable(word) || !board.answers.has(word)) {
      setVerdict({ word, kind: "unknown", gained: 0 });
      return;
    }
    const gained = wordScore(word, tuning.baseScore);
    onScore(gained);
    setFound((f) => [word, ...f]);
    setVerdict({ word, kind: "ok", gained });
  }, [typed, paused, found, spellable, board.answers, tuning.baseScore, onScore]);

  useEffect(() => {
    if (!verdict) return;
    const id = window.setTimeout(() => setVerdict(null), 1_400);
    return () => window.clearTimeout(id);
  }, [verdict]);

  const longest = found.reduce((n, w) => Math.max(n, w.length), 0);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
        <span className="text-text-muted">
          Build words from these seven letters · {MIN_LENGTH}+ letters
        </span>
        {/* The total is worth showing: "0 found" gives no sense of whether a
            board holds ten words or seventy, and therefore no sense of how a run
            is going. */}
        <span className="tnum text-text-muted">
          {found.length} of {board.answers.size} found · longest {longest || "—"}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {order.map((ch, i) => (
          <span
            key={`${ch}-${i}`}
            className={cn(
              "grid size-11 place-items-center rounded-xl border font-display text-lg font-semibold uppercase",
              typed.toLowerCase().includes(ch)
                ? "border-[var(--accent)] bg-accent-soft text-[var(--accent-hover)]"
                : "border-border-default bg-surface-inset text-text-primary",
            )}
          >
            {ch}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setOrder((o) => rng.shuffle(o))}
          className="grid size-11 place-items-center rounded-xl border border-border-subtle text-text-muted transition-colors hover:border-border-default hover:text-text-secondary"
          aria-label="Shuffle the letters"
        >
          <Shuffle className="size-4" />
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="relative"
      >
        <input
          ref={inputRef}
          value={typed}
          onChange={(e) => setTyped(e.target.value.replace(/[^a-zA-Z]/g, ""))}
          disabled={paused}
          maxLength={9}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="type a word, press Enter"
          aria-label="Your word"
          className="w-full rounded-xl border border-border-default bg-surface-inset px-4 py-3 pr-11 text-center font-display text-lg uppercase tracking-[0.2em] text-text-primary placeholder:text-sm placeholder:tracking-normal placeholder:text-text-muted focus:border-[var(--accent)] focus:outline-none"
        />
        <CornerDownLeft className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
      </form>

      <div className="h-6 text-center text-xs font-semibold" aria-live="polite">
        {verdict && (
          <span
            className={cn(
              "inline-flex items-center gap-1.5",
              verdict.kind === "ok" ? "text-success-400" : "text-text-muted",
            )}
          >
            {verdict.kind === "ok" ? <Check className="size-3.5" /> : <X className="size-3.5" />}
            {verdict.kind === "ok" && `${verdict.word.toUpperCase()} +${verdict.gained}`}
            {verdict.kind === "dupe" && `${verdict.word.toUpperCase()} — already found`}
            {verdict.kind === "unknown" && `${verdict.word.toUpperCase()} — not on this board`}
            {verdict.kind === "short" && `too short — ${MIN_LENGTH} letters minimum`}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border-subtle bg-surface-inset p-3">
        {found.length === 0 ? (
          <p className="text-center text-xs text-text-muted">Words you find appear here.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {found.map((w) => (
              <li
                key={w}
                className="rounded-lg bg-surface-1 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-text-secondary"
              >
                {w}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export const wordVault: EngineDefinition = {
  key: "word-vault",
  name: "Word Vault",
  howToPlay:
    "Spell words using only the seven letters shown, each at most once, three letters or more. Longer words are worth far more than short ones, and a word only counts the first time. Shuffle the tiles if the board stops reading.",
  keyboard: true,
  Component: WordVault,
};
