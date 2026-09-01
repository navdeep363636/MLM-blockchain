import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------- formatting ------------------------------- */

export function formatNumber(n: number, opts: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, ...opts }).format(n);
}

/** 12,345.67 — money/token amounts. Always pair with the .tnum class. */
export function formatToken(n: number, decimals = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function formatCompact(n: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: n < 100 ? 2 : 0,
  }).format(n);
}

export function formatPercent(n: number, decimals = 2) {
  return `${n.toFixed(decimals)}%`;
}

export function shortenAddress(a?: string, chars = 4) {
  if (!a) return "";
  return `${a.slice(0, 2 + chars)}…${a.slice(-chars)}`;
}

export function shortenHash(h?: string) {
  if (!h) return "";
  return `${h.slice(0, 10)}…${h.slice(-8)}`;
}

/* --------------------------------- dates --------------------------------- */

export function formatDate(d: Date | string | null | undefined, withTime = false) {
  /* Two failures this used to have, both silent in their own way.
   *
   * An unparseable string made Intl throw RangeError, and this helper is called
   * from ~90 places — so one bad timestamp from the API took a whole route to
   * its error boundary rather than spoiling one cell. Observed on
   * /app/wallet/convert.
   *
   * A missing date was worse than a crash: `Intl.format(undefined)` formats the
   * CURRENT date, so a field the API had not sent rendered as today —
   * confidently, and wrongly. On a ledger screen that is a fabricated date
   * presented as a real one.
   *
   * Both now render as an em dash, which is what a gap in the data actually
   * looks like. A caller wanting a different placeholder can branch first. */
  if (d === null || d === undefined) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

/**
 * Reference instant for relative-time rendering.
 *
 * Reading the wall clock during render makes the server pass and the client's
 * first render disagree, which React reports as a hydration error (#418) and
 * which users see as flickering text. This constant is identical in both
 * environments, so relative times are stable through hydration.
 *
 * It is anchored to the seeded dataset's "now" (see NOW in lib/mock/data.ts) so
 * that "2 hrs ago" is truthful relative to the data being displayed. Once a
 * real API supplies real timestamps, pass a live clock in as `nowMs` — the
 * ticking hooks (useLiveNow, useNow) already do exactly that after mount.
 */
export const REFERENCE_NOW = Date.parse("2026-08-20T09:30:00Z");

export function timeAgo(
  d: Date | string | null | undefined,
  nowMs: number = REFERENCE_NOW,
) {
  /* Same contract as formatDate, and for the same reason. A field the API did
   * not send used to reach `undefined.getTime()` and throw during render, which
   * an error boundary turns into a blank screen — one absent timestamp cost the
   * whole of /admin/cms. A gap in the data renders as a gap. */
  if (d === null || d === undefined) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  const s = Math.floor((nowMs - date.getTime()) / 1000);
  if (s < 60) return "just now";
  const units: [number, string][] = [
    [60, "min"], [3600, "hr"], [86400, "day"], [604800, "wk"], [2592000, "mo"], [31536000, "yr"],
  ];
  let prev = 1;
  for (const [limit, label] of units) {
    if (s < limit) {
      const v = Math.floor(s / prev);
      return `${v} ${label}${v > 1 ? "s" : ""} ago`;
    }
    prev = limit;
  }
  const y = Math.floor(s / 31536000);
  return `${y} yr${y > 1 ? "s" : ""} ago`;
}

/** "2d 14h 06m" — for lock-period and SLA countdowns. */
export function formatDuration(seconds: number) {
  if (seconds <= 0) return "0m";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${String(h).padStart(2, "0")}h`);
  parts.push(`${String(m).padStart(2, "0")}m`);
  return parts.join(" ");
}

/**
 * A game clock: m:ss.
 *
 * `formatDuration` has minute resolution, which is right for a staking term and
 * useless for a sixty-second session — it renders the whole run as "00m" and
 * then "0m". A player watching the last ten seconds needs to see them.
 */
export function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function daysLabel(days: number) {
  return days === 0 ? "Flexible" : `${days} days`;
}

/* --------------------------------- misc ---------------------------------- */

export async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export function csvDownload(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Deterministic pseudo-random from a string seed — keeps mock data stable
 *  between server and client renders (no hydration mismatch). */
export function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
