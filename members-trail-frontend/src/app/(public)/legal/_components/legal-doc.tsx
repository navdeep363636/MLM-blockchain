/* Shared legal document layout — FRD 11.
 * Server component. All eight policy pages render through this so the reading
 * experience, the plain-language summary, the table of contents and the
 * prev/next navigation are identical everywhere. */

import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, FileText, Gavel,
  LifeBuoy, List, PenLine, ShieldAlert,
} from "lucide-react";
import { Badge, Button, Callout } from "@/components/ui";
import { AuroraBackground, GridBackdrop, NoiseOverlay, ScrollProgress } from "@/components/fx";
import { Container } from "../../_components/shell";
import { legalDocs } from "@/lib/nav";
import { cn, formatDate } from "@/lib/utils";
import type { LegalDocument } from "@/types";
import { PrintButton } from "./print-button";

/**
 * Previous and next document, in the order the nav publishes them.
 *
 * Derived from `legalDocs` — the same list the legal index page and the footer
 * render — rather than from a parallel array. Two orderings of the same eight
 * documents is one ordering too many, and the one nobody looks at is the one that
 * ends up wrong.
 */
function neighbours(slug: string) {
  const i = legalDocs.findIndex((d) => d.href === `/legal/${slug}`);
  return {
    prev: i > 0 ? legalDocs[i - 1] : undefined,
    next: i >= 0 && i < legalDocs.length - 1 ? legalDocs[i + 1] : undefined,
  };
}

