/* ============================================================================
 * The wire contracts, as the API actually sends them.
 *
 * These are deliberately SEPARATE from the domain types in `@/types`. The
 * temptation is to make the UI read API shapes directly and delete a layer, and
 * it is the wrong trade for two specific reasons:
 *
 *  1. MONEY CROSSES THE WIRE AS A STRING. Every MTT figure is DECIMAL(36,18) on
 *     the server. `JSON.parse` on a number that wide silently rounds it —
 *     0.1 + 0.2 arithmetic, but on someone's balance. So the wire type says
 *     `string` and the mapper decides, once, where a float is acceptable
 *     (display) and where it is not (anything the user submits back).
 *
 *  2. THE SERVER'S VOCABULARY IS NOT THE UI'S. `kycTier` is 0|1|2 here and
 *     "none"|"tier1"|"tier2" in the components. Rather than change 171 files or
 *     pretend the mismatch does not exist, the mapping happens in one place
 *     where it can be read and argued with.
 *
 * Anything the server can omit is typed as optional or nullable here, so the
 * mappers are forced to make a decision about it instead of producing
 * `undefined` three components deep.
 * ========================================================================== */

/* ---------------------------------- shared -------------------------------- */

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

export interface OkResponse {
  ok: boolean;
  message?: string;
}

/* --------------------------------- identity ------------------------------- */

export interface MeResponse {
  id: string;
  ref: string;
  email: string;
  emailVerified: boolean;
  phone?: string | null;
  phoneVerified: boolean;
  fullName: string;
  displayName: string;
  avatarUrl?: string | null;
  country: string;
  locale: string;
  timezone: string;
  status: string;
  kycTier: number;
  role: string;
  referralCode: string;
  referralDepth: number;
  wasReferred: boolean;
  dateOfBirth: string | null;
  twoFactorEnabled: boolean;
  walletAddress: string | null;
  walletType: string | null;
  lastActiveAt: string | null;
  isStaff: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  acceptedLegalVersions: Record<string, string>;
}

export interface SecurityOverview {
  twoFactorEnabled?: boolean;
  twoFaMethod?: string | null;
  passwordChangedAt?: string | null;
  activeSessions?: number;
  [key: string]: unknown;
}

/* ---------------------------------- wallet -------------------------------- */

export interface BalanceResponse {
  points: number;
  mttAvailable: string;
  mttStaked: string;
  mttPendingRewards: string;
  commissionPending: string;
  commissionAvailable: string;
  commissionLifetime: string;
  mttLockedForWithdrawal: string;
  totalMtt: string;
  lastLedgerAt: string | null;
  readAt: string;
}

export interface TransactionResponse {
  ref: string;
  createdAt: string;
  type: string;
  amountMtt: string;
  amountFiat: string | null;
  currency: string | null;
  status: string;
  sourceTag: string | null;
  txHash: string | null;
  note?: string | null;
}

export interface WithdrawalResponse {
  ref: string;
  createdAt: string;
  amountMtt: string;
  status: string;
  destination?: string | null;
  destinationAddress?: string | null;
  sourceTag?: string | null;
  coolingOffUntil?: string | null;
  txHash?: string | null;
  reviewRequired?: boolean;
}

export interface WithdrawalLimits {
  kycTier: number;
  eligible: boolean;
  /** Why a withdrawal is refused right now, when it is. */
  blockedBy: string | null;
  tierLimitMtt: string;
  usedMtt: string;
  remainingMtt: string;
  availableMtt: string;
  maxRequestableMtt: string;
  reviewThresholdMtt: string;
  coolingOffHours: number;
  windowDays: number;
}

export interface WalletAddressResponse {
  id: string;
  address: string;
  type: "external" | "custodial";
  isPrimary: boolean;
  label?: string | null;
  verifiedAt?: string | null;
  /** When the anti-fraud cooling-off clock started on this address. */
  whitelistedAt?: string | null;
  /** False while the cooling-off window is still open. A new address cannot be paid to. */
  withdrawable: boolean;
  /** The instant it becomes withdrawable. Null when it already is. */
  withdrawableAt?: string | null;
}

/** The nonce-bearing message to sign. Note the seconds suffix — there is no `nonce` field. */
export interface LinkChallengeResponse {
  message: string;
  expiresInSeconds: number;
}

/* --------------------------------- points --------------------------------- */

