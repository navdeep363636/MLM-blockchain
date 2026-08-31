import { decodeArgList, encodeArgList } from "./tx-args";

/* ============================================================================
 * The regression test for a defect that silently emptied the entire outbound
 * chain queue: a bigint in a json column throws on insert, so no transaction was
 * ever written.
 * ========================================================================== */

describe("tx-args", () => {
  it("survives JSON.stringify, which the raw args did not", () => {
    const args = [123n];
    expect(() => JSON.stringify(args)).toThrow(/BigInt/);
    expect(() => JSON.stringify(encodeArgList(args))).not.toThrow();
  });

  it("round-trips a bigint back to a bigint, not a string", () => {
    /* The whole point: viem rejects a string for a uint256, so a lossy round trip
       would move the failure from insert time to submit time. */
    const wei = 1_000_000_000_000_000_000n;
    const stored = JSON.parse(JSON.stringify(encodeArgList([wei])));
    const [back] = decodeArgList(stored);
    expect(typeof back).toBe("bigint");
    expect(back).toBe(wei);
  });

  it("keeps an address a string while a uint becomes a bigint", () => {
    const address = "0x53AE1e2888C1703b3Acf818C1305bf411a86892B";
    const stored = JSON.parse(JSON.stringify(encodeArgList([address, 250n])));
    const [a, b] = decodeArgList(stored);
    expect(a).toBe(address);
    expect(typeof a).toBe("string");
    expect(b).toBe(250n);
  });

  it("handles the commission batch shape — a struct array with one bigint field", () => {
    const batch = [
      [
        { recipient: "0xdD83d806789e199D7D4C079FEEE80523cd023AAf", level: 1, amount: 20n },
        { recipient: "0xf489713C222252c6260Da1E367C1E8c10342168A", level: 2, amount: 7n },
      ],
      "0x" + "ab".repeat(32),
    ];
    const stored = JSON.parse(JSON.stringify(encodeArgList(batch)));
    const [entries, ref] = decodeArgList(stored) as [
      { recipient: string; level: number; amount: bigint }[], string,
    ];
    expect(entries).toHaveLength(2);
    expect(entries[0].amount).toBe(20n);
    expect(entries[1].level).toBe(2);
    expect(entries[0].recipient).toBe("0xdD83d806789e199D7D4C079FEEE80523cd023AAf");
    expect(ref).toBe("0x" + "ab".repeat(32));
  });

  it("preserves an extreme uint256 exactly", () => {
    /* Above 2^53, where a number would quietly lose precision. */
    const huge = 2n ** 255n - 1n;
    const [back] = decodeArgList(JSON.parse(JSON.stringify(encodeArgList([huge]))));
    expect(back).toBe(huge);
  });

  it("passes through an untagged row, so pre-existing rows still submit", () => {
    expect(decodeArgList([1, "x", true, null])).toEqual([1, "x", true, null]);
  });

  it("leaves booleans, nulls and nested empties alone", () => {
    const v = [true, false, null, [], {}];
    expect(decodeArgList(JSON.parse(JSON.stringify(encodeArgList(v))))).toEqual(v);
  });
});
