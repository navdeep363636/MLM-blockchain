"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { AlertTriangle, ChevronDown, Wallet } from "lucide-react";
import { cn, shortenAddress } from "@/lib/utils";

/**
 * RainbowKit's ConnectButton.Custom, restyled to the platform design system so
 * the wallet control matches every other button on the page. The modal itself
 * is RainbowKit's, themed with our accent in providers.tsx.
 */
export function WalletConnectButton({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        if (!ready) {
          return <div className={cn("h-10 w-32 shimmer rounded-xl", className)} aria-hidden />;
        }

        if (!connected) {
          return (
            <button
              onClick={openConnectModal}
              className={cn(
                "group relative inline-flex h-10 items-center gap-2 overflow-hidden rounded-xl bg-[var(--accent)] px-4",
                "text-sm font-semibold text-white transition-all duration-200",
                "hover:bg-[var(--accent-hover)] active:scale-[0.98]",
                "before:pointer-events-none before:absolute before:inset-0 before:-translate-x-full",
                "before:bg-[linear-gradient(100deg,transparent,rgba(255,255,255,0.25),transparent)]",
                "before:transition-transform before:duration-700 hover:before:translate-x-full",
                className,
              )}
            >
              <Wallet className="size-4" />
              <span className="relative">{compact ? "Connect" : "Connect wallet"}</span>
            </button>
          );
        }

        if (chain.unsupported) {
          return (
            <button
              onClick={openChainModal}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-xl bg-critical-500/12 px-3.5 text-sm font-semibold text-critical-400 ring-1 ring-inset ring-critical-500/40 transition-colors hover:bg-critical-500/20",
                className,
              )}
            >
              <AlertTriangle className="size-4" />
              Wrong network
            </button>
          );
        }

        return (
          <div className={cn("flex items-center gap-2", className)}>
            {!compact && (
              <button
                onClick={openChainModal}
                title={`Connected to ${chain.name}`}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-surface-3 px-3 text-xs font-medium text-text-secondary ring-1 ring-inset ring-border-default transition-colors hover:ring-border-strong"
              >
                <span className="size-2 rounded-full bg-good-500" />
                <span className="hidden sm:inline">{chain.name}</span>
                <ChevronDown className="size-3 opacity-60" />
              </button>
            )}
            <button
              onClick={openAccountModal}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-surface-3 px-3 text-sm font-semibold text-text-primary ring-1 ring-inset ring-border-default transition-colors hover:ring-[var(--accent)]"
            >
              <span
                className="size-5 shrink-0 rounded-full"
                style={{ background: "linear-gradient(140deg, var(--color-brand-400), var(--color-brand-700))" }}
              />
              <span className="tnum">{shortenAddress(account.address)}</span>
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
