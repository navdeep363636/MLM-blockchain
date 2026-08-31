import type { Address } from "viem";
import { Contracts, type ContractName } from "./chain.constants";

/* ============================================================================
 * What is actually deployed, per chain.
 *
 * WHY THIS EXISTS ALONGSIDE THE ENV CONFIG
 * ----------------------------------------
 * Addresses come from the environment, and that is right — a deployment is
 * operational data, not source. But an address read from the environment has no
 * way of being WRONG in a way anything notices. Paste one character short of a
 * staking address and:
 *
 *   - `getLogs` on it matches nothing. It does not throw. The indexer runs,
 *     reports healthy, advances its cursor to the head, and indexes zero events.
 *   - Every read reverts or returns zero, and the read layer's "honest nulls"
 *     posture turns that into a dashboard of dashes rather than an alarm.
 *
 * That is the same silent-failure class the generated ABIs were introduced to
 * kill (see chain.constants.ts), and it deserves the same treatment: state what
 * the deployment IS, in reviewed source, and check the environment against it.
 *
 * So this is not configuration. It is the deployment record — the same content
 * as MLM-contracts/deployments/bscTestnet.integration.json — in a form the
 * running service can assert against. A redeploy updates both.
 *
 * A chain with no entry here (mainnet, today) simply gets no cross-check; the
 * env values are used as-is and the verifier says so rather than inventing a
 * comparison it cannot make.
 * ========================================================================== */

export interface KnownDeployment {
  chainId: number;
  network: string;
  /** Block at or just before the first contract deployment. */
  indexerStartBlock: number;
  addresses: Readonly<Partial<Record<ContractName, Address>>>;
  /** Accounts that held each role after setup. Reported, never enforced. */
  roleHolders: Readonly<Record<string, Address>>;
  /** Pools created during setup, for the pool-count sanity check. */
  expectedPoolCount: number;
  /**
   * Facts that were true at the end of the deployment run and are worth knowing
   * when reading the platform's own numbers. These go stale by design — they are
   * a starting state, not a live value; anything live comes from chain reads.
   */
  postSetup: {
    fundedPoolIds: readonly number[];
    payoutFloatMtt: string;
    payoutDailyLimitMtt: string;
    commissionPoolDepositedMtt: string;
    deployerRetainsAdminRole: boolean;
  };
}

/**
 * BSC Testnet, deployed 2026-08-31.
 *
 * Sequence run: deploy -> roles -> pools -> fund -> payout -> post-deploy-check,
 * ending 23/23 checks passing against 109/109 contract tests.
 */
const BSC_TESTNET: KnownDeployment = {
  chainId: 97,
  network: "bscTestnet",
  /* Conservative lower bound: at/just before MTTToken's deployment block, so a
     first scan captures the setup events (role grants, pool creation, the
     initial funding) and not only what happened afterwards. */
  indexerStartBlock: 128_242_300,
  addresses: {
    [Contracts.MttToken]: "0x53AE1e2888C1703b3Acf818C1305bf411a86892B",
    [Contracts.Staking]: "0xce83252a19AfcC8B9C89ef44d3f2554b89C7Cb38",
    [Contracts.ReferralDistributor]: "0x6AE2AB55b420FEA264920F2944A5A1d729A94C8F",
    [Contracts.Payout]: "0x0af73E1bbe85526D5c74b34F6eA44E94861Ff827",
    [Contracts.TeamVesting]: "0x723053F097E8de0D7C8DAc967cD4346d0366580F",
    [Contracts.AdvisorsVesting]: "0xE1FB92AAF3190de8e2c24Dd342327F87fcfBBa29",
  },
  roleHolders: {
    DEFAULT_ADMIN_ROLE: "0xf832BA0d3337CC72043E47cA7a56938125801E4b",
    TREASURY_ROLE: "0xf489713C222252c6260Da1E367C1E8c10342168A",
    POOL_ADMIN_ROLE: "0xf489713C222252c6260Da1E367C1E8c10342168A",
    GUARDIAN_ROLE: "0xf489713C222252c6260Da1E367C1E8c10342168A",
    ORACLE_ROLE: "0xdD83d806789e199D7D4C079FEEE80523cd023AAf",
    PAYER_ROLE: "0xdD83d806789e199D7D4C079FEEE80523cd023AAf",
    COMPLIANCE_ROLE: "0x9BE3308f5d834db492ba18Ac940567D3444475e3",
  },
  expectedPoolCount: 4,
  postSetup: {
    /* Only pool 1 (30-day) was funded. Pools 0, 2 and 3 exist and accept stakes
       but emit no rewards until someone calls fundRewardPool, so a UI that shows
       an APR for them is showing a number the chain will not honour. */
    fundedPoolIds: [1],
    payoutFloatMtt: "10000",
    payoutDailyLimitMtt: "5000",
    /* Zero. `recordCommission` reverts until treasury calls
       depositCommissionPool, because the contract enforces
       totalRecorded <= totalDeposited. Not a bug — the commission rail is simply
       not open yet, and the platform must present it that way. */
    commissionPoolDepositedMtt: "0",
    /* REVOKE_DEPLOYER was not set, so the deployer EOA still holds
       DEFAULT_ADMIN_ROLE on every contract. Acceptable for a testnet rehearsal;
       a mainnet deployment must hand admin to a multisig and revoke the EOA. */
    deployerRetainsAdminRole: true,
  },
};

const BY_CHAIN = new Map<number, KnownDeployment>([[BSC_TESTNET.chainId, BSC_TESTNET]]);

/** The recorded deployment for a chain, or null if none has been recorded. */
export function knownDeployment(chainId: number): KnownDeployment | null {
  return BY_CHAIN.get(chainId) ?? null;
}

/**
 * The relayer address the deployment granted ORACLE_ROLE and PAYER_ROLE to.
 *
 * The signer derived from ORACLE_PRIVATE_KEY must be this address, or every
 * recordCommission and every payout reverts on the role check — after consuming
 * a nonce and gas. Worth comparing at boot rather than discovering per payout.
 */
export function expectedRelayer(chainId: number): Address | null {
  return knownDeployment(chainId)?.roleHolders.ORACLE_ROLE ?? null;
}
