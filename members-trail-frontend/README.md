# Members Trail — Frontend

> **Now wired to the API.** The mock data layer is gone — `src/lib/mock/` no longer
> exists. Every read goes through `src/lib/hooks/use-data.ts` and every write
> through `src/lib/hooks/use-mutations.ts`, both talking to the Members Trail API.
> Set `NEXT_PUBLIC_API_URL` (see `.env.example`) and read **`INTEGRATION.md`** before
> changing anything in `src/lib/api/`.


Next.js frontend for the Members Trail play-to-earn gaming and affiliate rewards
platform, built to the Functional Requirements Document (FRD v1.0). Covers the
public marketing site, the full player application, and the 14-page admin
back-office, with web3 integration against the MTT contracts on BNB Smart Chain.

**64 routes. Every page in the FRD inventory is implemented.**

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript strict |
| Styling | Tailwind CSS v4 (CSS-first `@theme`), no config file |
| Web3 | wagmi 2 + viem 2 + RainbowKit 2 (themed to the brand accent) |
| Charts | Recharts, wrapped in a validated chart system |
| Motion | Framer Motion, with `prefers-reduced-motion` honoured throughout |
| Data | Typed hook layer with a seeded mock dataset (one swap point per hook) |

---

## Getting started

```bash
npm install
cp .env.example .env.local     # optional — the UI runs fully without it
npm run dev                    # http://localhost:3000
```

Nothing is required to run. With no contract addresses set the app renders the
complete UI against the mock data layer and shows a dismissible banner saying so.

```bash
npm run build       # production build — currently 64 static routes
npm run typecheck   # tsc --noEmit, must exit 0
npm start           # serve the production build
```

---

## Environment

```bash
NEXT_PUBLIC_CHAIN_ID=97                        # 97 testnet, 56 mainnet
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=          # cloud.reown.com — free
NEXT_PUBLIC_MTT_TOKEN_ADDRESS=
NEXT_PUBLIC_STAKING_ADDRESS=
NEXT_PUBLIC_REFERRAL_DISTRIBUTOR_ADDRESS=
NEXT_PUBLIC_TEAM_VESTING_ADDRESS=
NEXT_PUBLIC_ADVISORS_VESTING_ADDRESS=
```

Take the addresses from `MLM-contracts/deployments/<network>.json` after
deploying. Without a WalletConnect project id, injected wallets (MetaMask,
Trust, Rabby) still work — only the QR/deep-link flow degrades.

---

## Architecture

```
src/
  app/
    (public)/        10 marketing pages + 8 legal policy pages
    (auth)/          7 onboarding pages (split-panel layout)
    (player)/app/    25 player pages (sidebar shell)
    (admin)/admin/   14 back-office pages (same shell, admin nav)
  components/
    ui/              primitives — Button, Card, DataTable, Modal, Toast, …
    fx/              motion & effects — Reveal, AnimatedCounter, TiltCard, …
    charts/          the chart system (see "Charts" below)
    layout/          PublicHeader/Footer, AppShell, PageHeader
    web3/            WalletConnectButton, TxModal, NetworkGuard
  lib/
    web3/            chains.ts (server-safe) · wagmi.ts (client-only) · abis/
    hooks/           use-data.ts (the API seam) · use-web3.ts · use-theme.tsx
    mock/            seeded dataset — data.ts, admin.ts, legal.ts
    nav.ts           single source of truth for every route
    utils.ts         formatters, csv export, seeded RNG
  types/             the whole domain model
```

### The data seam

Every page reads through a hook in `src/lib/hooks/use-data.ts`, and every hook
returns the same shape:

```ts
const { data, isLoading, error, refetch } = useBalances();
```

To go live, replace the body of `useResource` in that one file with a real
fetcher. No page changes:

```ts
function useResource<T>(key: string) {
  return useQuery({ queryKey: [key], queryFn: () => fetch(`/api/${key}`).then(r => r.json()) });
}
```

`src/lib/mock/*` then becomes deletable. `src/types/index.ts` documents the exact
shapes your API should return.

### Web3 boundary

`@/lib/web3` is **server-safe** (constants, addresses, explorer URLs, ABIs) and
may be imported from server components. The wagmi config lives in
`@/lib/web3/wagmi` and is client-only — importing it from a server component
breaks the build, which is deliberate.

The ABIs in `src/lib/web3/abis/` are **extracted from the compiled contract
artifacts**, not hand-written. Regenerate them after any contract change rather
than editing by hand.

Every on-chain write follows one pattern:

```tsx
const { stake, ...tx } = useStakeActions();
<TxModal open={open} onClose={close} state={tx} title="Stake MTT" summary={…} />
```

`TxModal` renders the full lifecycle — awaiting signature → pending → confirmed
→ error — with a BscScan link at every stage where a hash exists. Read hooks
return `undefined` when a contract is unconfigured, so pages fall back with
`onChainValue ?? mockValue`.

---

## Design system

Dark-first, orange-accented. Everything is written against semantic CSS
variables in `src/app/globals.css` — **never raw hex and never Tailwind palette
colours**. Both themes are defined explicitly; light mode is a selected set of
values, not an automatic flip.

