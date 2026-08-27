import { keccak256, toHex } from "viem";
import {
  CONTRACT_SPECS, INDEXED_SPECS, allCallable, assertCallable, assertSpecsValid,
  specForCallable, validateSpecs, watchedEventAbi,
} from "./chain.constants";

/* ============================================================================
 * The regression test for the defect that made this whole rewrite necessary.
 *
 * The previous chain layer watched seven event signatures that no deployed
 * contract emits. Nothing failed. `getLogs` returned an empty array for each,
 * the indexer advanced its cursor, and the health endpoint reported green — so
 * the only way to discover it was to notice that members' stakes never appeared.
 *
 * These tests make that class of error a red build instead.
 * ========================================================================== */

describe("chain.constants", () => {
  it("every watched event and callable function exists in the generated ABI", () => {
    /* The whole point. If this fails, the indexer would silently match nothing. */
    expect(validateSpecs()).toEqual([]);
    expect(() => assertSpecsValid()).not.toThrow();
  });

  it("watchedEventAbi yields exactly the watched events, as real ABI entries", () => {
    for (const spec of CONTRACT_SPECS) {
      const abi = watchedEventAbi(spec);
      expect(abi).toHaveLength(spec.watch.length);
      expect(abi.every((e) => e.type === "event")).toBe(true);

      const names = abi.map((e) => (e as { name: string }).name).sort();
      expect(names).toEqual([...spec.watch].sort());
    }
  });

  it("the topic0 viem will filter on matches the contract's own signature", () => {
    /*
     * The actual mechanism of the original bug, tested directly.
     *
     * `Staked(address,uint256,uint256,uint256)` and
     * `Staked(uint256,address,uint256,uint64)` are both plausible-looking, and
     * they hash to completely different topics. Deriving the signature from the
     * ABI entry — types and order — is what makes them impossible to confuse.
     */
    const staking = CONTRACT_SPECS.find((s) => s.name === "staking")!;
    const abi = watchedEventAbi(staking);

    const staked = abi.find(
      (e) => (e as { name?: string }).name === "Staked",
    ) as unknown as { name: string; inputs: { type: string }[] };
    const signature = `Staked(${staked.inputs.map((i) => i.type).join(",")})`;
    expect(signature).toBe("Staked(uint256,address,uint256,uint64)");

    /* And explicitly NOT the signature the old fragments declared. */
    const wrong = "Staked(address,uint256,uint256,uint256)";
    expect(keccak256(toHex(signature))).not.toEqual(keccak256(toHex(wrong)));
  });

  it("indexes only contracts that watch something", () => {
    expect(INDEXED_SPECS.every((s) => s.watch.length > 0)).toBe(true);
    /* The token is readable and callable but must not be indexed: watching
     * Transfer would mean millions of rows nobody reads. */
    expect(INDEXED_SPECS.map((s) => s.name)).not.toContain("mttToken");
  });

  it("refuses a function that is not on the allowlist", () => {
    expect(() => assertCallable("staking", "fundRewardPool")).not.toThrow();
    /* Real function on the contract, deliberately NOT callable by the platform. */
    expect(() => assertCallable("staking", "stake")).toThrow(/not in the callable allowlist/);
    expect(() => assertCallable("mttToken", "selfDestruct")).toThrow();
  });

  it("never lets the relayer call a member-facing function", () => {
    /* The platform must never stake, unstake or claim on a member's behalf —
     * those move a member's own tokens and belong to their wallet. */
    const forbidden = ["stake", "unstake", "claimRewards", "claimCommission", "release"];
    for (const { contract, functionName } of allCallable()) {
      expect(forbidden).not.toContain(functionName);
      expect(contract).toBeTruthy();
    }
  });

  it("resolves an unambiguous function name, and refuses an ambiguous one", () => {
    expect(specForCallable("recordCommissionBatch")?.name).toBe("referralDistributor");
    expect(specForCallable("payout")?.name).toBe("payout");

    /* `pause` is callable on both the token and the payout rail. Guessing which
     * one was meant would mean sending a privileged call to the wrong contract. */
    expect(specForCallable("pause")).toBeNull();
    expect(specForCallable("doesNotExist")).toBeNull();
  });

  it("declares no duplicate contract names or config keys", () => {
    const names = CONTRACT_SPECS.map((s) => s.name);
    const keys = CONTRACT_SPECS.map((s) => s.configKey);
    expect(new Set(names).size).toBe(names.length);
    /* Config keys MAY repeat only if two logical contracts share an address,
     * which they do not here — both vesting contracts have their own. */
    expect(new Set(keys).size).toBe(keys.length);
  });
});
