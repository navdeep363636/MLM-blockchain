/* Shared public-site layout primitives — reused by every marketing page.
 * Server-safe: no hooks, no event handlers. Client behaviour lives in the
 * fx primitives these render.
 *
 * Theme v2 note: the depth is applied HERE rather than page by page. Every
 * marketing page is built out of `Section`, `SectionHead`, `PageHero` and
 * `CtaBand`, so giving those four the scene/atmosphere/scroll treatment moves
 * all fourteen public routes at once — and keeps them consistent, which is the
 * part that would rot if each page rolled its own hero.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Atmosphere, AuroraBackground, GridBackdrop, GridFloor, LineReveal, NoiseOverlay,
  Reveal, ScrollScene, TideRibbon, TokenHelix,
} from "@/components/fx";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

export function Container({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
}

export function Eyebrow({
  children, icon, className,
}: { children: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1",
        "text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-hover)]",
        "ring-1 ring-inset ring-[var(--accent-ring)] [&>svg]:size-3.5",
        /* Lit top edge + a soft outer bloom. A pill this small is where the
           depth language has to be at its most restrained — one hairline. */
        "[box-shadow:inset_0_1px_0_0_var(--rim-light),0_0_18px_-6px_var(--accent-ring)]",
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

const tones = {
  default: "",
  inset: "bg-surface-inset",
  raised: "bg-surface-1",
} as const;

/**
 * Standard vertical rhythm for a marketing section.
 *
 * `depth` is the new axis:
 *   "none"   flat, as before — for legal pages and dense reference content
 *   "rise"   the section lifts into place as it enters (the default)
 *   "scene"  full 3D: it rotates up, straightens, and recedes as it leaves
 *
 * `atmosphere` adds the background stack behind the section's own content.
 */
export function Section({
  children, id, className, innerClassName, tone = "default", reveal = true, bordered,
  depth = "rise", atmosphere, ribbon,
}: {
  children: React.ReactNode;
  id?: string;
  className?: string;
  innerClassName?: string;
  tone?: keyof typeof tones;
  reveal?: boolean;
  bordered?: boolean;
  depth?: "none" | "rise" | "scene";
  atmosphere?: boolean;
  ribbon?: boolean;
}) {
  const body = <Container className={innerClassName}>{children}</Container>;

  const inner =
    depth === "scene" ? <ScrollScene tilt={7} lift={70}>{body}</ScrollScene>
    : reveal ? <Reveal>{body}</Reveal>
    : body;

  return (
    <section
      id={id}
      className={cn(
        "relative isolate scroll-mt-24 py-16 sm:py-20 lg:py-24",
        tones[tone],
        bordered && "border-y border-border-subtle",
        /* One perspective for everything inside. Cards in this section's grids
           now tilt toward the same vanishing point instead of each spinning
           about its own centre. */
        "scene",
        className,
      )}
    >
      {atmosphere && <Atmosphere stars={false} intensity={0.6} vignette={false} />}
      {ribbon && <TideRibbon />}
      {inner}
    </section>
  );
}

/**
 * Section heading block. Renders an `<h2>` by default so pages keep one `<h1>`.
 *
 * The heading is line-masked rather than word-split: titles here contain links
 * and `<br>` in places, and a word splitter would flatten that markup.
 */
export function SectionHead({
  eyebrow, title, description, align = "left", className, as: As = "h2", id,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
  as?: "h2" | "h3";
  id?: string;
}) {
  return (
    <div className={cn("max-w-3xl", align === "center" && "mx-auto text-center", className)}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <LineReveal>
        <As
          id={id}
          className={cn(
            "font-display font-semibold tracking-tight text-text-primary",
            As === "h2" ? "mt-4 text-2xl sm:text-3xl lg:text-[2.4rem] lg:leading-[1.15]" : "mt-3 text-xl sm:text-2xl",
          )}
        >
          {title}
        </As>
      </LineReveal>
      {description && (
        <LineReveal delay={0.08}>
          <p className="mt-4 text-[0.95rem] leading-relaxed text-text-secondary sm:text-base">{description}</p>
        </LineReveal>
      )}
      {/* A hairline that starts under the heading and fades out. Cheap, and it
          gives every section a consistent "top of a plate" edge. */}
      <div
        aria-hidden
        className={cn(
          "divider-glow mt-7 max-w-xs opacity-60",
          align === "center" && "mx-auto",
        )}
      />
    </div>
  );
}

/**
 * Hero band for every page other than the landing page. Renders the page `<h1>`.
 *
 * `helix` puts the 3D token helix behind the copy. Reserved for pages where the
 * token itself is the subject (tokenomics, staking) — on a legal or contact
 * page it is decoration competing with the thing the visitor came for.
 */
