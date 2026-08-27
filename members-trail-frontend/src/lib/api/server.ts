/* ============================================================================
 * Server-side reads, for React Server Components.
 *
 * Separate from `client.ts` deliberately. That module holds the session in module
 * state, which on the server would be shared between every concurrent request —
 * one visitor's access token served to another. Nothing here touches a session:
 * these are the PUBLIC endpoints only, and every function in this file is safe to
 * call during a server render because there is no per-user state to leak.
 *
 * Why fetch on the server at all rather than from a hook: the legal pages are
 * public, indexable documents. Rendering their text on the server means a crawler
 * and a reader with JavaScript disabled both get the actual policy, and the reader
 * does not watch a spinner where the terms they are agreeing to should be.
 * ========================================================================== */

import type { LegalDocumentResponse, Paginated, PublicConfig, PublicStats } from "./types";

const BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ?? "http://localhost:4000/api/v1";

export interface ServerFetchOptions {
  /**
   * Seconds to cache the response. Legal text changes when Compliance publishes a
   * new version, which is rare, so a long window is right — and `revalidate`
   * rather than `no-store` means a burst of traffic on a policy page is one
   * upstream request, not thousands.
   */
  revalidate?: number;
}

/**
 * One public GET, on the server.
 *
 * Returns null instead of throwing. A public page whose API is briefly
 * unreachable should degrade to "this content is temporarily unavailable" — a
 * thrown error here becomes a 500 for the whole route, which for a legal page
 * means the terms are simply gone rather than delayed.
 */
export async function fetchPublic<T>(
  path: string,
  { revalidate = 300 }: ServerFetchOptions = {},
): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path.startsWith("/") ? path : `/${path}`}`, {
      headers: { Accept: "application/json" },
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/* --------------------------------- legal ---------------------------------- */

/** Legal documents change on publication, not on traffic. An hour is generous. */
const LEGAL_REVALIDATE = 3_600;

export const fetchLegalDocument = (slug: string): Promise<LegalDocumentResponse | null> =>
  fetchPublic<LegalDocumentResponse>(`/legal/documents/${slug}`, { revalidate: LEGAL_REVALIDATE });

export async function fetchLegalDocuments(): Promise<LegalDocumentResponse[]> {
  const res = await fetchPublic<Paginated<LegalDocumentResponse> | LegalDocumentResponse[]>(
    "/legal/documents?limit=50",
    { revalidate: LEGAL_REVALIDATE },
  );
  if (!res) return [];
  return Array.isArray(res) ? res : res.data;
}

/* --------------------------------- config --------------------------------- */

export const fetchPublicConfig = (): Promise<PublicConfig | null> =>
  fetchPublic<PublicConfig>("/public/config", { revalidate: 300 });

export const fetchPublicStats = (): Promise<PublicStats | null> =>
  fetchPublic<PublicStats>("/public/stats", { revalidate: 300 });
