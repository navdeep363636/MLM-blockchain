"use client";

/* ============================================================================
 * DATA ACCESS LAYER — the single seam between the UI and the backend.
 *
 * Every hook here returns `{ data, isLoading, error, refetch }` and nothing
 * else, which is what let the whole app be built against mock data and then
 * switched to a live API without touching a component. The signatures below are
 * unchanged from that mock version on purpose.
 *
 * Three rules hold throughout.
 *
 * `data` IS NEVER UNDEFINED. Every hook has an empty fallback — `[]`, or a zero
 * object — because the components index into these values directly. A hook that
 * can return undefined pushes a null check into every one of them, and the one
 * that gets forgotten is a white screen rather than an empty table.
 *
 * COMPOSITE VIEWS ARE COMPOSED HERE, NOT ON THE SERVER. `useBalances` needs the
 * wallet balance, today's points and a price; `useReferralSummary` needs stats
 * and a cap. Those are separate endpoints because they have different freshness
 * requirements — a balance is read live from the ledger on every call, a cap
 * rolls over monthly — and collapsing them server-side would impose the
 * strictest of those on all of it.
 *
 * MONEY IS CONVERTED FOR DISPLAY ONLY. The mappers turn DECIMAL(36,18) strings
 * into numbers so the existing components work. Every mutation in
 * `use-mutations.ts` sends the string the member typed, so no amount a user
 * submits is ever round-tripped through a float.
 * ========================================================================== */

