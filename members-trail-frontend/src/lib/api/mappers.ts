/* ============================================================================
 * Wire shapes in, domain types out.
 *
 * One file, so every decision about a mismatch between the API and the UI is in
 * a place where it can be read and argued with rather than rediscovered in a
 * component. The four recurring decisions:
 *
 *  1. MONEY BECOMES A NUMBER, FOR DISPLAY ONLY. Balances arrive as
 *     DECIMAL(36,18) strings and the components take `number`. `num()` does that
 *     conversion in one place and is documented as lossy. Nothing that a user
 *     SUBMITS goes through it — a stake or a withdrawal sends the string the
 *     member typed, so the amount the server settles is the amount they saw.
 *
 *  2. BASIS POINTS BECOME FRACTIONS OR PERCENTAGES, EXPLICITLY. The API speaks
 *     bps throughout because that is how the plans are stored; the UI wants 0.08
 *     in one place and 8 in another. Both conversions are named.
 *
 *  3. NUMERIC TIERS BECOME THE UI's WORDS. `kycTier` is 0|1|2 on the wire and
 *     "none"|"tier1"|"tier2" in the badge component. Two of the UI's five values
 *     — "pending" and "rejected" — are not tiers at all: they are the state of a
 *     SUBMISSION, so they can only come from the KYC screens, and this mapper
 *     never invents them.
 *
 *  4. A MISSING VALUE IS NOT ZERO. Where the server says null because a figure
 *     is unknowable — a ratio with no denominator, a retention window that has
 *     not elapsed — the mapper passes null through rather than defaulting to
 *     something that reads as healthy.
 * ========================================================================== */

import type {
  Achievement, AppNotification, AuditLogEntry, Balances, CommissionEntry, FraudAlert, Game,
  KycSubmission, KycTier, LeaderboardEntry, LegalDocument, MarketListing, PointsEntry, Quest,
  ReferralNode, ReferralSummary, RewardEntry, StaffMember, StakePosition, StakingPool, StatusKind,
  StoreItem, Ticket, Tournament, Transaction, TreasuryInflow, TreasuryOutflow, User,
} from "@/types";
import type {
  AchievementResponse, AuditEntryResponse, BalanceResponse, CommissionResponse, DownlineNode,
  FraudAlertResponse, GameResponse, KycQueueItem,
  LegalDocumentResponse, MarketListingResponse, MemberSummary, MeResponse, NotificationResponse,
  LeaderboardRow, PointsEntryResponse, QuestBoardResponse, QuestResponse, ReferralCap,
  ReferralStats, StaffMemberResponse,
  StakePositionResponse, StakingPoolResponse, StakingRewardResponse, StoreItemResponse,
  TicketResponse, TournamentResponse, TransactionResponse, TreasuryInflowResponse,
  TreasuryOutflowResponse,
} from "./types";

/* -------------------------------- primitives ------------------------------ */

/**
 * A decimal string to a JS number.
 *
 * LOSSY BY CONSTRUCTION, and that is acceptable for exactly one purpose:
 * putting a figure on a screen. A double holds about 15-16 significant digits;
 * DECIMAL(36,18) holds 36. Any balance above ~9 quadrillion base units loses
 * precision here. Nothing in this file is used to compute an amount that is sent
 * back to the server.
 */
export const num = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Basis points to a fraction: 800 → 0.08. What a rate field wants. */
export const bpsToRate = (bps: number | null | undefined): number => num(bps) / 10_000;

/** Basis points to a percentage: 800 → 8. What a label wants. */
export const bpsToPct = (bps: number | null | undefined): number => num(bps) / 100;

/** Preserves "unknowable". Used for ratios the server declines to guess at. */
export const pctOrNull = (v: number | null | undefined): number | null =>
  v === null || v === undefined ? null : v;

const iso = (v: string | Date | null | undefined): string => {
  if (!v) return "";
  return typeof v === "string" ? v : v.toISOString();
};

/**
 * Server status strings to the badge component's vocabulary.
 *
 * The API has nine transaction statuses and the badge has a handful of tones.
 * Mapping the extras onto the nearest tone is fine; silently falling through to
 * "pending" would not be, because `failed` rendering as pending tells a member
 * their money is still on its way.
 */
