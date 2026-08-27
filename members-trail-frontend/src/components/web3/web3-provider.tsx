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
 *   (player)/layout.tsx  — AppShell renders WalletConnectButton + NetworkGuard
 *   (admin)/layout.tsx   — same shell
 *   (auth)/connect-wallet — the wallet-linking flow itself
 *   (public)/tokenomics  — AllocationChart reads on-chain supply
 *
 * Anything else must not call a wagmi hook. If a new page needs one, wrap it
 * here rather than hoisting this back to the root.
 * ========================================================================== */

import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import "@rainbow-me/rainbowkit/styles.css";

import { wagmiConfig } from "@/lib/web3/wagmi";
import { useTheme } from "@/lib/hooks/use-theme";

/* Built once at module scope. Rebuilding these objects per render made
 * RainbowKitProvider see a new `theme` identity on every parent render. */
const SHARED = {
  accentColor: "#ef6f2a",
  accentColorForeground: "#ffffff",
  borderRadius: "large" as const,
  fontStack: "system" as const,
  overlayBlur: "small" as const,
};
const DARK = darkTheme(SHARED);
const LIGHT = lightTheme(SHARED);
const APP_INFO = { appName: "Members Trail" };

export function Web3Provider({ children }: { children: React.ReactNode }) {
  const { resolved } = useTheme();

  return (
    <WagmiProvider config={wagmiConfig}>
      <RainbowKitProvider
        theme={resolved === "light" ? LIGHT : DARK}
        modalSize="compact"
        appInfo={APP_INFO}
      >
        {children}
      </RainbowKitProvider>
    </WagmiProvider>
  );
}
