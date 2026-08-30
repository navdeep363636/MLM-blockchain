"use client";

/* A one-bit context in a module of its own so that reading it never pulls in a
   provider — and therefore never pulls in wagmi. */

import { createContext, useContext } from "react";

export const WalletReadyContext = createContext(false);

/** True once a WagmiProvider is mounted above this component. */
export function useWalletStackReady(): boolean {
  return useContext(WalletReadyContext);
}
