/* ============================================================================
 * Which engine drives which title, and how hard it plays.
 *
 * One engine per title. That was not always true: four engines used to cover
 * eight titles, differing only by `Tuning`, so Sky Siege was Neon Rush on a
 * shorter clock, Cipher Break was Word Vault with more time, Hex Tactics was
 * Block Forge with slower pieces, and Pulse Beat — having no Rhythm entry in
 * the genre table — was a fourth copy of the reflex grid. The play screen
 * prints the engine name next to the title, so the catalogue was advertising
 * eight games and openly labelling four of them as duplicates.
 *
 * Sharing an engine also made the blurbs false in a way no amount of tuning
 * could fix: intensity can make a word hunt longer, it cannot make it the
 * "timed logic puzzle" the store page sells. Every title now plays the genre it
 * claims, and no two titles play the same game.
 *
 * `Tuning` still exists and still matters — it is how a title sets its own
 * length, pace and per-event value — it is simply no longer carrying the whole
 * burden of making two titles feel unalike.
 *
 * A title with no entry here still plays: it falls back to the engine that
 * suits its genre, so adding a game to the catalogue never ships a dead Play
 * button. Every genre in the catalogue has its own fallback, and a genre we
 * have never seen lands on the reflex grid because it is the one engine that
 * needs no keyboard and no explanation.
 * ========================================================================== */

import { blockForge } from "./engines/block-forge";
import { cipherBreak } from "./engines/cipher-break";
import { hexTactics } from "./engines/hex-tactics";
import { laneDodge } from "./engines/lane-dodge";
import { pulseBeat } from "./engines/pulse-beat";
import { reflexGrid } from "./engines/reflex-grid";
import { skySiege } from "./engines/sky-siege";
import { wordVault } from "./engines/word-vault";
import type { EngineDefinition, Tuning } from "./types";

export const ENGINES = {
  reflexGrid,
  wordVault,
  laneDodge,
  blockForge,
  cipherBreak,
  pulseBeat,
  skySiege,
  hexTactics,
} as const;

interface Assignment {
  engine: EngineDefinition;
  tuning: Tuning;
}

const BY_SLUG: Record<string, Assignment> = {
  /* Arcade. The introductory title: short, no keyboard, no rules to read. */
  "neon-rush": {
    engine: reflexGrid,
    tuning: { durationSeconds: 60, intensity: 0.55, baseScore: 22 },
  },
  /* Action. Intensity here buys descent speed and spawn rate; the wave clock
   * escalates on top of it, so a run gets away from the player rather than
   * simply being fast from the first second. */
  "sky-siege": {
    engine: skySiege,
    tuning: { durationSeconds: 90, intensity: 0.6, baseScore: 20 },
  },
  /* Word. Everyone plays the same board, so the clock is generous enough that
   * the board, not the timer, is what separates two players. */
  "word-vault": {
    engine: wordVault,
    tuning: { durationSeconds: 75, intensity: 0.4, baseScore: 34 },
  },
  /* Puzzle. The ranked deduction title: long on the clock because a cipher is
   * meant to be reasoned about, and intensity buys code length and palette
   * width rather than pressure. */
  "cipher-break": {
    engine: cipherBreak,
    tuning: { durationSeconds: 150, intensity: 0.6, baseScore: 18 },
  },
  /* Racing. */
  "turbo-drift": {
    engine: laneDodge,
    tuning: { durationSeconds: 70, intensity: 0.6, baseScore: 34 },
  },
  /* Strategy, fast. */
  "block-forge": {
    engine: blockForge,
    tuning: { durationSeconds: 120, intensity: 0.45, baseScore: 26 },
  },
  /* Strategy, deliberate. Turns are untimed, so the session length is really a
   * budget for how many skirmishes a player gets through. */
  "hex-tactics": {
    engine: hexTactics,
    tuning: { durationSeconds: 180, intensity: 0.35, baseScore: 14 },
  },
  /* Rhythm. Base score is per note and a run is hundreds of notes, so it is set
   * far below the others on purpose. */
  "pulse-beat": {
    engine: pulseBeat,
    tuning: { durationSeconds: 90, intensity: 0.5, baseScore: 8 },
  },
};

const BY_GENRE: Record<string, EngineDefinition> = {
  Arcade: reflexGrid,
  Action: skySiege,
  Word: wordVault,
  Puzzle: cipherBreak,
  Racing: laneDodge,
  Strategy: blockForge,
  Rhythm: pulseBeat,
};

const FALLBACK: Tuning = { durationSeconds: 60, intensity: 0.5, baseScore: 26 };

export function engineFor(slug: string, genre: string): Assignment {
  const exact = BY_SLUG[slug];
  if (exact) return exact;
  return { engine: BY_GENRE[genre] ?? reflexGrid, tuning: FALLBACK };
}
