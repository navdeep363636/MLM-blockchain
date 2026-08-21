# Members Trail frontend — build conventions

Read this fully before writing any page. The foundation is already built and
**must be reused, not re-created**.

## Hard rules

1. **Never modify** anything in `src/components/ui/`, `src/components/fx/`,
   `src/components/charts/`, `src/components/layout/`, `src/components/web3/`,
   `src/lib/` (except a file explicitly assigned to you), `src/types/`,
   `src/app/globals.css`, `src/app/layout.tsx`, `src/app/providers.tsx`,
   `next.config.ts`, `tsconfig.json`. Other agents are working in parallel.
2. **Never add npm dependencies.** Everything you need is installed.
3. **Never use raw hex colours or Tailwind palette colours** (`bg-orange-500`,
   `text-gray-400`, `bg-red-50`, …). Only the semantic tokens listed below.
4. Every page is a real page with real content. No "TODO", no placeholder
   `<div>Coming soon</div>`, no lorem ipsum.
5. Run `npx tsc --noEmit` before you finish. It must exit 0.

## Colour tokens — the only ones you may use

Surfaces: `bg-surface-0` (page) `bg-surface-1` (card) `bg-surface-2` (raised/hover)
`bg-surface-3` (input/popover) `bg-surface-inset` (recessed).

Borders: `border-border-subtle` `border-border-default` `border-border-strong`.

Text: `text-text-primary` `text-text-secondary` `text-text-muted` `text-text-inverse`.

Accent (orange): `bg-[var(--accent)]` `text-[var(--accent)]`
`text-[var(--accent-hover)]` `bg-accent-soft` `ring-[var(--accent-ring)]`.
Brand ramp when you need a specific step: `bg-brand-500`, `text-brand-300`, etc.

Status — **reserved**, never as decoration: `good-400/500` (success),
`warning-400/500`, `serious-400/500`, `critical-400/500`, `info-400/500`.
Always pair a status colour with an icon and a text label.

Chart series: `var(--series-1)` … `var(--series-8)`, assigned **in slot order,
never cycled**. Slot order is a validated colourblind-safety property — do not
reorder or invent a 9th.

Utilities available: `glass` `glow-brand` `glow-brand-lg` `bg-grid` `bg-dots`
`shimmer` `mask-fade-b` `mask-fade-edges` `no-scrollbar` `text-gradient-brand`
`ring-hairline` `border-conic` `tnum` (tabular figures — **use on every number**)
`font-display` `font-mono-num`.

## Components you must reuse

```ts
import {
  Button, IconButton, Card, CardHeader, CardBody, CardFooter, SectionTitle,
  Field, Input, PasswordInput, Textarea, Select, SearchInput, Checkbox, Switch,
  Slider, SegmentedControl, Badge, StatusPill, KycBadge, LevelBadge, Callout,
  Avatar, AvatarStack, Modal, Drawer, ConfirmDialog, useToast, Tooltip, InfoHint,
  DataTable, type Column, Skeleton, SkeletonCard, EmptyState, ProgressBar,
  CapMeter, RingProgress, Steps, Tabs, PillTabs, Accordion, Dropdown,
  StatTile, HeroStat, DetailRow,
} from "@/components/ui";

import {
  Reveal, RevealGroup, RevealItem, AnimatedCounter, AuroraBackground,
  GridBackdrop, NoiseOverlay, FloatingOrbs, Marquee, TiltCard, SpotlightCard,
  Magnetic, ScrollProgress, Typewriter, LiveDot, PageTransition, FlashValue,
  motion, AnimatePresence,
} from "@/components/fx";

import {
  AreaTrend, BarSeries, LineSeries, DonutBreakdown, Sparkline, ChartFrame,
  seriesColor, SEQ_VARS,
} from "@/components/charts";

import { PageHeader } from "@/components/layout";
import { WalletConnectButton, TxModal } from "@/components/web3";
```

`PageHeader` is required at the top of every dashboard/admin page:
`<PageHeader title description actions breadcrumb badge />`.

## Data — never hardcode, always use a hook

```ts
import { useBalances, useGames, useStakingPools /* … */ } from "@/lib/hooks/use-data";
const { data, isLoading } = useBalances();
```

Full hook list is in `src/lib/hooks/use-data.ts`. Types are in `@/types`.
If you need data that has no hook, add a new `export const useX = () => useResource(...)`
to `use-data.ts` **only if that file is assigned to you**; otherwise derive it
from an existing hook inside your page.

