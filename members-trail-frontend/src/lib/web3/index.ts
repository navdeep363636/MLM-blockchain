/* Server-safe barrel. Anything importable from a server component lives here.
 * The wagmi config is deliberately NOT re-exported — import it directly from
 * "@/lib/web3/wagmi" inside a client component. */
export * from "./chains";
export { mttTokenAbi } from "./abis/mttToken";
export { mttStakingAbi } from "./abis/mttStaking";
export { mttReferralDistributorAbi } from "./abis/mttReferralDistributor";
export { mttVestingAbi } from "./abis/mttVesting";
