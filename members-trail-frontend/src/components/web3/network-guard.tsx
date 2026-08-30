"use client";

import { AlertTriangle } from "lucide-react";
import { useSwitchChain } from "wagmi";
import { CHAIN_ID, IS_TESTNET } from "@/lib/web3";
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