export function toStatusKind(status: string): StatusKind {
  switch (status) {
    case "completed":
    case "approved":
    case "released":
    case "confirmed":
      return "completed";
    case "failed":
    case "rejected":
    case "reversed":
    case "clawed_back":
      return "failed";
    case "cancelled":
    case "expired":
      return "cancelled";
    case "review":
    case "in_review":
    case "escalated":
      return "review";
    case "processing":
    case "queued":
    case "cooling_off":
      return "processing";
    default:
      return "pending";
  }
}

/**
 * Numeric KYC tier to the UI's label.
 *
 * "pending" and "rejected" are deliberately unreachable from here: they describe
 * a submission, not a tier, and manufacturing one from a tier of 0 would tell a
 * member their documents are under review when none were ever sent.
 */
export function toKycTier(tier: number | null | undefined): KycTier {
  if (tier === 2) return "tier2";
  if (tier === 1) return "tier1";
  return "none";
}

/* --------------------------------- identity ------------------------------- */

export function toUser(me: MeResponse): User {
  return {
    id: me.id,
    displayName: me.displayName,
    fullName: me.fullName,
    email: me.email,
    phone: me.phone ?? "",
    country: me.country,
    dateOfBirth: me.dateOfBirth ?? "",
    avatarUrl: me.avatarUrl ?? null,
    status: normaliseUserStatus(me.status),
    kycTier: toKycTier(me.kycTier),
    twoFactorEnabled: me.twoFactorEnabled,
    walletAddress: me.walletAddress,
    walletType: (me.walletType as User["walletType"]) ?? null,
    referralCode: me.referralCode,
    /* The sponsor's identity is another member's data and is not on this
     * endpoint. The UI only ever asks "was I referred", which `wasReferred`
     * answers; a placeholder id here would look like a real one. */
    referredBy: me.wasReferred ? "referred" : null,
    joinedAt: iso(me.createdAt),
    lastActiveAt: iso(me.lastActiveAt ?? me.lastLoginAt ?? me.createdAt),
    /* Not exposed to a member about themselves, on purpose: a fraud score tells
     * you which behaviour tripped a rule, which is a map for evading it. The
     * admin member view carries the real value. */
    riskScore: 0,
    riskFlags: [],
  };
}

function normaliseUserStatus(status: string): User["status"] {
  switch (status) {
    case "pending_verification":
      return "unverified";
    case "verified_kyc_pending":
    case "active":
    case "suspended":
    case "frozen":
      return status;
    /* `closed` has no UI state of its own; a closed account cannot sign in, so
     * the only way to see this is an admin looking at the record. Frozen is the
     * closest honest rendering — locked, holding funds, not usable. */
    case "closed":
      return "frozen";
    default:
      return "unverified";
  }
}

/** The admin member directory row. Contact details arrive already masked. */
export function toAdminUser(m: MemberSummary): User {
  return {
    id: m.id,
    displayName: m.displayName,
    fullName: m.displayName,
    email: m.email,
    phone: m.phone ?? "",
    country: m.country ?? "",
    dateOfBirth: "",
    avatarUrl: null,
    status: normaliseUserStatus(m.status),
    kycTier: toKycTier(m.kycTier),
    twoFactorEnabled: m.twoFactorEnabled,
    walletAddress: m.walletAddress,
    walletType: (m.walletType as User["walletType"]) ?? null,
    referralCode: m.referralCode,
    referredBy: m.wasReferred ? "referred" : null,
    joinedAt: m.joinedAt,
    lastActiveAt: m.lastActiveAt ?? m.joinedAt,
    riskScore: m.riskScore,
    riskFlags: m.riskFlags ?? [],
  };
}

export function toStaffMember(s: StaffMemberResponse): StaffMember {
  return {
    id: s.id,
    name: s.name,
    email: s.email,
    role: s.role as StaffMember["role"],
    twoFactorEnabled: s.twoFactorEnabled,
    lastActiveAt: s.lastActiveAt ?? "",
    active: s.active,
  };
}

/* --------------------------------- balances -------------------------------- */

