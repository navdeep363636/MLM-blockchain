/* Server-safe barrel. Anything importable from a server component lives here.
 * The wagmi config is deliberately NOT re-exported — import it directly from
 * "@/lib/web3/wagmi" inside a client component. */
export * from "./chains";
/* The ABI barrel is GENERATED — `npm run abi` in MLM-contracts rewrites
 * ./abis/index.ts, so adding a contract needs no edit here. */
export * from "./abis";
