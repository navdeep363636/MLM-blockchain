"use client";

import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { WagmiProvider } from "wagmi";
import "@rainbow-me/rainbowkit/styles.css";

import { wagmiConfig } from "@/lib/web3/wagmi";
import { ToastProvider } from "@/components/ui";
import { ThemeProvider, useTheme } from "@/lib/hooks/use-theme";

/** RainbowKit themed to the platform's orange accent. */
function RainbowKit({ children }: { children: React.ReactNode }) {
  const { resolved } = useTheme();
  const shared = {
    accentColor: "#ef6f2a",
    accentColorForeground: "#ffffff",
    borderRadius: "large" as const,
    fontStack: "system" as const,
    overlayBlur: "small" as const,
  };
  return (
    <RainbowKitProvider
      theme={resolved === "light" ? lightTheme(shared) : darkTheme(shared)}
      modalSize="compact"
      appInfo={{ appName: "Members Trail" }}
    >
      {children}
    </RainbowKitProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1 } } }),
  );
  // wagmi's SSR hydration needs one client-side frame before RainbowKit mounts.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <ThemeProvider>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKit>
            <ToastProvider>
              {/* Suppress the first paint of wallet-dependent UI to avoid
                  hydration mismatch on connector state. */}
              <div style={{ visibility: mounted ? "visible" : "visible" }}>{children}</div>
            </ToastProvider>
          </RainbowKit>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  );
}
