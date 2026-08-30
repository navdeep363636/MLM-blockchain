/* ============================================================================
 * The only place in the frontend that talks to the network.
 *
 * Everything above this file — hooks, pages, forms — goes through `api.get`,
 * `api.post` and friends. That is what makes the following four behaviours true
 * everywhere instead of in the twelve places somebody remembered:
 *
 *  1. THE ACCESS TOKEN LIVES IN MEMORY. Never localStorage. An injected script
 *     on a platform that moves money should not be able to read a bearer token,
 *     and it certainly should not be able to read the refresh token — which is
 *     why that one is an httpOnly cookie the server sets and JavaScript cannot
 *     see. The cost is that a reload has no token until the refresh call
 *     completes, which `restore()` handles.
 *
 *  2. ONE REFRESH AT A TIME. Six queries firing on a dashboard whose token has
 *     just expired produce six 401s. Six refresh calls would rotate the token
 *     six times, and since rotation is single-use and reuse is treated as a
 *     compromise, five of them would destroy the session that the first one just
 *     created. So a refresh is a single shared promise; everyone waits for it.
 *
 *  3. MUTATIONS CARRY AN IDEMPOTENCY KEY. The server dedupes on it, which turns
 *     a double-clicked "Stake" from two stakes into one. Generated per call, not
 *     per retry: a retry of the same intent must present the SAME key or the
 *     guarantee is worthless.
 *
 *  4. FAILURES ARE ApiError. Never a bare Error, never a rejected response
 *     object. Callers branch on `code`.
 * ========================================================================== */

import { ApiError, type ApiErrorBody } from "./errors";

/* --------------------------------- config --------------------------------- */

/**
 * Base URL, including the version segment.
 *
 * The version is part of the base rather than each path because every call in
 * this app speaks v1, and threading it through 90 call sites is how half of them
 * end up on v2 and half do not.
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ?? "http://localhost:4000/api/v1";

/** Origin only — the socket server is not under the API prefix. */
export const API_ORIGIN = (() => {
  try {
    return new URL(API_BASE).origin;
  } catch {
    return "http://localhost:4000";
  }
})();

/* ------------------------------ token storage ----------------------------- */

interface Session {
  accessToken: string;
  /** Epoch ms. Used to refresh proactively rather than waiting for a 401. */
  expiresAt: number;
}

let session: Session | null = null;
let refreshInFlight: Promise<boolean> | null = null;

/** Called by the auth provider whenever the session changes. */
type SessionListener = (authenticated: boolean) => void;
const listeners = new Set<SessionListener>();

export function onSessionChange(fn: SessionListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce(authenticated: boolean): void {
  for (const fn of listeners) fn(authenticated);
}

export function setSession(accessToken: string, expiresInSeconds: number): void {
  session = {
    accessToken,
    /* Expire the token in our own bookkeeping 30s early. Clock skew between the
     * browser and the server is real, and a token we think is valid for one more
     * second is a request that arrives already expired. */
    expiresAt: Date.now() + Math.max(0, expiresInSeconds - 30) * 1000,
  };
  announce(true);
}

export function clearSession(): void {
  session = null;
  announce(false);
}

export function currentAccessToken(): string | null {
  return session?.accessToken ?? null;
}

export function hasSession(): boolean {
  return session !== null;
}

/* -------------------------------- refresh --------------------------------- */

/**
 * Exchanges the httpOnly refresh cookie for a new access token.
 *
 * Returns false rather than throwing when there is no session to restore: on
 * first load for an anonymous visitor that is the expected answer, not an error,
 * and treating it as one fills the console with noise on every public page.
 */
type RefreshBody = { tokens?: { accessToken?: string; expiresIn?: number } } | null;

/**
 * The refresh the document head kicked off during HTML parse, if it is still
 * unclaimed. Claimed once: a refresh token is single-use, so a second POST would
 * invalidate the token this one just spent and read as reuse-as-breach.
 */
function adoptHeadRefresh(): Promise<RefreshBody> | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { __mtSession?: Promise<RefreshBody> };
  const p = w.__mtSession;
  if (!p) return null;
  delete w.__mtSession;
  return p;
}

