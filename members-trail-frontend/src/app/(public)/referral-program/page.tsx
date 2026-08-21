/* P-05 · Referral Program Overview — FRD 5.1, 2.4, 7.1–7.5 */

import Link from "next/link";
import {
  Ban, CheckCircle2, CircleSlash, Gift, Layers, Scale, ShieldCheck, TriangleAlert, Users, XCircle,
} from "lucide-react";
import { Badge, Button, Callout } from "@/components/ui";
import { RevealGroup, RevealItem } from "@/components/fx";
import { CtaBand, PageHero, Section, SectionHead } from "../_components/shell";
import { FactCard, FeatureCard, IconTile } from "../_components/feature-card";
import { CommissionCalculator } from "./_components/calculator";

export const metadata = {
  title: "Referral program",
  description:
    "Three levels, 8/3/1% of eligible real-money spend, capped monthly and funded from real revenue. Free to join and never required to earn.",
};

const IS: string[] = [
  "A capped marketing bonus paid on a referred player's verified real-money purchases.",
  "Free to join and free to participate — there is no joining fee, ever.",
  "Limited to three levels deep, with sharply decreasing rates (8% / 3% / 1%).",
  "Funded exclusively from the Revenue Treasury, which holds a published share of actual platform revenue.",
  "Fully auditable — every payout line shows the revenue event and Treasury deposit that funded it.",
  "Entirely optional. A player who never refers anyone still accesses 100% of platform earnings.",
];

const IS_NOT: string[] = [
  "A percentage of anyone's stake principal, deposit or Points conversion being passed upward.",
  "An income opportunity, a business opportunity, or a substitute for employment.",
  "A scheme where recruiting is required to earn, withdraw, or unlock features.",
  "Uncapped — per-recipient monthly caps stop professional-recruiter income concentration.",
  "Deeper than three levels, no matter how large your network becomes.",
  "A promise of any particular amount. Most participants earn little or nothing.",
];

const RULES = [
  { icon: <ShieldCheck />, title: "KYC before release", body: "Commission accrues in a pending state but is only released to a withdrawable balance once you hold Tier 1 KYC approval." },
  { icon: <CircleSlash />, title: "Self-referral is blocked", body: "Shared identity, device or payment fingerprint between a code owner and a new sign-up is flagged for fraud review at registration." },
  { icon: <Layers />, title: "Referral loops rejected", body: "A refers B who refers A is detected and blocked. Circular referral rings are a standing fraud-alert category." },
  { icon: <Users />, title: "Real players only", body: "A referred account must reach a minimum age and a minimum number of genuine gameplay sessions before it can generate its first commission." },
  { icon: <Scale />, title: "Caps do not roll over", body: "Commission above your monthly cap is not paid and is not carried into the following month." },
  { icon: <Ban />, title: "No income claims", body: "Making unsubstantiated earnings claims about Members Trail breaches the Referral Program Terms and can cost you the programme." },
];

