/* ============================================================================
 * Storing contract call arguments in a JSON column.
 *
 * THE BUG THIS FIXES
 * ------------------
 * Every amount in every contract call is a `bigint` — `toWei()` returns one, and
 * viem requires one for any `uint`. `outbound_transactions.args` is a `json`
 * column, and TypeORM persists a json column by calling `JSON.stringify`, which
 * throws `TypeError: Do not know how to serialize a BigInt`.
 *
 * So no outbound transaction could ever be written. Not commission recording,
 * not pool funding, not a payout, not a KYC mirror — the insert threw before the
 * row existed, and callers logged the failure and moved on. The queue was not
 * slow or misconfigured; it was empty, and had always been empty.
 *
 * WHY TAGGING, RATHER THAN JUST STRINGIFYING
 * ------------------------------------------
 * The stored args are handed straight back to viem when the transaction is
 * submitted, so the round trip has to be exact. `"1000"` for a uint256 and
 * `"0xabc…"` for an address are both strings in JSON, and viem will reject the
 * first and require the second — a plain string cannot tell them apart. Tagging
 * the bigints keeps the distinction, and keeps it through nested structs: the
 * commission batch passes an array of `{ recipient, level, amount }` where only
 * `amount` is a bigint.
 * ========================================================================== */

/** The tag. Distinctive enough that no contract argument could collide with it. */
const BIGINT_TAG = "$bigint";

type Tagged = { [BIGINT_TAG]: string };

function isTagged(v: unknown): v is Tagged {
  return (
    typeof v === "object" && v !== null &&
    Object.keys(v).length === 1 &&
    typeof (v as Record<string, unknown>)[BIGINT_TAG] === "string"
  );
}

/**
 * Makes a value safe for a json column, tagging every bigint.
 *
 * Structure is preserved exactly — arrays stay arrays, objects keep their keys —
 * because viem encodes a struct from an object keyed by field name.
 */
export function encodeTxArgs(value: unknown): unknown {
  if (typeof value === "bigint") return { [BIGINT_TAG]: value.toString() };
  if (Array.isArray(value)) return value.map(encodeTxArgs);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = encodeTxArgs(v);
    }
    return out;
  }
  return value;
}

/**
 * Restores what `encodeTxArgs` stored.
 *
 * Untagged values pass through unchanged, so a row written before this existed —
 * or one hand-edited by an operator — still submits, just without bigints it
 * never had.
 */
export function decodeTxArgs(value: unknown): unknown {
  if (isTagged(value)) return BigInt(value[BIGINT_TAG]);
  if (Array.isArray(value)) return value.map(decodeTxArgs);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = decodeTxArgs(v);
    }
    return out;
  }
  return value;
}

/** The argument list as stored. */
export function encodeArgList(args: unknown[]): unknown[] {
  return args.map(encodeTxArgs);
}

/** The argument list as viem needs it. */
export function decodeArgList(args: unknown[]): unknown[] {
  return args.map(decodeTxArgs);
}
