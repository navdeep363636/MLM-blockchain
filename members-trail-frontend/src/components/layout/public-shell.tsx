"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { publicFooterNav, publicNav } from "@/lib/nav";
import { Button } from "@/components/ui";
import { WalletConnectButton } from "@/components/web3";
import { ScrollProgress } from "@/components/fx";
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
      <header
        className={cn(
          "sticky top-0 z-[70] transition-all duration-300",
          scrolled ? "glass border-b border-border-subtle" : "border-b border-transparent",
        )}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Logo />

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
            {publicNav.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={cn(
                    "relative rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active ? "text-text-primary" : "text-text-muted hover:text-text-primary",
                  )}
                >
                  {l.label}
                  {active && (
                    <motion.span
                      layoutId="public-nav-dot"
                      className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-[var(--accent)]"
                    />
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle className="hidden sm:grid" />
            <div className="hidden sm:block">
              <WalletConnectButton compact />
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
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden border-t border-border-subtle bg-surface-1 lg:hidden"
            >
              <nav className="mx-auto max-w-7xl space-y-1 px-4 py-4 sm:px-6" aria-label="Mobile">
                {publicNav.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={cn(
                      "block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      pathname === l.href
                        ? "bg-accent-soft text-[var(--accent-hover)]"
                        : "text-text-secondary hover:bg-surface-2",
                    )}
                  >
                    {l.label}
                  </Link>
                ))}
                <div className="flex flex-col gap-2 pt-3">
                  <WalletConnectButton />
                  <Button href="/login" variant="outline" fullWidth>Log in</Button>
                  <Button href="/signup" fullWidth>Sign up free</Button>
                </div>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
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
    <footer className="relative mt-24 border-t border-border-subtle bg-surface-inset">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
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
                      className="group inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-[var(--accent-hover)]"
                    >
                      {it.label}
                      <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
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
