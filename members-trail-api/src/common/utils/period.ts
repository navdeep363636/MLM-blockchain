/* ============================================================================
 * Period keys for caps and reporting.
 *
 * All periods are UTC. A cap that rolls over at the server's local midnight is
 * a bug the moment the platform has users in two timezones — and it is also
 * exploitable, because a user near a DST boundary gets a longer day.
 * ========================================================================== */

export const dayKey = (d: Date = new Date()): string => d.toISOString().slice(0, 10);          // YYYY-MM-DD
export const monthKey = (d: Date = new Date()): string => d.toISOString().slice(0, 7);         // YYYY-MM
export const hourKey = (d: Date = new Date()): string => d.toISOString().slice(0, 13);         // YYYY-MM-DDTHH

/** ISO week key, e.g. 2026-W34. Used for weekly quests and payout batches. */
export function weekKey(d: Date = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;              // Monday = 1 … Sunday = 7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);      // nearest Thursday
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function startOfUtcDay(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function startOfUtcMonth(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Seconds until the next UTC midnight — the natural TTL for a daily cap key. */
export function secondsUntilUtcMidnight(now: Date = new Date()): number {
  const next = startOfUtcDay(new Date(now.getTime() + 86_400_000));
  return Math.max(60, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

/** Seconds until the first of next month UTC. */
export function secondsUntilUtcMonthEnd(now: Date = new Date()): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.max(60, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

export const daysBetween = (a: Date, b: Date): number =>
  Math.floor(Math.abs(b.getTime() - a.getTime()) / 86_400_000);

export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);
export const addHours = (d: Date, n: number): Date => new Date(d.getTime() + n * 3_600_000);

/** Trailing N whole months as [start, end) — used for the commission cap formula. */
export function trailingMonths(n: number, now: Date = new Date()): { start: Date; end: Date } {
  const end = startOfUtcMonth(now);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - n, 1));
  return { start, end };
}
