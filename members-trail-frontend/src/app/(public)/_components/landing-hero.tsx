"use client";

/* P-01 hero. Interactive bits only (Typewriter, Magnetic CTA) — the rest of
 * the landing page stays a server component. */

import Link from "next/link";
import { ArrowRight, Gamepad2, PlayCircle, ShieldCheck, Sparkles } from "lucide-react";
import {
  AuroraBackground, FloatingOrbs, GridBackdrop, Magnetic, NoiseOverlay, Reveal, Typewriter,
} from "@/components/fx";
import { Button } from "@/components/ui";
import { Container, Eyebrow } from "./shell";

const ROTATING = [
  "skill — not luck",
  "Points you convert to MTT",
  "staking funded by real revenue",
  "tournaments with published rake",
  "no entry fee, ever",
];

export function LandingHero() {
  return (
    <header className="relative isolate overflow-hidden">
      <AuroraBackground />
      <GridBackdrop />
      <FloatingOrbs count={18} />
      <NoiseOverlay />

      <Container className="relative pb-16 pt-14 sm:pb-24 sm:pt-20 lg:pb-28 lg:pt-24">
        <div className="mx-auto max-w-4xl text-center">
          <Reveal>
            <Eyebrow icon={<Sparkles />}>Play-to-earn on BNB Smart Chain</Eyebrow>
          </Reveal>

          <Reveal delay={0.06}>
            <h1 className="mt-6 font-display text-4xl font-semibold leading-[1.06] tracking-tight text-text-primary sm:text-5xl lg:text-6xl">
              Play games. Earn Points.
              <br className="hidden sm:block" />{" "}
              <span className="text-gradient-brand">Own what you earn.</span>
            </h1>
          </Reveal>

          <Reveal delay={0.12}>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-text-secondary sm:text-lg">
              Members Trail rewards{" "}
              <span className="font-semibold text-text-primary">
                <Typewriter words={ROTATING} />
              </span>
              <br className="hidden sm:block" />
              Points convert to MTT, a BEP-20 utility token you can stake, spend in the store, or
              withdraw to your own wallet.
            </p>
          </Reveal>

          <Reveal delay={0.18}>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Magnetic strength={0.2}>
                <Button href="/signup" size="lg" iconRight={<ArrowRight className="size-4" />}>
                  Play free
                </Button>
              </Magnetic>
              <Button href="/how-it-works" size="lg" variant="outline" icon={<PlayCircle className="size-4" />}>
                How it works
              </Button>
              <Button href="/games" size="lg" variant="ghost" icon={<Gamepad2 className="size-4" />}>
                Try a demo — no login
              </Button>
            </div>
          </Reveal>

          <Reveal delay={0.24}>
            <ul className="mx-auto mt-9 flex max-w-3xl flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-text-muted">
              {[
                "Free to join — no entry fee",
                "Referring is optional and never required to earn",
                "Payouts funded by platform revenue, never by member deposits",
                "18+ · KYC before withdrawal",
              ].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-good-400" aria-hidden />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={0.3}>
            <p className="mx-auto mt-8 max-w-2xl text-xs leading-relaxed text-text-muted">
              Demo mode runs in your browser without an account. Points earned in demo mode are not
              saved and cannot be converted. Nothing on this page is a promise of earnings — read the{" "}
              <Link href="/legal/risk-disclosure" className="text-[var(--accent-hover)] underline underline-offset-2">
                Risk Disclosure
              </Link>{" "}
              before you take part.
            </p>
          </Reveal>
        </div>
      </Container>
    </header>
  );
}
