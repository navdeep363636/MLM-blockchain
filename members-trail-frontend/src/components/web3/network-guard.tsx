"use client";

import { AlertTriangle, Info } from "lucide-react";
import { useSwitchChain } from "wagmi";
import { CHAIN_ID, CONTRACTS_CONFIGURED, IS_TESTNET } from "@/lib/web3";
import { useWallet } from "@/lib/hooks/use-web3";
import { Button } from "@/components/ui";

/** Sticky banner shown when the wallet is on the wrong chain. */
export function NetworkGuard() {
  const { wrongNetwork, chainName } = useWallet();
  const { switchChain, isPending } = useSwitchChain();

  if (!wrongNetwork) return null;

  return (
    <div className="sticky top-0 z-[80] flex flex-wrap items-center justify-center gap-3 border-b border-critical-500/40 bg-critical-500/12 px-4 py-2.5 text-sm">
      <span className="flex items-center gap-2 font-medium text-critical-400">
        <AlertTriangle className="size-4" />
        Wallet is on {chainName ?? "an unsupported network"}. Switch to BNB Smart Chain{IS_TESTNET ? " Testnet" : ""}.
      </span>
      <Button size="xs" variant="danger" loading={isPending} onClick={() => switchChain({ chainId: CHAIN_ID })}>
        Switch network
      </Button>
    </div>
  );
}

/**
 * Development banner: the UI is running against the mock data layer because no
 * contract addresses are configured. Silent in production builds.
 */
export function MockDataBanner() {
  if (CONTRACTS_CONFIGURED) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 border-b border-border-subtle bg-surface-2 px-4 py-2 text-xs text-text-muted">
      <Info className="size-3.5 shrink-0 text-[var(--accent)]" />
      <span>
        Demo data — no contract addresses configured. Set
        <code className="mx-1 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">
          NEXT_PUBLIC_MTT_TOKEN_ADDRESS
        </code>
        and friends in <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">.env.local</code> to read live on-chain state.
      </span>
    </div>
  );
}
