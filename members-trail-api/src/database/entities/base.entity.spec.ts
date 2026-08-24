import { decimalTransformer } from "./base.entity";

/* ============================================================================
 * The transformer that made account registration impossible.
 *
 * Money columns are DECIMAL with a DB default of 0. Creating a row without
 * naming them — `create({ userId })` for a fresh balance — relies on that
 * default. An earlier transformer mapped `undefined` to `null`, so TypeORM sent
 * NULL into NOT NULL columns and MySQL refused the insert: every registration
 * failed at the balance row, and every unit test passed, because they all mock
 * the repository.
 *
 * Hence these tests. The three states are genuinely different.
 * ========================================================================== */

describe("decimalTransformer.to", () => {
  it("passes undefined through, so the column DEFAULT applies", () => {
    /* If this ever returns null again, registration breaks. */
    expect(decimalTransformer.to(undefined)).toBeUndefined();
  });

  it("keeps null as null, for the genuinely nullable money columns", () => {
    expect(decimalTransformer.to(null)).toBeNull();
  });

  it("stringifies a value, because DECIMAL travels as text", () => {
    expect(decimalTransformer.to("12.5")).toBe("12.5");
    expect(decimalTransformer.to(0)).toBe("0");
    /* Zero is a value, not an absence — it must not collapse to undefined. */
    expect(decimalTransformer.to(0)).not.toBeUndefined();
  });

  it("does not confuse an empty string with an absent value", () => {
    expect(decimalTransformer.to("")).toBe("");
  });
});

describe("decimalTransformer.from", () => {
  it("reads a NULL column as zero rather than leaking null into arithmetic", () => {
    expect(decimalTransformer.from(null)).toBe("0");
  });

  it("returns the stored string untouched, at full precision", () => {
    /* Parsing to a number here would silently lose the last digits of an
     * 18-decimal amount. */
    expect(decimalTransformer.from("1234567890.123456789012345678")).toBe("1234567890.123456789012345678");
  });
});
