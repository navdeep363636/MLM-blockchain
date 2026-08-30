"use client";

/* ============================================================================
 * The wallet stack, imported AFTER the shell has hydrated.
 *
 * Scoping wagmi to the two dashboard shells (see web3-provider.tsx) moved its
 * cost off the marketing pages but not off the dashboards, where ~200 kB of
 * connector SDKs is still parsed and executed before React can hydrate — and
 * nothing on the page can fetch until hydration finishes. Measured on a
 * 4x-throttled cold /admin: every script had landed by 217ms and the first data
 * request still did not go out until ~1.0s.
 *
 * A staff member reads the dashboard far more often than they connect a wallet,
 * so this imports the stack on an idle callback and renders children without it
 * until then. `useWalletStackReady()` reports false during that window; wagmi
 * hooks throw outside a WagmiProvider, so every component below this that calls
 * one must gate on the flag. Under the admin shell that is exactly the two
 * controls in components/web3/shell-wallet.tsx — no admin page touches a wallet.
 *
 * This is deliberately NOT used for the player shell: its wallet, staking and
 * referral views call wagmi hooks on their first render, so there the provider
 * has to be there from the start.
 * ========================================================================== */

import { useEffect, useState } from "react";

import { WalletReadyContext } from "./wallet-ready";

type Stack = (props: { children: React.ReactNode }) => React.ReactNode;

/* Module scope, so a remount or a route change reuses the resolved component
   instead of paying for the import decision again. */
let resolved: Stack | null = null;
let pending: Promise<Stack> | null = null;

function loadStack(): Promise<Stack> {
  pending ??= import("./wallet-stack").then((m) => {
    resolved = m.WalletStack as Stack;
    return resolved;
  });
  return pending;
}

/** Starts the wallet chunk early — call it on the first hint of wallet intent. */
export function warmWalletStack(): void {
  void loadStack().catch(() => {});
}

export function DeferredWeb3Provider({ children }: { children: React.ReactNode }) {
  const [Stack, setStack] = useState<Stack | null>(resolved);

  useEffect(() => {
    if (Stack) return;
    let cancelled = false;
    const start = () => {
      void loadStack().then((S) => {
        if (!cancelled) setStack(() => S);
      });
    };

    /* Executing the stack is ~450ms of main thread at 4x throttle, so it waits
       for `load` before even asking for idle: an idle callback alone can fire in
       a gap between the page's own requests and put that block right in the
       middle of them. */
    let idleId: number | null = null;
    const queue = () => {
      if (cancelled) return;
      const ric = window.requestIdleCallback;
      if (typeof ric === "function") {
        /* With a timeout, because a dashboard that keeps re-rendering can starve
           idle indefinitely and the button must not stay a stub forever. */
        idleId = ric(start, { timeout: 3_000 });
      } else {
        idleId = window.setTimeout(start, 600);
      }
    };

    const useIdle = typeof window.requestIdleCallback === "function";
    const cancelQueued = () => {
      if (idleId === null) return;
      if (useIdle) window.cancelIdleCallback?.(idleId);
      else window.clearTimeout(idleId);
    };

    if (document.readyState === "complete") queue();
    else window.addEventListener("load", queue, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener("load", queue);
      cancelQueued();
    };
  }, [Stack]);

  if (!Stack) return <WalletReadyContext.Provider value={false}>{children}</WalletReadyContext.Provider>;
  return (
    <WalletReadyContext.Provider value={true}>
      <Stack>{children}</Stack>
    </WalletReadyContext.Provider>
  );
}
