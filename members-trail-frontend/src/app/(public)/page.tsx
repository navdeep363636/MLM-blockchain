/* P-01 · Landing / Home — FRD 5.1 */

import Link from "next/link";
import {
  ArrowRight, Coins, Gamepad2, Landmark, Layers, Repeat, ShieldCheck, Sparkles, Store,
  TrendingUp, Trophy, Users, Wallet,
} from "lucide-react";
import { Button, Callout } from "@/components/ui";
import { Reveal } from "@/components/fx";
import { CtaBand, Container, Section, SectionHead } from "./_components/shell";
import { FeatureCard, IconTile } from "./_components/feature-card";
import { StepFlow, type FlowStep } from "./_components/step-flow";
import { FundingCallout, TrustStrip } from "./_components/compliance";
import { LiveStatsStrip } from "./_components/live-stats";
import { LandingHero } from "./_components/landing-hero";
import { FeaturedGames } from "./_components/landing-games";
import { StakingTeaser } from "./_components/landing-staking";
import { GameMarquee } from "./_components/landing-marquee";

export const metadata = {
  title: "Members Trail — skill gaming, Points, and MTT on BNB Smart Chain",
  description:
    "Play skill-based games, earn Points, convert them to MTT and stake or withdraw. " +
    "Free to join, no entry fee, and every payout funded by real platform revenue.",
};

const EARNING_STEPS: FlowStep[] = [
  {
    n: 1,
    title: "Play skill-based games",
    summary:
      "Eight titles across arcade, puzzle, strategy and rhythm. Scoring is skill-based — the same daily board, the same rules, no pay-to-win multipliers on ranked play.",
    icon: <Gamepad2 />,
  },
  {
    n: 2,
    title: "Earn Points",
    summary:
      "Sessions, quests, tournaments and rewarded ads credit Points to an off-chain ledger. Issuance is capped per user, per game and per day to keep the economy honest.",
    icon: <Sparkles />,
  },
  {
    n: 3,
    title: "Convert to MTT",
    summary:
      "Redeem Points for MTT at the current published rate. Every rate change is versioned, approved by two roles, and viewable on the public tokenomics page.",
    icon: <Repeat />,
  },
  {
    n: 4,
    title: "Stake, spend or withdraw",
    summary:
      "Stake MTT for revenue-funded rewards, spend it in the store and marketplace, or withdraw it to your own wallet once KYC is complete. All three are optional.",
    icon: <Wallet />,
  },
];

const REVENUE_STREAMS = [
  { label: "In-app purchases", note: "Cosmetics, boosts and energy refills." },
  { label: "Tournament entry rake", note: "A published share of optional paid events." },
  { label: "Marketplace fees", note: "Commission on peer-to-peer asset trades." },
  { label: "Advertising", note: "Rewarded video and in-app placements." },
  { label: "Premium Pass", note: "Optional monthly subscription." },
];

