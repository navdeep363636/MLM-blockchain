/* ============================================================================
 * Reading values out of untrusted, loosely-typed payloads.
 *
 * Provider webhooks and decoded chain event args both arrive as
 * `Record<string, unknown>`. The tempting shorthand is `String(payload.amount)`,
 * which is safe right up until a provider sends
 *
 *   { "amount": { "value": "100.00", "currency": "INR" } }
 *
 * and the platform records a settled amount of "[object Object]". Depending on
 * where that lands it becomes a zero, a NaN or a crash — and one of those three
 * silently credits the wrong number.
 *
 * So: nothing here guesses. A value that is not a scalar is ABSENT, and the
 * caller decides what to do about the absence.
 * ========================================================================== */

/**
 * A string, number or boolean as a string. Anything else — object, array, null,
 * undefined, function — is null.
 */
export function asScalar(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return String(value);
  return null;
}

/** First scalar among the candidates, for payloads that name a field several ways. */
export function firstScalar(...values: unknown[]): string | null {
  for (const value of values) {
    const scalar = asScalar(value);
    if (scalar !== null && scalar.length > 0) return scalar;
  }
  return null;
}

/**
 * A decimal amount, or null.
 *
 * Stricter than `asScalar` on purpose: "1e21", "0x10", "abc" and "" are all
 * refused rather than being handed to a Decimal constructor that may accept some
 * of them and throw on others. Only a plain signed decimal gets through.
 */
export function asAmount(value: unknown): string | null {
  const scalar = asScalar(value);
  if (scalar === null) return null;
  const trimmed = scalar.trim();
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? trimmed : null;
}

/** A non-negative integer (a pool id, a block number, a count), or null. */
export function asIndex(value: unknown): number | null {
  const scalar = asScalar(value);
  if (scalar === null) return null;
  if (!/^\d+$/.test(scalar.trim())) return null;
  const n = Number(scalar);
  return Number.isSafeInteger(n) ? n : null;
}
