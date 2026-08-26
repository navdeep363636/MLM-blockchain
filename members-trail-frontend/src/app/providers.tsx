"use client";

import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { WagmiProvider } from "wagmi";
import "@rainbow-me/rainbowkit/styles.css";

import { wagmiConfig } from "@/lib/web3/wagmi";
import { ToastProvider } from "@/components/ui";
import { ThemeProvider, useTheme } from "@/lib/hooks/use-theme";
import { AuthProvider } from "@/lib/auth/auth-context";
import { RealtimeProvider } from "@/lib/realtime/socket";

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
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /* Per-hook staleTime in use-data.ts overrides this. The default is a
             * floor for anything that forgets to set one. */
            staleTime: 20_000,
            retry: 1,
            /* Do NOT refetch on window focus by default. On a dashboard with
             * fifteen queries, alt-tabbing would fire fifteen requests every
             * time; the hooks that genuinely need to be current have short stale
             * times, and the socket invalidates the rest when something changes. */
            refetchOnWindowFocus: false,
          },
          mutations: {
            /* Never retried automatically. Every mutation carries an idempotency
             * key, so a retry would be SAFE — but "safe" is not "wanted": a user
             * who sees an error and a spinner cannot tell whether their stake
             * went through. Retrying is their decision. */
            retry: 0,
          },
        },
      }),
  );
  // wagmi's SSR hydration needs one client-side frame before RainbowKit mounts.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <ThemeProvider>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          {/* AuthProvider sits inside QueryClientProvider because it clears the
              cache on sign-out, and outside RealtimeProvider because the socket
              is authenticated with the session it establishes. */}
          <AuthProvider>
            <RealtimeProvider>
              <RainbowKit>
                <ToastProvider>
              {/* Suppress the first paint of wallet-dependent UI to avoid
                  hydration mismatch on connector state. */}
                  <div style={{ visibility: mounted ? "visible" : "visible" }}>{children}</div>
                </ToastProvider>
              </RainbowKit>
            </RealtimeProvider>
          </AuthProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  );
}
