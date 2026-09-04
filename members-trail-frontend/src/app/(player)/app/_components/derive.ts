/* Deterministic derivations shared by the player pages.
 *
 * Nothing in here uses Math.random() or the wall clock: every "plausible"
 * figure comes out of `seeded`, so server and client renders are identical. */

import type { Game, PointsEntry, StakePosition, StakingPool } from "@/types";
import { seeded } from "@/lib/utils";

/** Stable 0..1 draw from any string key. */
export function draw(key: string): number {
  return seeded(key)();
}

/** How much of a game's daily Points cap this player has already used today. */
export function dailyCapUsed(game: Pick<Game, "id" | "dailyPointsCap">): number {
  return Math.round(game.dailyPointsCap * (0.12 + draw(`cap:${game.id}`) * 0.72));
}

export function dailyCapRemaining(game: Pick<Game, "id" | "dailyPointsCap">): number {
  return Math.max(0, game.dailyPointsCap - dailyCapUsed(game));
}

/** Platform-wide Points issuance headroom for the day, across every live game. */
export function issuanceCap(games: Game[]): number {
  return games.filter((g) => g.active).reduce((sum, g) => sum + g.dailyPointsCap, 0);
}

/** Points earned per day for the last `days` days, oldest first. */
export function pointsPerDay(entries: PointsEntry[], days = 14) {
  if (entries.length === 0) return [] as { day: string; earned: number; converted: number }[];

  const reference = entries.reduce((max, e) => Math.max(max, Date.parse(e.date)), 0);
  const dayMs = 86_400_000;
  const buckets = Array.from({ length: days }, () => ({ earned: 0, converted: 0 }));

  for (const entry of entries) {
    const offset = Math.floor((reference - Date.parse(entry.date)) / dayMs);
    if (offset < 0 || offset >= days) continue;
    const bucket = buckets[days - 1 - offset];
    if (entry.amount >= 0) bucket.earned += entry.amount;
    else bucket.converted += Math.abs(entry.amount);
  }

  return buckets.map((bucket, i) => ({
    day: new Date(reference - (days - 1 - i) * dayMs).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
    }),
    ...bucket,
  }));
}

/** Stake-weighted blended APR. Variable by definition — never a promise. */
export function blendedApr(positions: StakePosition[], pools: StakingPool[]): number {
  const staked = positions.reduce((sum, p) => sum + p.amount, 0);
  if (staked === 0) return 0;
  const weighted = positions.reduce((sum, p) => {
    const pool = pools.find((x) => x.poolId === p.poolId);
    return sum + p.amount * (pool?.currentApr ?? 0);
  }, 0);
  return Number((weighted / staked).toFixed(2));
}

/** Best single earning day in a Points ledger. */
export function bestDay(entries: PointsEntry[]): { day: string; earned: number } | null {
  const series = pointsPerDay(entries, 30);
  if (series.length === 0) return null;
  return series.reduce(
    (best, row) => (row.earned > best.earned ? { day: row.day, earned: row.earned } : best),
    { day: series[0].day, earned: series[0].earned },
  );
}

export const POINTS_SOURCE_LABEL: Record<PointsEntry["source"], string> = {
  gameplay: "Gameplay",
  quest: "Quest reward",
  achievement: "Achievement reward",
  ad: "Rewarded ad",
  purchase: "Purchase bonus",
  tournament: "Tournament",
  referral_bonus: "Referral bonus",
  conversion: "Converted to MTT",
  admin_adjustment: "Admin adjustment",
  reversal: "Reversed",
};