import { useMemo } from "react";
import { keepPreviousData, useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { api, fetchAll, type Paginated } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import {
  EMPTY_BALANCES, num, pctOrNull, toAchievement, toAdminUser, toAuditEntry, toBalances,
  toCommissionEntry, toFraudAlert, toGame, toKycSubmission, toLeaderboardEntry, toLegalDocument,
  toMarketListing, toNotification, toPointsEntry, toQuest, toReferralNode, toReferralSummary,
  toQuestList, toRewardEntry, toStaffMember, toStakePosition, toStakingPool, toStoreItem,
  toTicket,
  toTournament, toTransaction, toTreasuryInflow, toTreasuryOutflow, toUser,
} from "@/lib/api/mappers";
import type {
  AchievementBoardResponse, AuditEntryResponse, BalanceResponse, CohortRetentionPoint,
  CommissionPlanResponse, CommissionResponse, ConversionCapsOverview, ConversionRateInfo,
  ConversionRateRow, DownlineNode, FraudAlertResponse, GameResponse, KycFunnelStage, KycQueueItem,
  LeaderboardResponse, LegalDocumentResponse, MarketListingResponse, MemberSummary, MeResponse,
  NotificationResponse, PayoutVsInflowPoint, PlatformKpis, PointsEntryResponse, PointsRuleResponse,
  PointsSummary, PublicConfig, PublicStats, QuestBoardResponse, ReferralCap, ReferralStats,
  RevenueByStreamPoint, RolePermissionResponse, StaffIdentity, StaffMemberResponse,
  StakePositionsResponse, StakingPoolResponse, StakingRewardResponse, StakingTvlPoint,
  StoreItemResponse, TicketResponse, TournamentResponse, TransactionResponse, TreasuryDashboard,
  TreasuryInflowResponse, TreasuryOutflowResponse, WalletAddressResponse,
} from "@/lib/api/types";
import { useAuth } from "@/lib/auth/auth-context";
import type {
  Achievement, AppNotification, AuditLogEntry, Balances, CommissionConfig, CommissionEntry,
  ConversionRateConfig, FraudAlert, Game, KycSubmission, LeaderboardEntry, LegalDocument,
  MarketListing, PointsEntry, PointsRule, Quest, ReferralNode, ReferralSummary, RewardEntry,
  StaffMember, StakePosition, StakingPool, StoreItem, Ticket, Tournament, Transaction,
  TreasuryInflow, TreasuryOutflow, User,
} from "@/types";

export interface Resource<T> {
  data: T;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/* --------------------------------- plumbing ------------------------------- */

/**
 * How long a value may be served from cache before it is refetched in the
 * background. Tuned by how quickly the number goes wrong, not by how often it is
 * read.
 */
const FRESH = {
  /** Balances and anything derived from them. Effectively live. */
  money: 2_000,
  /** Ledgers and lists: append-only, so a few seconds behind is harmless. */
  ledger: 15_000,
  /** Catalogue and config: changes when an operator changes it. */
  config: 5 * 60_000,
  /** Monthly series. The server caches these as well. */
  series: 60_000,
} as const;

type Opts<T> = Omit<UseQueryOptions<T, Error, T>, "queryKey" | "queryFn">;

/**
 * The one adapter between react-query and the `Resource` shape.
 *
 * `fallback` is a required argument rather than an optional one, so that adding
 * a hook forces a decision about what the screen shows before the first byte
 * arrives.
 */
function useResource<T>(
  key: readonly unknown[],
  fetcher: () => Promise<T>,
  fallback: T,
  opts: Opts<T> = {},
): Resource<T> {
  const query = useQuery<T, Error, T>({
    queryKey: key,
    queryFn: fetcher,
    staleTime: FRESH.ledger,
    /* One retry. A second and third turn a server hiccup into a five-second
     * spinner, and every one of these hooks has a visible loading state. */
    retry: 1,
    ...opts,
  });

  return {
    data: query.data ?? fallback,
    isLoading: query.isPending,
    error: query.error ?? null,
    refetch: () => void query.refetch(),
  };
}

/** Hooks that need a signed-in member. Anonymous callers never fire a request. */
function useAuthedResource<T>(
  key: readonly unknown[],
  fetcher: () => Promise<T>,
  fallback: T,
  opts: Opts<T> = {},
): Resource<T> {
  const { phase, sessionReady } = useAuth();
  /* Gate on the bearer token, not on the profile. `/users/me` runs in parallel
   * with these requests, so waiting for `phase` to reach "authenticated" costs
   * every authenticated screen one extra round trip before it starts loading. */
  const authed = sessionReady;
  const res = useResource(key, fetcher, fallback, {
    ...opts,
    enabled: authed && opts.enabled !== false,
  });
  return {
    ...res,
    /* While the session is still resolving, report loading rather than "empty".
     * Otherwise every authenticated screen flashes its empty state on load. */
    isLoading: (phase === "loading" && !authed) || (authed && res.isLoading),
  };
}

/**
 * For a hook whose key contains a control the reader can change — a leaderboard
 * period, a chart's month window.
 *
 * Without it, switching the control unmounts the chart back to a skeleton and
 * then re-mounts it, so the reader loses the thing they were comparing against
 * at the exact moment they wanted to compare. With it, the previous series stays
 * on screen until the new one lands and the swap is a redraw.
 *
 * Deliberately NOT the default in `useResource`. Most hooks here are keyed on
 * nothing at all — this app filters and paginates already-fetched lists on the
 * client — and for the few keyed on an identity rather than a control
 * (`useLegalDocument(slug)`) holding the previous value would show one
 * document's text under another's heading.
 */
const KEEP_PREVIOUS = { placeholderData: keepPreviousData } as const;

const page = <T,>(res: Paginated<T> | T[] | null | undefined): T[] =>
  Array.isArray(res) ? res : (res?.data ?? []);

/* ------------------------------ query specs -------------------------------
 * A hook can only start its request once the component holding it has mounted,
 * and that component only mounts once the router has committed the navigation.
 * Measured on in-app navigations against a 120ms API, that put the FIRST byte of
 * the destination's data ~105ms after the click — every time, before the network
 * had even been asked for anything.
 *
 * So the fetcher and the cache key are declared here, as data, and the hook is a
 * thin consumer of the same declaration. `route-prefetch.ts` maps routes to
 * these and NavLink runs them on hover, which moves the request to the moment a
 * click becomes likely rather than the moment it has already happened. One
 * definition for both paths, so a prefetch cannot drift into fetching something
 * subtly different from what the page then reads out of the cache.
 *
 * Only the queries on routes people actually navigate to under load are declared
 * this way. For the rest the indirection would cost more than the wait it saves.
 * ------------------------------------------------------------------------- */

export interface QuerySpec<T> {
  queryKey: readonly unknown[];
  queryFn: () => Promise<T>;
  staleTime?: number;
  /** Skipped when there is no session, exactly as `useAuthedResource` would. */
  authed: boolean;
}

const q = <T,>(
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
  /* Defaulted, not left undefined. A spec carries its freshness to BOTH callers
   * — the hook and the prefetch — and an undefined staleTime is not "use the
   * default", it is react-query's 0, which marks the value stale the instant it
   * lands. That made every prefetch worthless: the data arrived, the component
   * mounted, saw stale data and immediately fetched it again. Measured as the
   * request count going UP on hover rather than the wait going down. */
  { staleTime = FRESH.ledger, authed = true }: { staleTime?: number; authed?: boolean } = {},
): QuerySpec<T> => ({ queryKey, queryFn, staleTime, authed });

export const Q = {
  balance: q(qk.balance(), () => api.get<BalanceResponse | null>("/wallet/balance"),
    { staleTime: FRESH.money }),
  pointsSummary: q(qk.pointsSummary(), () => api.get<PointsSummary | null>("/points/summary"),
    { staleTime: FRESH.money }),
  transactions: q(qk.transactions(), async () =>
    page(await api.get<Paginated<TransactionResponse>>("/wallet/transactions", { query: { limit: 100 } }))
      .map(toTransaction)),
  pointsHistory: q(qk.pointsHistory(), async () =>
    page(await api.get<Paginated<PointsEntryResponse>>("/points/history", { query: { limit: 100 } }))),
  games: q(qk.games(), async () =>
    page(await api.get<Paginated<GameResponse>>("/games", { query: { limit: 100 } })).map(toGame),
    { staleTime: FRESH.config, authed: false }),
  tournaments: q(qk.tournaments(), async () =>
    page(await api.get<Paginated<TournamentResponse>>("/tournaments", { query: { limit: 100 } }))
      .map(toTournament),
    { staleTime: FRESH.config, authed: false }),
  stakingPools: q(qk.stakingPools(), async () =>
    page(await api.get<Paginated<StakingPoolResponse>>("/staking/pools")).map(toStakingPool),
    { staleTime: FRESH.config, authed: false }),
  stakePositions: q(qk.stakePositions(), async () =>
    ((await api.get<StakePositionsResponse>("/staking/positions"))?.positions ?? []).map(toStakePosition),
    { staleTime: FRESH.money }),
  stakingRewards: q(qk.stakingRewards(), async () =>
    page(await api.get<Paginated<StakingRewardResponse>>("/staking/rewards", { query: { limit: 100 } }))),
  referralStats: q(qk.referralStats(), () => api.get<ReferralStats | null>("/referral/stats")),
  referralCap: q(qk.referralCap(), () => api.get<ReferralCap | null>("/referral/cap")),
  commissions: q(qk.commissions(), async () =>
    page(await api.get<Paginated<CommissionResponse>>("/referral/commissions", { query: { limit: 100 } }))
      .map(toCommissionEntry)),
  referralDownline: q(qk.referralDownline(), async () =>
    page(await api.get<Paginated<DownlineNode> | DownlineNode[]>("/referral/downline", { query: { limit: 200 } }))
      .map((n, i) => toReferralNode(n, i))),
  notifications: q(qk.notifications(), async () =>
    page(await api.get<Paginated<NotificationResponse>>("/notifications", { query: { limit: 50 } }))
      .map(toNotification)),
  adminKpis: q(qk.adminKpis(), () => api.get<PlatformKpis | null>("/admin/kpis"),
    { staleTime: FRESH.money }),
  adminMembers: q(qk.adminMembers(), async () =>
    (await fetchAll<MemberSummary>("/admin/members", {}, 100, 5)).map(toAdminUser)),
  adminKycQueue: q(qk.adminKycQueue(), async () =>
    page(await api.get<Paginated<KycQueueItem>>("/kyc/admin/queue", { query: { limit: 100 } }))
      .map(toKycSubmission)),
  adminStaff: q(qk.adminStaff(), async () =>
    (await api.get<StaffMemberResponse[]>("/admin/staff")).map(toStaffMember),
    { staleTime: FRESH.config }),
} as const;

/**
 * Runs a spec through the same cache, fallback and auth gate the hooks use, so
 * a hook built on a spec behaves identically to one written out longhand.
 */
function useSpec<T>(spec: QuerySpec<T>, fallback: T, opts: Opts<T> = {}): Resource<T> {
  const { phase, sessionReady } = useAuth();
  /* See `useAuthedResource` — the token, not the profile, is what a request needs. */
  const signedIn = sessionReady;
  const res = useResource(spec.queryKey, spec.queryFn, fallback, {
    ...(spec.staleTime === undefined ? {} : { staleTime: spec.staleTime }),
    ...opts,
    enabled: (!spec.authed || signedIn) && opts.enabled !== false,
  });
  if (!spec.authed) return res;
  /* While the session is still resolving, report loading rather than "empty" —
     otherwise every authenticated screen flashes its empty state on load. */
  return { ...res, isLoading: (phase === "loading" && !signedIn) || (signedIn && res.isLoading) };
}

/* ================================ Player scope ============================ */

const EMPTY_USER: User = {
  id: "", displayName: "", fullName: "", email: "", phone: "", country: "", dateOfBirth: "",
  avatarUrl: null, status: "unverified", kycTier: "none", twoFactorEnabled: false,
  walletAddress: null, walletType: null, referralCode: "", referredBy: null,
  joinedAt: "", lastActiveAt: "", riskScore: 0, riskFlags: [],
};

/**
 * The signed-in member.
 *
 * Reads from the auth context rather than issuing its own request: the provider
 * already fetched the profile to decide whether there is a session at all, and
 * a second fetch here would double every page load for no new information.
 */
export const useCurrentUser = (): Resource<User> => {
  const { user, phase, reload } = useAuth();
  const data = useMemo(() => (user ? toUser(user) : EMPTY_USER), [user]);
  return {
    data,
    isLoading: phase === "loading",
    error: null,
    refetch: () => void reload(),
  };
};

/**
 * The wallet, in the shape the UI wants.
 *
 * Three reads: the live balance, today's points, and the MTT price. Combined
 * here because the components want one object, and kept as separate requests
 * because the balance must not be cached for more than a moment while the other
 * two comfortably can be.
 */
export function useBalances(): Resource<Balances> {
  const balance = useSpec(Q.balance, null as BalanceResponse | null);
  const points = useSpec(Q.pointsSummary, null as PointsSummary | null);
  const rate = useMttPrice();

  const data = useMemo(
    () =>
      balance.data
        ? toBalances(balance.data, num(points.data?.earnedToday), rate.data)
        : EMPTY_BALANCES,
    [balance.data, points.data, rate.data],
  );

  return {
    data,
    isLoading: balance.isLoading,
    error: balance.error ?? points.error,
    refetch: () => {
      balance.refetch();
      points.refetch();
    },
  };
}

/**
 * MTT in USD.
 *
 * There is no price feed wired up, and there must not be a hard-coded one: a
 * made-up rate turns every fiat figure on every screen into a fabrication. Until
 * a feed exists this resolves to 0, and the formatters omit the fiat line when
 * the rate is zero rather than printing "$0.00". This is the single place to
 * change when a feed arrives.
 */
export function useMttPrice(): Resource<number> {
  return useResource(["mtt-price"], async () => 0, 0, { staleTime: FRESH.config });
}

export const useGames = (): Resource<Game[]> =>
  useSpec(Q.games, [] as Game[]);

export const useTournaments = (): Resource<Tournament[]> =>
  useSpec(Q.tournaments, [] as Tournament[]);

/**
 * A leaderboard.
 *
 * AUTHENTICATED, not public. A board shows other members' chosen display names,
 * and `you` is the caller's own standing — both of which need a caller. The
 * endpoint requires a session, so firing this for a signed-out visitor was a
 * guaranteed 401 rather than a public page.
 */
export const useLeaderboard = (
  metric = "points",
  period = "weekly",
): Resource<LeaderboardEntry[]> =>
  useAuthedResource(
    qk.leaderboard(metric, period),
    async () =>
      /* The response is an object with `rows` plus the caller's own standing — not
       * a page. `you` is appended when it falls outside the returned window, so a
       * member always sees where they stand even at rank 4,000. */
      (async () => {
        const res = await api.get<LeaderboardResponse>("/leaderboard", {
          query: { metric, period, limit: 100 },
        });
        const rows = (res?.rows ?? []).map(toLeaderboardEntry);
        const you = res?.you;
        return you && !rows.some((r) => r.isCurrentUser)
          ? [...rows, toLeaderboardEntry(you)]
          : rows;
      })(),
    [],
    KEEP_PREVIOUS,
  );

export const useQuests = (): Resource<Quest[]> =>
  useAuthedResource(
    qk.quests(),
    async () =>
      toQuestList(await api.get<QuestBoardResponse>("/quests")),
    [],
  );

export const useAchievements = (): Resource<Achievement[]> =>
  useAuthedResource(
    qk.achievements(),
    async () =>
      ((await api.get<AchievementBoardResponse>("/quests/achievements"))?.achievements ?? [])
        .map(toAchievement),
    [],
  );

/**
 * The Points ledger.
 *
 * The ledger carries `gameId`, not a title, so the game catalogue is joined here
 * — one cached read shared with every other screen — rather than the API
 * denormalising a title onto every row it would then have to keep in sync.
 */
export const usePointsHistory = (): Resource<PointsEntry[]> => {
  const games = useGames();
  const titles = useMemo(() => new Map(games.data.map((g) => [g.id, g.title])), [games.data]);
  const res = useSpec(Q.pointsHistory, [] as PointsEntryResponse[]);
  const data = useMemo(() => res.data.map((r) => toPointsEntry(r, titles)), [res.data, titles]);
  return { data, isLoading: res.isLoading, error: res.error, refetch: res.refetch };
};

export const useTransactions = (): Resource<Transaction[]> =>
  useSpec(Q.transactions, [] as Transaction[]);

export const useStakingPools = (): Resource<StakingPool[]> =>
  useSpec(Q.stakingPools, [] as StakingPool[]);

export const useStakePositions = (): Resource<StakePosition[]> =>
  useSpec(Q.stakePositions, [] as StakePosition[]);

/** Reward rows carry a pool id; the name comes from the pool list. */
export const useRewardHistory = (): Resource<RewardEntry[]> => {
  const pools = useStakingPools();
  const names = useMemo(() => new Map(pools.data.map((p) => [p.poolId, p.name])), [pools.data]);
  const res = useSpec(Q.stakingRewards, [] as StakingRewardResponse[]);
  const data = useMemo(() => res.data.map((r) => toRewardEntry(r, names)), [res.data, names]);
  return { data, isLoading: res.isLoading, error: res.error, refetch: res.refetch };
};

const EMPTY_CAP: ReferralCap = {
  monthKey: "", capAmount: "0", usedAmount: "0", remainingAmount: "0", cappedAwayAmount: "0",
  trailingSpend: "0", entryCount: 0, absoluteCap: "0", capMultiplier: "0", capBase: "0",
};

const EMPTY_REFERRAL_SUMMARY: ReferralSummary = {
  code: "", link: "", directCount: 0, totalDownline: 0, byLevel: [],
  earnedLifetime: 0, earnedThisMonth: 0, monthlyCap: 0, monthlyCapUsed: 0,
};

/** Stats and the monthly cap, composed. The cap is why a member is told they stopped earning. */
export function useReferralSummary(): Resource<ReferralSummary> {
  const stats = useSpec(Q.referralStats, null as ReferralStats | null);
  const cap = useSpec(Q.referralCap, null as ReferralCap | null);

  /* Built from the running origin rather than a configured base URL: a referral
   * link that points at production while you are testing on staging is a bug only
   * a member will find. */
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const data = useMemo(
    () =>
      stats.data ? toReferralSummary(stats.data, cap.data ?? EMPTY_CAP, origin) : EMPTY_REFERRAL_SUMMARY,
    [stats.data, cap.data, origin],
  );

  return {
    data,
    isLoading: stats.isLoading || cap.isLoading,
    error: stats.error ?? cap.error,
    refetch: () => {
      stats.refetch();
      cap.refetch();
    },
  };
}

export const useReferralTree = (): Resource<ReferralNode[]> =>
  useSpec(Q.referralDownline, [] as ReferralNode[]);

export const useCommissionHistory = (): Resource<CommissionEntry[]> =>
  useSpec(Q.commissions, [] as CommissionEntry[]);

export const useNotifications = (): Resource<AppNotification[]> =>
  useSpec(Q.notifications, [] as AppNotification[]);

export const useTickets = (): Resource<Ticket[]> =>
  useAuthedResource(
    qk.tickets(),
    async () =>
      page(await api.get<Paginated<TicketResponse>>("/support/tickets", { query: { limit: 50 } }))
        .map(toTicket),
    [],
  );

export const useStoreItems = (): Resource<StoreItem[]> =>
  useResource(
    qk.storeItems(),
    async () =>
      page(await api.get<Paginated<StoreItemResponse>>("/store/items", { query: { limit: 100 } }))
        .map(toStoreItem),
    [],
    { staleTime: FRESH.config },
  );

/**
 * The P2P marketplace.
 *
 * AUTHENTICATED: every listing carries `isYours`, which only means something for
 * a known caller, and the endpoint requires a session. `useStoreItems` above is
 * the public one — the catalogue is browsable without an account, the
 * member-to-member market is not.
 */
export const useMarketListings = (): Resource<MarketListing[]> =>
  useAuthedResource(
    qk.market(),
    async () =>
      page(await api.get<Paginated<MarketListingResponse>>("/store/market", { query: { limit: 100 } }))
        .map(toMarketListing),
    [],
  );

/* --------------------------- Configuration reads -------------------------- */

/**
 * The economics the UI needs but must not carry in the bundle.
 *
 * Everything below is a POLICY value — a rate, a cap, a minimum, a cooling-off
 * period. Each one was a constant in the mock build, and a constant in a bundle
 * is a number that goes stale the moment an operator changes it, silently, on
 * every screen at once. They come from the API now.
 */

/** The active conversion rate and the next scheduled one, for the rate banner. */
export const useConversionRate = (): Resource<ConversionRateInfo> =>
  useResource(
    qk.conversionRate(),
    () => api.get<ConversionRateInfo>("/conversion/rate"),
    { pointsPerMtt: 0, effectiveFrom: "", nextPointsPerMtt: null, nextEffectiveFrom: null },
    { staleTime: 30_000 },
  );

/** Per-member conversion caps and what is left of them today and this month. */
export const useConversionSummary = (): Resource<Record<string, unknown>> =>
  useAuthedResource(
    qk.conversionSummary(),
    () => api.get<Record<string, unknown>>("/conversion/summary"),
    {},
  );

/**
 * The member's linked withdrawal addresses.
 *
 * The API has always served this and nothing read it, which is why the withdraw
 * screen offered a free-text address field: it had no way to show which
 * addresses were actually linked. `withdrawable` is false while an address is
 * inside its cooling-off window, and `withdrawableAt` says when that ends — both
 * come from the server, because the window length is per-environment.
 */
export const useWalletAddresses = (): Resource<WalletAddressResponse[]> =>
  useAuthedResource(
    qk.walletAddresses(),
    /* The endpoint returns a bare array. `page()` anyway, because a payload that
       is not the shape the screen assumes should degrade to "no addresses" — the
       withdraw page calls .filter on this, and an unexpected object took the whole
       route to its error boundary rather than showing an empty list. */
    async () => page(await api.get<WalletAddressResponse[]>("/wallet/addresses")),
    [],
    { staleTime: FRESH.money },
  );

/** Withdrawal minimums, ceilings and the cooling-off period for this member's tier. */
export const useWithdrawalLimits = (): Resource<Record<string, unknown>> =>
  useAuthedResource(
    qk.withdrawalLimits(),
    () => api.get<Record<string, unknown>>("/wallet/withdrawals/limits"),
    {},
    { staleTime: FRESH.config },
  );

/** Daily points caps, per member and per game. */
export const usePointsCaps = (): Resource<Record<string, unknown>> =>
  useAuthedResource(
    qk.pointsCaps(),
    () => api.get<Record<string, unknown>>("/points/caps"),
    {},
    { staleTime: FRESH.config },
  );

/** Marketplace rules: fees, price bounds, listing lifetime. */
export const useMarketPolicy = (): Resource<Record<string, unknown>> =>
  useResource(
    qk.marketPolicy(),
    () => api.get<Record<string, unknown>>("/store/market/policy"),
    {},
    { staleTime: FRESH.config },
  );

/** Published legal documents. The bundle no longer carries their text. */
export const useLegalDocuments = (): Resource<LegalDocument[]> =>
  useResource(
    qk.legalDocuments(),
    async () =>
      page(await api.get<Paginated<LegalDocumentResponse>>("/legal/documents", { query: { limit: 50 } }))
        .map(toLegalDocument),
    [],
    { staleTime: FRESH.config },
  );

export const useLegalDocument = (slug: string): Resource<LegalDocument | null> =>
  useResource(
    qk.legalDocument(slug),
    async () => toLegalDocument(await api.get<LegalDocumentResponse>(`/legal/documents/${slug}`)),
    null,
    { staleTime: FRESH.config, enabled: Boolean(slug) },
  );

/* ================================ Admin scope ============================= */

/**
 * The operator's own record, permissions and eligible second approvers.
 *
 * The approver list comes from the server rather than being filtered here. The
 * UI asking "who may second-approve me" and the server deciding "is this
 * approval valid" have to agree; letting the browser decide is how a form offers
 * an ineligible approver and the submission fails at the last step.
 */
export const useStaffIdentity = (): Resource<StaffIdentity | null> =>
  useAuthedResource(qk.adminMe(), () => api.get<StaffIdentity>("/admin/me"), null, {
    staleTime: FRESH.config,
  });

/**
 * The dashboard's view of the KPI response.
 *
 * Field names are kept from the version this app was built against so the
 * dashboard did not have to be rewritten, but two of them are worth naming
 * honestly:
 *
 *  - `mttCirculating` is the platform's LIABILITY to members, not a token supply
 *    figure. For custodial balances those are different numbers, and the one an
 *    operator needs on this screen is what is owed.
 *  - `dauDelta` / `mauDelta` are undefined when there is no prior period to
 *    compare against. The stat component renders that as no change at all rather
 *    than as 0%, which would be a claim we cannot make on a platform's first day.
 */
export interface AdminKpiView {
  dau: number;
  mau: number;
  dauDelta?: number;
  mauDelta?: number;
  pointsIssued30d: number;
  mttCirculating: number;
  mttStaked: number;
  treasuryBalanceMtt: number;
  pendingWithdrawals: number;
  pendingWithdrawalsMtt: number;
  openKycQueue: number;
  openTickets: number;
  openFraudAlerts: number;
  commissionPayoutRatio: number;
  stakingPayoutRatio: number;
  realRevenueFundedPct: number;
  commissionSolvent: boolean;
  attentionRequired: string[];
  pendingApprovals: number;
  breachedTickets: number;
  members: number;
  kycVerified: number;
  frozen: number;
  withdrawalsInReview: number;
  queuedCommissionMtt: number;
}

const EMPTY_KPIS: AdminKpiView = {
  dau: 0, mau: 0, pointsIssued30d: 0, mttCirculating: 0, mttStaked: 0, treasuryBalanceMtt: 0,
  pendingWithdrawals: 0, pendingWithdrawalsMtt: 0, openKycQueue: 0, openTickets: 0,
  openFraudAlerts: 0, commissionPayoutRatio: 0, stakingPayoutRatio: 0, realRevenueFundedPct: 0,
  commissionSolvent: true, attentionRequired: [], pendingApprovals: 0, breachedTickets: 0,
  members: 0, kycVerified: 0, frozen: 0, withdrawalsInReview: 0, queuedCommissionMtt: 0,
};

function toKpiView(k: PlatformKpis | null): AdminKpiView {
  if (!k) return EMPTY_KPIS;
  return {
    dau: k.activeMembersToday,
    mau: k.activeMembers30d,
    dauDelta: k.activeTodayDeltaPct ?? undefined,
    mauDelta: k.active30dDeltaPct ?? undefined,
    pointsIssued30d: num(k.pointsIssued30d),
    mttCirculating: num(k.mttLiability),
    mttStaked: num(k.mttStaked),
    treasuryBalanceMtt: num(k.treasuryHeadroomMtt),
    pendingWithdrawals: k.pendingWithdrawals,
    pendingWithdrawalsMtt: num(k.pendingWithdrawalsMtt),
    openKycQueue: k.openKycQueue,
    openTickets: k.openTickets,
    openFraudAlerts: k.openFraudAlerts,
    /* The gauges do arithmetic on these, so null becomes 0 here. That is
     * defensible for a RATIO in a way it is not for a delta: no payouts against
     * no revenue really is a 0% payout ratio. */
    commissionPayoutRatio: pctOrNull(k.commissionPayoutRatioPct) ?? 0,
    stakingPayoutRatio: pctOrNull(k.stakingOutflowRatioPct) ?? 0,
    realRevenueFundedPct: pctOrNull(k.revenueFundedPct) ?? 0,
    commissionSolvent: k.commissionSolvent,
    attentionRequired: k.attentionRequired ?? [],
    pendingApprovals: k.pendingApprovals,
    breachedTickets: k.breachedTickets,
    members: k.members,
    kycVerified: k.kycVerified,
    frozen: k.frozen,
    withdrawalsInReview: k.withdrawalsInReview,
    queuedCommissionMtt: num(k.queuedCommissionMtt),
  };
}

export const useAdminKpis = (): Resource<AdminKpiView> => {
  const res = useSpec(Q.adminKpis, null as PlatformKpis | null);
  const data = useMemo(() => toKpiView(res.data), [res.data]);
  return { data, isLoading: res.isLoading, error: res.error, refetch: res.refetch };
};

export const useAdminUsers = (): Resource<User[]> =>
  useSpec(Q.adminMembers, [] as User[]);

export const useKycQueue = (): Resource<KycSubmission[]> =>
  useSpec(Q.adminKycQueue, [] as KycSubmission[]);

export const useTreasuryInflows = (): Resource<TreasuryInflow[]> =>
  useAuthedResource(
    qk.adminTreasuryInflows(),
    async () =>
      page(
        await api.get<Paginated<TreasuryInflowResponse>>("/admin/treasury/inflows", {
          query: { limit: 100 },
        }),
      ).map(toTreasuryInflow),
    [],
  );

export const useTreasuryOutflows = (): Resource<TreasuryOutflow[]> =>
  useAuthedResource(
    qk.adminTreasuryOutflows(),
    async () =>
      page(
        await api.get<Paginated<TreasuryOutflowResponse>>("/admin/treasury/outflows", {
          query: { limit: 100 },
        }),
      ).map(toTreasuryOutflow),
    [],
  );

export interface TreasuryTotalsView {
  reconciledInflow: number;
  unreconciledInflow: number;
  totalOutflow: number;
  commissionOutflow: number;
  stakingOutflow: number;
  headroom: number;
  utilisationPct: number;
}

const EMPTY_TREASURY_TOTALS: TreasuryTotalsView = {
  reconciledInflow: 0, unreconciledInflow: 0, totalOutflow: 0, commissionOutflow: 0,
  stakingOutflow: 0, headroom: 0, utilisationPct: 0,
};

/**
 * The treasury headline figures for the current period.
 *
 * `utilisationPct` is outflow over RECONCILED inflow — money that actually
 * arrived. Using gross revenue as the denominator would make the platform look
 * better funded than it is, and this is the figure the four-eyes block on
 * treasury funding depends on being right.
 */
export const useTreasuryTotals = (): Resource<TreasuryTotalsView> => {
  const res = useAuthedResource(
    qk.adminTreasuryDashboard(),
    () => api.get<TreasuryDashboard>("/admin/treasury/dashboard"),
    null as TreasuryDashboard | null,
  );

  const data = useMemo<TreasuryTotalsView>(() => {
    const d = res.data;
    if (!d) return EMPTY_TREASURY_TOTALS;
    /* Field names are the server's: `commissionOutflow` / `stakingOutflow` /
     * `totalOutflow`. This used to read `commissionPoolOut` / `stakingPoolOut` /
     * `reserveOut`, none of which exist on the contract, so every outflow figure
     * and the utilisation gauge read zero — on the one screen whose job is to
     * show whether payouts are outrunning revenue. */
    const reconciled = num(d.reconciledInflow);
    const commission = num(d.commissionOutflow);
    const staking = num(d.stakingOutflow);
    return {
      reconciledInflow: reconciled,
      unreconciledInflow: num(d.unreconciledInflow),
      /* The server totals this itself, including anything the two named pools do
       * not cover. Re-deriving it from the parts would drift the moment a third
       * destination is added. */
      totalOutflow: num(d.totalOutflow),
      commissionOutflow: commission,
      stakingOutflow: staking,
      headroom: num(d.headroom),
      /* The server publishes this ratio in bps and it is the figure the payout
       * ceiling is enforced on, so it is read rather than recomputed — a second
       * implementation of the number a compliance gate depends on is one that can
       * disagree with the gate. */
      utilisationPct: Number((d.payoutRatioBps / 100).toFixed(1)),
    };
  }, [res.data]);

  return { data, isLoading: res.isLoading, error: res.error, refetch: res.refetch };
};

export const useFraudAlerts = (): Resource<FraudAlert[]> =>
  useAuthedResource(
    qk.adminFraudAlerts(),
    async () =>
      page(await api.get<Paginated<FraudAlertResponse>>("/admin/fraud/alerts", { query: { limit: 100 } }))
        .map(toFraudAlert),
    [],
  );

export const useStaff = (): Resource<StaffMember[]> =>
  useSpec(Q.adminStaff, [] as StaffMember[]);

/**
 * Staff id → display name.
 *
 * Several back-office contracts identify an actor by id and nothing else — the
 * audit trail, the conversion-rate proposals, the treasury approvals. None of
 * them embed a name, on purpose: a name copied onto an append-only row is a name
 * that goes stale. The staff directory is one cached read shared across every
 * screen that needs to put a person against an id.
 */
function useStaffNames(): Map<string, string> {
  const staff = useStaff();
  return useMemo(() => new Map(staff.data.map((s) => [s.id, s.name])), [staff.data]);
}

/**
 * The audit trail.
 *
 * The actor is an ID on this contract, so the name is resolved here. Falling back
 * to the raw id matters: "who did this" must never render as blank on an
 * append-only compliance record, even for a staff account that has since been
 * removed from the directory.
 */
export const useAuditLog = (): Resource<AuditLogEntry[]> => {
  const staffNames = useStaffNames();
  const res = useAuthedResource(
    qk.adminAudit(),
    async () =>
      page(await api.get<Paginated<AuditEntryResponse>>("/admin/audit", { query: { limit: 100 } })),
    [] as AuditEntryResponse[],
  );
  const data = useMemo(() => res.data.map((a) => toAuditEntry(a, staffNames)), [res.data, staffNames]);
  return { data, isLoading: res.isLoading, error: res.error, refetch: res.refetch };
};

function normaliseRateStatus(status: string): ConversionRateConfig["status"] {
  if (status === "active" || status === "scheduled" || status === "superseded") return status;
  return "pending_approval";
}

export const useConversionRates = (): Resource<ConversionRateConfig[]> => {
  const staffNames = useStaffNames();
  const res = useAuthedResource(
    qk.adminConversionRates(),
    async () =>
      page(
        await api.get<Paginated<ConversionRateRow>>("/admin/conversion/rates", { query: { limit: 50 } }),
      ),
    [] as ConversionRateRow[],
  );

  /* Proposer and approver are IDS on this contract, not names — the rate row does
   * not carry staff names, and reading `proposedByName` left both columns
   * permanently blank. Resolved against the staff directory the screen already
   * loads. The join is a memo rather than part of the fetcher so the rate list is
   * not refetched every time the directory settles. */
  const data = useMemo<ConversionRateConfig[]>(
    () =>
      res.data.map((r) => ({
        pointsPerMtt: r.pointsPerMtt,
        effectiveFrom: r.effectiveFrom,
        proposedBy: staffNames.get(r.proposedById) ?? r.proposedById,
        approvedBy: r.approvedById
          ? staffNames.get(r.approvedById) ?? r.approvedById
          : undefined,
        status: normaliseRateStatus(r.status),
      })),
    [res.data, staffNames],
  );

  return { data, isLoading: res.isLoading, error: res.error, refetch: res.refetch };
};

const EMPTY_COMMISSION_CONFIG: CommissionConfig = {
  levels: [], eligibleTypes: [], monthlyCapAbsolute: 0, monthlyCapMultiplier: 0,
  monthlyCapBase: 0, maxDepth: 0, minAccountAgeDays: 0, minGameplaySessions: 0,
};

/**
 * The active commission plan, as configuration.
 *
 * The API returns plan VERSIONS — the whole history, with proposal and approval
 * state — because that is what the four-eyes screen needs. The calculators and
 * the public referral page want the one that is live, so the active version is
 * picked here rather than in three separate components.
 */
export const useCommissionConfig = (): Resource<CommissionConfig> => {
  const res = useAuthedResource(
    qk.adminCommissionPlans(),
    async () =>
      page(
        await api.get<Paginated<CommissionPlanResponse>>("/admin/referral/plans", { query: { limit: 20 } }),
      ),
    [] as CommissionPlanResponse[],
    { staleTime: FRESH.config },
  );

  const data = useMemo<CommissionConfig>(() => {
    const active = res.data.find((p) => p.status === "active") ?? res.data[0];
    if (!active) return EMPTY_COMMISSION_CONFIG;
    /* The plan's rates are FLAT fields on the wire — l1Bps, l2Bps, l3Bps — not a
     * `levels` array. Reading `active.levels.map(...)` threw a TypeError inside
     * this memo, which is to say during render, which is to say the whole admin
     * commission route rendered nothing at all.
     *
     * `maxDepth` decides how many of the three are in force: a plan capped at two
     * levels must not advertise a level-3 rate it will never pay. */
    const rates = [active.l1Bps, active.l2Bps, active.l3Bps];
    return {
      levels: rates.slice(0, Math.max(0, Math.min(3, active.maxDepth))).map((bps, i) => ({
        level: (i + 1) as 1 | 2 | 3,
        ratePct: bps / 100,
      })),
      /* `eligibleTriggers` server-side. Same values, different name. */
      eligibleTypes: active.eligibleTriggers as CommissionConfig["eligibleTypes"],
      /* The cap fields are fiat-denominated and are NOT suffixed `Mtt`. */
      monthlyCapAbsolute: num(active.monthlyCapAbsolute),
      monthlyCapMultiplier: num(active.capMultiplier),
      monthlyCapBase: num(active.capBase),
      maxDepth: active.maxDepth,
      minAccountAgeDays: active.minAccountAgeDays,
      minGameplaySessions: active.minGameplaySessions,
    };
  }, [res.data]);

  return { data, isLoading: res.isLoading, error: res.error, refetch: res.refetch };
};

/**
 * The conversion ceilings in force, for the operator screen.
 *
 * `globalDailyPoints` can be null, meaning no platform-wide brake is configured.
 * The gauge treats that as "no limit set" rather than as a limit of zero, which
 * would show a permanently breached bar.
 */
/**
 * Every legal document, in every state — including drafts.
 *
 * Distinct from `useLegalDocuments`, which is the PUBLIC list and only serves
 * what Compliance has published. The CMS screen needs to see a draft in order to
 * submit it for review, and the public page must never see one.
 */
export const useAdminLegalDocuments = (): Resource<LegalDocument[]> =>
  useAuthedResource(
    qk.adminLegalDocuments(),
    async () =>
      page(
        await api.get<Paginated<LegalDocumentResponse>>("/admin/legal/documents", {
          query: { limit: 50 },
        }),
      ).map(toLegalDocument),
    [],
    { staleTime: FRESH.config },
  );

export const useAdminConversionCaps = (): Resource<ConversionCapsOverview> =>
  useAuthedResource(
    qk.adminConversionCaps(),
    () => api.get<ConversionCapsOverview>("/admin/conversion/caps"),
    {
      perUserDailyPoints: 0, perUserMonthlyPoints: 0, globalDailyPoints: null,
      globalDailyUsedPoints: "0", globalDailyConversions: 0,
    },
    { staleTime: FRESH.money },
  );

/**
 * The RBAC matrix, grouped by role.
 *
 * The module list is derived from the rows the server returns rather than being
 * a constant here. A hard-coded list of modules goes stale the moment a module is
 * added, and the failure is silent — the new module simply never appears on the
 * roles screen, so nobody can grant access to it.
 */
export const useRolePermissions = () => {
  const res = useAuthedResource(
    qk.adminPermissions(),
    () => api.get<RolePermissionResponse[]>("/admin/permissions"),
    [] as RolePermissionResponse[],
    { staleTime: FRESH.config },
  );

  const data = useMemo(() => {
    const byRole: Record<string, { module: string; read: boolean; write: boolean; approve: boolean }[]> = {};
    const modules = new Set<string>();
    for (const row of res.data) {
      modules.add(row.module);
      byRole[row.role] ??= [];
      byRole[row.role].push({
        module: row.module,
        read: row.canRead,
        write: row.canWrite,
        approve: row.canApprove,
      });
    }
    return { byRole, modules: [...modules].sort() };
  }, [res.data]);

  return { data, isLoading: res.isLoading, error: res.error, refetch: res.refetch };
};

/**
 * The points rules, per game and action.
 *
 * The rule carries a `gameId` and no title — same as the points ledger — so the
 * catalogue is joined here. It used to read a `gameTitle` field that does not
 * exist on the contract and fell back to the id, which rendered a raw UUID in the
 * title column of the operator's own configuration screen.
 *
 * A rule with a null `gameId` is a PLATFORM-WIDE rule, not a missing join, and it
 * is labelled as such rather than shown as an empty cell.
 */
export const usePointsRules = (): Resource<PointsRule[]> => {
  const games = useGames();
  const titles = useMemo(() => new Map(games.data.map((g) => [g.id, g.title])), [games.data]);
  const res = useAuthedResource(
    qk.adminPointsRules(),
    async () =>
      page(
        await api.get<Paginated<PointsRuleResponse>>("/admin/games/points-rules", { query: { limit: 200 } }),
      ),
    [] as PointsRuleResponse[],
    { staleTime: FRESH.config },
  );

  const data = useMemo<PointsRule[]>(
    () =>
      res.data.map((r) => ({
        gameId: r.gameId ?? "",
        gameTitle: r.gameId ? titles.get(r.gameId) ?? r.gameId : "All games",
        action: r.action,
        points: r.points,
        dailyCapPerUser: r.dailyCapPerUser,
        enabled: r.enabled,
      })),
    [res.data, titles],
  );

  return { data, isLoading: res.isLoading, error: res.error, refetch: res.refetch };
};

/* ---------------------------- Analytics series ---------------------------- */

/**
 * The chart series.
 *
 * `month` is kept as the label each chart's x-axis already renders, and
 * `periodKey` comes along beside it so a component that needs to sort or filter
 * has something sortable — "Aug 26" sorts alphabetically, which puts April
 * first.
 */
export const useRevenueByStream = (months = 12) =>
  useAuthedResource(
    qk.revenueByStream(months),
    async () => {
      const rows = await api.get<RevenueByStreamPoint[]>("/admin/analytics/revenue-by-stream", {
        query: { months },
      });
      return rows.map((r) => ({
        month: r.label,
        periodKey: r.periodKey,
        iap: num(r.iap),
        tournament: num(r.tournament),
        marketplace: num(r.marketplace),
        advertising: num(r.advertising),
        subscription: num(r.subscription),
        total: num(r.total),
        unreconciled: num(r.unreconciled),
      }));
    },
    [],
    { staleTime: FRESH.series, ...KEEP_PREVIOUS },
  );

export const usePayoutVsInflow = (months = 12) =>
  useAuthedResource(
    qk.payoutVsInflow(months),
    async () => {
      const rows = await api.get<PayoutVsInflowPoint[]>("/admin/analytics/payout-vs-inflow", {
        query: { months },
      });
      return rows.map((r) => ({
        month: r.label,
        periodKey: r.periodKey,
        inflow: num(r.inflow),
        commission: num(r.commission),
        staking: num(r.staking),
        reserve: num(r.reserve),
        /* Null when there was no inflow to divide by: the chart draws a gap
         * rather than a reassuring zero. */
        ratio: pctOrNull(r.outflowRatioPct),
        commissionRatio: pctOrNull(r.commissionRatioPct),
      }));
    },
    [],
    { staleTime: FRESH.series, ...KEEP_PREVIOUS },
  );

export const useStakingTvlTrend = (months = 12) =>
  useAuthedResource(
    qk.stakingTvl(months),
    async () => {
      const rows = await api.get<StakingTvlPoint[]>("/admin/analytics/staking-tvl", {
        query: { months },
      });
      return rows.map((r) => ({
        month: r.label,
        periodKey: r.periodKey,
        tvl: num(r.tvl),
        stakers: r.stakers,
        staked: num(r.staked),
        unstaked: num(r.unstaked),
      }));
    },
    [],
    { staleTime: FRESH.series, ...KEEP_PREVIOUS },
  );

export const useKycFunnel = () =>
  useAuthedResource(
    qk.kycFunnel(),
    () => api.get<KycFunnelStage[]>("/admin/analytics/kyc-funnel"),
    [] as KycFunnelStage[],
    { staleTime: FRESH.series },
  );

export const useCohortRetention = (months = 6) =>
  useAuthedResource(
    qk.cohortRetention(months),
    async () => {
      const rows = await api.get<CohortRetentionPoint[]>("/admin/analytics/cohort-retention", {
        query: { months },
      });
      /* d1/d7/d30 stay nullable. A 30-day figure for a nine-day-old cohort is not
       * a low number, it is not a number, and plotting zero draws a cliff at the
       * right-hand edge of the chart forever. */
      return rows.map((r) => ({
        month: r.label,
        periodKey: r.periodKey,
        cohort: r.cohort,
        d1: r.d1,
        d7: r.d7,
        d30: r.d30,
        partial: r.partial,
      }));
    },
    [],
    { staleTime: FRESH.series, ...KEEP_PREVIOUS },
  );

/* -------------------------- Public / landing page ------------------------- */

/**
 * The landing page's live stats strip.
 *
 * Unauthenticated and server-cached. The FRD forbids hard-coded marketing
 * numbers, so anything the ledger cannot substantiate arrives as null and the
 * strip omits that tile rather than printing a flattering default.
 */
export function usePublicStats() {
  const res = useResource(
    qk.publicStats(),
    () => api.get<PublicStats>("/public/stats", { anonymous: true }),
    null as PublicStats | null,
    { staleTime: 5 * 60_000 },
  );

  const data = useMemo(
    () => ({
      totalPlayers: res.data?.activeMembers30d ?? 0,
      totalMembers: res.data?.totalMembers ?? 0,
      mttStaked: num(res.data?.mttStaked),
      tournamentsRun: res.data?.tournamentsRun ?? 0,
      gamesLive: res.data?.gamesLive ?? 0,
      treasuryFundedPct: pctOrNull(res.data?.revenueFundedPct ?? null),
      payoutRatio: pctOrNull(res.data?.payoutRatioPct ?? null),
      pointsPerMtt: res.data?.pointsPerMtt ?? 0,
    }),
    [res.data],
  );

  return { data, isLoading: res.isLoading, error: res.error, refetch: res.refetch };
}

/**
 * Registration policy, from the server.
 *
 * The restricted-jurisdiction list, the minimum ages and the password rules were
 * all constants in this bundle. They are compliance and statutory decisions
 * enforced server-side, so a copy here could only ever drift — and the drift is
 * silent: the form accepts a registration the API refuses, or blocks one it
 * would have allowed. There is one list now, and this is a read of it.
 */
export const usePublicConfig = (): Resource<PublicConfig> =>
  useResource(
    qk.publicConfig(),
    async () => {
      const res = await api.get<Partial<PublicConfig>>("/public/config", { anonymous: true });
      /* Merged over the empty config, one level deep, rather than returned raw.
       *
       * The fallback below only applies when the request has produced NOTHING.
       * A response that arrives with a block missing — no `conversion`, no
       * `referral` — replaced the whole object, and the screens that read
       * `policy.conversion.perUserDailyPoints` threw. /app/wallet/convert and
       * /referral-program both went to their error boundaries this way, and
       * /referral-program is a public marketing page.
       *
       * One level is the right depth: every top-level key here is either a
       * scalar, an array, or a flat block of scalars. */
      const got = res ?? {};
      return {
        ...EMPTY_PUBLIC_CONFIG,
        ...got,
        password: { ...EMPTY_PUBLIC_CONFIG.password, ...(got.password ?? {}) },
        referral: { ...EMPTY_PUBLIC_CONFIG.referral, ...(got.referral ?? {}) },
        conversion: { ...EMPTY_PUBLIC_CONFIG.conversion, ...(got.conversion ?? {}) },
      };
    },
    EMPTY_PUBLIC_CONFIG,
    { staleTime: FRESH.config },
  );

/**
 * The fallback while the policy is in flight.
 *
 * `restrictedJurisdictions` is EMPTY here, not a guessed list. An incomplete
 * blocklist rendered as though it were complete is worse than none: it looks
 * authoritative while letting a sanctioned jurisdiction through. The server
 * refuses those registrations regardless, so the honest client behaviour while
 * loading is to warn about nothing rather than to warn about the wrong thing.
 */
const EMPTY_PUBLIC_CONFIG: PublicConfig = {
  restrictedJurisdictions: [],
  globalMinimumAge: 18,
  jurisdictionMinimumAge: {},
  password: { minLength: 10, maxLength: 128, rules: [] },
  requiredLegalDocuments: [],
  /* No rates and no caps until the real ones arrive. A calculator that quotes a
   * default rate is quoting a plan nobody approved. */
  referral: {
    levels: [], eligibleTypes: [], maxDepth: 0, monthlyCapAbsoluteMtt: "0",
    monthlyCapMultiplier: 0, monthlyCapBaseMtt: "0", minAccountAgeDays: 0,
    minGameplaySessions: 0,
  },
  conversion: {
    pointsPerMtt: 0, perUserDailyPoints: "0", perUserMonthlyPoints: "0", minimumPoints: "0",
  },
};

/**
 * The live commission plan, from the PUBLIC config.
 *
 * Separate from `useCommissionConfig`, which reads the admin plan endpoint and
 * carries proposal and approval state. The public referral page and the earnings
 * calculator are reachable without signing in, so they cannot use that one — and
 * a signed-out visitor being shown rates from a bundle constant is the exact
 * drift this replaces.
 */
export const usePublicReferralPlan = (): Resource<CommissionConfig> => {
  const res = usePublicConfig();
  const data = useMemo<CommissionConfig>(() => {
    /* `/public/config` is the one read on this path and it is optional all the
     * way down: this drives a PUBLIC marketing page and a member-facing
     * calculator, and neither may white-screen because the config endpoint
     * answered with a block this app has not seen. An absent plan renders as an
     * empty plan, which the components below already handle. */
    const r = res.data.referral ?? ({} as NonNullable<PublicConfig["referral"]>);
    return {
      levels: (r.levels ?? []).map((l) => ({
        level: (l.level === 2 ? 2 : l.level === 3 ? 3 : 1) as 1 | 2 | 3,
        ratePct: l.rateBps / 100,
      })),
      eligibleTypes: r.eligibleTypes as CommissionConfig["eligibleTypes"],
      monthlyCapAbsolute: num(r.monthlyCapAbsoluteMtt),
      monthlyCapMultiplier: r.monthlyCapMultiplier,
      monthlyCapBase: num(r.monthlyCapBaseMtt),
      maxDepth: r.maxDepth,
      minAccountAgeDays: r.minAccountAgeDays,
      minGameplaySessions: r.minGameplaySessions,
    };
  }, [res.data]);
  return { data, isLoading: res.isLoading, error: res.error, refetch: res.refetch };
};
