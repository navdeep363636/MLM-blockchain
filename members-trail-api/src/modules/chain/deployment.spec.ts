import { getAddress, isAddress } from "viem";
import { CONTRACT_SPECS, Contracts } from "./chain.constants";
import { knownDeployment, expectedRelayer } from "./deployment";

/* ============================================================================
 * The deployment record is hand-maintained, so it gets the same treatment the
 * ABI names get: checked in CI rather than trusted.
 *
 * A wrong address here is worse than no address, because the verifier reports it
 * as the truth the environment is measured against — a typo would flag a
 * correctly-configured environment as broken and, worse, teach whoever is
 * debugging to ignore the verifier.
 * ========================================================================== */

describe("deployment record", () => {
  const testnet = knownDeployment(97);

  it("records the BSC testnet deployment", () => {
    expect(testnet).not.toBeNull();
    expect(testnet!.chainId).toBe(97);
    expect(testnet!.network).toBe("bscTestnet");
  });

  it("has no entry for a chain that has not been deployed to", () => {
    /* Mainnet deliberately absent: an entry here asserts "this is deployed", and
       inventing one would make the verifier compare against fiction. */
    expect(knownDeployment(56)).toBeNull();
    expect(knownDeployment(1)).toBeNull();
    expect(expectedRelayer(56)).toBeNull();
  });

  it("every address is a valid, correctly checksummed EIP-55 address", () => {
    /* Not pedantry: viem throws on a mis-checksummed address, and it throws from
       inside whatever read happened to use it first. */
    const all = [
      ...Object.values(testnet!.addresses),
      ...Object.values(testnet!.roleHolders),
    ];
    for (const address of all) {
      expect(isAddress(address)).toBe(true);
      expect(getAddress(address)).toBe(address);
    }
  });

  it("records an address for every contract the chain layer knows about", () => {
    /* A spec without a recorded address is a contract the verifier cannot
       cross-check — which is exactly how a stale address survives a review. */
    for (const spec of CONTRACT_SPECS) {
      expect(testnet!.addresses[spec.name]).toBeDefined();
    }
  });

  it("gives every contract a distinct address", () => {
    const values = Object.values(testnet!.addresses).map((a) => a.toLowerCase());
    expect(new Set(values).size).toBe(values.length);
  });

  it("names the relayer that holds ORACLE_ROLE and PAYER_ROLE", () => {
    /* Both roles went to the same account, and the boot check compares the
       configured signer against ORACLE_ROLE — so they must agree. */
    expect(expectedRelayer(97)).toBe(testnet!.roleHolders.ORACLE_ROLE);
    expect(testnet!.roleHolders.PAYER_ROLE).toBe(testnet!.roleHolders.ORACLE_ROLE);
  });

  it("starts the indexer at or before the deployment, not at genesis", () => {
    expect(testnet!.indexerStartBlock).toBeGreaterThan(0);
  });

  it("records the pools that were created and which of them were funded", () => {
    expect(testnet!.expectedPoolCount).toBe(4);
    /* Only pool 1 was funded. Pools 0, 2 and 3 accept stakes and emit nothing,
       so any APR the UI shows for them is a number the chain will not honour. */
    expect(testnet!.postSetup.fundedPoolIds).toEqual([1]);
    for (const id of testnet!.postSetup.fundedPoolIds) {
      expect(id).toBeLessThan(testnet!.expectedPoolCount);
    }
  });

  it("records that the commission rail is not open yet", () => {
    /* The distributor enforces totalRecorded <= totalDeposited, so with nothing
       deposited every recordCommission reverts. The platform has to present
       commission as pending rather than offer a claim that cannot settle. */
    expect(testnet!.postSetup.commissionPoolDepositedMtt).toBe("0");
  });

  it("records that an EOA still holds admin, which blocks a mainnet promotion", () => {
    expect(testnet!.postSetup.deployerRetainsAdminRole).toBe(true);
    expect(testnet!.roleHolders.DEFAULT_ADMIN_ROLE).toBeDefined();
  });

  it("keeps the token address the one every other contract settles in", () => {
    /* Asserted on chain by the verifier; asserted here only that the record
       names a token at all, since the verifier compares against this value. */
    expect(testnet!.addresses[Contracts.MttToken]).toBeDefined();
  });
});
