# Frontend ↔ backend integration

This document is the map of the seam. If you are changing how the app talks to
the API, start here.

---

## The shape of it

```
components (171 files, unchanged)
        │  every read goes through one of ~45 hooks
        ▼
src/lib/hooks/use-data.ts        ← reads      ─┐
src/lib/hooks/use-mutations.ts   ← writes      │ react-query
        │                                      │
        ▼                                      │
src/lib/api/mappers.ts           wire → domain │
src/lib/api/types.ts             the wire contracts
src/lib/api/keys.ts              cache keys, for invalidation
        │                                      │
        ▼                                      │
src/lib/api/client.ts            fetch, tokens, idempotency, errors
src/lib/api/server.ts            the same, for server components
        │
        ▼
   Members Trail API  ·  http://localhost:4000/api/v1
        ▲
        │  events (hints only)
src/lib/realtime/socket.tsx      socket.io → cache invalidation
```

Nothing above `use-data.ts` knows a network exists. That is what allowed the whole
app to be built against mock data and switched over without touching a component:
the hooks kept their signatures, and `src/lib/mock/` was deleted.

---

## The five rules

**1. The access token lives in memory. The refresh token is an httpOnly cookie.**

`localStorage` is readable by any injected script, and on a platform that moves
money an XSS should not also yield a credential that mints new sessions for a
month. So the API sets `mt_rt` — httpOnly, SameSite=Lax, path-scoped to
`/api/v1/auth` — and the browser never holds it in JavaScript. A page reload has
no access token until `restoreSession()` completes, which is why `useAuth()` has a
`"loading"` phase distinct from `"anonymous"`.

Native clients have no cookie jar, so `POST /auth/refresh` still accepts the token
in the body. Both work; neither has to know about the other.

**2. One refresh at a time.**

A dashboard with fifteen queries whose token has just expired produces fifteen
401s. Fifteen refresh calls would rotate the token fifteen times — and rotation is
single-use, with reuse treated as a compromise that destroys the session family.
So the refresh is a single shared promise and every caller waits on it. This is not
an optimisation; without it, loading a dashboard would log you out.

**3. Money crosses the wire as a string, and comes back as the string you typed.**

Every MTT figure is `DECIMAL(36,18)`. `JSON.parse` on a number that wide rounds it
silently. The mappers convert to `number` for DISPLAY and say so; every mutation in
`use-mutations.ts` sends the string from the input. No amount a member confirms is
round-tripped through a float.

**4. Realtime events are hints. The API is the truth.**

The server says this in its own handshake payload. Nothing in
`src/lib/realtime/socket.tsx` writes a value into the cache — an event invalidates
the queries it affects and react-query refetches. A push carries what the server
knew at emit time; a balance is read live from the ledger. Patching a balance from
a push shows a figure that was already stale when it left the building. It also
means a tab that missed three events while backgrounded is correct again on
reconnect, for free.

**5. Policy comes from the server, not the bundle.**

Rates, caps, minimums, restricted jurisdictions, password rules, legal text — all
of it was a constant in this repo and all of it is now a read. See below.

---

## What moved out of the bundle

Each of these was a hard-coded constant. Each is a value an operator changes, which
makes a bundled copy a number that goes stale silently, on every screen at once.

| Was | Now | Notes |
| --- | --- | --- |
| `RESTRICTED = ["US","KP","IR","SY","CU"]` in the signup form | `GET /public/config` | The two lists **had already drifted**: SG, RU, BY, VE, MM and AF are refused server-side and were absent from the bundle. The form accepted registrations the API rejects. |
| Minimum age `18` | `GET /public/config` | Jurisdictional minimums are higher in five countries. |
| Password rules | `GET /public/config` | The regexes remain as live typing feedback; the policy is the server's, including the checks a browser cannot do. |
| Commission rates 8/3/1 and the cap formula | `GET /public/config` → `referral` | Needed on public pages, so it is on the public config rather than the admin plan endpoint. |
| Conversion rate and caps | `GET /conversion/rate`, `GET /public/config` → `conversion` | |
| Withdrawal ceilings, cooling-off | `GET /wallet/withdrawals/limits` | Varies by KYC tier. |
| Marketplace fees and price bounds | `GET /store/market/policy` | |
| Admin conversion caps | `GET /admin/conversion/caps` | The write side existed; the read side did not, so the operator screen showed bundled figures. |
| RBAC matrix and module list | `GET /admin/permissions` | A hard-coded module list means a newly added module never appears on the roles screen, so nobody can grant access to it. |
| **116 KB of legal policy text** | `GET /legal/documents/:slug` | Server-rendered. The API serves published documents only — see the note below. |