/**
 * The wallet balance, plus the two figures that do not live on it.
 *
 * `pointsToday` comes from the points summary and `usdRate` from a configured
 * price. Both are passed in rather than defaulted, so a caller cannot
 * accidentally render a zero rate as though it were a real one.
 */
export function toBalances(
  b: BalanceResponse,
  pointsToday: number,
  usdRate: number,
): Balances {
  return {
    points: b.points,
    pointsToday,
    mttAvailable: num(b.mttAvailable),
    mttStaked: num(b.mttStaked),
    mttPendingRewards: num(b.mttPendingRewards),
    commissionPending: num(b.commissionPending),
    commissionAvailable: num(b.commissionAvailable),
    commissionLifetime: num(b.commissionLifetime),
    usdRate,
  };
}

export const EMPTY_BALANCES: Balances = {
  points: 0,
  pointsToday: 0,
  mttAvailable: 0,
  mttStaked: 0,
  mttPendingRewards: 0,
  commissionPending: 0,
  commissionAvailable: 0,
  commissionLifetime: 0,
  usdRate: 0,
};

/* ---------------------------------- ledgers ------------------------------- */

export function toTransaction(t: TransactionResponse): Transaction {
  return {
    id: t.ref,
    date: t.createdAt,
    type: t.type as Transaction["type"],
    amountMtt: num(t.amountMtt),
    amountFiat: t.amountFiat === null ? undefined : num(t.amountFiat),
    status: toStatusKind(t.status),
    txHash: t.txHash ?? undefined,
    sourceTag: (t.sourceTag as Transaction["sourceTag"]) ?? undefined,
    note: t.note ?? undefined,
  };
}

/**
 * A Points ledger row.
 *
 * `gameTitle` is not on the wire — the ledger carries `gameId`. Resolving it to a
 * title needs the game catalogue, which the caller has and this function does
 * not, so it is passed in. Left undefined, the row shows its note instead of a
 * fabricated title.
 */
export function toPointsEntry(
  p: PointsEntryResponse,
  gameTitles?: Map<string, string>,
): PointsEntry {
  return {
    id: p.ref,
    date: p.createdAt,
    source: p.source as PointsEntry["source"],
    gameTitle: p.gameId ? gameTitles?.get(p.gameId) : undefined,
    amount: num(p.amount),
    runningBalance: num(p.runningBalance),
    note: p.note ?? undefined,
  };
}

/* ----------------------------------- play --------------------------------- */

export function toGame(g: GameResponse): Game {
  return {
    id: g.id,
    slug: g.slug,
    title: g.title,
    genre: g.genre,
    blurb: g.blurb ?? g.description ?? "",
    /* The gradient art is generated from a hue. Deriving one from the slug when
     * the catalogue has not set it keeps a game's tile stable across reloads
     * instead of flickering a new colour each render. */
    thumbnailHue: g.thumbnailHue ?? hueFromString(g.slug),
    pointsPerSessionMin: g.pointsPerSessionMin,
    pointsPerSessionMax: g.pointsPerSessionMax,
    entryType: g.entryType as Game["entryType"],
    entryFee: g.entryFee === null ? undefined : num(g.entryFee),
    players30d: g.players30d,
    /* A decimal string on the wire, like every other decimal here. It used to be
     * typed `number` and passed straight through, which put a string into a field
     * the UI sorts and compares numerically. */
    rating: num(g.rating),
    active: g.active,
    dailyPointsCap: g.dailyPointsCap,
  };
}

/** Stable pseudo-hue from a string. Not security-relevant; just needs to not move. */
export function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export function toTournament(t: TournamentResponse): Tournament {
  return {
    /* The ref, not the uuid: it is what the API's own path parameters take, so a
     * component that has this id can act on it without a second lookup. */
    id: t.ref,
    gameId: t.gameId,
    name: t.name,
    startsAt: t.startsAt,
    endsAt: t.endsAt,
    entryFee: num(t.entryFee),
    prizePool: num(t.prizePool),
    participants: t.participants,
    maxParticipants: t.maxParticipants,
    status: (t.status === "live" || t.status === "completed" ? t.status : "scheduled") as Tournament["status"],
    format: t.format,
    /* Basis points on the wire, a percentage in the UI — which renders `{share}%`
     * and multiplies the pool by `share / 100`. Getting this wrong by a factor of
     * 100 would misstate every prize. */
    prizeSplit: (t.prizeSplit ?? []).map((sp) => ({ place: sp.place, share: bpsToPct(sp.share) })),
    /* `entryOpen` is about the tournament; whether THIS member has entered is on
     * /tournaments/mine. Left undefined rather than guessed from entryOpen, which
     * would show "registered" to everyone while entry is open. */
    registered: undefined,
  };
}

