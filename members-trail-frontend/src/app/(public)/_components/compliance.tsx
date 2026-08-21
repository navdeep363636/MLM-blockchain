/* Compliance surfaces reused across the public site. Per CONVENTIONS.md these
 * are product features, not boilerplate: every earnings-adjacent page renders
 * at least one of them. */

import Link from "next/link";
import {
  BadgeCheck, FileWarning, HeartHandshake, Landmark, ScrollText, ShieldCheck,
} from "lucide-react";
import { Callout } from "@/components/ui";
import { Reveal } from "@/components/fx";
import { cn } from "@/lib/utils";
import { Container } from "./shell";

const TRUST_LINKS = [
  {
    href: "/legal/aml-kyc",
    title: "AML / KYC Policy",
    blurb: "Tiered identity verification, ongoing monitoring, and reporting duties.",
    icon: <ShieldCheck />,
  },
  {
    href: "/legal/risk-disclosure",
    title: "Risk Disclosure",
    blurb: "Token volatility, variable yield, smart-contract and liquidity risk.",
    icon: <FileWarning />,
  },
  {
    href: "/legal/responsible-gaming",
    title: "Responsible Gaming",
    blurb: "Spend and session limits, self-exclusion, and support resources.",
    icon: <HeartHandshake />,
  },
  {
    href: "/legal/referral-terms",
    title: "Referral Program Terms",
    blurb: "Commission basis, monthly caps, and the ban on income claims.",
    icon: <ScrollText />,
  },
];

/** Trust / compliance strip (P-01 requirement, reused on several pages). */
export function TrustStrip({ className }: { className?: string }) {
  return (
    <section
      className={cn("relative border-y border-border-subtle bg-surface-inset py-14 sm:py-16", className)}
      aria-labelledby="trust-heading"
    >
      <Container>
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <h2 id="trust-heading" className="font-display text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">
                Built to be checked, not just trusted
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                Compliance documents are public before you ever create an account. Payouts are funded
                from real platform revenue and reconciled against the Revenue Treasury — the same
                figures the internal treasury dashboard reports on.
              </p>
            </div>
            <Link
              href="/legal"
              className="text-sm font-medium text-[var(--accent-hover)] underline underline-offset-4"
            >
              Browse the full legal hub
            </Link>
          </div>

          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="group flex h-full flex-col gap-2 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-4 transition-colors hover:border-[color-mix(in_oklab,var(--accent)_38%,var(--border-default))]"
                >
                  <span className="grid size-9 place-items-center rounded-lg bg-accent-soft text-[var(--accent)] [&>svg]:size-4">
                    {l.icon}
                  </span>
                  <span className="text-sm font-semibold text-text-primary">{l.title}</span>
                  <span className="text-xs leading-relaxed text-text-muted">{l.blurb}</span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            {[
              { icon: <Landmark className="size-3.5" />, label: "BNB Smart Chain · BEP-20" },
              { icon: <BadgeCheck className="size-3.5" />, label: "18+ only · geo-restricted" },
              { icon: <ShieldCheck className="size-3.5" />, label: "KYC required before withdrawal" },
              { icon: <FileWarning className="size-3.5" />, label: "No guaranteed returns" },
            ].map((c) => (
              <span
                key={c.label}
                className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-[11px] font-medium text-text-muted ring-1 ring-inset ring-border-subtle"
              >
                {c.icon}
                {c.label}
              </span>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

/** The one sentence this entire platform is designed around. */
export function FundingCallout({ className }: { className?: string }) {
  return (
    <Callout tone="brand" title="Where the money comes from" icon={<Landmark />} className={className}>
      Every payout — staking rewards and referral commission alike — is funded by real platform
      revenue: in-app purchases, tournament rake, marketplace fees, advertising and subscriptions.
      No payout is ever funded by another member&apos;s deposit, and there is no joining fee that gets
      distributed upward. Staking yield is variable and recalculated each period from actual Revenue
      Treasury inflows; it is never a fixed or promised rate.
    </Callout>
  );
}

/** Standard "these are drafts" legal note (FRD 11). */
export function DraftDocsCallout({ className }: { className?: string }) {
  return (
    <Callout tone="warning" title="Documents pending attorney review" icon={<FileWarning />} className={className}>
      The policies published here are structural drafts that define the required sections and
      clauses for our development and legal teams. They are not final, ready-to-publish legal text.
      A licensed attorney in each operating jurisdiction must review, adapt and approve the final
      language before launch, because gaming, token and marketing rules differ significantly by
      country and state.
    </Callout>
  );
}
