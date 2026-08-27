"use client";

/* ============================================================================
 * P-01 hero — the platform's front door and the fullest statement of the theme.
 *
 * Composition, back to front:
 *
 *   Atmosphere    mesh haze + perspective-projected star field + grid floor
 *   TokenHelix    the double helix of MTT/Points tokens, scroll-driven
 *   TideRibbon    a light path that folds as the page is scrolled
 *   PointerTilt   the whole copy block leans with the cursor, as one object
 *   WordReveal    the headline assembles word by word out of its own baseline
 *
 * The one rule that keeps this from being a toy: nothing decorative is allowed
 * to delay or obscure the copy. The headline, the claims list and the risk
 * disclosure are all in the first server-rendered payload as plain text; the
 * helix, the stars and the ribbon are `aria-hidden`, pointer-events-none, and
 * absent entirely under `prefers-reduced-motion`. A visitor who blocks
 * JavaScript reads exactly the same words.
 *
 * The compliance copy at the bottom is deliberately NOT animated on a delay.
 * It is the last claim a regulator would want gated behind a scroll trigger.
 * ========================================================================== */

import Link from "next/link";
import { ArrowRight, Gamepad2, PlayCircle, ShieldCheck, Sparkles } from "lucide-react";
import {
  Atmosphere, GridBackdrop, LineReveal, MagneticButton, NoiseOverlay, PointerTilt,
  Reveal, TideRibbon, TokenHelix, Typewriter, WordReveal,
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

const CLAIMS = [
  "Free to join — no entry fee",
  "Referring is optional and never required to earn",
  "Payouts funded by platform revenue, never by member deposits",
  "18+ · KYC before withdrawal",
];

export function LandingHero() {
  return (
    <header className="scene relative isolate overflow-hidden">
      {/* ---------------------------- atmosphere ---------------------------- */}
      <Atmosphere floor intensity={1.05} />
      <GridBackdrop />
      <NoiseOverlay />
      <TideRibbon />

      <Container className="relative pb-20 pt-14 sm:pb-28 sm:pt-20 lg:pb-32 lg:pt-24">
        {/*
          Two columns from `lg`, one below it.

          This started as a single centred column with the helix behind the
          copy, and it did not work: a helix sweeps through every x between
          −radius and +radius, so no radius, opacity or mask keeps it reliably
          off centred text — coins kept landing on the risk-disclosure
          paragraph. Giving the object its own column is the honest fix. The
          copy is never competing with it, and the helix gets to be a real
          subject rather than wallpaper.
        */}
        <div className="grid items-center gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:gap-8">
          <PointerTilt max={3.5} className="mx-auto max-w-2xl lg:mx-0">
            <div className="text-center lg:text-left [transform-style:preserve-3d]">
              <Reveal>
                <Eyebrow icon={<Sparkles />}>Play-to-earn on BNB Smart Chain</Eyebrow>
              </Reveal>

              {/* The headline is the only element pushed forward on Z, so the
                  composition has a single focal depth. */}
              <div style={{ transform: "translateZ(34px)" }}>
                <h1 className="mt-7 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-text-primary sm:text-5xl lg:text-[3.6rem]">
                  <WordReveal as="span" className="block">Play games.</WordReveal>
                  <WordReveal as="span" className="block" delay={0.14}>Earn Points.</WordReveal>
                  <WordReveal
                    as="span"
                    className="mt-1 block"
                    delay={0.28}
                    highlight={["Own", "what", "you", "earn."]}
                  >
                    Own what you earn.
                  </WordReveal>
                </h1>
              </div>

              <LineReveal delay={0.4} className="mt-7">
                <p className="mx-auto max-w-xl text-base leading-relaxed text-text-secondary sm:text-lg lg:mx-0">
                  Members Trail rewards{" "}
                  <span className="font-semibold text-text-primary">
                    <Typewriter words={ROTATING} />
                  </span>
                  <br className="hidden sm:block" />
                  Points convert to MTT, a BEP-20 utility token you can stake, spend in the store, or
                  withdraw to your own wallet.
                </p>
              </LineReveal>

              <Reveal delay={0.5}>
                <div
                  className="mt-9 flex flex-wrap items-center justify-center gap-3 lg:justify-start"
                  style={{ transform: "translateZ(20px)" }}
                >
                  <MagneticButton strength={12}>
                    <Button href="/signup" size="lg" iconRight={<ArrowRight className="size-4" />}>
                      Play free
                    </Button>
                  </MagneticButton>
                  <Button href="/how-it-works" size="lg" variant="glass" icon={<PlayCircle className="size-4" />}>
                    How it works
                  </Button>
                  <Button href="/games" size="lg" variant="ghost" icon={<Gamepad2 className="size-4" />}>
                    Try a demo — no login
                  </Button>
                </div>
              </Reveal>

              <Reveal delay={0.58}>
                <ul className="mt-9 flex flex-wrap items-center justify-center gap-2.5 lg:justify-start">
                  {CLAIMS.map((t) => (
                    <li
                      key={t}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-1/70 px-3 py-1.5 text-xs text-text-muted
                                 [box-shadow:inset_0_1px_0_0_var(--rim-light)] backdrop-blur-sm
                                 transition-colors duration-[var(--dur-base)] hover:border-border-strong hover:text-text-secondary"
                    >
                      <ShieldCheck className="size-3.5 text-good-400" aria-hidden />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>

              {/* No reveal wrapper: the risk copy must be present on first
                  paint, not gated behind a scroll trigger or an animation
                  timer. */}
              <p className="mx-auto mt-9 max-w-xl text-xs leading-relaxed text-text-muted lg:mx-0">
                Demo mode runs in your browser without an account. Points earned in demo mode are not
                saved and cannot be converted. Nothing on this page is a promise of earnings — read the{" "}
                <Link href="/legal/risk-disclosure" className="link-slide text-[var(--accent-hover)]">
                  Risk Disclosure
                </Link>{" "}
                before you take part.
              </p>
            </div>
          </PointerTilt>

          {/* --------------------------- the object --------------------------
              Hidden below `lg`. On a phone this column would sit under 600px
              of copy where nobody scrolls back up to see it, and the canvas
              plus 36 composited nodes are not worth a frame of a phone's
              battery for something invisible. */}
          <div
            className="relative hidden h-[34rem] overflow-hidden lg:block"
            style={{
              /* The helix is taller than its column by design — a strand that
                 ends inside the frame looks like a broken loop. So the column
                 clips it and fades both ends out, which reads as the object
                 continuing past the edge of the shot. Without the clip the
                 coins and the core light spill into the header and into the
                 section below. */
              maskImage: "linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent)",
              WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent)",
            }}
            aria-hidden
          >
            <TokenHelix count={10} radius={168} rise={38} turn={33} />

            {/* A ring on the floor beneath the helix, so it reads as standing
                in the scene rather than floating in front of it. */}
            <div className="scene absolute inset-x-0 bottom-6 grid place-items-center">
              <div
                className="h-40 w-80 rounded-[50%] border"
                style={{
                  transform: "rotateX(74deg)",
                  borderColor: "color-mix(in oklab, var(--accent) 22%, transparent)",
                  boxShadow: "0 0 60px -10px color-mix(in oklab, var(--accent) 35%, transparent)",
                }}
              />
            </div>
          </div>
        </div>
      </Container>

      {/* A soft horizon where the hero meets the next section, so the two do not
          butt together as two flat blocks. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-[linear-gradient(to_top,var(--surface-0),transparent)]" />
    </header>
  );
}
