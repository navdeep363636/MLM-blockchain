import { asAmount, asIndex, asScalar, firstScalar } from "./untrusted";

/* ============================================================================
 * These four functions stand between an untrusted payload and a money column,
 * so what they REFUSE is the point.
 * ========================================================================== */

describe("asScalar", () => {
  it("passes strings, numbers, bigints and booleans through", () => {
    expect(asScalar("100.00")).toBe("100.00");
    expect(asScalar(42)).toBe("42");
    expect(asScalar(10n ** 20n)).toBe("100000000000000000000");
    expect(asScalar(true)).toBe("true");
  });

  it("refuses an OBJECT rather than stringifying it to [object Object]", () => {
    /* The whole reason this file exists: a provider that wraps an amount in an
     * object must not produce a recorded amount of "[object Object]". */
    expect(asScalar({ value: "100.00", currency: "INR" })).toBeNull();
    expect(asScalar(["100.00"])).toBeNull();
  });

  it("refuses absence and non-finite numbers", () => {
    expect(asScalar(null)).toBeNull();
    expect(asScalar(undefined)).toBeNull();
    expect(asScalar(NaN)).toBeNull();
    expect(asScalar(Infinity)).toBeNull();
  });
});

describe("firstScalar", () => {
  it("takes the first usable candidate, for payloads that name a field several ways", () => {
    expect(firstScalar(undefined, "", { a: 1 }, "DEP-1", "DEP-2")).toBe("DEP-1");
  });

  it("returns null when nothing usable is present", () => {
    expect(firstScalar(undefined, null, "", {})).toBeNull();
  });
});

describe("asAmount", () => {
  it("accepts a plain decimal, signed or not", () => {
    expect(asAmount("100.00")).toBe("100.00");
    expect(asAmount("-0.000000000000000001")).toBe("-0.000000000000000001");
    expect(asAmount(" 25 ")).toBe("25");
  });

  it("refuses notations a Decimal parser might accept in surprising ways", () => {
    /* "1e21" is a valid Decimal and a terrible thing to receive as an amount
     * from a payment provider. */
    expect(asAmount("1e21")).toBeNull();
    expect(asAmount("0x10")).toBeNull();
    expect(asAmount("100,00")).toBeNull();
    expect(asAmount("")).toBeNull();
    expect(asAmount("abc")).toBeNull();
    expect(asAmount({ value: 1 })).toBeNull();
  });
});

describe("asIndex", () => {
  it("accepts a non-negative integer", () => {
    expect(asIndex("3")).toBe(3);
    expect(asIndex(0)).toBe(0);
  });

  it("refuses a negative, fractional or unsafe value", () => {
    expect(asIndex("-1")).toBeNull();
    expect(asIndex("1.5")).toBeNull();
    expect(asIndex("99999999999999999999")).toBeNull();
    expect(asIndex(undefined)).toBeNull();
  });
});
