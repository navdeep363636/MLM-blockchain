/* ============================================================================
 * One place that turns a slug into a rendered legal document.
 *
 * The eight policy pages were each importing 116KB of policy text from the
 * bundle. That is wrong on three counts, and only the first is about size:
 *
 *  1. The published text is a legal instrument with a VERSION and an effective
 *     date, and members accept a specific version. Serving it from the bundle
 *     means the version a member reads is whatever was compiled, while the
 *     version their acceptance is recorded against is whatever the API says.
 *  2. Publication is a governed act — Compliance approves it, and the API only
 *     serves documents that reached `published`. A bundled copy bypasses that
 *     entirely, which is how a draft ends up on a public URL.
 *  3. It shipped to every visitor of every page, read or not.
 *
 * Fetched on the server so a crawler and a reader without JavaScript both get the
 * actual policy rather than a spinner.
 * ========================================================================== */

import { AlertTriangle } from "lucide-react";
import { Callout } from "@/components/ui";
import { fetchLegalDocument } from "@/lib/api/server";
import { toLegalDocument } from "@/lib/api/mappers";
import { legalDocs } from "@/lib/nav";
import { Container } from "../../_components/shell";
import { LegalDoc } from "./legal-doc";

export async function LegalDocFromApi({
  slug,
  extras,
}: {
  slug: string;
  extras?: Record<string, React.ReactNode>;
}) {
  const raw = await fetchLegalDocument(slug);

  /* Two different absences, and telling a reader the wrong one is worse than
   * telling them nothing.
   *
   * The API serves PUBLISHED documents only. A document still in legal review is
   * therefore missing here — correctly, because a draft policy on a public URL is
   * a document someone could rely on. That is not an outage and must not be
   * reported as one.
   *
   * A slug we do not recognise at all is a broken link, and a transient failure
   * on a slug we do recognise is a real outage. All three get their own words. */
  if (!raw) {
    const known = legalDocs.some((d) => d.href === `/legal/${slug}`);
    return (
      <Container className="py-16">
        <Callout
          tone="warning"
          title={known ? "This policy has not been published yet" : "Document not found"}
          icon={<AlertTriangle />}
        >
          <p className="mt-1">
            {known ? (
              <>
                The text is drafted and in legal review. It is deliberately not shown here until an
                attorney in each operating jurisdiction has approved it — a draft policy on a public
                page is a document someone could reasonably rely on. Contact support if you need the
                current position in writing before then.
              </>
            ) : (
              <>
                There is no policy at this address. The{" "}
                <a className="underline underline-offset-2" href="/legal">
                  legal index
                </a>{" "}
                lists every document we publish.
              </>
            )}
          </p>
        </Callout>
      </Container>
    );
  }

  return <LegalDoc doc={toLegalDocument(raw)} extras={extras} />;
}
