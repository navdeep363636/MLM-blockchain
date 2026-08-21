"use client";

/* ============================================================================
 * Client-only wagmi + RainbowKit configuration.
 *
 * getDefaultConfig() is a client function, so this module must never be
 * imported from a server component. Import server-safe constants from
 * ./chains (or the package root) instead.
 * ========================================================================== */

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { bsc, bscTestnet } from "wagmi/chains";
import { http } from "wagmi";
import { BSC_MAINNET_RPC, BSC_TESTNET_RPC, CHAIN_ID } from "./chains";

/* WalletConnect needs a project id. Without one, injected wallets (MetaMask,
 * Trust, Rabby) still work — only the QR/deep-link flow degrades. */
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

export const activeChain = CHAIN_ID === 56 ? bsc : bscTestnet;

export const wagmiConfig = getDefaultConfig({
  appName: "Members Trail",
  appDescription: "Play-to-earn gaming and affiliate rewards on BNB Smart Chain",
  projectId: projectId || "00000000000000000000000000000000",
  chains: CHAIN_ID === 56 ? [bsc] : [bscTestnet],
  transports: {
    [bsc.id]: http(BSC_MAINNET_RPC),
    [bscTestnet.id]: http(BSC_TESTNET_RPC),
  },
  ssr: true,
});