/**
 * A Points ledger row.
 *
 * `amount` and `runningBalance` are NUMBERS here, not strings, and that is not an
 * inconsistency with the money fields elsewhere: Points are an integral count, so
 * the server sends them as JSON numbers. MTT is DECIMAL(36,18) and stays a string.
 */
export interface PointsEntryResponse {
  ref: string;
  createdAt: string;
  source: string;
  amount: number;
  runningBalance: number;
  gameId: string | null;
  gameSessionId: string | null;
  note: string | null;
}

export interface PointsSummary {
  earned: number;
  convertedOut: number;
  net: number;
  currentBalance: number;
  earnedToday: number;
  /** The server names the figure `earned`, not `amount`. */
  bestDay: { day: string; earned: number } | null;
  firstEntryAt: string | null;
}

export interface PointsCaps {
  day: string;
  globalCap: number;
  globalIssued: number;
  globalRemaining: number;
  resetsInSeconds: number;
  games: {
    gameId: string;
    gameTitle: string;
    cap: number;
    issued: number;
    remaining: number;
    /** Ceiling for one session, distinct from the daily cap. */
    sessionCap: number;
  }[];
}

/* ---------------------------------- games --------------------------------- */

export interface GameResponse {
  id: string;
  slug: string;
  title: string;
  genre: string;
  blurb?: string | null;
  description?: string | null;
  thumbnailHue?: number | null;
  pointsPerSessionMin: number;
  pointsPerSessionMax: number;
  entryType: string;
  entryFee: string | null;
  players30d: number;
  /**
   * A DECIMAL on the wire, so a string — like every other decimal in this API.
   * It was typed `number` here and passed straight through the mapper, which put
   * a string in a field the UI does arithmetic and comparisons on.
   */
  rating: string;
  active: boolean;
  dailyPointsCap: number;
  sessionPointsCap?: number;
}

export interface TournamentResponse {
  id: string;
  ref: string;
  gameId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  entryFee: string;
  prizePool: string;
  participants: number;
  maxParticipants: number;
  status: string;
  format: string;
  /** `share` is BASIS POINTS on the wire — exact, and assertable to total 10000. */
  prizeSplit: { place: string; share: number }[];
  prizeSplitLockedAt: string | null;
  rules?: string | null;
  settledAt: string | null;
  startsInSeconds: number;
  entryOpen: boolean;
}

export interface LeaderboardRow {
  rank: number;
  displayName: string;
  /** A score, not money: a JSON number, and the server sends it as one. */
  score: number;
  /**
   * The caller's own row. Note there is no `userId` on the wire: a leaderboard
   * that published member ids would let anyone build a directory of accounts
   * from a public page.
   */
  isYou: boolean;
}

export interface LeaderboardResponse {
  metric: string;
  period: string;
  periodKey: string;
  rows: LeaderboardRow[];
  /** The caller's own standing, even when outside the returned page. */
  you: LeaderboardRow | null;
  totalRanked: number;
  resetsInSeconds: number;
  source: string;
}

/* --------------------------------- quests --------------------------------- */

export interface QuestResponse {
  id: string;
  title: string;
  description: string;
  kind: string;
  gameId: string | null;
  metric: string;
  target: number;
  progress: number;
  progressPct: number;
  rewardPoints: number;
  completed: boolean;
  claimed: boolean;
  pointsAwarded: number | null;
  periodKey: string | null;
  expiresAt: string | null;
  expiresInSeconds: number | null;
}

/** Quests arrive GROUPED by cadence, not as one list. */
export interface QuestBoardResponse {
  daily: QuestResponse[];
  weekly: QuestResponse[];
  milestones: QuestResponse[];
  claimablePoints: number;
  readyToClaim: number;
}

export interface AchievementResponse {
  id: string;
  code: string;
  title: string;
  description: string;
  tier: string;
  rewardPoints: number;
  unlocked: boolean;
  unlockedAt: string | null;
  progress: number;
  target: number;
  pointsAwarded: number | null;
}

export interface AchievementBoardResponse {
  achievements: AchievementResponse[];
  unlockedCount: number;
  totalCount: number;
  pointsEarned: number;
}

/* --------------------------------- staking -------------------------------- */

export interface StakingPoolResponse {
  poolId: number;
  name: string;
  lockDays: number;
  rewardsDurationDays: number;
  earlyPenaltyBps: number;
  active: boolean;
  totalStaked: string;
  totalRewardsFunded: string;
  totalRewardsPaid: string;
  /**
   * Already a PERCENTAGE, not basis points. Trailing and derived — inflow over
   * TVL, annualised — and never a forecast.
   */
  currentApr: string;
  rewardsRemaining: string;
  lastSyncedBlock: number | null;
  /** True when the on-chain mirror is behind. The UI should say so. */
  stale: boolean;
}

