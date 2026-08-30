/* ============================================================================
 * Its own file, not part of network-guard.tsx, because AppShell renders it on
 * every dashboard and network-guard.tsx imports wagmi — a barrel re-export from
 * there put the whole wallet stack back into the shell's first-load JS, which is
 * the exact cost web3-provider.tsx exists to defer. Nothing here needs a wallet.
 * ========================================================================== */

import { Info } from "lucide-react";
import { CONTRACTS_CONFIGURED } from "@/lib/web3";

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
