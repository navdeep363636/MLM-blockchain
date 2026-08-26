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
  chainId: number;
  label?: string | null;
  isPrimary: boolean;
  verifiedAt?: string | null;
  createdAt: string;
}

/* --------------------------------- points --------------------------------- */

export interface PointsEntryResponse {
  ref: string;
  createdAt: string;
  source: string;
  amount: string;
  runningBalance: string;
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
  bestDay: { day: string; amount: number } | null;
  firstEntryAt: string | null;
}

export interface PointsCaps {
  day: string;
  globalCap: number;
  globalIssued: number;
  globalRemaining: number;
  resetsInSeconds: number;
  games: { gameId: string; title?: string; cap: number; issued: number; remaining: number }[];
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
  rating: number;
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
  score: string;
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

export interface TicketMessageResponse {
  id: string;
  authorName: string;
  authorRole: string;
  body: string;
  createdAt: string;
  internal?: boolean;
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
  /** Staff view only. */
  userRef?: string | null;
  assigneeName?: string | null;
  updatedAt?: string;
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

export interface ConversionQuote {
  points: number;
  mtt: string;
  pointsPerMtt: number;
  feeMtt?: string | null;
  capRemainingPoints?: string | null;
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
  averageRate: number | null;
  lastConvertedAt: string | null;
}

/* ---------------------------------- legal --------------------------------- */

export interface LegalDocumentResponse {
  slug: string;
  title: string;
  version: string;
  status: string;
  updatedAt: string;
  effectiveFrom: string;
  materialChange: boolean;
  summary?: string | null;
  sections?: { heading: string; body: string[] }[] | null;
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
  documents: { documentId: string; kind: string; mimeType?: string; sizeBytes?: number }[];
}

export interface TreasuryInflowResponse {
  ref: string;
  occurredAt: string;
  stream: string;
  grossRevenue: string;
  netRevenue?: string | null;
  treasuryAllocationBps?: number | null;
  amountToTreasuryMtt?: string | null;
  processorRef?: string | null;
  reconciled: boolean;
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
}

export interface TreasuryDashboard {
  periodKey: string;
  reconciledInflow: string;
  unreconciledInflow: string;
  grossRevenue: string;
  commissionPoolOut: string;
  stakingPoolOut: string;
  reserveOut: string;
  headroom?: string;
  [key: string]: unknown;
}

export interface FraudAlertResponse {
  ref: string;
  raisedAt: string;
  kind: string;
  severity: string;
  riskScore: number;
  affectedUsers?: { id: string; name: string }[] | null;
  summary: string;
  status: string;
  signals?: string[] | null;
}

export interface AuditEntryResponse {
  id: string;
  createdAt: string;
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  requiresSecondApproval?: boolean;
  approvedById?: string | null;
}

export interface ConversionRateRow {
  id: string;
  pointsPerMtt: number;
  effectiveFrom: string;
  status: string;
  proposedByName?: string | null;
  approvedByName?: string | null;
}

export interface CommissionPlanResponse {
  id: string;
  version: number;
  status: string;
  levels: { level: number; rateBps: number }[];
  eligibleTypes: string[];
  monthlyCapAbsoluteMtt: string;
  monthlyCapMultiplier: number;
  monthlyCapBaseMtt: string;
  maxDepth: number;
  minAccountAgeDays: number;
  minGameplaySessions: number;
}

export interface PointsRuleResponse {
  id?: string;
  gameId: string;
  gameTitle?: string | null;
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
