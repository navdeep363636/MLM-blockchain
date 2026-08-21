/* P-02 · How It Works — FRD 5.1 */

import {
  ArrowDown, BadgeCheck, Coins, Gamepad2, Landmark, Repeat, ShieldCheck,
  Sparkles, Users, Wallet,
} from "lucide-react";
import { Accordion, Badge, Button, Callout } from "@/components/ui";
import { RevealGroup, RevealItem } from "@/components/fx";
import { CtaBand, PageHero, Section, SectionHead } from "../_components/shell";
import { FactCard, FeatureCard, IconTile } from "../_components/feature-card";
import { StepFlow, type FlowStep } from "../_components/step-flow";
import { FundingCallout } from "../_components/compliance";

export const metadata = {
  title: "How it works",
  description:
    "Play skill-based games, earn Points, convert to MTT, stake for revenue-funded rewards. Referring other people is optional and never required to earn.",
};

const STEPS: FlowStep[] = [
  { n: 1, title: "Play", summary: "Launch any game free. Skill decides your score — sessions are validated server-side before Points are credited.", icon: <Gamepad2 /> },
  { n: 2, title: "Earn Points", summary: "Sessions, quests, tournaments and rewarded ads credit Points to an off-chain ledger, inside per-user daily caps.", icon: <Sparkles /> },
  { n: 3, title: "Convert", summary: "Redeem Points for MTT at the published rate once Tier 1 KYC is complete. Daily conversion caps apply.", icon: <Repeat /> },
  { n: 4, title: "Stake", summary: "Lock MTT in a pool to earn a variable, revenue-funded reward stream. Your principal is never at risk from the protocol.", icon: <Coins /> },
  { n: 5, title: "Refer — optional", summary: "Share your code if you want to. Commissions are capped, revenue-funded, and paid on real purchases only.", icon: <Users />, optional: true },
  { n: 6, title: "Withdraw", summary: "Move MTT to your own wallet, or take a fiat payout. KYC tier and AML checks apply by amount.", icon: <Wallet /> },
];