/** Stable anchor id for a section heading: drops the leading clause number. */
export function sectionId(heading: string) {
  return heading
    .toLowerCase()
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const STATUS: Record<
  LegalDocument["status"],
  { label: string; tone: "neutral" | "warning" | "good"; Icon: typeof PenLine }
> = {
  draft: { label: "Structural draft", tone: "neutral", Icon: PenLine },
  legal_review: { label: "In legal review", tone: "warning", Icon: ShieldAlert },
  published: { label: "Published", tone: "good", Icon: CheckCircle2 },
  /* Reachable: a member following an old link to a version that has since been
   * replaced. Saying so is the point of showing it at all. */
  archived: { label: "Superseded", tone: "neutral", Icon: PenLine },
};

export function LegalDoc({
  doc,
  /** Optional extra block rendered after the section whose heading is the key. */
  extras,
}: {
  doc: LegalDocument;
  extras?: Record<string, React.ReactNode>;
}) {
  const { prev, next } = neighbours(doc.slug);
  const meta = legalDocs.find((d) => d.href === `/legal/${doc.slug}`);
  /* Falls back rather than indexing blind.
   *
   * `doc.status` is whatever the API said. A value outside this map — a status
   * added server-side, a mapper that let an unknown string through — made
   * `status` undefined and threw on `status.tone` during render, which for a
   * statically-generated public policy page means the BUILD fails, not one
   * request. A legal page must render whatever else is wrong with it; the
   * status badge is the least important thing on it. */
  const status = STATUS[doc.status] ?? STATUS.draft;

  const toc = doc.sections.map((s) => ({ id: sectionId(s.heading), heading: s.heading }));

  return (
    <>
      <ScrollProgress />

      {/* ------------------------------- Header ------------------------------ */}
      <header className="relative isolate overflow-hidden border-b border-border-subtle print:border-0">
        <AuroraBackground intensity={0.6} />
        <GridBackdrop />
        <NoiseOverlay />
        <Container className="relative py-12 sm:py-16">
          <Link
            href="/legal"
            className="inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-[var(--accent-hover)] print:hidden"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            All legal documents
          </Link>

          <h1 className="mt-5 max-w-3xl font-display text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl lg:text-[2.9rem] lg:leading-[1.08]">
            {doc.title}
          </h1>

          {meta?.description && (
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-text-secondary">
              {meta.description}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge tone="brand" icon={<FileText className="size-3.5" />}>
              Version <span className="tnum">{doc.version}</span>
            </Badge>
            <Badge tone={status.tone} icon={<status.Icon className="size-3.5" />}>
              {status.label}
            </Badge>
            {meta?.frd && <Badge tone="neutral">FRD §{meta.frd}</Badge>}
            {doc.materialChange && (
              <Badge tone="warning" icon={<AlertTriangle className="size-3.5" />}>
                Material change — re-acceptance required
              </Badge>
            )}
          </div>

          <dl className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
            <div className="flex items-center gap-2">
              <CalendarClock className="size-4 text-text-muted" aria-hidden />
              <dt className="text-text-muted">Last updated</dt>
              <dd className="tnum font-medium text-text-primary">{formatDate(doc.updatedAt)}</dd>
            </div>
            <div className="flex items-center gap-2">
              <Gavel className="size-4 text-text-muted" aria-hidden />
              <dt className="text-text-muted">Effective from</dt>
              <dd className="tnum font-medium text-text-primary">{formatDate(doc.effectiveFrom)}</dd>
            </div>
            <div className="flex items-center gap-2">
              <List className="size-4 text-text-muted" aria-hidden />
              <dt className="text-text-muted">Sections</dt>
              <dd className="tnum font-medium text-text-primary">{doc.sections.length}</dd>
            </div>
          </dl>

          <div className="mt-7 flex flex-wrap items-center gap-3 print:hidden">
            <PrintButton />
            <Button href="/contact" variant="ghost" size="sm" icon={<LifeBuoy className="size-4" />}>
              Ask about this policy
            </Button>
          </div>
        </Container>
      </header>

      {/* ------------------------------- Body -------------------------------- */}
      <Container className="py-10 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-14">
          {/* Desktop sticky table of contents */}
          <aside className="hidden lg:block print:hidden">
            <nav
              aria-label="On this page"
              className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto no-scrollbar border-l border-border-subtle pl-4"
            >
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                On this page
              </p>
              <ol className="space-y-1.5">
                {toc.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="block rounded-md py-1 text-sm leading-snug text-text-muted transition-colors hover:text-[var(--accent-hover)]"
                    >
                      {s.heading}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>

          <div className="min-w-0">
            {/* Mobile disclosure table of contents */}
            <details className="group mb-8 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 lg:hidden print:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-text-primary">
                <span className="flex items-center gap-2">
                  <List className="size-4 text-text-muted" aria-hidden />
                  On this page
                  <span className="tnum text-text-muted">({doc.sections.length})</span>
                </span>
                <ArrowRight
                  className="size-4 shrink-0 text-text-muted transition-transform group-open:rotate-90"
                  aria-hidden
                />
              </summary>
              <nav aria-label="On this page" className="border-t border-border-subtle px-4 py-3">
                <ol className="space-y-2">
                  {toc.map((s) => (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        className="block text-sm leading-snug text-text-secondary transition-colors hover:text-[var(--accent-hover)]"
                      >
                        {s.heading}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            </details>

            {/* Plain-language summary — the differentiator */}
            <Callout
              tone="info"
              title="What this means for you"
              icon={<LifeBuoy />}
              className="max-w-[72ch]"
            >
              <p className="mt-1 leading-relaxed">{doc.summary}</p>
              <p className="mt-2 text-xs text-text-muted">
                This summary is written for readability and is not part of the agreement. Where it
                differs from the sections below, the sections govern.
              </p>
            </Callout>

            {/* Prose */}
            <div className="mt-10 max-w-[72ch] space-y-12">
              {doc.sections.map((s, i) => {
                const id = sectionId(s.heading);
                const extra = extras?.[s.heading];
                const isLast = i === doc.sections.length - 1;
                return (
                  <section
                    key={id}
                    id={id}
                    className={cn(
                      "scroll-mt-24",
                      isLast &&
                        "rounded-[var(--radius-card)] border border-border-subtle bg-surface-inset p-5 sm:p-6",
                    )}
                  >
                    <h2 className="font-display text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">
                      {s.heading}
                    </h2>
                    <div className="mt-4 space-y-4">
                      {s.body.map((p, pi) => (
                        <p
                          key={pi}
                          className="text-[0.95rem] leading-[1.75] text-text-secondary sm:text-base sm:leading-[1.8]"
                        >
                          {p}
                        </p>
                      ))}
                    </div>
                    {extra}
                    <a
                      href={`#${id}`}
                      aria-label={`Link to section: ${s.heading}`}
                      className="mt-4 inline-block text-xs text-text-muted underline-offset-4 transition-colors hover:text-[var(--accent-hover)] hover:underline print:hidden"
                    >
                      Link to this section
                    </a>
                  </section>
                );
              })}
            </div>

            {/* Foot: questions + print + prev/next */}
            <div className="mt-14 max-w-[72ch] border-t border-border-subtle pt-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-sm text-text-secondary">
                  Questions about this policy?{" "}
                  <Link
                    href="/contact"
                    className="font-medium text-[var(--accent-hover)] underline underline-offset-4"
                  >
                    Contact the compliance team
                  </Link>{" "}
                  — compliance enquiries and data-subject requests route away from general support.
                </p>
                <PrintButton label="Print this policy" />
              </div>

              <nav
                aria-label="Other legal documents"
                className="mt-8 grid gap-3 sm:grid-cols-2 print:hidden"
              >
                {prev ? (
                  <Link
                    href={prev.href}
                    className="group flex flex-col gap-1 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-4 transition-colors hover:border-[color-mix(in_oklab,var(--accent)_38%,var(--border-default))]"
                  >
                    <span className="flex items-center gap-1.5 text-xs text-text-muted">
                      <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" aria-hidden />
                      Previous
                    </span>
                    <span className="text-sm font-medium text-text-primary group-hover:text-[var(--accent-hover)]">
                      {prev.label}
                    </span>
                  </Link>
                ) : (
                  <span aria-hidden className="hidden sm:block" />
                )}
                {next && (
                  <Link
                    href={next.href}
                    className="group flex flex-col items-end gap-1 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-4 text-right transition-colors hover:border-[color-mix(in_oklab,var(--accent)_38%,var(--border-default))] sm:col-start-2"
                  >
                    <span className="flex items-center gap-1.5 text-xs text-text-muted">
                      Next
                      <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                    <span className="text-sm font-medium text-text-primary group-hover:text-[var(--accent-hover)]">
                      {next.label}
                    </span>
                  </Link>
                )}
              </nav>
            </div>
          </div>
        </div>
      </Container>
    </>
  );
}
