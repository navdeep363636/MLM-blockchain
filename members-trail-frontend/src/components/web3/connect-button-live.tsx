"use client";

/* ============================================================================
 * The real wallet button plus its own provider, in one lazily-imported chunk.
 *
 * This module is what LazyWalletConnectButton pulls in. It carries its own
 * Web3Provider because on public routes there is no wallet stack above it —
 * that is the entire point of the split. On routes that already have one
 * (player, admin, connect-wallet), use WalletConnectButton directly instead;
 * nesting a second WagmiProvider there would give the header its own
 * disconnected copy of the connection state.
 * ========================================================================== */

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useEffect, useRef } from "react";

import { Web3Provider } from "./web3-provider";
import { WalletConnectButton } from "./connect-button";

function AutoOpen() {
  const { openConnectModal } = useConnectModal();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || !openConnectModal) return;
    fired.current = true;
    openConnectModal();
  }, [openConnectModal]);

  return null;
}

export function LiveConnectButton({
  className, compact, autoOpen,
}: { className?: string; compact?: boolean; autoOpen?: boolean }) {
  return (
    <Web3Provider>
      <WalletConnectButton className={className} compact={compact} />
      {/* The click that triggered the import was consumed by the placeholder, so
          the intent has to be replayed once the modal is mountable. */}
      {autoOpen && <AutoOpen />}
    </Web3Provider>
  );
}