export default function LandingPage() {
  return (
    <>
      <LandingHero />

      <LiveStatsStrip />

      {/* ----------------------------- Featured games ----------------------------- */}
      <Section id="games" reveal={false}>
        <Reveal>
          <SectionHead
            eyebrow="Games catalog"
            title="Featured titles, one skill-based scoring model"
            description="Every game publishes its Points-per-session range and its daily Points cap up front. Try any of them in demo mode without an account — demo sessions are not saved and earn no Points."
          />
        </Reveal>
        <div className="mt-10">
          <FeaturedGames />
        </div>
      </Section>

      {/* --------------------------- How earning works ---------------------------- */}
      <Section id="earning" tone="inset" bordered reveal={false}>
        <Reveal>
          <SectionHead
            eyebrow="How earning works"
            title="Four steps from a game session to your own wallet"
            description="Points are the in-game unit. MTT is the token. Nothing in between requires you to recruit anybody, pay a joining fee, or lock funds you might need."
          />
        </Reveal>
        <div className="mt-10">
          <StepFlow steps={EARNING_STEPS} />
        </div>

        <Reveal delay={0.1}>
          <div className="mt-8 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <Callout tone="good" title="Referring people is a bonus, not the plan" icon={<Users />}>
              You can reach every earning mechanism on this platform — Points, conversion, staking,
              tournaments, the marketplace — without referring a single person. Referral commission is
              a capped marketing bonus on top, paid out of real revenue. It is never required to earn
              or to withdraw, and there is no fee to join or to refer.{" "}
              <Link href="/referral-program">See the referral program in full</Link>.
            </Callout>
            <FundingCallout />
          </div>
        </Reveal>

        <Reveal delay={0.16}>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button href="/how-it-works" variant="outline" iconRight={<ArrowRight className="size-4" />}>
              Walk through the full flow
            </Button>
            <Button href="/faq" variant="ghost">Read the FAQ</Button>
          </div>
        </Reveal>
      </Section>

      {/* ------------------------------- Staking --------------------------------- */}
      <Section id="staking" reveal={false}>
        <Reveal>
          <SectionHead
            eyebrow="Staking"
            title="Rewards that are funded before they are advertised"
            description="Each pool's rate is calculated after real revenue lands in that pool's reward balance — never promised in advance. Lock periods are optional; a flexible pool with no lock is always available."
          />
        </Reveal>
        <div className="mt-10">
          <StakingTeaser />
        </div>
      </Section>

      {/* -------------------------- Where money comes from ------------------------ */}
      <Section tone="inset" bordered reveal={false}>
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-start">
          <Reveal>
            <SectionHead
              eyebrow="Revenue Treasury"
              title="Five real revenue streams fund every payout"
              description="A defined share of each stream is routed into the Revenue Treasury. Staking rewards and referral commissions are paid from that pool and reconciled against it — so a payout can always be traced back to a genuine, independent revenue event."
            />
            <ul className="mt-7 space-y-3">
              {REVENUE_STREAMS.map((r) => (
                <li key={r.label} className="flex items-start gap-3">
                  <IconTile size="sm"><Landmark /></IconTile>
                  <div>
                    <p className="text-sm font-semibold text-text-primary">{r.label}</p>
                    <p className="text-xs text-text-muted">{r.note}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FeatureCard
                icon={<Coins />}
                title="Fixed-supply utility token"
                description="MTT is a BEP-20 token with 1,000,000,000 units fixed at deployment, 18 decimals, and no further minting. Rewards come from a pre-allocated pool, not from inflation."
                href="/tokenomics"
              />
              <FeatureCard
                icon={<ShieldCheck />}
                title="Published rate history"
                description="Every Points-to-MTT conversion rate, who proposed it, who approved it and when it took effect — all public, including superseded rates."
                href="/tokenomics#rate-history"
              />
              <FeatureCard
                icon={<Trophy />}
                title="Skill, not chance"
                description="Ranked play uses deterministic, seeded boards and Elo-style ladders. Prize splits are published before a tournament opens."
                href="/games"
              />
              <FeatureCard
                icon={<Layers />}
                title="Capped by design"
                description="Points issuance, conversion volume and referral commission all sit under per-user daily and monthly caps, with the cap usage shown to you as you approach it."
                href="/how-it-works#caps"
              />
            </div>
          </Reveal>
        </div>
      </Section>

      {/* -------------------------------- Marquee -------------------------------- */}
      <section className="border-y border-border-subtle bg-surface-0 py-10" aria-labelledby="catalog-marquee">
        <Container>
          <h2 id="catalog-marquee" className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
            In the catalog today
          </h2>
        </Container>
        <div className="mt-6">
          <GameMarquee />
        </div>
      </section>

      {/* ------------------------------- Trust strip ----------------------------- */}
      <TrustStrip />

      {/* --------------------------------- Utility ------------------------------- */}
      <Section reveal={false}>
        <Reveal>
          <SectionHead
            align="center"
            eyebrow="Beyond earning"
            title="MTT is something to use, not just something to hold"
            description="The token's utility is deliberately inside the product: gameplay, cosmetics, tournaments and marketplace trades. That is what keeps it a utility token rather than an investment pitch."
          />
        </Reveal>
        <Reveal delay={0.08}>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              tilt
              icon={<Store />}
              title="Store & marketplace"
              description="Spend MTT on cosmetics, boosts and tournament entries, or trade in-game assets peer-to-peer with a published fee."
            />
            <FeatureCard
              tilt
              icon={<TrendingUp />}
              title="Optional staking"
              description="Commit MTT for a period and receive a pro-rata share of whatever the Treasury funded that period. Variable, revenue-linked, never guaranteed."
            />
            <FeatureCard
              tilt
              icon={<Wallet />}
              title="Your keys, your token"
              description="Withdraw MTT to an external BEP-20 wallet after KYC, or keep it in the custodial balance while you play. Both paths are supported."
            />
          </div>
        </Reveal>
      </Section>

      <CtaBand
        title="Start with a game, not a deposit"
        description="Create a free account, play, and see what a session actually earns before you spend anything. There is no joining fee and no requirement to refer anyone."
        primary={{ label: "Play free", href: "/signup" }}
        secondary={{ label: "How it works", href: "/how-it-works" }}
      />
    </>
  );
}
