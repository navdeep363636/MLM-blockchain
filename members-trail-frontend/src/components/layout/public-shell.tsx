"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { publicFooterNav, publicNav } from "@/lib/nav";
import { Button } from "@/components/ui";
import { LazyWalletConnectButton } from "@/components/web3/lazy-connect-button";
import { GlassPanel, MeshHaze, ScrollProgress } from "@/components/fx";
import { NavLink } from "./nav-link";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";

export function PublicHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <ScrollProgress />
      {/*
        The header has two states and morphs between them on scroll:

          at rest   full width, transparent, sitting on the hero's atmosphere
          scrolled  an inset floating glass pill with a rim light and a shadow

        The morph is a transition on max-width, border-radius, padding and
        backdrop — not a swap between two rendered headers — so the nav items
        never remount and the active-tab indicator does not jump. The sticky
        wrapper keeps its own height constant either way, which is what stops
        the page content shifting the moment you start scrolling.
      */}
      {/* The top padding is CONSTANT. A sticky element still reserves its box
          in normal flow at the top of the document, so animating the header's
          own height shifts every pixel of the page down as you begin to
          scroll. The morph is therefore confined to the inner pill. */}
      <header className="sticky top-0 z-[70] pt-3">
        <div
          className={cn(
            "mx-auto transition-[max-width,border-radius,background-color,box-shadow,border-color,padding] duration-500 ease-[var(--ease-tide)]",
            scrolled
              ? "max-w-6xl rounded-2xl border border-border-subtle glass-2 px-1"
              : "max-w-7xl rounded-none border border-transparent px-0",
          )}
        >
          <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <Logo />

            <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Main">
              {publicNav.map((l) => {
                const active = pathname === l.href;
                return (
                  <NavLink
                    key={l.href}
                    href={l.href}
                    active={active}
                    showIndicator={false}
                    className={cn(
                      "group relative rounded-xl px-3.5 py-2 text-sm font-medium transition-colors duration-[var(--dur-quick)]",
                      "text-text-muted hover:text-text-primary",
                    )}
                    activeClassName="text-text-primary"
                  >
                    {/* Hover plate, drawn behind the label. A background on the
                        link itself would animate its own text colour with it. */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 scale-90 rounded-xl bg-surface-2 opacity-0 transition-[opacity,transform] duration-[var(--dur-quick)] ease-[var(--ease-tide)] group-hover:scale-100 group-hover:opacity-100"
                    />
                    <span className="relative">{l.label}</span>
                    {active && (
                      <>
                        <motion.span
                          layoutId="public-nav-dot"
                          className="absolute inset-x-3.5 -bottom-0.5 h-0.5 rounded-full bg-[var(--accent)] shadow-[0_0_10px_1px_var(--accent-ring)]"
                          transition={{ duration: 0.38, ease: [0.32, 0.72, 0, 1] }}
                        />
                        <motion.span
                          layoutId="public-nav-glow"
                          aria-hidden
                          className="pointer-events-none absolute inset-x-1 bottom-0 h-7 rounded-t-xl bg-[linear-gradient(to_top,var(--accent-soft),transparent)]"
                          transition={{ duration: 0.38, ease: [0.32, 0.72, 0, 1] }}
                        />
                      </>
                    )}
                  </NavLink>
                );
              })}
            </nav>

            <div className="flex items-center gap-2">
              <ThemeToggle className="hidden sm:grid" />
              <div className="hidden sm:block">
                <LazyWalletConnectButton compact />
              </div>
              <Button href="/login" variant="ghost" size="sm" className="hidden md:inline-flex">Log in</Button>
              <Button href="/signup" size="sm" className="hidden md:inline-flex">Sign up free</Button>
              <button
                onClick={() => setOpen((o) => !o)}
                aria-label={open ? "Close menu" : "Open menu"}
                aria-expanded={open}
                className="grid size-10 place-items-center rounded-xl text-text-secondary transition-colors hover:bg-surface-2 lg:hidden"
              >
                {open ? <X className="size-5" /> : <Menu className="size-5" />}
              </button>
            </div>
          </div>

          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.36, ease: [0.32, 0.72, 0, 1] }}
                className="overflow-hidden border-t border-border-subtle lg:hidden"
              >
                <GlassPanel tier={2} radius="card" edge={false} className="mx-2 mb-2 mt-2">
                  <nav className="space-y-1 p-3" aria-label="Mobile">
                    {publicNav.map((l, i) => (
                      <motion.div
                        key={l.href}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.04 * i, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      >
                        <Link
                          href={l.href}
                          className={cn(
                            "block rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                            pathname === l.href
                              ? "bg-accent-soft text-[var(--accent-hover)] ring-1 ring-inset ring-[var(--accent-ring)]"
                              : "text-text-secondary hover:bg-surface-2",
                          )}
                        >
                          {l.label}
                        </Link>
                      </motion.div>
                    ))}
                    <div className="flex flex-col gap-2 pt-3">
                      <LazyWalletConnectButton />
                      <Button href="/login" variant="outline" fullWidth>Log in</Button>
                      <Button href="/signup" fullWidth>Sign up free</Button>
                    </div>
                  </nav>
                </GlassPanel>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>
    </>
  );
}

