"use client";

/* ============================================================================
 * The wallet stack, scoped to the routes that actually need a wallet.
 *
 * WHY THIS IS NOT IN app/providers.tsx
 * -----------------------------------
 * It used to be. `getDefaultConfig()` in lib/web3/wagmi.ts eagerly constructs
 * every RainbowKit connector — the MetaMask SDK, WalletConnect's universal
 * provider, Coinbase's SDK — and RainbowKit ships its own stylesheet. Mounted at
 * the root, that entire graph landed in the first-load JS of every route,
 * including the marketing pages, the legal documents and the login form: about
 * 200 kB of wallet code parsed and executed before a visitor who has no wallet
 * and no account could read a paragraph of text.
 *
 * Wagmi hooks throw outside a WagmiProvider, so the boundary has to enclose
 * every component that calls one. That set is small and stable:
 *
 *   (player)/layout.tsx  — AppShell plus the wallet, staking and referral views
 *   (auth)/connect-wallet — the wallet-linking flow itself
 *   (public)/tokenomics  — AllocationChart reads on-chain supply
 *
 * The admin shell uses DeferredWeb3Provider instead — see that file. Use this
 * one wherever a descendant calls a wagmi hook during its first render.
 *
 * Anything else must not call a wagmi hook. If a new page needs one, wrap it
 * here rather than hoisting this back to the root.
 * ========================================================================== */

import { WalletReadyContext } from "./wallet-ready";
import { WalletStack } from "./wallet-stack";

export { useWalletStackReady } from "./wallet-ready";

export function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WalletReadyContext.Provider value={true}>
      <WalletStack>{children}</WalletStack>
    </WalletReadyContext.Provider>
  );
}