export interface StakePositionResponse {
  poolId: number;
  poolName: string;
  amount: string;
  pendingRewards: string;
  stakedAt: string;
  lockEnd: string | null;
  locked: boolean;
  unlocksInSeconds: number | null;
  lastSyncedBlock: number | null;
}

export interface StakePositionsResponse {
  positions: StakePositionResponse[];
  totalStakedMtt: string;
  totalPendingRewardsMtt: string;
  activePositions: number;
  lifetimeRewardsClaimedMtt: string;
}

export interface StakingRewardResponse {
  ref: string;
  poolId: number;
  accrued: string;
  claimed: boolean;
  periodKey: string | null;
  txHash: string | null;
  createdAt: string;
}

/* -------------------------------- referral -------------------------------- */

export interface ReferralStats {
  code: string;
  link: string | null;
  totalDownline: number;
  activeDownline: number;
  levels: { level: number; members: number; activeMembers: number; earnedMtt: string; rateBps: number }[];
  lifetimeEarnedMtt: string;
  claimableMtt: string;
  pendingMtt: string;
  maxDepth: number;
  planVersion: number;
}

export interface ReferralCap {
  monthKey: string;
  capAmount: string;
  usedAmount: string;
  remainingAmount: string;
  cappedAwayAmount: string;
  trailingSpend: string;
  entryCount: number;
  absoluteCap: string;
  capMultiplier: string;
  capBase: string;
}

/**
 * A downline member, anonymised.
 *
 * FLAT, and with no id or parent — deliberately. The FRD anonymises the downline
 * so a referrer cannot reconstruct the graph or identify the people in it, which
 * means there is no hierarchy on the wire to build a tree from. The UI groups by
 * level instead; inventing a parent to draw a prettier diagram would be
 * inventing the exact relationship the anonymisation exists to hide.
 */
export interface DownlineNode {
  label: string;
  level: number;
  joinedAt: string;
  active: boolean;
  earnedFromMtt: string;
  verified: boolean;
}

export interface CommissionResponse {
  ref: string;
  createdAt: string;
  level: number;
  /** Anonymised label for the member whose spend generated this line. */
  fromMember: string;
  triggerType: string;
  eligibleSpend: string;
  rateBps: number;
  grossAmount: string;
  amount: string;
  cappedAmount: string;
  amountMtt: string;
  status: string;
  monthKey: string;
  /** The Treasury inflow that funded it. Every line must trace to one. */
  treasuryInflowRef: string | null;
  releasedAt: string | null;
  claimedAt: string | null;
  clawbackReason: string | null;
}

/* ------------------------------ notifications ----------------------------- */

export interface NotificationResponse {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
  data?: Record<string, unknown> | null;
}

export interface NotificationPreferences {
  [channel: string]: unknown;
}

/* --------------------------------- support -------------------------------- */

/**
 * One message on a ticket.
 *
 * `authorLabel` is "You", "Support" or "System" — agent identities are
 * deliberately not exposed, so there is no name here to render. There is also no
 * `internal` flag: internal notes are filtered out server-side before the
 * player-facing endpoint answers, so anything that arrives is meant to be read.
 */
export interface TicketMessageResponse {
  id: string;
  authorLabel: string;
  authorRole: "user" | "agent" | "system";
  body: string;
  createdAt: string;
}

export interface TicketResponse {
  ref: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  financialDispute: boolean;
  slaDueAt: string;
  slaBreached: boolean;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  disputedRef: string | null;
  satisfactionRating: number | null;
  createdAt: string;
  messageCount: number;
  /** Present on the detail endpoint only — the list does not carry the thread. */
  messages?: TicketMessageResponse[] | null;
  /**
   * Staff view only, and only on the ADMIN list endpoint, which returns
   * `TicketResponse & { userId }`. There is no `userRef`, `assigneeName` or
   * `updatedAt` on this contract — the mapper used to read all three and got
   * `undefined` every time.
   */
  userId?: string | null;
}

/* ---------------------------------- store --------------------------------- */

export interface StoreItemResponse {
  id: string;
  sku: string;
  name: string;
  category: string;
  rarity: string;
  priceMtt: string | null;
  pricePoints: number | null;
  hue: number | null;
  description: string;
  consumable: boolean;
  tradable: boolean;
  active: boolean;
}

