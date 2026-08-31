/* ============================================================================
 * Server-safe web3 constants. NO client-only imports here — this module is
 * pulled into server components (e.g. the public Tokenomics page) to render
 * contract addresses and explorer links during prerender.
 *
 * The wagmi config itself lives in ./wagmi.ts, which is client-only.
 * ========================================================================== */

import { getAddress, type Address } from "viem";

/** 97 = BSC Testnet (default), 56 = BSC Mainnet. */
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97) as 56 | 97;
export const IS_TESTNET = CHAIN_ID === 97;

export const BSC_MAINNET_RPC = process.env.NEXT_PUBLIC_BSC_RPC ?? "https://bsc-dataseed.binance.org";
export const BSC_TESTNET_RPC =
  process.env.NEXT_PUBLIC_BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/**
 * A configured address, normalised to its EIP-55 checksummed form.
 *
 * `getAddress` is the check, not the regex: a mixed-case address whose checksum
 * is wrong is the signature of a corrupted paste, and viem throws on one — from
 * inside whichever contract read happened to reach it first, which is a long way
 * from the line that set it. Anything unusable becomes the zero address, which
 * the hooks already read as "not deployed" and handle.
 *
 * Being well-formed says nothing about being the RIGHT contract. That is checked
 * against the chain by the API at boot (see the backend's deployment verifier);
 * the browser is not the place to discover it.
 */
const addr = (v: string | undefined): Address => {
  const raw = v?.trim();
  if (!raw) return ZERO_ADDRESS;
  try {
    return getAddress(raw);
  } catch {
    return ZERO_ADDRESS;
  }
};

/**
 * Deployed addresses, from MLM-contracts/deployments/<network>.json.
 * A zero address means "not deployed yet" — hooks detect this and fall back to
 * the mock layer so every page still renders during development.
 */
export const contracts = {
  mttToken: addr(process.env.NEXT_PUBLIC_MTT_TOKEN_ADDRESS),
  staking: addr(process.env.NEXT_PUBLIC_STAKING_ADDRESS),
  referralDistributor: addr(process.env.NEXT_PUBLIC_REFERRAL_DISTRIBUTOR_ADDRESS),
  teamVesting: addr(process.env.NEXT_PUBLIC_TEAM_VESTING_ADDRESS),
  advisorsVesting: addr(process.env.NEXT_PUBLIC_ADVISORS_VESTING_ADDRESS),
  /* MTTPayout — the withdrawal settlement rail. Read-only from the browser: a
   * member never calls it, but the explorer link and the settlement lookup on
   * their withdrawal history both point here. */
  payout: addr(process.env.NEXT_PUBLIC_PAYOUT_ADDRESS),
} as const;

export const isDeployed = (a: Address) => a !== ZERO_ADDRESS;

/** True when the core contracts are configured — otherwise the UI shows mock data. */
export const CONTRACTS_CONFIGURED =
  isDeployed(contracts.mttToken) && isDeployed(contracts.staking);

export const explorerBase = CHAIN_ID === 56 ? "https://bscscan.com" : "https://testnet.bscscan.com";
export const txUrl = (hash: string) => `${explorerBase}/tx/${hash}`;
export const addressUrl = (a: string) => `${explorerBase}/address/${a}`;
export const tokenUrl = (a: string) => `${explorerBase}/token/${a}`;

export const MTT_DECIMALS = 18;
export const MTT_SYMBOL = "MTT";
export const NATIVE_SYMBOL = "BNB";
