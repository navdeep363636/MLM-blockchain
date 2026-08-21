import Link from "next/link";
import { ArrowLeft, ShieldCheck, TrendingUp, Wallet } from "lucide-react";
import { Logo } from "@/components/layout";
import { AuroraBackground, FloatingOrbs, GridBackdrop, NoiseOverlay } from "@/components/fx";

/**
 * Split auth layout: form on the left, a compliance-forward brand panel on the
 * right. The three assurances shown are the FRD's core promises — they belong
 * in front of anyone creating an account.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative flex flex-col px-5 py-8 sm:px-8 lg:px-14">
        <div className="flex items-center justify-between gap-4">
          <Logo />
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text-primary"
          >
            <ArrowLeft className="size-3.5" />
            Back to site
          </Link>
        </div>
        <main id="main" className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-md">{children}</div>
        </main>
        <p className="text-center text-xs text-text-muted">
          Protected by 2FA and rate limiting ·{" "}
          <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-text-secondary">Privacy</Link>
          {" · "}
          <Link href="/legal/terms" className="underline underline-offset-2 hover:text-text-secondary">Terms</Link>
        </p>
      </div>

      <aside className="relative hidden overflow-hidden border-l border-border-subtle bg-surface-inset lg:block">
        <AuroraBackground intensity={1.2} />
        <GridBackdrop />
        <FloatingOrbs count={18} />
        <NoiseOverlay />
        <div className="relative flex h-full flex-col justify-center px-14 py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            Members Trail
          </p>
          <h2 className="mt-4 max-w-md font-display text-3xl font-semibold leading-tight tracking-tight text-text-primary">
            Play for skill. Earn from revenue.{" "}
            <span className="text-gradient-brand">Never from someone else&apos;s deposit.</span>
          </h2>

          <ul className="mt-10 space-y-6">
            {[
              {
                Icon: TrendingUp,
                title: "Earn without referring anyone",
                body: "Gameplay and staking give you 100% access to platform earnings. Referrals are an optional, capped bonus.",
              },
              {
                Icon: ShieldCheck,
                title: "Payouts capped on-chain",
                body: "The distributor contract reverts if commissions would ever exceed what real revenue has funded.",
              },
              {
                Icon: Wallet,
                title: "Your keys, your MTT",
                body: "Connect MetaMask, Trust or any WalletConnect wallet — or use a platform wallet secured by MPC.",
              },
            ].map(({ Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-[var(--accent)] ring-1 ring-inset ring-[var(--accent-ring)]">
                  <Icon className="size-4.5" />
                </span>
                <div className="max-w-sm">
                  <p className="text-sm font-semibold text-text-primary">{title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-12 max-w-md text-xs leading-relaxed text-text-muted">
            18+ only. Availability is restricted in some jurisdictions. MTT is a utility token, not an
            investment — no return is promised or guaranteed.
          </p>
        </div>
      </aside>
    </div>
  );
}
