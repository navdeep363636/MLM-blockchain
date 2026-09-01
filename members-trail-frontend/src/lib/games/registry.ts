/* ============================================================================
 * Which engine drives which title, and how hard it plays.
 *
 * Four engines cover seven titles. That is deliberate: seven bespoke games would
 * be seven codebases to keep honest against one scoring contract, and the parts
 * that actually have to be right — the telemetry stream, the seed handling, the
 * cap arithmetic — are the parts they would each reimplement slightly wrong.
 *
 * What makes two titles on one engine feel different is `Tuning`, and the fact
 * that each draws its board from its own session seed.
 *
 * A title with no entry here still plays: it falls back to the engine that suits
 * its genre, so adding a game to the catalogue never ships a dead Play button.
 * ========================================================================== */

import { blockForge } from "./engines/block-forge";
import { laneDodge } from "./engines/lane-dodge";
import { reflexGrid } from "./engines/reflex-grid";
import { wordVault } from "./engines/word-vault";
import type { EngineDefinition, Tuning } from "./types";

export const ENGINES = { reflexGrid, wordVault, laneDodge, blockForge } as const;

interface Assignment {
  engine: EngineDefinition;
  tuning: Tuning;
}

const BY_SLUG: Record<string, Assignment> = {
  "neon-rush": {
    engine: reflexGrid,
    tuning: { durationSeconds: 60, intensity: 0.55, baseScore: 22 },
  },
  /* Sky Siege is the same grid played hard: shorter fuses, more targets at once,
   * and a shorter session, so a run is decided by accuracy under pressure. */
  "sky-siege": {
    engine: reflexGrid,
    tuning: { durationSeconds: 50, intensity: 0.85, baseScore: 26 },
  },
  "word-vault": {
    engine: wordVault,
    tuning: { durationSeconds: 75, intensity: 0.4, baseScore: 34 },
  },
  /* Cipher Break is the ranked word title: longer on the clock, and each find
   * worth more, because it is scored against the whole field rather than a cap. */
  "cipher-break": {
    engine: wordVault,
    tuning: { durationSeconds: 90, intensity: 0.6, baseScore: 40 },
  },
  "turbo-drift": {
    engine: laneDodge,
    tuning: { durationSeconds: 70, intensity: 0.6, baseScore: 34 },
  },
  "block-forge": {
    engine: blockForge,
    tuning: { durationSeconds: 120, intensity: 0.45, baseScore: 26 },
  },
  /* Hex Tactics is the deliberate end of the strategy shelf: slow pieces, a long
   * session, and scoring that rewards a built-up stack over a quick clear. */
  "hex-tactics": {
    engine: blockForge,
    tuning: { durationSeconds: 150, intensity: 0.2, baseScore: 22 },
  },
};

const BY_GENRE: Record<string, EngineDefinition> = {
  Arcade: reflexGrid,
  Action: reflexGrid,
  Word: wordVault,
  Puzzle: wordVault,
  Racing: laneDodge,
  Strategy: blockForge,
};

const FALLBACK: Tuning = { durationSeconds: 60, intensity: 0.5, baseScore: 26 };

export function engineFor(slug: string, genre: string): Assignment {
  const exact = BY_SLUG[slug];
  if (exact) return exact;
  return { engine: BY_GENRE[genre] ?? reflexGrid, tuning: FALLBACK };
}