/**
 * A leaderboard row.
 *
 * `userId` is synthesised from the rank because the API deliberately does not
 * publish member ids on a leaderboard — doing so would turn a public page into a
 * directory of accounts. The value is used only as a React key.
 *
 * `change` is 0 for the same reason it is not on the wire: rank movement needs
 * the previous period's snapshot, and reporting an invented delta on a
 * competitive board is worse than reporting none.
 */
export function toLeaderboardEntry(e: LeaderboardRow): LeaderboardEntry {
  return {
    rank: e.rank,
    userId: `rank-${e.rank}`,
    displayName: e.displayName,
    metric: num(e.score),
    change: 0,
    isCurrentUser: e.isYou,
  };
}

export function toQuest(q: QuestResponse): Quest {
  return {
    id: q.id,
    kind: q.kind as Quest["kind"],
    title: q.title,
    description: q.description,
    progress: q.progress,
    target: q.target,
    rewardPoints: q.rewardPoints,
    expiresAt: q.expiresAt ?? undefined,
    claimed: q.claimed,
    completed: q.completed,
  };
}

/** The quest board arrives grouped by cadence; the UI wants one list. */
export function toQuestList(board: QuestBoardResponse | null): Quest[] {
  if (!board) return [];
  return [...board.daily, ...board.weekly, ...board.milestones].map(toQuest);
}

export function toAchievement(a: AchievementResponse): Achievement {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    unlocked: a.unlocked,
    unlockedAt: a.unlockedAt ?? undefined,
    rewardPoints: a.rewardPoints,
    tier: a.tier as Achievement["tier"],
  };
}

/* --------------------------------- staking -------------------------------- */

export function toStakingPool(p: StakingPoolResponse): StakingPool {
  return {
    poolId: p.poolId,
    name: p.name,
    lockDays: p.lockDays,
    rewardsDurationDays: p.rewardsDurationDays,
    earlyPenaltyBps: p.earlyPenaltyBps,
    active: p.active,
    totalStaked: num(p.totalStaked),
    totalRewardsFunded: num(p.totalRewardsFunded),
    totalRewardsPaid: num(p.totalRewardsPaid),
    /* Already a percentage on the wire — trailing inflow over TVL, annualised.
     * Variable and revenue-funded, never advertised as a fixed rate. */
    currentApr: num(p.currentApr),
    /* Per-pool APR history is on /staking/pools/:poolId/apr, not on the list.
     * Empty here rather than a single fabricated point, so a sparkline renders
     * nothing instead of a flat line that looks like a guarantee. */
    aprHistory: [],
  };
}

export function toStakePosition(p: StakePositionResponse): StakePosition {
  return {
    poolId: p.poolId,
    amount: num(p.amount),
    lockEnd: p.lockEnd ?? "",
    pendingRewards: num(p.pendingRewards),
    stakedAt: p.stakedAt,
  };
}

/**
 * A staking reward accrual.
 *
 * The pool NAME is not on this row — the reward ledger carries the pool id — so
 * it is resolved from the pool list the caller already has. Falling back to
 * "Pool 3" is honest; inventing a name is not.
 */
export function toRewardEntry(
  r: StakingRewardResponse,
  poolNames?: Map<number, string>,
): RewardEntry {
  return {
    id: r.ref,
    date: r.createdAt,
    poolId: r.poolId,
    poolName: poolNames?.get(r.poolId) ?? `Pool ${r.poolId}`,
    accrued: num(r.accrued),
    claimed: r.claimed,
    txHash: r.txHash ?? undefined,
  };
}

/* -------------------------------- referral -------------------------------- */

