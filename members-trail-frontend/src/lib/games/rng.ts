/* ============================================================================
 * Seeded randomness.
 *
 * Every board a player sees is generated from the seed the SERVER issued when it
 * opened the session. That is not decoration:
 *
 *  • The daily/tournament boards are advertised as "everyone plays the same
 *    board". They only are if the board is a pure function of a value the
 *    server chose.
 *  • Reloading to reroll a bad board is the oldest score-farming trick there is.
 *    A reload gets the same seed until the session is submitted, so there is
 *    nothing to reroll.
 *
 * mulberry32: 32-bit state, one multiply-xorshift round. Fast enough to call per
 * frame, and identical in every JS engine — which matters, because a server-side
 * replay of the same seed has to walk the same sequence.
 * ========================================================================== */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** A uniformly chosen member of a non-empty list. */
  pick<T>(items: readonly T[]): T;
  /** A copy of `items`, shuffled. Fisher-Yates. */
  shuffle<T>(items: readonly T[]): T[];
}

/** Folds an arbitrary-length seed string into the 32 bits mulberry32 wants. */
function hash32(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rngFrom(seed: string): Rng {
  let state = hash32(seed) || 1;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number =>
    min + Math.floor(next() * (max - min + 1));

  return {
    next,
    int,
    pick: (items) => items[int(0, items.length - 1)],
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}
