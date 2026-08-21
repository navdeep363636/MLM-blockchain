/* P-03 · Games Catalog (public preview) — FRD 5.1 */

import { Gamepad2, Info, Play, ShieldCheck, Sparkles, Trophy } from "lucide-react";
import { Button, Callout } from "@/components/ui";
import { CtaBand, PageHero, Section, SectionHead } from "../_components/shell";
import { FactCard } from "../_components/feature-card";
import { PublicGameCatalog } from "./_components/catalog";

export const metadata = {
  title: "Games",
  description:
    "Browse the Members Trail catalog. Every title is playable free — paid tournament entry is always optional.",
};

export default function GamesPage() {
  return (
    <>
      <PageHero
        eyebrow={<>Games catalog</>}
        title={<>Skill-based titles. <span className="text-gradient-brand">Free mode always open.</span></>}
        lede="Scoring is decided by skill, validated server-side, and capped daily so nobody can farm the economy. Paid tournaments exist, but free play is never throttled to push you toward them."
        actions={
          <>
            <Button href="/signup" size="lg" icon={<Play className="size-4" />}>Play a demo — no login</Button>
            <Button href="/how-it-works" variant="outline" size="lg">How Points work</Button>
          </>
        }
      >
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          <FactCard label="Titles live" value="7 of 8" note="One more in final QA. Catalog grows each quarter." icon={<Gamepad2 />} />
          <FactCard label="Entry cost" value="Free" note="Every title has a free mode that earns real Points." icon={<Sparkles />} />
          <FactCard label="Anti-cheat" value="Server-side" note="Scores are recomputed by the backend before Points are credited." icon={<ShieldCheck />} />
        </div>
      </PageHero>

      <Section>
        <SectionHead
          eyebrow="Browse"
          title="The catalog"
          description="Points-per-session ranges are observed values from real sessions, not targets. Your actual earnings depend on skill, session length and the daily cap for that title."
        />
        <div className="mt-8">
          <PublicGameCatalog />
        </div>
      </Section>

      <Section tone="inset" bordered>
        <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
          <div>
            <SectionHead
              eyebrow="Demo mode"
              title="Try before you register"
              description="Launch any title in demo mode without an account. You get the full game — the only difference is that Points from a demo session are not saved to a ledger, because there is no ledger to save them to yet."
            />
            <Callout tone="info" title="Nothing is lost by trying" icon={<Info />} className="mt-6">
              <p className="mt-1">
                Demo sessions do not count toward daily caps and do not affect your leaderboard rank.
                Once you verify your email and phone, free-mode sessions start crediting real Points
                immediately — you do not need KYC to start earning, only to convert or withdraw.
              </p>
            </Callout>
          </div>

          <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface-1 p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]">
                <Trophy className="size-5" />
              </span>
              <h3 className="font-display text-lg font-semibold text-text-primary">Tournaments and prize pools</h3>
            </div>
            <ul className="mt-5 space-y-4 text-sm">
              {[
                ["Format disclosed before entry", "Rules, scoring, bracket format and the full prize split are shown on the tournament page before you pay anything."],
                ["Entry fees are a revenue event", "A published share of net rake flows into the Revenue Treasury, which is what funds staking rewards and referral commissions."],
                ["Free-entry events run too", "Not every tournament costs money. Free opens run alongside paid events with smaller pools."],
                ["Prizes are skill-ranked", "Placement is determined by score under identical conditions — same board, same seed, same rules for every entrant."],
              ].map(([title, body]) => (
                <li key={title} className="border-b border-border-subtle pb-4 last:border-0 last:pb-0">
                  <p className="font-medium text-text-primary">{title}</p>
                  <p className="mt-1 leading-relaxed text-text-muted">{body}</p>
                </li>
              ))}
            </ul>
            <Button href="/signup" variant="outline" size="sm" fullWidth className="mt-5">
              See the tournament schedule
            </Button>
          </div>
        </div>
      </Section>

      <CtaBand
        title="Pick a game and start earning Points"
        description="Free mode, no deposit, no referral code needed. Verify your email and phone and Points start counting."
        primary={{ label: "Create a free account", href: "/signup" }}
        secondary={{ label: "Read the Responsible Gaming policy", href: "/legal/responsible-gaming" }}
      />
    </>
  );
}