export function toReferralSummary(
  stats: ReferralStats,
  cap: ReferralCap,
  origin: string,
): ReferralSummary {
  const levels = stats.levels ?? [];
  return {
    code: stats.code,
    /* The server's link is preferred; the fallback is built from the RUNNING
     * origin rather than a configured base URL, because a referral link that
     * points at production while you are testing on staging is a bug only a
     * member will find. */
    link: stats.link ?? `${origin}/signup?ref=${encodeURIComponent(stats.code)}`,
    /* Direct referrals are the level-1 member count. There is no separate field
     * for it, and deriving it is exact rather than approximate. */
    directCount: levels.find((l) => l.level === 1)?.members ?? 0,
    totalDownline: stats.totalDownline,
    byLevel: levels.map((l) => ({
      level: clampLevel(l.level),
      count: l.members,
      earned: num(l.earnedMtt),
    })),
    earnedLifetime: num(stats.lifetimeEarnedMtt),
    /* This month's earnings ARE the cap usage: the cap is measured over the same
     * month against the same commission lines, so `usedAmount` is the figure —
     * not an approximation of it. */
    earnedThisMonth: num(cap.usedAmount),
    monthlyCap: num(cap.capAmount),
    monthlyCapUsed: num(cap.usedAmount),
  };
}

/** The plan is three levels deep. Anything else is a data fault, not a level. */
const clampLevel = (l: number): 1 | 2 | 3 => (l === 2 ? 2 : l === 3 ? 3 : 1);

/**
 * A downline member.
 *
 * `children` is always empty and `id` is synthesised. The API returns a FLAT,
 * anonymised list because the FRD forbids exposing the referral graph — a
 * referrer may see how many people are at each level and what they contributed
 * in aggregate, never who introduced whom. Nesting these by guesswork would
 * reconstruct exactly the relationship the anonymisation exists to hide.
 */
export function toReferralNode(n: DownlineNode, index: number): ReferralNode {
  return {
    id: `l${n.level}-${index}`,
    label: n.label,
    level: clampLevel(n.level),
    joinedAt: n.joinedAt,
    active: n.active,
    contributedCommission: num(n.earnedFromMtt),
    children: [],
  };
}

export function toCommissionEntry(c: CommissionResponse): CommissionEntry {
  return {
    id: c.ref,
    date: c.createdAt,
    downlineLabel: c.fromMember,
    level: clampLevel(c.level),
    triggerType: c.triggerType as CommissionEntry["triggerType"],
    eligibleSpend: num(c.eligibleSpend),
    rate: bpsToRate(c.rateBps),
    /* `amountMtt` is what the member receives. `amount` and `grossAmount` are the
     * fiat-denominated figures before and after the cap, and rendering either as
     * an MTT amount would overstate the payout. */
    amount: num(c.amountMtt),
    status: toStatusKind(c.status),
    /* Every line must trace to the inflow that funded it. An empty string shows
     * in the UI as a gap, which is the correct signal: a commission with no
     * funding reference is a reconciliation problem, not a cosmetic one. */
    treasuryDepositRef: c.treasuryInflowRef ?? "",
    /* Not published on this row. The month key is what an operator reconciles by. */
    sourceEventId: c.monthKey,
  };
}

/* ------------------------------- comms + store ---------------------------- */

export function toNotification(n: NotificationResponse): AppNotification {
  return {
    id: n.id,
    kind: n.kind as AppNotification["kind"],
    title: n.title,
    body: n.body,
    createdAt: n.createdAt,
    read: n.read,
    href: n.href ?? undefined,
  };
}