/**
 * The `/users/me` the head chained onto the refresh, if it is still unclaimed.
 * Unlike the refresh there is nothing single-use about it — claiming once is
 * simply so a later profile reload goes to the network for a current answer
 * rather than replaying the one from page load.
 */
export function adoptHeadProfile(): Promise<unknown> | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { __mtProfile?: Promise<unknown> };
  const p = w.__mtProfile;
  if (!p) return null;
  delete w.__mtProfile;
  return p;
}

export async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const head = adoptHeadRefresh();
      const body = head
        ? await head
        : await (async () => {
            const res = await fetch(`${API_BASE}/auth/refresh`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              /* Empty body: the token is in the cookie. The field is optional
               * server-side precisely so a browser never has to hold it. */
              body: "{}",
            });
            return res.ok ? ((await res.json()) as RefreshBody) : null;
          })();
      if (!body) {
        clearSession();
        return false;
      }
      const token = body.tokens?.accessToken;
      if (!token) {
        clearSession();
        return false;
      }
      setSession(token, body.tokens?.expiresIn ?? 900);
      return true;
    } catch {
      clearSession();
      return false;
    } finally {
      /* Cleared in `finally` so a failed refresh does not wedge every later call
       * behind a permanently-rejected promise. */
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/** Restores a session on page load. Safe to call when signed out. */
export const restoreSession = refreshSession;

/* ------------------------ eager session bootstrap ------------------------- */

/**
 * The session restore starts when this MODULE evaluates, not when React mounts.
 *
 * THE PROBLEM
 * -----------
 * Restoring the session was the first thing an effect did after hydration, and
 * every authenticated query is gated on the result. That put three round trips
 * in a row on the critical path of every cold load:
 *
 *     hydrate -> POST /auth/refresh -> GET /users/me -> queries become enabled
 *
 * Measured on a 4x-throttled cold load of /admin against a 120ms API, the first
 * data request went out at 1,651ms — on a page that had painted at 296ms. Almost
 * none of that was the network. It was waiting for a turn.
 *
 * Module evaluation happens while React is still hydrating, so firing the
 * refresh here overlaps it with work the browser is doing anyway. By the time
 * the provider's effect runs, the token is usually already in hand.
 *
 * `refreshSession()` dedupes on `refreshInFlight`, but only while a call is in
 * flight — a second call after the first resolved would rotate the refresh
 * token again for nothing. So the promise is held here and the provider awaits
 * THIS one rather than starting its own.
 *
 * Guarded on `window`: on the server there is no cookie jar to restore from, and
 * firing a request during a server render would be one request per rendered
 * page, to no purpose.
 */
let bootstrap: Promise<boolean> | null = null;

export function bootstrapSession(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  bootstrap ??= refreshSession().catch(() => false);
  return bootstrap;
}

if (typeof window !== "undefined") {
  /* Fire immediately. Nothing awaits it here — the provider picks up the same
     promise, and an anonymous visitor's failed restore is expected, not an
     error worth surfacing. */
  void bootstrapSession();
}

/* ------------------------------- the request ------------------------------ */

export interface RequestOptions {
  /** Query parameters. Undefined and null values are dropped, not sent as "undefined". */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Skip the Authorization header. Used for the public endpoints. */
  anonymous?: boolean;
  /**
   * Idempotency key for a mutation. Supply one to make a retry safe across
   * reloads; omit it and one is generated per call.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Internal: set once a call has already been retried after a refresh. */
  _retried?: boolean;
}

const MUTATIONS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(`${API_BASE}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID();
  /* Older Safari. Not cryptographically strong, but an idempotency key only has
   * to be unique per intent, not unguessable. */
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  /* Refresh BEFORE the call when we can see the token is about to expire. This
   * turns the common case from "401, refresh, retry" into a single request. */
  if (!opts.anonymous && session && session.expiresAt <= Date.now()) {
    await refreshSession();
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (!opts.anonymous && session) headers.Authorization = `Bearer ${session.accessToken}`;
  if (MUTATIONS.has(method)) {
    headers["Idempotency-Key"] = opts.idempotencyKey ?? newIdempotencyKey();
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      /* Always include: the refresh cookie is path-scoped to /auth, so this is
       * a no-op elsewhere, and getting it wrong on the auth calls is a silent
       * "why am I signed out on every reload". */
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    /* An aborted request is the caller's own doing — a navigation, a changed
     * query key — and must not be dressed up as a network failure. */
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, { code: "NETWORK_ERROR", message: "Network request failed" });
  }

  /* A 401 on an authenticated call means the token died mid-flight. Refresh once
   * and replay. `_retried` stops this recursing when the refresh itself yields a
   * token the server still rejects. */
  if (res.status === 401 && !opts.anonymous && !opts._retried) {
    const ok = await refreshSession();
    if (ok) return request<T>(method, path, body, { ...opts, _retried: true, idempotencyKey: headers["Idempotency-Key"] });
    clearSession();
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const parsed: unknown = text.length > 0 ? safeJson(text) : null;

  if (!res.ok) {
    const retryAfter = Number(res.headers.get("Retry-After") ?? "");
    throw new ApiError(
      res.status,
      (parsed ?? { message: text || undefined }) as ApiErrorBody,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    );
  }

  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    /* A body that is not JSON on a 2xx is a proxy or gateway page, not our API. */
    return { message: text.slice(0, 200) };
  }
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("POST", path, body ?? {}, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("PATCH", path, body ?? {}, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("PUT", path, body ?? {}, opts),
  del: <T>(path: string, opts?: RequestOptions) => request<T>("DELETE", path, undefined, opts),
};

/* -------------------------------- pagination ------------------------------ */

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

/**
 * Pulls every page of a list endpoint.
 *
 * Several screens in this app are built around a complete array — a referral
 * tree, a staff directory, a chart series — and were written against mock data
 * that was simply all of it. Rather than rewrite those screens for cursors, this
 * walks the pages, with a hard stop so a server that always says `hasNext` can
 * only cost us a bounded number of requests instead of hanging the tab.
 */
export async function fetchAll<T>(
  path: string,
  opts: RequestOptions = {},
  limit = 100,
  maxPages = 25,
): Promise<T[]> {
  const first = await api.get<Paginated<T>>(path, {
    ...opts,
    query: { ...opts.query, page: 1, limit },
  });
  const out: T[] = [...(first?.data ?? [])];
  if (!first?.meta?.hasNext) return out;

  /* Page 1 tells us how many there are, so pages 2..n go out together.
   *
   * This used to be a `for` loop that awaited each page before asking for the
   * next, which made the wait the SUM of the round trips. /admin/users needs
   * five pages: against a 400ms API that was five round trips end to end, and
   * the members table could not render until the last one landed — measured at
   * 2174ms to content. Fanned out, the wait is the slowest single page instead
   * of all of them in a queue.
   *
   * `maxPages` still bounds it, so a server that always says `hasNext` costs a
   * known number of requests rather than hanging the tab — the difference is
   * that the bound is now on how many are IN FLIGHT, not how long they queue. */
  const totalPages = first.meta.pages;
  if (Number.isFinite(totalPages) && totalPages > 1) {
    const last = Math.min(totalPages, maxPages);
    const rest = await Promise.all(
      Array.from({ length: last - 1 }, (_, i) =>
        api.get<Paginated<T>>(path, { ...opts, query: { ...opts.query, page: i + 2, limit } }),
      ),
    );
    /* Concatenated in page order, not completion order: several of these lists
       are rendered as-is, and a table whose rows reorder by network timing is a
       different list on every load. */
    for (const res of rest) out.push(...(res?.data ?? []));
    return out;
  }

  /* No page count in the envelope — a cursor-ish server, or an older endpoint.
     Fall back to walking, which is slow but correct. */
  for (let page = 2; page <= maxPages; page += 1) {
    const res = await api.get<Paginated<T>>(path, {
      ...opts,
      query: { ...opts.query, page, limit },
    });
    out.push(...(res?.data ?? []));
    if (!res?.meta?.hasNext) break;
  }
  return out;
}