const DETAIL = [
  {
    title: "How are Points calculated, and can I game the system?",
    content: (
      <>
        <p>
          Your client streams signed telemetry during a session. When the session ends the backend
          Game Result Validator recomputes the score server-side — or re-validates the client result
          against the server-known rules and random seed — before a single Point is credited. A score
          your client simply asserts is never trusted on its own.
        </p>
        <p className="mt-3">
          Daily and per-session Points caps apply per user and per game, and device/IP fingerprint
          clustering flags multi-accounting. Free-mode Points earning is never throttled to push you
          toward paid entry.
        </p>
      </>
    ),
  },
  {
    title: "What sets the Points-to-MTT conversion rate?",
    content: (
      <>
        <p>
          A Finance Admin proposes the rate and a second authorised admin must approve it — the
          four-eyes principle. Changes take a scheduled effective date, are never applied
          retroactively, and the full rate history stays permanently viewable on the public
          Tokenomics page.
        </p>
        <p className="mt-3">
          Per-user daily and monthly conversion caps are enforced server-side. They exist to control
          token emission and to make Points farming unprofitable.
        </p>
      </>
    ),
  },
  {
    title: "Where does staking yield actually come from?",
    content: (
      <>
        <p>
          Exclusively from the Revenue Treasury. The Treasury is funded by a published share of real
          platform revenue — in-app purchases, tournament rake, marketplace fees, advertising and
          subscriptions. Finance triggers a multisig transaction that calls{" "}
          <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs">fundRewardPool()</code>{" "}
          on the staking contract, and that function is the only way a reward balance can ever grow.
        </p>
        <p className="mt-3">
          Because the pool is funded rather than promised, APR is variable and recalculated each
          period from actual inflows. Any platform quoting a fixed, guaranteed high APR is telling
          you something the maths cannot support.
        </p>
      </>
    ),
  },
  {
    title: "Is my staked MTT ever at risk?",
    content: (
      <>
        <p>
          Not from the protocol. The staking contract has no{" "}
          <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs">withdraw</code> or{" "}
          <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs">emergencyWithdraw</code>{" "}
          escape hatch — there is no function an administrator could call to move your principal.
          Unstaking always returns your full principal.
        </p>
        <p className="mt-3">
          If you exit a locked pool early, the penalty applies only to <em>pending, unclaimed
          rewards</em> — never to the principal you deposited. The exact penalty is shown before you
          confirm.
        </p>
      </>
    ),
  },
  {
    title: "How do referral commissions work — and why are they capped?",
    content: (
      <>
        <p>
          Commission is calculated on a referred player&apos;s verified real-money spend — purchases,
          tournament entry fees, subscriptions. It is never a share of their stake, their deposit or
          their Points conversion, because passing a member&apos;s deposit upward is exactly what makes
          a scheme unlawful.
        </p>
        <p className="mt-3">
          Depth stops at three levels and each recipient has a monthly cap. Those two limits keep
          referral income secondary to gameplay, which is what separates a lawful affiliate bonus
          from recruitment-primary income.
        </p>
      </>
    ),
  },
  {
    title: "What do I need to verify, and when?",
    content: (
      <>
        <p>
          You can register and play in free mode straight away. Tier 1 KYC — government ID plus a
          liveness selfie — is required before your first conversion, your first withdrawal, and
          before referral commission is released to a withdrawable state.
        </p>
        <p className="mt-3">
          Tier 2 adds proof of address and is only requested above a configurable cumulative
          withdrawal threshold. Documents are encrypted at rest and access is restricted to the
          Compliance role and logged.
        </p>
      </>
    ),
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <PageHero
        eyebrow={<>How it works</>}
        title={<>Six steps. Only four of them <span className="text-gradient-brand">involve you playing.</span></>}
        lede="Points come from skill. MTT comes from Points. Rewards come from revenue the platform actually earned. Referring other people is a bonus you can ignore entirely and still access everything."
        orbs
        actions={
          <>
            <Button href="/signup" size="lg">Create a free account</Button>
            <Button href="/tokenomics" variant="outline" size="lg">See the tokenomics</Button>
          </>
        }
      />

      <Section>
        <SectionHead
          eyebrow="The flow"
          title="From a game session to your own wallet"
          description="Each step is independent. You can stop at Points, stop at MTT, or go all the way to a withdrawal — nothing downstream is required to keep earning upstream."
        />
        <StepFlow steps={STEPS} className="mt-10" />
      </Section>

      <Section tone="inset" bordered>
        <SectionHead
          eyebrow="Where the money comes from"
          title="Revenue in, rewards out — in that order"
          description="This is the whole design. Money paid to players is traced back to a settled revenue event, never to another member's deposit."
        />

        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface-1 p-6">
            <div className="flex items-center gap-3">
              <IconTile><Landmark /></IconTile>
              <h3 className="font-display text-lg font-semibold text-text-primary">Real revenue events</h3>
            </div>
            <ul className="mt-5 space-y-3 text-sm text-text-secondary">
              {[
                ["In-app purchases", "30% of net revenue to Treasury"],
                ["Tournament entry rake", "20% of net rake"],
                ["Marketplace fees", "25% of fee revenue"],
                ["Advertising", "40% of ad revenue"],
                ["Premium Pass subscriptions", "30% of subscription revenue"],
              ].map(([label, note]) => (
                <li key={label} className="flex items-start justify-between gap-4 border-b border-border-subtle pb-3 last:border-0 last:pb-0">
                  <span className="font-medium text-text-primary">{label}</span>
                  <span className="tnum shrink-0 text-right text-xs text-text-muted">{note}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-text-muted">
              Allocation percentages are configurable by Finance and published quarterly. The
              remainder funds operations, game development and margin.
            </p>
          </div>

          <div className="grid place-items-center py-2 lg:py-0">
            <div className="flex flex-col items-center gap-2">
              <span className="hidden h-16 w-px bg-gradient-to-b from-transparent via-[var(--accent)] to-transparent lg:block" />
              <IconTile size="lg" className="rotate-90 lg:rotate-0"><ArrowDown className="rotate-[-90deg] lg:rotate-0" /></IconTile>
              <span className="text-center text-[11px] font-semibold uppercase tracking-wider text-[var(--accent-hover)]">
                Reconciled<br className="hidden lg:block" /> then funded
              </span>
              <span className="hidden h-16 w-px bg-gradient-to-b from-[var(--accent)] via-[var(--accent)] to-transparent lg:block" />
            </div>
          </div>

          <div className="rounded-[var(--radius-panel)] border border-[var(--accent-ring)] bg-surface-1 p-6 glow-brand">
            <div className="flex items-center gap-3">
              <IconTile><Coins /></IconTile>
              <h3 className="font-display text-lg font-semibold text-text-primary">Player payouts</h3>
            </div>
            <ul className="mt-5 space-y-4 text-sm">
              <li>
                <p className="font-medium text-text-primary">Staking reward pools</p>
                <p className="mt-1 leading-relaxed text-text-muted">
                  Funded only by <code className="rounded bg-surface-3 px-1 font-mono text-[11px]">fundRewardPool()</code>,
                  callable only by the Treasury multisig. Stakers&apos; principal is never reward budget.
                </p>
              </li>
              <li>
                <p className="font-medium text-text-primary">Commission pool</p>
                <p className="mt-1 leading-relaxed text-text-muted">
                  Funded only by <code className="rounded bg-surface-3 px-1 font-mono text-[11px]">depositCommissionPool()</code>.
                  The contract reverts if recorded commission would ever exceed what has been deposited.
                </p>
              </li>
              <li>
                <p className="font-medium text-text-primary">Points → MTT conversions</p>
                <p className="mt-1 leading-relaxed text-text-muted">
                  Drawn from the pre-allocated 40% Play-to-Earn pool. There is no mint function, so
                  supply cannot be inflated to cover a shortfall.
                </p>
              </li>
            </ul>
          </div>
        </div>

        <FundingCallout className="mt-8" />
      </Section>

      <Section>
        <SectionHead
          eyebrow="Three earning paths"
          title="Referring people is the one you can skip"
          description="A player who never shares a referral code still has access to 100% of what the platform pays out."
        />
        <RevealGroup className="mt-10 grid gap-4 md:grid-cols-3">
          <RevealItem>
            <FeatureCard
              icon={<Gamepad2 />}
              title="Gameplay"
              description="Points from sessions, quests, tournaments and rewarded ads. Convert to MTT at the published rate."
              footer={<Badge tone="good" icon={<BadgeCheck className="size-3.5" />}>Core path — always available</Badge>}
            />
          </RevealItem>
          <RevealItem>
            <FeatureCard
              icon={<Coins />}
              title="Staking"
              description="Lock MTT for a variable, revenue-funded reward stream. Longer locks may carry a modestly higher rate."
              footer={<Badge tone="good" icon={<BadgeCheck className="size-3.5" />}>Core path — always available</Badge>}
            />
          </RevealItem>
          <RevealItem>
            <FeatureCard
              icon={<Users />}
              title="Referrals"
              description="A capped percentage of a referred player's real-money spend, across at most three levels."
              footer={<Badge tone="neutral">Optional bonus — never required</Badge>}
            />
          </RevealItem>
        </RevealGroup>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <FactCard label="Cost to join" value="Free" note="No joining fee, ever. A fee distributed upward is the defining feature of a pyramid scheme." icon={<ShieldCheck />} />
          <FactCard label="Referral depth" value="3 levels" note="Hard cap. Level 1 8%, Level 2 3%, Level 3 1% of eligible spend." icon={<Users />} />
          <FactCard label="Yield type" value="Variable" note="Recalculated from actual Treasury inflows each period. Never fixed, never guaranteed." icon={<Coins />} />
        </div>
      </Section>

      <Section tone="inset" bordered>
        <SectionHead
          eyebrow="The detail"
          title="Questions worth asking before you play"
          description="Expand any step. If something here reads as vague, that is a bug — tell support and we will fix the wording."
        />
        <Accordion items={DETAIL} defaultOpen={0} className="mt-8" />
      </Section>

      <Section>
        <Callout
          tone="warning"
          title="What we will never tell you"
          icon={<ShieldCheck />}
        >
          <p className="mt-1">
            We will not quote you a monthly income figure, a fixed APR, or a &ldquo;guaranteed&rdquo; return —
            not on this site, not in marketing assets, and not in the copy we give referrers. Any
            such claim you see attributed to Members Trail is not ours. Yield depends on real
            revenue and on how many people are staking; referral income depends on other
            people&apos;s genuine purchases and is capped. Both can be zero.
          </p>
        </Callout>
      </Section>

      <CtaBand
        title="Start with a free game. Decide about everything else later."
        description="No entry fee, no deposit, no referral needed. Play in free mode the moment your email and phone are verified."
        primary={{ label: "Create a free account", href: "/signup" }}
        secondary={{ label: "Browse the games", href: "/games" }}
        note="18+ only. Availability is restricted in some jurisdictions."
      />
    </>
  );
}