Kept in the repository, deliberately: `src/content/cookies.ts`. A cookie inventory
must match what the *code* sets. It changes when a developer adds a cookie, in the
same commit, reviewed by the same person. A CMS copy would drift, and a cookie
table that does not match the cookies is a compliance defect.

---

## Two things that will look like bugs and are not

**The legal pages say "this policy has not been published yet."**

That is correct. The seed loads all eight documents as `legal_review`, and
`GET /legal/documents` serves `published` only. A draft policy on a public URL is
a document someone could rely on. Publishing them is a governed act — Compliance
approves each one — and it is a real gating step before launch, not a bug to fix
in the frontend.

**Some figures are absent rather than zero.**

The landing page's "Payouts funded by real revenue" tile does not render when no
commission has been released; a retention chart shows gaps for cohorts younger
than the window; the payout-ratio line breaks for a month with no reconciled
inflow. In each case the API returns `null` because the figure is *unknowable*, and
the UI omits it. Rendering 0% would read as healthy when the truth is unknown, and
these numbers sit next to the product's promises.

---

## Adding a read

1. Add the wire type to `src/lib/api/types.ts`. **Check the real response first** —
   `curl` it. Field names are not guessable, and the shapes are not uniform: some
   endpoints return `{data, meta}`, some a bare array, and several return a wrapper
   (`/quests` groups by cadence, `/leaderboard` returns `{rows, you}`,
   `/staking/positions` returns `{positions, …}`).
2. Add a mapper to `src/lib/api/mappers.ts` if the UI's vocabulary differs.
3. Add a key to `src/lib/api/keys.ts`.
4. Add the hook to `use-data.ts` with an explicit empty fallback — `data` is never
   undefined, because the components index into it directly.

## Adding a write

1. Add it to `use-mutations.ts` via `useAction(fn, invalidates)`. The `invalidates`
   argument is required, so a mutation cannot ship without cache invalidation.
2. List every key it affects, coarsest first. After a withdrawal the balance, the
   ledger and the withdrawal list are all wrong together.
3. Pass amounts as strings. Do not parse and re-serialise.
4. Do not add optimistic updates to anything with an amount on it.

Mutations are never retried automatically. The idempotency key makes a retry safe,
but a member watching a spinner after an error cannot tell whether their withdrawal
went through — that decision is theirs.

---

## Environment

```
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
```

Include the version segment. The socket origin is derived from it, so one variable
configures both. The API's `CORS_ORIGINS` must include this app's origin, and
`credentials: "include"` is sent on every request so the refresh cookie works.

---

## Verified against the running stack

Not "should work" — run and checked:

- 24 authenticated player reads, all 200, shapes confirmed against the mappers
- register → login → refresh **from the cookie alone** → authenticated read
- refresh-token reuse correctly destroys the session family (`REFRESH_REUSE_DETECTED`)
- socket handshake accepted with a real token, refused with a junk one
- a real server event (`account.status_changed`) delivered to the member's socket
- a replayed mutation refused with `DUPLICATE_REQUEST`
- 67 pages build; every public route returns 200; guards render their resolving state

Two defects were found this way and fixed — both invisible to unit tests. They are
written up in `members-trail-api/BACKEND_CONVENTIONS.md` under "Two bugs the tests
could not see".