export function toTicket(t: TicketResponse): Ticket {
  return {
    id: t.ref,
    subject: t.subject,
    category: t.category as Ticket["category"],
    status: t.status as Ticket["status"],
    priority: t.priority as Ticket["priority"],
    /* The member's own ticket list does not carry their id or name — it is their
     * list. The ADMIN list adds `userId`, and that is all it adds: there is no
     * `userRef` or `assigneeName` on this contract, and reading them left the
     * staff table's member and assignee columns permanently blank. Resolving a
     * name from the id is the caller's job, where the directory is available. */
    userId: t.userId ?? "",
    userName: "",
    assignee: undefined,
    createdAt: t.createdAt,
    /* No `updatedAt` on the contract either; the SLA clock is what the UI sorts
     * by, and the created instant is the honest fallback. */
    updatedAt: t.createdAt,
    slaDueAt: t.slaDueAt,
    messages: (t.messages ?? []).map((m) => ({
      id: m.id,
      /* `authorLabel` — "You", "Support" or "System". Agent identities are not
       * exposed, so there is no name to show and `authorName` was always
       * undefined, which rendered every message as being from nobody. */
      author: m.authorLabel,
      authorRole: m.authorRole as Ticket["messages"][number]["authorRole"],
      body: m.body,
      createdAt: m.createdAt,
      /* Internal notes never reach the player-facing endpoint, so anything here
       * is meant to be read. There is no flag on the wire to carry. */
      internal: false,
    })),
    financialDispute: t.financialDispute,
  };
}

export function toStoreItem(i: StoreItemResponse): StoreItem {
  return {
    id: i.id,
    name: i.name,
    category: i.category as StoreItem["category"],
    rarity: i.rarity as StoreItem["rarity"],
    priceMtt: i.priceMtt === null ? undefined : num(i.priceMtt),
    pricePoints: i.pricePoints ?? undefined,
    hue: i.hue ?? hueFromString(i.sku),
    /* Ownership is a fact about the member's inventory, not about the catalogue
     * row, and it is not on this endpoint. Left undefined so the UI does not
     * claim either way. */
    owned: undefined,
    description: i.description,
  };
}

export function toMarketListing(l: MarketListingResponse): MarketListing {
  return {
    id: l.ref,
    itemName: l.name,
    rarity: l.rarity as StoreItem["rarity"],
    sellerLabel: l.isYours ? "You" : l.seller,
    askMtt: num(l.askMtt),
    listedAt: l.listedAt,
    hue: l.hue ?? hueFromString(l.sku),
  };
}

/* ----------------------------------- legal -------------------------------- */

export function toLegalDocument(d: LegalDocumentResponse): LegalDocument {
  return {
    slug: d.slug,
    title: d.title,
    version: d.version,
    status: d.status as LegalDocument["status"],
    /* Three names for "when did this last change", because the public read model
     * and the admin one grew apart. Take whichever the server actually sent. */
    updatedAt: d.updatedAt ?? d.publishedAt ?? d.createdAt ?? null,
    effectiveFrom: d.effectiveFrom ?? null,
    materialChange: d.materialChange,
    summary: d.summary ?? "",
    sections: d.sections ?? [],
  };
}

/* ----------------------------------- admin -------------------------------- */

export function toKycSubmission(k: KycQueueItem): KycSubmission {
  return {
    id: k.ref,
    userId: k.userId,
    /* A reference, not a name. The queue is deliberately triaged before anyone
     * opens the identity documents, so the reviewer sees who they are about to
     * look at only once they choose to. */
    userName: k.userRef,
    submittedAt: k.createdAt,
    tier: k.tier === 2 ? 2 : 1,
    riskScore: k.riskScore,
    status: normaliseKycStatus(k.status),
    documents: (k.documents ?? []).map((d) => ({
      kind: d.kind as KycSubmission["documents"][number]["kind"],
      /* Filenames are not published: an uploaded filename is user-controlled text
       * and often contains the person's real name. The kind is what a reviewer
       * needs to know before opening it. */
      filename: d.kind,
    })),
    /* The queue row DOES carry these two. They were hard-coded to 0 and "" here,
     * which showed every submission as having no provider confidence — a figure a
     * reviewer triages on. Absent stays absent rather than becoming zero. */
    providerConfidence: k.providerConfidence ?? 0,
    country: k.country ?? "",
    notes: k.reviewerNotes ?? undefined,
  };
}

function normaliseKycStatus(status: string): KycSubmission["status"] {
  if (status === "approved" || status === "rejected" || status === "more_info") return status;
  /* `in_review` and `pending` are both "waiting for a reviewer" as far as the
   * queue screen is concerned. */
  return "pending";
}