- Surfaces: `bg-surface-0` … `bg-surface-3`, `bg-surface-inset`
- Text: `text-text-primary` / `-secondary` / `-muted`
- Accent: `bg-[var(--accent)]`, `bg-accent-soft`, `text-[var(--accent-hover)]`
- Status (reserved, always with an icon + label): `good` `warning` `serious` `critical` `info`
- Brand ramp: `brand-50` … `brand-950` (OKLCH hue 45, perceptually even)

### Charts

`src/components/charts/` enforces the rules so callers can't get them wrong:

- One y-axis only — there is no dual-axis option
- A legend whenever there are ≥ 2 series
- A table-view toggle on every chart frame (accessibility fallback and the
  relief rule for low-contrast slots)
- Series assigned in **fixed slot order**, never cycled

The categorical palette was validated with a colour-vision-deficiency checker
against both surfaces: worst adjacent CVD ΔE 8.4 dark / 9.1 light, worst
normal-vision ΔE 19.3 / 19.6, contrast ≥ 3:1 on dark. **Slot order is the
safety mechanism** — reordering `--series-1…8` invalidates it. Note the brand
accent is deliberately *not* chart slot 1: at OKLCH L 0.686 it fails the dark
lightness band, so slot 1 uses the validated `#d95926` step from the same hue
family.

### Fonts

Google Fonts was unreachable in the build environment, so the stack falls back
to system fonts. To add webfonts, replace `--font-display` and `--font-sans` in
`globals.css` with `next/font` variables — a two-line change:

```ts
import { Sora, Inter } from "next/font/google";
```

---

## Compliance is a UI feature, not a footer

The platform's whole design rests on one rule: **every payout is funded by real
platform revenue, never by another member's deposit.** The UI is built to make
that checkable rather than asserted:

- No fixed or guaranteed APR is displayed anywhere. Staking rates are labelled
  variable and revenue-funded, with the derivation formula shown on the page.
- Referral pages state that referring is optional, free, capped, and never
  required to earn or withdraw.
- Every commission line item shows the Treasury deposit reference that funded it
  and the on-chain source event id.
- Caps are rendered as `CapMeter` gauges wherever they bite — daily Points
  issuance, conversion allowance, monthly commission, withdrawal tier limits.
- The admin dashboard makes the commission-payout-to-inflow ratio the single
  most prominent element, with amber at 75%, red at 90%, and an explicit
  explanation of what breaching 100% would mean.
- The Treasury page hard-blocks a funding transfer that exceeds reconciled
  inflows for the period — implemented as real form validation, not a warning.
- Money-moving and destructive admin actions route through a four-eyes modal
  requiring a typed reason and a named second approver.

A grep for guaranteed-return language returns only negations. Please keep it
that way.

---

## Accessibility & correctness notes

- Relative times and countdowns are anchored to `REFERENCE_NOW` in
  `lib/utils.ts` rather than the wall clock. Reading `Date.now()` during render
  makes the server pass and the client's first render disagree — React reports
  it as hydration error #418 and users see flickering text. Ticking hooks
  (`useLiveNow`, `useNow`) seed from that constant and switch to the live clock
  after mount.
- `Reveal` / `RevealGroup` drive their animation from an explicit `useInView`
  **plus a 1200 ms fallback timer**, so a section can never be left stuck at
  `opacity: 0` if the IntersectionObserver is outrun by fast scrolling, print
  layout, or a restored scroll position.
- Mock data uses a seeded RNG (`seeded()` in `utils.ts`) so server and client
  render identical values.
- Icon-only controls carry `aria-label`; every `DataTable` has a `caption`;
  status is never communicated by colour alone.
- All motion respects `prefers-reduced-motion`, both in Framer Motion and via a
  global CSS override.

---

## Verified

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exits 0 |
| `npx next build` | 64 routes, all prerendered |
| Route coverage vs `nav.ts` | 0 missing, 0 orphaned |
| Dead internal links | 0 |
| Runtime errors across all 59 navigable routes | 0 |
| Hydration warnings | 0 |
| Raw hex / Tailwind palette colours | 0 (excluding third-party brand marks) |
| `any` / `@ts-ignore` | 0 |
| Responsive | verified at 390 px and 1440 px |
| Light theme | verified on public, player and admin |

---

## Known scope boundaries

- **No backend.** Everything reads the mock layer; see "The data seam".
- **Games are placeholders.** The gameplay screen is a framed canvas with a
  simulated score counter — real titles integrate via iframe or canvas mount.
- **File uploads are affordances,** not wired to storage (KYC documents, avatars,
  ticket attachments, CMS assets).
- **Auth is not enforced.** There is no session guard on `/app` or `/admin` —
  wire your auth middleware before any deployment that isn't a demo.
- **Blog and legal detail content** is authored in `lib/mock/legal.ts` and the
  blog page; in production both come from the CMS (AD-11).
- **Legal text is a structural draft** per FRD Section 11 — it defines required
  sections and must be reviewed by counsel in each operating jurisdiction
  before publication.