Render `isLoading` with `Skeleton` / `SkeletonCard` / `DataTable loading`.
Render empty collections with `EmptyState` or `DataTable empty={{...}}`.

## Web3 — use the real hooks

```ts
import {
  useWallet, useMttBalance, useMttAllowance, useApproveMtt, useTokenStats,
  useStakingPools as _, useStakePosition, useStakeActions, useCommissionOnChain,
  useClaimCommission, useOnChainPools, usePoolCount,
} from "@/lib/hooks/use-web3";
```

Pattern for any on-chain write:

```tsx
const { stake, ...tx } = useStakeActions();
const [showTx, setShowTx] = useState(false);
// on submit: setShowTx(true); await stake(poolId, amount);
<TxModal open={showTx} onClose={() => setShowTx(false)} state={tx}
  title="Stake MTT" summary={<DetailRow label="Amount" value="…" />} />
```

Read hooks return `undefined` when no contract is configured — always fall back
to the mock value: `const shown = onChainBalance ?? balances.mttAvailable;`

## Compliance content is a feature, not boilerplate

This platform's whole design rests on one rule: **every payout is funded by real
platform revenue, never by another member's deposit.** Wherever a page touches
earnings, staking yield or referral commission it must say so plainly:

- Never print a fixed or guaranteed APR. Always label yield "variable,
  recalculated from Treasury inflows". Use `Callout` + `InfoHint`.
- Referral pages must state that referring is optional, free, capped, and never
  required to earn or withdraw.
- Commission line items must show which Treasury deposit funded them
  (`treasuryDepositRef`).
- Show cap usage with `CapMeter` wherever a cap exists.
- No income claims, no "earn $X/month" language anywhere.

## Style targets

- Dark-first. Test that light mode still reads (tokens handle it automatically).
- Responsive: mobile-first, real breakpoints. Tables use `Column.hideBelow`.
- Motion: `Reveal`/`RevealGroup` for section entrances, `TiltCard`/`SpotlightCard`
  for feature cards, `AnimatedCounter` for every headline number. Keep it
  purposeful — no animation on dense data tables.
- Accessibility: real `<button>`/`<a>`, `aria-label` on icon-only controls,
  `sr-only` captions on data tables, focus states inherited from globals.
- Numbers: always `tnum`, format with the helpers in `@/lib/utils`
  (`formatToken`, `formatCompact`, `formatCurrency`, `formatPercent`,
  `shortenAddress`, `shortenHash`, `timeAgo`, `formatDate`, `formatDuration`,
  `csvDownload`).

## File layout

Pages go in the route group you were assigned. Page-specific components go in a
`_components/` folder next to the page (Next.js ignores underscore folders for
routing), e.g. `src/app/(player)/app/staking/_components/pool-card.tsx`.

Every page file starts with a comment naming its FRD reference:

```tsx
/* S-01 · Staking Pools — FRD 5.6 */
```

Add `export const metadata = { title: "…" }` to every server page. If a page
needs client interactivity, either mark it `"use client"` (then drop `metadata`)
or keep the page as a server component and put interactivity in `_components`.
Prefer the second for pages with metadata.

## Web3 import boundary (IMPORTANT)

`@/lib/web3` is **server-safe** — constants, addresses, explorer URLs, ABIs. You
may import it from a server component:

```ts
import { contracts, isDeployed, addressUrl, txUrl, IS_TESTNET, CHAIN_ID,
         CONTRACTS_CONFIGURED, MTT_SYMBOL } from "@/lib/web3";
```

The wagmi config is client-only and lives at `@/lib/web3/wagmi`. Never import it
outside `src/app/providers.tsx`.

All the wagmi **hooks** are in `@/lib/hooks/use-web3` and are `"use client"` —
use them only inside client components.

## Verified working page pattern

Server page + client interactivity, which is what every public page uses:

```tsx
/* X-01 · Page Name — FRD 5.x */
import { PageHeader } from "@/components/layout";   // dashboard pages
import { InteractiveBit } from "./_components/interactive-bit";

export const metadata = { title: "Page name" };

export default function Page() {
  return (
    <>
      <PageHeader title="…" description="…" />
      <InteractiveBit />
    </>
  );
}
```

`_components/*.tsx` files that use hooks or state start with `"use client"`.