export interface MarketListingResponse {
  ref: string;
  itemId: string;
  sku: string;
  name: string;
  rarity: string;
  hue: number | null;
  askMtt: string;
  feeMtt: string;
  sellerReceivesMtt: string;
  status: string;
  /** Anonymised seller label. */
  seller: string;
  isYours: boolean;
  listedAt: string;
  soldAt: string | null;
}

/* -------------------------------- conversion ------------------------------ */

export interface ConversionRateInfo {
  pointsPerMtt: number;
  effectiveFrom: string;
  nextPointsPerMtt: number | null;
  nextEffectiveFrom: string | null;
}

/** One cap window's meter, as the quote reports it. */
export interface ConversionCapMeter {
  window: "day" | "month";
  periodKey: string;
  limitPoints: number;
  usedPoints: number;
  remainingPoints: number;
  resetsInSeconds: number;
}

/**
 * What a conversion WOULD do, before the member commits.
 *
 * Field names are the server's: `pointsRequested` versus `pointsConvertible` is
 * the whole point of a quote — a cap or the balance can make them differ — and
 * `mttOut` is truncated, never rounded up.
 */
export interface ConversionQuote {
  pointsRequested: number;
  pointsConvertible: number;
  pointsPerMtt: number;
  mttOut: string;
  remainderPoints: number;
  pointsBalance: number;
  caps: ConversionCapMeter[];
  executable: boolean;
  /** INSUFFICIENT_POINTS, DAILY_CAP, MONTHLY_CAP, RATE_GRANULARITY, BELOW_MINIMUM, or null. */
  blockedBy: string | null;
}

/**
 * The result of an executed conversion.
 *
 * NOT a `TransactionResponse` — this endpoint reports the conversion, so it
 * carries the points spent and the rate applied rather than a signed ledger
 * amount. `replayed` is true when an idempotent retry returned the original.
 */
export interface ConversionResponse {
  ref: string;
  createdAt: string;
  pointsSpent: number;
  rateApplied: number;
  mttCredited: string;
  status: string;
  txHash: string | null;
  pointsBalanceAfter: number;
  replayed: boolean;
}

export interface ConversionCapsOverview {
  perUserDailyPoints: number;
  perUserMonthlyPoints: number;
  /** Null when no platform-wide brake is configured — not zero. */
  globalDailyPoints: number | null;
  globalDailyUsedPoints: string;
  globalDailyConversions: number;
}

/**
 * A member's conversion HISTORY, not their caps.
 *
 * The caps live on `/public/config` (the ceilings) and `/points/caps` (what is
 * left today). Naming matters here: a screen that read "summary" expecting caps
 * would render lifetime totals as remaining allowance.
 */
export interface ConversionSummary {
  totalConversions: number;
  pointsSpentLifetime: number;
  mttReceivedLifetime: string;
  /** Weighted average Points paid per MTT. Always present — 0 when nothing converted. */
  averageRate: number;
  lastConvertedAt: string | null;
}

/* ---------------------------------- legal --------------------------------- */

/**
 * Two endpoints serve this shape and they do not agree on every field: the
 * public reader sends a published document, the admin list sends drafts and
 * archived versions too. Anything only one of them guarantees is optional here,
 * so a component has to decide what an absent value looks like instead of
 * finding out at runtime. `updatedAt` was typed as required and never sent by
 * the admin endpoint at all, which cost the whole of /admin/cms.
 */
export interface LegalDocumentResponse {
  slug: string;
  title: string;
  version: string;
  status: string;
  updatedAt?: string | null;
  createdAt?: string | null;
  publishedAt?: string | null;
  effectiveFrom?: string | null;
  materialChange: boolean;
  summary?: string | null;
  sections?: { heading: string; body: string[] }[] | null;
}

/** One row of `/tournaments/mine`: this member's entry in one event. */
export interface TournamentEntryResponse {
  tournamentId: string;
  /** Public reference, which is what `Tournament.id` carries in the UI. */
  tournamentRef: string;
  tournamentName: string;
  paidAmount: string;
  bestScore: number | null;
  rank: number | null;
  prizeAmount: string;
  prizePaidAt: string | null;
  disqualified: boolean;
  disqualificationReason: string | null;
  joinedAt: string;
}

/* ---------------------------------- public -------------------------------- */