export default function ReferralProgramPage() {
  return (
    <>
      <PageHero
        eyebrow={<>Referral program</>}
        title={<>An optional bonus — <span className="text-gradient-brand">not an income opportunity.</span></>}
        lede="If you enjoy the games and want to share them, we'll pay you a capped percentage of what the people you bring actually spend. That's the whole offer. You never need to refer anyone to earn on Members Trail."
        orbs
        actions={
          <>
            <Button href="/signup" size="lg">Get your referral code</Button>
            <Button href="/legal/referral-terms" variant="outline" size="lg">Read the full terms</Button>
          </>
        }
      >
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FactCard label="Cost to join" value="₹0" note="No joining fee. A fee paid upward would make this a pyramid." icon={<Gift />} />
          <FactCard label="Levels" value="3 max" note="8% / 3% / 1% of eligible spend." icon={<Layers />} />
          <FactCard label="Monthly cap" value="₹50,000" note="Absolute ceiling, with a spend-linked formula below it." icon={<Scale />} />
          <FactCard label="Commissionable on" value="Real spend" note="Purchases, entry fees, subscriptions. Never stakes or deposits." icon={<ShieldCheck />} />
        </div>
      </PageHero>

      <Section>
        <SectionHead
          eyebrow="The structure"
          title="Three levels, decreasing sharply"
          description="Depth is capped at three deliberately. Deep multi-level structures are what regulators look for when distinguishing a marketing bonus from an unlawful recruitment scheme — so we simply don't have one."
        />

        <RevealGroup className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            { level: 1, rate: "8%", label: "Direct referral", body: "Someone who signed up with your code." },
            { level: 2, rate: "3%", label: "Referral of a referral", body: "Someone your direct referral brought in." },
            { level: 3, rate: "1%", label: "Third tier", body: "One step further. This is where it stops." },
          ].map((l) => (
            <RevealItem key={l.level}>
              <div className="relative h-full overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-6">
                <span
                  className="absolute inset-x-0 top-0 h-0.5"
                  style={{ background: `var(--series-${l.level})` }}
                />
                <div className="flex items-baseline justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    <span className="size-2 rounded-full" style={{ background: `var(--series-${l.level})` }} />
                    Level {l.level}
                  </span>
                  <span className="tnum font-display text-3xl font-semibold tracking-tight text-text-primary">{l.rate}</span>
                </div>
                <p className="mt-4 text-sm font-medium text-text-primary">{l.label}</p>
                <p className="mt-1 text-sm leading-relaxed text-text-muted">{l.body}</p>
                <p className="mt-4 border-t border-border-subtle pt-3 text-xs leading-relaxed text-text-muted">
                  Applies to that player&apos;s eligible real-money spend: in-app purchases, tournament
                  entry fees and Premium Pass subscriptions.
                </p>
              </div>
            </RevealItem>
          ))}
        </RevealGroup>

        <Callout tone="brand" title="These rates are sized against revenue, not ambition" icon={<Scale />} className="mt-6">
          <p className="mt-1">
            Total projected commission liability across all three levels is deliberately kept
            comfortably below the share of revenue allocated to the commission pool, leaving margin
            for staking rewards and operations. Before any rate change is published, a simulator
            projects the liability against current Treasury inflow — if it wouldn&apos;t be sustainable,
            it doesn&apos;t ship.
          </p>
        </Callout>
      </Section>

      <Section tone="inset" bordered>
        <SectionHead
          eyebrow="Plainly stated"
          title="What this is, and what it isn't"
          description="We would rather lose a sign-up than have someone join with the wrong expectation."
        />

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <div className="rounded-[var(--radius-panel)] border border-good-500/30 bg-surface-1 p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-good-500/12 text-good-400">
                <CheckCircle2 className="size-5" />
              </span>
              <h3 className="font-display text-lg font-semibold text-text-primary">What it is</h3>
            </div>
            <ul className="mt-5 space-y-3">
              {IS.map((t) => (
                <li key={t} className="flex gap-2.5 text-sm leading-relaxed text-text-secondary">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good-400" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-[var(--radius-panel)] border border-critical-500/30 bg-surface-1 p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-critical-500/12 text-critical-400">
                <XCircle className="size-5" />
              </span>
              <h3 className="font-display text-lg font-semibold text-text-primary">What it is not</h3>
            </div>
            <ul className="mt-5 space-y-3">
              {IS_NOT.map((t) => (
                <li key={t} className="flex gap-2.5 text-sm leading-relaxed text-text-secondary">
                  <XCircle className="mt-0.5 size-4 shrink-0 text-critical-400" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section>
        <SectionHead
          eyebrow="Calculator"
          title="See the arithmetic yourself"
          description="Every commission on the platform is computed exactly this way, and every payout line in your history shows you the inputs."
        />
        <div className="mt-8">
          <CommissionCalculator />
        </div>
      </Section>

      <Section tone="inset" bordered>
        <SectionHead
          eyebrow="Rules that protect the programme"
          title="Anti-abuse is not optional"
          description="These limits exist so that genuine players aren't funding someone else's farm — and so the programme stays lawful."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RULES.map((r) => (
            <FeatureCard key={r.title} icon={r.icon} title={r.title} description={r.body} />
          ))}
        </div>
      </Section>

      <Section>
        <Callout tone="critical" title="No earnings claims — ours or yours" icon={<TriangleAlert />}>
          <p className="mt-1">
            Members Trail does not publish income figures, and the marketing assets we provide contain
            no earnings claims. Under the{" "}
            <Link href="/legal/referral-terms">Referral Program Terms</Link> you are prohibited from
            making unsubstantiated income claims when sharing your code — including screenshots
            presented as typical results, &ldquo;passive income&rdquo; framing, or any suggestion that
            joining guarantees a return. Breaching this can result in removal from the programme and
            forfeiture of pending commission.
          </p>
        </Callout>
      </Section>

      <CtaBand
        title="Play first. Share only if you want to."
        description="Your referral code is generated automatically when you sign up. Using it is entirely up to you — nothing about your account depends on it."
        primary={{ label: "Create a free account", href: "/signup" }}
        secondary={{ label: "See how earning works", href: "/how-it-works" }}
        note="Referral commissions require Tier 1 KYC before release. 18+ only."
      />
    </>
  );
}
