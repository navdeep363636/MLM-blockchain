"use client";

/* ============================================================================
 * The two wallet-aware controls in AppShell, gated on the wallet stack.
 *
 * Web3Provider now imports that stack on an idle callback, so for the first
 * moment of a dashboard's life there is no WagmiProvider above these — and a
 * wagmi hook called outside one throws. Both are therefore dynamic imports (so
 * the shell's own chunk stays free of wagmi) rendered only once
 * `useWalletStackReady()` is true.
 *
 * The button keeps a same-size stub in the meantime so the header does not
 * reflow when the real one arrives, and pointer intent on the stub pulls the
 * stack in immediately rather than waiting for idle.
 * ========================================================================== */

import dynamic from "next/dynamic";
import { Wallet } from "lucide-react";

import { cn } from "@/lib/utils";
import { useWalletStackReady } from "./wallet-ready";
import { warmWalletStack } from "./deferred-web3-provider";

const RealButton = dynamic(
  () => import("./connect-button").then((m) => m.WalletConnectButton),
  { ssr: false, loading: () => <ButtonStub /> },
);

const RealGuard = dynamic(() => import("./network-guard").then((m) => m.NetworkGuard), {
  ssr: false,
});

function ButtonStub({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <button
      type="button"
      onPointerEnter={warmWalletStack}
      onFocus={warmWalletStack}
      onClick={warmWalletStack}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl border border-border-default bg-surface-2",
        "font-medium text-text-primary transition-[background-color,border-color,box-shadow]",
        "duration-[var(--dur-quick)] hover:border-[var(--accent-ring)] hover:bg-surface-3",
        compact ? "h-10 px-3 text-sm" : "h-11 w-full px-4 text-sm",
        className,
      )}
    >
      <Wallet className="size-4" />
      {compact ? "Connect" : "Connect wallet"}
    </button>
  );
}

export function ShellWalletButton({ className, compact }: { className?: string; compact?: boolean }) {
  const ready = useWalletStackReady();
  if (!ready) return <ButtonStub className={className} compact={compact} />;
  return <RealButton className={className} compact={compact} />;
}

/** Renders nothing until there is a wallet connection to be on the wrong chain. */
export function ShellNetworkGuard() {
  return useWalletStackReady() ? <RealGuard /> : null;
}