export interface PublicConfig {
  restrictedJurisdictions: string[];
  globalMinimumAge: number;
  jurisdictionMinimumAge: Record<string, number>;
  password: { minLength: number; maxLength: number; rules: string[] };
  requiredLegalDocuments: string[];
  referral: {
    levels: { level: number; rateBps: number }[];
    eligibleTypes: string[];
    maxDepth: number;
    monthlyCapAbsoluteMtt: string;
    monthlyCapMultiplier: number;
    monthlyCapBaseMtt: string;
    minAccountAgeDays: number;
    minGameplaySessions: number;
  };
  conversion: {
    pointsPerMtt: number;
    perUserDailyPoints: string;
    perUserMonthlyPoints: string;
    minimumPoints: string;
  };
}

export interface PublicStats {
  activeMembers30d: number;
  totalMembers: number;
  mttStaked: string;
  tournamentsRun: number;
  gamesLive: number;
  revenueFundedPct: number | null;
  payoutRatioPct: number | null;
  pointsPerMtt: number;
  computedAt: string;
}

/* ---------------------------------- admin --------------------------------- */

export interface PlatformKpis {
  members: number;
  activeMembers30d: number;
  kycVerified: number;
  frozen: number;
  withdrawalsInReview: number;
  openFraudAlerts: number;
  breachedTickets: number;
  pendingApprovals: number;
  queuedCommissionMtt: string;
  commissionSolvent: boolean;
  attentionRequired: string[];
  activeMembersToday: number;
  pointsIssued30d: string;
  mttLiability: string;
  mttStaked: string;
  treasuryHeadroomMtt: string;
  pendingWithdrawals: number;
  pendingWithdrawalsMtt: string;
  openKycQueue: number;
  openTickets: number;
  commissionPayoutRatioPct: number | null;
  outflowRatioPct: number | null;
  revenueFundedPct: number | null;
  /** Null when there is no prior period to compare against — not 0%. */
  activeTodayDeltaPct: number | null;
  active30dDeltaPct: number | null;
  /** Staking-pool transfers over reconciled inflow. Separate from outflowRatioPct. */
  stakingOutflowRatioPct: number | null;
}

export interface MemberSummary {
  id: string;
  ref: string;
  displayName: string;
  email: string;
  phone: string | null;
  country: string | null;
  status: string;
  kycTier: number;
  twoFactorEnabled: boolean;
  walletAddress: string | null;
  walletType: string | null;
  referralCode: string;
  wasReferred: boolean;
  joinedAt: string;
  lastActiveAt: string | null;
  riskScore: number;
  riskFlags: string[];
}

export interface StaffMemberResponse {
  id: string;
  name: string;
  email: string;
  role: string;
  twoFactorEnabled: boolean;
  lastActiveAt: string | null;
  active: boolean;
}

export interface RolePermissionResponse {
  role: string;
  module: string;
  canRead: boolean;
  canWrite: boolean;
  canApprove: boolean;
}

export interface StaffIdentity {
  me: StaffMemberResponse;
  permissions: string[];
  modules: RolePermissionResponse[];
  approvers: StaffMemberResponse[];
  serverTime: string;
}

export interface KycQueueItem {
  id: string;
  ref: string;
  userId: string;
  /** A reference, not a name: the queue is triaged before identity is opened. */
  userRef: string;
  tier: number;
  status: string;
  riskScore: number;
  createdAt: string;
  providerConfidence?: number | null;
  country?: string | null;
  reviewerNotes?: string | null;
  /** The document id field is `id`, which is what the document-read route takes. */
  documents: {
    id: string;
    kind: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    purgedAt: string | null;
  }[];
}

export interface TreasuryInflowResponse {
  ref: string;
  /** When the Treasury recognised the allocation. Not the processor's event time. */
  recognisedAt: string;
  stream: string;
  grossRevenue: string;
  treasuryAllocationBps: number;
  /** Fiat-denominated allocation. */
  amountToTreasury: string;
  /** The same allocation in MTT, at the rate in force when it was recorded. */
  amountToTreasuryMtt: string;
  processorRef?: string | null;
  reconciled: boolean;
  reconciledAt?: string | null;
  periodKey: string;
}

export interface TreasuryOutflowResponse {
  ref: string;
  createdAt: string;
  destination: string;
  poolId?: number | null;
  amountMtt: string;
  status: string;
  txHash?: string | null;
  approvedByIds?: string[] | null;
  approvedAt?: string | null;
  periodKey: string;
}

