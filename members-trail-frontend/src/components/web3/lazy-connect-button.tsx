"use client";

/* ============================================================================
 * The wallet button for the PUBLIC header, which loads the wallet stack only
 * when someone actually reaches for it.
 *
 * The public header carried the real <WalletConnectButton/>, and because that
 * calls RainbowKit hooks it dragged wagmi + every connector into the first-load
 * JS of every marketing page, FAQ entry and legal document — for a control that
 * a first-time visitor almost never touches.
 *
 * So: render a plain button that looks exactly like the real one, and on the
 * first hint of intent (pointer enter, focus, or click) import the wallet stack
 * and hand over. A click also opens the connect modal as soon as the stack is
 * ready, so one click still means one action — it just may resolve a few hundred
 * milliseconds later on a cold cache, instead of every page paying for it.
 *
 * Once handed over, the real button owns the slot for the rest of the session,
 * including the connected account state.
 * ========================================================================== */

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const RealConnect = dynamic(
  () => import("./connect-button-live").then((m) => m.LiveConnectButton),
  { ssr: false, loading: () => <ButtonShell aria-hidden /> },
);

function ButtonShell({
  className, compact, ...rest
}: React.ComponentPropsWithoutRef<"button"> & { compact?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
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

export function LazyWalletConnectButton({
  className, compact,
}: { className?: string; compact?: boolean }) {
  const [armed, setArmed] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  /* Guards against a pointerenter and a click both arming it, which would
   * otherwise set state twice before the first render committed. */
  const armedOnce = useRef(false);

  const arm = useCallback(() => {
    if (armedOnce.current) return;
    armedOnce.current = true;
    setArmed(true);
  }, []);

  if (armed) return <RealConnect className={className} compact={compact} autoOpen={autoOpen} />;

  return (
    <ButtonShell
      className={className}
      compact={compact}
      onPointerEnter={arm}
      onFocus={arm}
      onClick={() => { setAutoOpen(true); arm(); }}
    />
  );
}
