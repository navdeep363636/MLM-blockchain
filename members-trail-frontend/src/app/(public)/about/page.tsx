/* About — FRD 4.1, 2.5 */

import Link from "next/link";
import {
  ArrowRight, Ban, Building2, Check, Gavel, Landmark, Rocket, Scale, ShieldCheck, Target, Users, X,
} from "lucide-react";
import { Avatar, Badge, Button, Callout } from "@/components/ui";
import { RevealGroup, RevealItem } from "@/components/fx";
import { CtaBand, PageHero, Section, SectionHead } from "../_components/shell";
import { FactCard, FeatureCard, IconTile } from "../_components/feature-card";

export const metadata = {
  title: "About us",
  description:
    "Why Members Trail is built the way it is: revenue-funded payouts, capped referrals, and an on-chain solvency invariant.",
};

/** FRD 2.5 — the regulatory tests the design is deliberately structured to pass. */
const TESTS = [
  {
    test: "FTC “primarily rewards recruitment” test",
    how: "Referral income is capped and secondary. Core earning comes from gameplay and staking, neither of which requires recruiting anyone.",
  },
  {
    test: "Howey Test (investment contract)",
    how: "MTT is a utility and access token for gameplay and rewards, not sold as an investment with a promised return. Staking yield is variable and revenue-linked, not a guaranteed fixed return.",
  },
  {
    test: "Pyramid / chain-scheme statutes (e.g. India's PCMCS Act 1978)",
    how: "No entry fee is required to join or to earn. Money paid to any user never traces back to another member's deposit — only to independently generated revenue.",
  },
];

const PRINCIPLES = [
  {
    icon: <Landmark />,
    title: "Revenue first, payouts second",
    body: "Every rupee paid to a player traces to a settled revenue event: a purchase, a tournament fee, an ad impression, a subscription. Reconciliation happens before funding, not after.",
  },
  {
    icon: <ShieldCheck />,
    title: "Enforce it in code, not policy",
    body: "The referral distributor reverts if recorded commission would exceed deposited funds. The staking contract has no path from stakers' principal to reward payouts. Policies can drift; a require() statement cannot.",
  },
  {
    icon: <Scale />,
    title: "Cap what could run away",
    body: "Points issuance, Points-to-MTT conversion, referral depth, per-user monthly commission — all capped. Uncapped systems are how token economies and compensation plans collapse.",
  },
  {
    icon: <Ban />,
    title: "No number we can't defend",
    body: "No fixed APR, no projected monthly income, no 'typical earnings'. If we can't derive a figure from real data on demand, we don't publish it.",
  },
  {
    icon: <Users />,
    title: "Separate the keys",
    body: "Treasury moves money, the oracle records commissions but cannot move money, compliance handles KYC and clawbacks. No single compromised key can drain anything.",
  },
  {
    icon: <Gavel />,
    title: "Legal review is a gate, not a formality",
    body: "Material changes to the compensation plan, tokenomics or entry-fee structure pass a legal checkpoint before publication, in every jurisdiction we operate in.",
  },
];

const ROADMAP = [
  { phase: "Phase 1", status: "done", title: "Contracts and economy design", body: "MTT token, vesting, staking and referral distributor written, unit-tested and rehearsed end-to-end on a local chain." },
  { phase: "Phase 2", status: "active", title: "Testnet soak on BSC", body: "Deployment to BSC Testnet with a 2–4 week public testing period, post-deploy verification, and role separation exercised in anger." },
  { phase: "Phase 3", status: "next", title: "Independent audit", body: "Third-party smart-contract audit with the report published. Bug bounty sized to expected value locked." },
  { phase: "Phase 4", status: "next", title: "Mainnet and first title", body: "Multisig plus timelock live, liquidity locked, and the first ranked game opening to real Points." },
  { phase: "Phase 5", status: "later", title: "Catalog and marketplace growth", body: "More titles, peer-to-peer asset trading at scale, and a published quarterly transparency report on payout funding." },
];

