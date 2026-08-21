/* P-08 · Legal Hub — FRD 5.1, 11 */

import Link from "next/link";
import { ArrowUpRight, FileText, Gavel, ScrollText, ShieldCheck } from "lucide-react";
import { Badge, Button, Callout } from "@/components/ui";
import { RevealGroup, RevealItem } from "@/components/fx";
import { SpotlightCard } from "@/components/fx";
import { CtaBand, PageHero, Section, SectionHead } from "../_components/shell";
import { IconTile } from "../_components/feature-card";
import { legalDocs } from "@/lib/nav";

export const metadata = {
  title: "Legal hub",
  description:
    "Terms, Privacy, Risk Disclosure, AML/KYC, Referral Program Terms, Refunds, Responsible Gaming and Cookies — all in one place.",
};

/** Grouping makes the hub scannable; every doc in `legalDocs` appears exactly once. */
const GROUPS: { heading: string; blurb: string; slugs: string[] }[] = [
  {
    heading: "Before you play",
    blurb: "The three documents you accept at sign-up. Read the Risk Disclosure even if you skip the others.",
    slugs: ["/legal/terms", "/legal/privacy", "/legal/risk-disclosure"],
  },
  {
    heading: "Money and verification",
    blurb: "How identity checks, refunds and the referral programme actually work in practice.",
    slugs: ["/legal/aml-kyc", "/legal/referral-terms", "/legal/refunds"],
  },
  {
    heading: "Playing safely",
    blurb: "Limits, self-exclusion, support resources, and what we store in your browser.",
    slugs: ["/legal/responsible-gaming", "/legal/cookies"],
  },
];

export default function LegalHubPage() {
  const bySlug = new Map(legalDocs.map((d) => [d.href, d]));

  return (
    <>
      <PageHero
        eyebrow={<>Legal hub</>}
        title={<>Every policy, <span className="text-gradient-brand">in one place.</span></>}
        lede="Eight documents. We've written them to be read rather than to be technically compliant with being available — each one opens with a plain-language summary of what it actually means for you."
        actions={
          <>
            <Button href="/legal/risk-disclosure" size="lg">Start with the Risk Disclosure</Button>
            <Button href="/contact" variant="outline" size="lg">Ask a compliance question</Button>
          </>
        }
      />

      <Section>
        <Callout tone="warning" title="These are structural drafts pending attorney review" icon={<Gavel />}>
          <p className="mt-1">
            The documents in this hub define the required content, sections and clauses for the
            development and legal teams. They are <strong className="text-text-primary">not
            ready-to-publish legal text</strong>. A licensed attorney in each operating jurisdiction
            must review, adapt and approve the final language before publication, because
            requirements differ significantly by country and state — and by whether the platform is
            classified locally as gaming, gambling, e-commerce or a financial service.
          </p>
        </Callout>
      </Section>

      {GROUPS.map((g, gi) => (
        <Section key={g.heading} tone={gi % 2 === 0 ? "inset" : "default"} bordered={gi % 2 === 0}>
          <SectionHead as="h2" eyebrow={`0${gi + 1}`} title={g.heading} description={g.blurb} />
          <RevealGroup className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {g.slugs.map((slug) => {
              const doc = bySlug.get(slug);
              if (!doc) return null;
              return (
                <RevealItem key={slug}>
                  <Link href={doc.href} className="group block h-full">
                    <SpotlightCard className="flex h-full flex-col rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5 transition-colors duration-300 hover:border-[color-mix(in_oklab,var(--accent)_38%,var(--border-default))]">
                      <div className="flex items-start justify-between gap-3">
                        <IconTile size="sm"><FileText /></IconTile>
                        <ArrowUpRight className="size-4 shrink-0 text-text-muted transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--accent)]" />
                      </div>
                      <h3 className="mt-4 font-display text-base font-semibold leading-snug text-text-primary transition-colors group-hover:text-[var(--accent-hover)]">
                        {doc.label}
                      </h3>
                      <p className="mt-2 flex-1 text-sm leading-relaxed text-text-muted">{doc.description}</p>
                      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border-subtle pt-3.5">
                        <span className="text-xs text-text-muted">FRD §{doc.frd}</span>
                        <Badge tone="neutral">Draft v1.0</Badge>
                      </div>
                    </SpotlightCard>
                  </Link>
                </RevealItem>
              );
            })}
          </RevealGroup>
        </Section>
      ))}

      <Section tone="inset" bordered>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
            <IconTile size="sm"><ScrollText /></IconTile>
            <h3 className="mt-4 text-sm font-semibold text-text-primary">Versioning and re-acceptance</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              Every document is versioned in the admin CMS with a draft → legal review → publish
              workflow and full history. Publishing a version that materially changes your rights
              triggers a re-acceptance prompt on your next login rather than a quiet update.
            </p>
          </div>
          <div className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
            <IconTile size="sm"><ShieldCheck /></IconTile>
            <h3 className="mt-4 text-sm font-semibold text-text-primary">Your data rights</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              Access, rectification, erasure and portability requests are handled by the compliance
              team. KYC documents are encrypted at rest, access-logged, and retained only for the
              period the AML policy requires.
            </p>
          </div>
          <div className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
            <IconTile size="sm"><Gavel /></IconTile>
            <h3 className="mt-4 text-sm font-semibold text-text-primary">Jurisdiction restrictions</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              A geo-blocking list is maintained by Legal and configurable without a code deployment.
              Sign-ups from restricted or sanctioned jurisdictions are rejected at registration using
              an IP and declared-country cross-check.
            </p>
          </div>
        </div>
      </Section>

      <CtaBand
        title="Questions a policy doesn't answer?"
        description="Compliance enquiries and data-subject requests go to the compliance team directly, not general support."
        primary={{ label: "Contact compliance", href: "/contact" }}
        secondary={{ label: "Read the FAQ", href: "/faq" }}
      />
    </>
  );
}