/**
 * The Treasury period dashboard.
 *
 * Field names are the server's. The `*PoolOut` / `reserveOut` names this used to
 * declare do not exist on the contract, so every outflow figure and the whole
 * utilisation gauge read zero — on the screen whose job is to show whether
 * payouts are outrunning revenue.
 */
export interface TreasuryDashboard {
  periodKey: string;
  reconciledInflow: string;
  unreconciledInflow: string;
  commissionOutflow: string;
  stakingOutflow: string;
  totalOutflow: string;
  reserveFunded: string;
  headroom: string;
  /** (commission + staking) / reconciled inflow, in bps. Must stay below 10000. */
  payoutRatioBps: number;
  /** Share of payouts funded by real revenue rather than the reserve, in bps. */
  realRevenueFundedBps: number;
  ratioBand: "safe" | "watch" | "escalate" | "breach";
  byStream: { stream: string; gross: string; toTreasury: string }[];
  unreconciledCount: number;
  mismatchCount: number;
}

/**
 * A fraud alert.
 *
 * `createdAt`, not `raisedAt`, and `affectedUserIds` — ids only. The alert does
 * not carry member names, so the queue resolves them from the member directory
 * it already has rather than expecting them inline.
 */
export interface FraudAlertResponse {
  ref: string;
  createdAt: string;
  kind: string;
  severity: string;
  riskScore: number;
  affectedUserIds: string[];
  summary: string;
  signals: string[];
  evidence?: Record<string, unknown> | null;
  status: string;
  assigneeId?: string | null;
  resolutionNote?: string | null;
  resolvedAt?: string | null;
}

/**
 * One append-only audit row.
 *
 * The identifier is `ref` and the four-eyes flag is `requiredSecondApproval`
 * (past tense — it records what was required at the time). There is no
 * `actorName`: the audit trail stores the actor's id, and a name is resolved from
 * the staff directory when one is needed.
 */
export interface AuditEntryResponse {
  ref: string;
  createdAt: string;
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  requiredSecondApproval: boolean;
  approvedById?: string | null;
  ip?: string | null;
}

/** A proposed or active conversion rate. Proposer and approver are ids, not names. */
export interface ConversionRateRow {
  id: string;
  pointsPerMtt: number;
  effectiveFrom: string;
  status: string;
  proposedById: string;
  approvedById?: string | null;
  approvedAt?: string | null;
  rationale?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
}

/**
 * One version of the commission plan.
 *
 * The rates are FLAT fields — `l1Bps`, `l2Bps`, `l3Bps` — not a `levels` array,
 * and the cap fields are fiat-denominated (`monthlyCapAbsolute`, not
 * `…AbsoluteMtt`). Reading a `levels` array off this response is what crashed
 * the admin commission screen: `undefined.map` during render.
 */
export interface CommissionPlanResponse {
  id: string;
  version: number;
  l1Bps: number;
  l2Bps: number;
  l3Bps: number;
  maxDepth: number;
  eligibleTriggers: string[];
  monthlyCapAbsolute: string;
  capMultiplier: string;
  capBase: string;
  minAccountAgeDays: number;
  minGameplaySessions: number;
  status: string;
  effectiveFrom: string;
  proposedById: string;
  approvedById?: string | null;
}

/**
 * A points rule.
 *
 * No `gameTitle` on the wire — the rule carries `gameId` and the caller joins the
 * catalogue, the same way the points ledger does.
 */
export interface PointsRuleResponse {
  id?: string;
  gameId: string | null;
  action: string;
  points: number;
  dailyCapPerUser: number;
  enabled: boolean;
}

/* ------------------------------- analytics -------------------------------- */

export interface RevenueByStreamPoint {
  periodKey: string;
  label: string;
  iap: string;
  tournament: string;
  marketplace: string;
  advertising: string;
  subscription: string;
  total: string;
  unreconciled: string;
}

export interface PayoutVsInflowPoint {
  periodKey: string;
  label: string;
  inflow: string;
  commission: string;
  staking: string;
  reserve: string;
  outflowRatioPct: number | null;
  commissionRatioPct: number | null;
}

export interface StakingTvlPoint {
  periodKey: string;
  label: string;
  tvl: string;
  stakers: number;
  staked: string;
  unstaked: string;
}

export interface KycFunnelStage {
  stage: string;
  count: number;
  ofTopPct: number;
}

export interface CohortRetentionPoint {
  periodKey: string;
  label: string;
  cohort: number;
  d1: number | null;
  d7: number | null;
  d30: number | null;
  partial: boolean;
}