const TEAM = [
  { name: "Product & Business", role: "Compensation plan, economy design, transparency reporting" },
  { name: "Backend & Ledger", role: "Commission engine, ledger service, revenue recognition" },
  { name: "Blockchain", role: "Solidity contracts, multisig operations, on-chain monitoring" },
  { name: "Compliance & AML", role: "KYC tiers, transaction monitoring, SAR workflow" },
  { name: "Game Engineering", role: "Anti-cheat, server-side validation, title integrations" },
  { name: "Design & Frontend", role: "Player and admin experience, accessibility, disclosure UX" },
];

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow={<>About Members Trail</>}
        title={<>We built the boring version <span className="text-gradient-brand">on purpose.</span></>}
        lede="Plenty of play-to-earn platforms pay early users with later users' money and call it yield. That model always ends the same way. Members Trail is the attempt to build the version that doesn't — which means accepting lower, variable, honest numbers."
        orbs
      >
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          <FactCard label="Payout funding rule" value="Revenue only" note="Never from another member's deposit, stake or purchase." icon={<Landmark />} />
          <FactCard label="Referral depth" value="3 levels" note="Capped by design, not by current convenience." icon={<Users />} />
          <FactCard label="Mint function" value="None" note="Fixed 1B supply. Shortfalls can't be papered over." icon={<Ban />} />
        </div>
      </PageHero>

      <Section>
        <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
          <div>
            <SectionHead
              eyebrow="Mission"
              title="Make skill pay, without pretending it's an investment"
              description="Games should reward the person who got better at them. Tokens should be useful inside the thing they belong to. Neither of those requires promising anyone a return — and the moment a platform does, it has taken on an obligation it can only meet with someone else's money."
            />
            <p className="mt-5 text-[0.95rem] leading-relaxed text-text-secondary">
              So the design starts from the constraint rather than the promise. We measured what
              in-app purchases, tournament rake, marketplace fees, advertising and subscriptions
              actually generate, allocated a published share of that to a Revenue Treasury, and built
              payouts that cannot exceed it. Staking APR floats with real inflow. Referral commission
              is a marketing cost, capped like any other marketing cost.
            </p>
            <p className="mt-4 text-[0.95rem] leading-relaxed text-text-secondary">
              The result is less exciting than a fixed 40% APR banner. It is also still solvent in
              month eighteen.
            </p>
          </div>

          <div className="rounded-[var(--radius-panel)] border border-[var(--accent-ring)] bg-surface-1 p-6 glow-brand">
            <Badge tone="brand" className="mb-4">The one rule</Badge>
            <blockquote className="font-display text-xl font-semibold leading-snug tracking-tight text-text-primary sm:text-2xl">
              &ldquo;Money paid out to users — staking yield <em>and</em> referral commissions — must
              come from independently verifiable platform revenue. Never from the deposits, stakes or
              purchases of newly joined members.&rdquo;
            </blockquote>
            <p className="mt-5 text-sm leading-relaxed text-text-muted">
              This sentence governs every technical decision on the platform. It is enforced in the
              backend, asserted in the smart contracts, covered by the contract test suite, and
              reflected in the legal documents. Where a product decision conflicted with it, the
              product decision lost.
            </p>
            <Link
              href="/how-it-works"
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent-hover)] hover:underline"
            >
              See how it's enforced <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </Section>

      <Section tone="inset" bordered>
        <SectionHead
          eyebrow="How the money moves"
          title="Revenue → Treasury → pools → players"
          description="Four hops, each of them auditable. The reconciliation gate between hop one and hop two is the part most platforms skip."
        />

        <div className="mt-10 grid gap-3 lg:grid-cols-4">
          {[
            { n: 1, title: "Revenue event", body: "A purchase, entry fee, ad impression or subscription settles with the payment processor.", icon: <Building2 /> },
            { n: 2, title: "Reconciled to Treasury", body: "Reported revenue is matched against processor settlement data. Mismatches are flagged and block funding.", icon: <Scale /> },
            { n: 3, title: "Multisig funds a pool", body: "Three-of-five signers move reconciled MTT into a staking reward pool or the commission pool, on-chain.", icon: <ShieldCheck /> },
            { n: 4, title: "Players claim", body: "Stakers claim accrued rewards; referrers claim released commission. Both bounded by the funded balance.", icon: <Users /> },
          ].map((s) => (
            <div key={s.n} className="relative rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
              <div className="flex items-center justify-between">
                <IconTile size="sm">{s.icon}</IconTile>
                <span className="tnum font-display text-2xl font-semibold text-[var(--accent)] opacity-30">
                  {String(s.n).padStart(2, "0")}
                </span>
              </div>
              <p className="mt-3.5 text-sm font-semibold text-text-primary">{s.title}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{s.body}</p>
              {s.n < 4 && (
                <span className="absolute -right-1.5 top-1/2 hidden size-3 -translate-y-1/2 rotate-45 border-r border-t border-border-default bg-surface-1 lg:block" />
              )}
            </div>
          ))}
        </div>

        <Callout tone="brand" title="Outflows can never exceed reconciled inflows" icon={<Landmark />} className="mt-8">
          <p className="mt-1">
            The admin Treasury page is the compliance backbone of the platform, and it enforces this
            as a hard control: a funding transfer cannot be approved for an amount exceeding
            reconciled inflows for the relevant period. The commission-payout-to-inflow ratio is
            tracked as the single most important operational KPI and is flagged prominently if it
            approaches 100%.
          </p>
        </Callout>
      </Section>

      <Section>
        <SectionHead
          eyebrow="Design principles"
          title="Six commitments we can be held to"
          description="Each of these is checkable. If you find us breaking one, that's a legitimate complaint and we'd like to hear it."
        />
        <RevealGroup className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PRINCIPLES.map((p) => (
            <RevealItem key={p.title}>
              <FeatureCard icon={p.icon} title={p.title} description={p.body} />
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>

      <Section tone="inset" bordered>
        <SectionHead
          eyebrow="Regulatory posture"
          title="The tests this design is built to pass"
          description="Referral programmes attract scrutiny, and they should. Rather than hoping to avoid the questions, the structure is arranged so the answers are straightforward."
        />

        <div className="mt-8 overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1">
          <table className="w-full text-sm">
            <caption className="sr-only">Regulatory tests and how the platform design satisfies each</caption>
            <thead>
              <tr className="border-b border-border-default bg-surface-inset">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Test</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">How this design satisfies it</th>
              </tr>
            </thead>
            <tbody>
              {TESTS.map((t) => (
                <tr key={t.test} className="border-b border-border-subtle last:border-0">
                  <td className="px-5 py-4 align-top">
                    <span className="flex gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-good-400" />
                      <span className="font-medium text-text-primary">{t.test}</span>
                    </span>
                  </td>
                  <td className="px-5 py-4 align-top leading-relaxed text-text-secondary">{t.how}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Callout tone="warning" title="Not legal advice" icon={<Gavel />} className="mt-6">
          <p className="mt-1">
            This is a description of design intent, not a legal opinion. MLM, gaming and token
            regulations vary significantly by country and state. The compensation plan, token
            classification and all platform legal documents are reviewed by licensed counsel in every
            jurisdiction we operate in before launch there, and availability is restricted where they
            advise it.
          </p>
        </Callout>
      </Section>

      <Section>
        <SectionHead
          eyebrow="Roadmap"
          title="Where we actually are"
          description="Stated plainly, including the parts that aren't finished. Nothing here should be read as a commitment to a date."
        />
        <ol className="mt-10 space-y-0">
          {ROADMAP.map((r, i) => (
            <li key={r.phase} className="relative flex gap-5 pb-8 last:pb-0">
              {i < ROADMAP.length - 1 && (
                <span className="absolute left-[1.1rem] top-9 h-full w-px bg-border-default" aria-hidden />
              )}
              <span
                className={
                  r.status === "done"
                    ? "relative z-10 grid size-9 shrink-0 place-items-center rounded-full bg-good-500 text-white"
                    : r.status === "active"
                      ? "relative z-10 grid size-9 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-white ring-4 ring-[var(--accent-soft)]"
                      : "relative z-10 grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 text-text-muted ring-1 ring-border-default"
                }
              >
                {r.status === "done" ? <Check className="size-4" /> : r.status === "active" ? <Rocket className="size-4" /> : <Target className="size-4" />}
              </span>
              <div className="min-w-0 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">{r.phase}</span>
                  {r.status === "done" && <Badge tone="good" dot>Complete</Badge>}
                  {r.status === "active" && <Badge tone="brand" dot>In progress</Badge>}
                </div>
                <p className="mt-1.5 font-display text-base font-semibold text-text-primary">{r.title}</p>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-text-muted">{r.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section tone="inset" bordered>
        <SectionHead
          eyebrow="The team"
          title="Who builds this"
          description="Named profiles go live alongside the audit report. Until then, here are the functions and what each is accountable for."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TEAM.map((t) => (
            <div key={t.name} className="flex items-start gap-3.5 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
              <Avatar name={t.name} size="md" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary">{t.name}</p>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">{t.role}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <CtaBand
        title="Judge it by the constraints, not the copy"
        description="Read the tokenomics, read the referral terms, then decide. Both are written to be checked rather than skimmed."
        primary={{ label: "Read the tokenomics", href: "/tokenomics" }}
        secondary={{ label: "Referral program terms", href: "/legal/referral-terms" }}
      />
    </>
  );
}