export function PageHero({
  eyebrow, title, lede, actions, children, orbs, className, helix, floor = true,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  orbs?: boolean;
  className?: string;
  helix?: boolean;
  floor?: boolean;
}) {
  return (
    <header className={cn("scene relative isolate overflow-hidden border-b border-border-subtle", className)}>
      <Atmosphere stars={orbs !== false} intensity={0.85} floor={floor} vignette />
      <GridBackdrop />
      <NoiseOverlay />
      {helix && (
        <div className="pointer-events-none absolute inset-y-0 right-[-6%] hidden w-[38rem] opacity-70 lg:block">
          <TokenHelix count={16} radius={112} rise={30} />
        </div>
      )}

      <Container className="relative py-16 sm:py-20 lg:py-24">
        <div className={cn("max-w-3xl", helix && "lg:max-w-2xl")}>
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <LineReveal>
            <h1 className="mt-5 font-display text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl lg:text-5xl lg:leading-[1.08]">
              {title}
            </h1>
          </LineReveal>
          {lede && (
            <LineReveal delay={0.09}>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-text-secondary sm:text-lg">{lede}</p>
            </LineReveal>
          )}
          {actions && (
            <Reveal delay={0.18}>
              <div className="mt-8 flex flex-wrap items-center gap-3">{actions}</div>
            </Reveal>
          )}
        </div>
        {children}
      </Container>
    </header>
  );
}

/** Closing call-to-action band. Used at the foot of most public pages. */
export function CtaBand({
  title, description, primary, secondary, note,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  primary?: { label: string; href: string };
  secondary?: { label: string; href: string };
  note?: React.ReactNode;
}) {
  const p = primary ?? { label: "Play free", href: "/signup" };
  const s = secondary ?? { label: "How it works", href: "/how-it-works" };
  return (
    <Section depth="none" reveal={false}>
      <ScrollScene tilt={6} lift={80} recede={false}>
        <div
          className={cn(
            "relative isolate overflow-hidden rounded-[calc(var(--radius-card)*1.75)] px-6 py-16 text-center sm:px-12",
            "border border-border-default bg-surface-1",
            /* The heaviest elevation in the system, used exactly once per page:
               this is the last thing on the screen and it should be the nearest
               thing to the reader. */
            "[box-shadow:var(--shadow-e5),inset_0_1px_0_0_var(--rim-light-strong)]",
            "ring-gradient",
          )}
        >
          <AuroraBackground intensity={0.95} />
          <GridBackdrop fade />
          <GridFloor height="48%" />
          <NoiseOverlay />

          <div className="relative mx-auto max-w-2xl">
            <LineReveal>
              <h2 className="font-display text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl lg:text-4xl">
                {title}
              </h2>
            </LineReveal>
            {description && (
              <LineReveal delay={0.08}>
                <p className="mt-4 text-[0.95rem] leading-relaxed text-text-secondary">{description}</p>
              </LineReveal>
            )}
            <Reveal delay={0.16}>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <Button href={p.href} size="lg" iconRight={<ArrowRight className="size-4" />}>{p.label}</Button>
                <Button href={s.href} size="lg" variant="outline">{s.label}</Button>
              </div>
            </Reveal>
            <p className="mt-7 text-xs leading-relaxed text-text-muted">
              {note ?? (
                <>
                  Free to join · no entry fee · referring is optional and never required to earn.
                  18+ only. Read the{" "}
                  <Link href="/legal/risk-disclosure" className="link-slide text-[var(--accent-hover)]">
                    Risk Disclosure
                  </Link>{" "}
                  first.
                </>
              )}
            </p>
          </div>
        </div>
      </ScrollScene>
    </Section>
  );
}

/** Two-column "label / body" reading block used on About and Tokenomics. */
export function SplitRow({
  label, children, className,
}: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "group grid gap-4 border-t border-border-subtle py-6 transition-colors duration-[var(--dur-base)] lg:grid-cols-[16rem_1fr] lg:gap-10",
        "hover:border-[color-mix(in_oklab,var(--accent)_35%,var(--border-subtle))]",
        className,
      )}
    >
      <h3 className="flex items-start gap-2 text-sm font-semibold uppercase tracking-wider text-text-muted">
        <span
          aria-hidden
          className="mt-1.5 h-px w-0 bg-[var(--accent)] transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-tide)] group-hover:w-4"
        />
        {label}
      </h3>
      <div className="space-y-3 text-sm leading-relaxed text-text-secondary">{children}</div>
    </div>
  );
}
