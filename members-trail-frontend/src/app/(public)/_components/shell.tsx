/* Shared public-site layout primitives — reused by every marketing page.
 * Server-safe: no hooks, no event handlers. Client behaviour lives in the
 * fx primitives these render. */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  AuroraBackground, FloatingOrbs, GridBackdrop, NoiseOverlay, Reveal,
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

/** Standard vertical rhythm + optional reveal for a marketing section. */
export function Section({
  children, id, className, innerClassName, tone = "default", reveal = true, bordered,
}: {
  children: React.ReactNode;
  id?: string;
  className?: string;
  innerClassName?: string;
  tone?: keyof typeof tones;
  reveal?: boolean;
  bordered?: boolean;
}) {
  const body = <Container className={innerClassName}>{children}</Container>;
  return (
    <section
      id={id}
      className={cn(
        "relative scroll-mt-24 py-16 sm:py-20 lg:py-24",
        tones[tone],
        bordered && "border-y border-border-subtle",
        className,
      )}
    >
      {reveal ? <Reveal>{body}</Reveal> : body}
    </section>
  );
}

/** Section heading block. Renders an <h2> by default so pages keep one <h1>. */
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
    <div
      className={cn(
        "max-w-3xl",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <As
        id={id}
        className={cn(
          "font-display font-semibold tracking-tight text-text-primary",
          As === "h2" ? "mt-4 text-2xl sm:text-3xl lg:text-[2.4rem] lg:leading-[1.15]" : "mt-3 text-xl sm:text-2xl",
        )}
      >
        {title}
      </As>
      {description && (
        <p className="mt-4 text-[0.95rem] leading-relaxed text-text-secondary sm:text-base">{description}</p>
      )}
    </div>
  );
}

/** Hero band for every page other than the landing page. Renders the page <h1>. */
export function PageHero({
  eyebrow, title, lede, actions, children, orbs, className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  orbs?: boolean;
  className?: string;
}) {
  return (
    <header className={cn("relative isolate overflow-hidden border-b border-border-subtle", className)}>
      <AuroraBackground intensity={0.75} />
      <GridBackdrop />
      {orbs && <FloatingOrbs count={10} />}
      <NoiseOverlay />
      <Container className="relative py-16 sm:py-20 lg:py-24">
        <div className="max-w-3xl">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <h1 className="mt-5 font-display text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl lg:text-5xl lg:leading-[1.08]">
            {title}
          </h1>
          {lede && (
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-text-secondary sm:text-lg">{lede}</p>
          )}
          {actions && <div className="mt-8 flex flex-wrap items-center gap-3">{actions}</div>}
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
    <Section>
      <div className="relative isolate overflow-hidden rounded-[calc(var(--radius-card)*1.5)] border border-border-subtle bg-surface-1 px-6 py-14 text-center sm:px-12">
        <AuroraBackground intensity={0.9} />
        <GridBackdrop fade />
        <NoiseOverlay />
        <div className="relative mx-auto max-w-2xl">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl lg:text-4xl">
            {title}
          </h2>
          {description && <p className="mt-4 text-[0.95rem] leading-relaxed text-text-secondary">{description}</p>}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button href={p.href} size="lg" iconRight={<ArrowRight className="size-4" />}>{p.label}</Button>
            <Button href={s.href} size="lg" variant="outline">{s.label}</Button>
          </div>
          <p className="mt-6 text-xs leading-relaxed text-text-muted">
            {note ?? (
              <>
                Free to join · no entry fee · referring is optional and never required to earn.
                18+ only. Read the{" "}
                <Link href="/legal/risk-disclosure" className="text-[var(--accent-hover)] underline underline-offset-2">
                  Risk Disclosure
                </Link>{" "}
                first.
              </>
            )}
          </p>
        </div>
      </div>
    </Section>
  );
}

/** Two-column "label / body" reading block used on About and Tokenomics. */
export function SplitRow({
  label, children, className,
}: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-4 border-t border-border-subtle py-6 lg:grid-cols-[16rem_1fr] lg:gap-10", className)}>
      <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">{label}</h3>
      <div className="space-y-3 text-sm leading-relaxed text-text-secondary">{children}</div>
    </div>
  );
}