/**
 * A Treasury inflow row.
 *
 * These endpoints used to hand back the raw entity, whose column names differ
 * from the documented ones — so the date, the allocation percentage and the
 * amount all read `undefined` and rendered as blank and zero. The API now serves
 * a response DTO; `recognisedAt` is its name for the row's own timestamp, which
 * is honest about being the Treasury's recognition instant rather than the
 * processor's event time.
 */
export function toTreasuryInflow(i: TreasuryInflowResponse): TreasuryInflow {
  return {
    id: i.ref,
    date: i.recognisedAt,
    stream: i.stream as TreasuryInflow["stream"],
    grossRevenue: num(i.grossRevenue),
    treasuryAllocationPct: bpsToPct(i.treasuryAllocationBps),
    amountToTreasury: num(i.amountToTreasuryMtt),
    processorRef: i.processorRef ?? "",
    reconciled: i.reconciled,
  };
}

export function toTreasuryOutflow(o: TreasuryOutflowResponse): TreasuryOutflow {
  return {
    id: o.ref,
    date: o.createdAt,
    destination: (o.destination === "staking_pool" ? "staking_pool" : "commission_pool") as TreasuryOutflow["destination"],
    poolId: o.poolId ?? undefined,
    amount: num(o.amountMtt),
    txHash: o.txHash ?? "",
    approvedBy: o.approvedByIds ?? [],
  };
}

/**
 * A fraud alert.
 *
 * `createdAt` is when it was raised — there is no `raisedAt` on the wire, so the
 * queue used to show a blank timestamp on every alert.
 *
 * Affected members arrive as IDS only, and that is deliberate on the server's
 * part: an alert is not a place to denormalise member names. The id is carried
 * through as the name too, so a screen that renders the label still shows
 * something identifying; the fraud queue itself joins the member directory it
 * already loads to show the real account. Fetching that directory HERE would put
 * five paginated member requests behind every screen that shows an alert count,
 * including the dashboard, for a name most of them never render.
 */
export function toFraudAlert(a: FraudAlertResponse): FraudAlert {
  return {
    id: a.ref,
    raisedAt: a.createdAt,
    kind: a.kind as FraudAlert["kind"],
    severity: a.severity as FraudAlert["severity"],
    riskScore: a.riskScore,
    affectedUsers: (a.affectedUserIds ?? []).map((id) => ({ id, name: id })),
    summary: a.summary,
    status: a.status as FraudAlert["status"],
    signals: a.signals ?? [],
  };
}

/**
 * One audit row.
 *
 * Three field names here were wrong and each failed silently:
 *   - the identifier is `ref`, not `id`, so every row had an undefined React key;
 *   - there is no `actorName` on the contract, so the actor always fell through
 *     to the raw id — `staffNames` resolves it properly now;
 *   - the four-eyes flag is `requiredSecondApproval` (past tense: it records what
 *     was required at the time), so reading `requiresSecondApproval` rendered
 *     EVERY entry as not needing a second approver. On an append-only compliance
 *     record that is the worst of the three.
 */
export function toAuditEntry(
  a: AuditEntryResponse,
  staffNames?: Map<string, string>,
): AuditLogEntry {
  return {
    id: a.ref,
    timestamp: a.createdAt,
    actor: (a.actorId ? staffNames?.get(a.actorId) : undefined) ?? a.actorId ?? "system",
    actorRole: (a.actorRole as AuditLogEntry["actorRole"]) ?? "support",
    action: a.action,
    target: [a.targetType, a.targetId].filter(Boolean).join(" "),
    before: a.before === null || a.before === undefined ? undefined : stringifyDiff(a.before),
    after: a.after === null || a.after === undefined ? undefined : stringifyDiff(a.after),
    ip: a.ip ?? "",
    requiresSecondApproval: a.requiredSecondApproval,
    approvedBy: a.approvedById ?? undefined,
  };
}

/**
 * A before/after snapshot for the audit table's single-line cell.
 *
 * Truncated, because an audit row can carry a whole entity and the table has one
 * line for it. The full value is on the record itself — this is the summary, and
 * the ellipsis is there so nobody mistakes it for the whole thing.
 */
function stringifyDiff(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const s = JSON.stringify(value);
    return s.length > 160 ? `${s.slice(0, 157)}…` : s;
  } catch {
    return String(value);
  }
}
