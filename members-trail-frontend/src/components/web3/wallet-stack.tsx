"use client";

/* ============================================================================
 * The wallet providers themselves, in a chunk of their own.
 *
 * Split out of web3-provider.tsx so that mounting a shell does not, by itself,
 * pull wagmi, RainbowKit and every connector SDK into the route's first-load JS.
 * web3-provider.tsx imports this lazily; nothing else should import it directly.
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

export function WalletStack({ children }: { children: React.ReactNode }) {
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