/** The year is read on the client only. A statically built page rendered in
 *  December would otherwise mismatch a client loading it in January. */
function ClientYear() {
  const [year, setYear] = useState<number | null>(null);
  useEffect(() => setYear(new Date().getFullYear()), []);
  return <>{year ?? ""}</>;
}

export function PublicFooter() {
  return (
    <footer className="relative isolate mt-24 overflow-hidden border-t border-border-subtle bg-surface-inset">
      {/* The footer is the bottom of the scene, so the haze here is inverted:
          faint, low, and behind everything — the light going out rather than a
          second hero. */}
      <MeshHaze opacity={0.3} />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--accent-ring),transparent)]"
      />
      <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-text-muted">
              Skill-based gaming on BNB Smart Chain. Every payout is funded by real platform
              revenue — never by another member&apos;s deposit.
            </p>
            <div className="mt-5 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text-muted ring-1 ring-inset ring-border-subtle">
                <span className="size-1.5 rounded-full bg-good-500" />
                BNB Smart Chain
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text-muted ring-1 ring-inset ring-border-subtle">
                BEP-20
              </span>
            </div>
          </div>

          {publicFooterNav.map((col) => (
            <div key={col.heading}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-primary">{col.heading}</h3>
              <ul className="mt-3.5 space-y-2.5">
                {col.items.map((it) => (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      className="group inline-flex items-center gap-1 text-sm text-text-muted transition-[color,transform] duration-[var(--dur-quick)] ease-[var(--ease-tide)] hover:translate-x-0.5 hover:text-[var(--accent-hover)]"
                    >
                      {it.label}
                      <ArrowUpRight className="size-3 -translate-x-1 opacity-0 transition-[opacity,transform] duration-[var(--dur-quick)] group-hover:translate-x-0 group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 space-y-4 border-t border-border-subtle pt-8">
          <p className="text-xs leading-relaxed text-text-muted">
            <strong className="font-semibold text-text-secondary">Important:</strong> Members Trail is a
            skill-based gaming platform. MTT is a utility token for gameplay and rewards — it is not an
            investment product, and no return is promised or guaranteed. Staking yield is variable and
            recalculated from actual Revenue Treasury inflows each period. Referral commissions are a
            capped marketing bonus paid from real revenue; referring other people is optional and is never
            required to earn or withdraw. There is no fee to join. Availability is restricted in some
            jurisdictions. Please read the{" "}
            <Link href="/legal/risk-disclosure" className="text-[var(--accent-hover)] underline underline-offset-2">Risk Disclosure</Link>{" "}
            and{" "}
            <Link href="/legal/referral-terms" className="text-[var(--accent-hover)] underline underline-offset-2">Referral Program Terms</Link>{" "}
            before participating. 18+ only.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-text-muted">© <ClientYear /> Members Trail. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <Link href="/legal" className="text-xs text-text-muted hover:text-text-secondary">Legal hub</Link>
              <Link href="/legal/cookies" className="text-xs text-text-muted hover:text-text-secondary">Cookies</Link>
              <Link href="/contact" className="text-xs text-text-muted hover:text-text-secondary">Contact</Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
