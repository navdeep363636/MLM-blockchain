import type { GameScoringConfig } from "@/database/entities/game.entity";
/* ============================================================================
 * Seed data.
 *
 * Everything here is DETERMINISTIC and keyed on a natural identifier (slug, sku,
 * code, poolId). That is what makes the seed re-runnable: it upserts by that key
 * instead of inserting a second copy, so running it against a database that has
 * already been seeded is a no-op rather than a duplicate catalogue.
 *
 * The catalogue deliberately matches the front end's titles, pool names and
 * slugs. A demo where the API serves "Pool A" while the UI says "30-Day" wastes
 * a reviewer's afternoon.
 *
 * What is NOT here: users, balances, sessions, commissions — anything that
 * represents member activity or money. A seed that invents balances teaches the
 * ledger to disagree with itself, and every figure in this platform is supposed
 * to be derivable from an immutable entry.
 * ========================================================================== */

/**
 * How the server turns a submitted telemetry stream into a score, and a score
 * into Points. Every title needs one: `GamesService.replay` reads
 * `scoringConfig` and a title without one scores every session at the default
 * rate regardless of what its Points band says, which is how a catalogue ends
 * up crediting the same 180 Points for a perfect run and a mediocre one.
 *
 * `pointsPerScore` is set per title so that a near-perfect session lands at the
 * top of that title's declared band and an average one lands mid-band.
 * `maxScore` is a hard replay ceiling - twice what the engine can plausibly
 * produce - so a forged telemetry stream cannot mint an unbounded score.
 */
export type ScoringConfigSeed = Required<
  Pick<GameScoringConfig, "scoreEvent" | "scorePerUnit" | "maxScore" | "pointsPerScore">
>;

export interface GameSeed {
  slug: string;
  title: string;
  genre: string;
  blurb: string;
  thumbnailHue: number;
  pointsPerSessionMin: number;
  pointsPerSessionMax: number;
  entryType: "free" | "paid" | "both";
  entryFee: string;
  dailyPointsCap: number;
  sessionPointsCap: number;
  active: boolean;
  scoringConfig: ScoringConfigSeed;
}

/** The eight launch titles. Hue and caps are fixed values, not random ones. */
/**
 * A scheduled event on a title, expressed relative to the seed run so the
 * catalogue is never seeded into the past.
 *
 * The tournament hub shipped with nothing in it, which reads as a broken screen
 * rather than an empty calendar - and the lobby's "upcoming events" strip, the
 * paid-entry story and the prize-split disclosure all had nothing to render.
 * Every fee here is real revenue: it books to the Revenue Treasury, which is the
 * only pot that funds staking yield and referral commission.
 */
export interface TournamentSeed {
  slug: string;
  gameSlug: string;
  name: string;
  /** Days from the seed run until the doors open. Negative means already live. */
  startsInDays: number;
  /** How long the event runs, in days. */
  runsForDays: number;
  entryFee: string;
  prizePool: string;
  maxParticipants: number;
  status: "scheduled" | "live";
  format: string;
  prizeSplit: { place: string; share: number }[];
}

/**
 * Prize shares are BASIS POINTS totalling exactly 10,000, and a place is a
 * NUMBER OR A NUMERIC RANGE ("1", "4-10") — not an ordinal label.
 *
 * Not percentages. `assertSplitTotals` enforces the bps total on the admin
 * create/publish path, and the UI divides by 100 to display — so a split written
 * as percentages is a hundredfold understatement of every prize, and the seeded
 * events shipped exactly that: 100 bps distributed, 99% of each pool retained,
 * and "1st place: 0.25%" on screen. `normaliseSplit` also parses the place to
 * expand a range across its positions, so "4th-20th" was unparseable and would
 * have paid nobody. Both were caught by running `assertSplitTotals` over the
 * seed data, which is why the seed now does that.
 */
const TOP_HEAVY: { place: string; share: number }[] = [
  { place: "1", share: 4_000 },
  { place: "2", share: 2_200 },
  { place: "3", share: 1_300 },
  { place: "4-10", share: 1_700 },
  { place: "11-50", share: 800 },
];

const FLAT_FIELD: { place: string; share: number }[] = [
  { place: "1", share: 2_500 },
  { place: "2", share: 1_700 },
  { place: "3", share: 1_200 },
  { place: "4-20", share: 2_800 },
  { place: "21-100", share: 1_800 },
];

export const TOURNAMENTS: TournamentSeed[] = [
  {
    slug: "cipher-weekly-ranked", gameSlug: "cipher-break",
    name: "Cipher Break — Weekly Ranked",
    startsInDays: -1, runsForDays: 6, entryFee: "0", prizePool: "12000",
    maxParticipants: 5_000, status: "live",
    format: "Free entry. Best single validated session over the week; ties broken by earliest submission.",
    prizeSplit: FLAT_FIELD,
  },
  {
    slug: "neon-rush-midnight-sprint", gameSlug: "neon-rush",
    name: "Neon Rush — Midnight Sprint",
    startsInDays: 2, runsForDays: 1, entryFee: "5", prizePool: "4000",
    maxParticipants: 1_200, status: "scheduled",
    format: "Single 24-hour window. Highest server-validated score takes the pool.",
    prizeSplit: TOP_HEAVY,
  },
  {
    slug: "turbo-drift-time-trial", gameSlug: "turbo-drift",
    name: "Turbo Drift — Circuit Time Trial",
    startsInDays: 5, runsForDays: 3, entryFee: "8", prizePool: "9000",
    maxParticipants: 800, status: "scheduled",
    format: "Three tracks, one ranked lap each. Aggregate of your three best validated laps.",
    prizeSplit: TOP_HEAVY,
  },
  {
    slug: "block-forge-open", gameSlug: "block-forge",
    name: "Block Forge — Season Open",
    startsInDays: 9, runsForDays: 14, entryFee: "12", prizePool: "25000",
    maxParticipants: 2_000, status: "scheduled",
    format: "Fortnight-long ladder. Your top five validated sessions count; the rest are ignored.",
    prizeSplit: FLAT_FIELD,
  },
  {
    slug: "word-vault-daily-board", gameSlug: "word-vault",
    name: "Word Vault — Daily Board",
    startsInDays: 0, runsForDays: 1, entryFee: "3", prizePool: "1500",
    maxParticipants: 3_000, status: "live",
    format: "Everyone plays the same seeded board. One ranked attempt per member per day.",
    prizeSplit: FLAT_FIELD,
  },
];

export const GAMES: GameSeed[] = [
  {
    slug: "neon-rush", title: "Neon Rush", genre: "Arcade",
    blurb: "Endless runner through a synth-lit city. Reflex scoring with combo multipliers.",
    thumbnailHue: 18, pointsPerSessionMin: 90, pointsPerSessionMax: 620,
    entryType: "both", entryFee: "5", dailyPointsCap: 3_000, sessionPointsCap: 900, active: true,
    /* Event 2 carries a score delta already expressed in score units, so
     * scorePerUnit is 1 and the replay is a plain sum of the stream. */
    scoringConfig: { scoreEvent: 2, scorePerUnit: 1, maxScore: 12000, pointsPerScore: 0.1033 },
  },
  {
    slug: "cipher-break", title: "Cipher Break", genre: "Puzzle",
    blurb: "Timed logic puzzles. Pure skill, no randomness — the flagship ranked title.",
    thumbnailHue: 61, pointsPerSessionMin: 120, pointsPerSessionMax: 780,
    entryType: "free", entryFee: "0", dailyPointsCap: 4_000, sessionPointsCap: 1_100, active: true,
    /* Event 2 carries a score delta already expressed in score units, so
     * scorePerUnit is 1 and the replay is a plain sum of the stream. */
    scoringConfig: { scoreEvent: 2, scorePerUnit: 1, maxScore: 12000, pointsPerScore: 0.13 },
  },
  {
    slug: "turbo-drift", title: "Turbo Drift", genre: "Racing",
    blurb: "Time-trial circuit racing with ghost replays and weekly track rotation.",
    thumbnailHue: 104, pointsPerSessionMin: 100, pointsPerSessionMax: 560,
    entryType: "both", entryFee: "8", dailyPointsCap: 3_000, sessionPointsCap: 800, active: true,
    /* Event 2 carries a score delta already expressed in score units, so
     * scorePerUnit is 1 and the replay is a plain sum of the stream. */
    scoringConfig: { scoreEvent: 2, scorePerUnit: 1, maxScore: 12000, pointsPerScore: 0.0933 },
  },
  {
    slug: "block-forge", title: "Block Forge", genre: "Strategy",
    blurb: "Tile-placement builder. Deep scoring ceiling rewards long-term mastery.",
    thumbnailHue: 147, pointsPerSessionMin: 140, pointsPerSessionMax: 900,
    entryType: "both", entryFee: "12", dailyPointsCap: 4_500, sessionPointsCap: 1_300, active: true,
    /* Event 2 carries a score delta already expressed in score units, so
     * scorePerUnit is 1 and the replay is a plain sum of the stream. */
    scoringConfig: { scoreEvent: 2, scorePerUnit: 1, maxScore: 12000, pointsPerScore: 0.15 },
  },
  {
    slug: "sky-siege", title: "Sky Siege", genre: "Action",
    blurb: "Wave-defence shooter with escalating difficulty tiers.",
    thumbnailHue: 190, pointsPerSessionMin: 110, pointsPerSessionMax: 640,
    entryType: "free", entryFee: "0", dailyPointsCap: 3_200, sessionPointsCap: 950, active: true,
    /* Event 2 carries a score delta already expressed in score units, so
     * scorePerUnit is 1 and the replay is a plain sum of the stream. */
    scoringConfig: { scoreEvent: 2, scorePerUnit: 1, maxScore: 12000, pointsPerScore: 0.1067 },
  },
  {
    slug: "word-vault", title: "Word Vault", genre: "Word",
    blurb: "Vocabulary sprints with daily seeded boards — everyone plays the same board.",
    thumbnailHue: 233, pointsPerSessionMin: 80, pointsPerSessionMax: 480,
    entryType: "both", entryFee: "3", dailyPointsCap: 2_500, sessionPointsCap: 700, active: true,
    /* Event 2 carries a score delta already expressed in score units, so
     * scorePerUnit is 1 and the replay is a plain sum of the stream. */
    scoringConfig: { scoreEvent: 2, scorePerUnit: 1, maxScore: 12000, pointsPerScore: 0.08 },
  },
  {
    slug: "hex-tactics", title: "Hex Tactics", genre: "Strategy",
    blurb: "Turn-based skirmish on hex grids. Elo-rated ladder.",
    thumbnailHue: 276, pointsPerSessionMin: 150, pointsPerSessionMax: 850,
    entryType: "both", entryFee: "15", dailyPointsCap: 5_000, sessionPointsCap: 1_400, active: true,
    /* Event 2 carries a score delta already expressed in score units, so
     * scorePerUnit is 1 and the replay is a plain sum of the stream. */
    scoringConfig: { scoreEvent: 2, scorePerUnit: 1, maxScore: 12000, pointsPerScore: 0.1417 },
  },
  {
    slug: "pulse-beat", title: "Pulse Beat", genre: "Rhythm",
    blurb: "Beat-matching with community-charted tracks and accuracy grading.",
    thumbnailHue: 319, pointsPerSessionMin: 100, pointsPerSessionMax: 700,
    entryType: "free", entryFee: "0", dailyPointsCap: 3_000, sessionPointsCap: 1_000,
    /* Inactive on purpose: the admin catalogue needs one disabled row to prove
     * the active filter works, and gameplay routes must refuse it. */
    active: false,
    /* Event 2 carries a score delta already expressed in score units, so
     * scorePerUnit is 1 and the replay is a plain sum of the stream. */
    scoringConfig: { scoreEvent: 2, scorePerUnit: 1, maxScore: 12000, pointsPerScore: 0.1167 },
  },
];

export interface PoolSeed {
  poolId: number;
  name: string;
  lockDays: number;
  rewardsDurationDays: number;
  earlyPenaltyBps: number;
  active: boolean;
}

/**
 * Staking pools, mirroring the deployed contract's pool ids.
 *
 * The penalty basis points apply to UNCLAIMED REWARDS, never to principal —
 * that rule lives in StakingService and is asserted there. These rows exist so
 * the API can describe a pool before the indexer has seen its first event.
 */
export const POOLS: PoolSeed[] = [
  { poolId: 0, name: "Flexible", lockDays: 0, rewardsDurationDays: 7, earlyPenaltyBps: 0, active: true },
  { poolId: 1, name: "30-Day", lockDays: 30, rewardsDurationDays: 30, earlyPenaltyBps: 2_000, active: true },
  { poolId: 2, name: "90-Day", lockDays: 90, rewardsDurationDays: 30, earlyPenaltyBps: 3_000, active: true },
  { poolId: 3, name: "180-Day", lockDays: 180, rewardsDurationDays: 30, earlyPenaltyBps: 4_000, active: true },
];

export interface QuestSeed {
  code: string;
  title: string;
  description: string;
  kind: "daily" | "weekly" | "milestone";
  metric: "sessions" | "score" | "points" | "wins" | "tournaments" | "conversions" | "referrals";
  gameSlug?: string;
  target: number;
  rewardPoints: number;
}

/**
 * Quests.
 *
 * `metric` must be one of the metrics the tracker understands — anything else
 * is a quest that can never progress, which looks like a bug to a member and is
 * invisible to us. The codes are stable so a re-seed updates rather than
 * duplicates.
 */
export const QUESTS: QuestSeed[] = [
  { code: "daily-three-sessions", title: "Play three sessions", description: "Any game. Free mode counts.", kind: "daily", metric: "sessions", target: 3, rewardPoints: 250 },
  { code: "daily-neon-5000", title: "Score 5,000 in Neon Rush", description: "Single run.", kind: "daily", metric: "score", gameSlug: "neon-rush", target: 5_000, rewardPoints: 400 },
  { code: "daily-earn-1000", title: "Earn 1,000 Points", description: "Across any titles.", kind: "daily", metric: "points", target: 1_000, rewardPoints: 150 },
  { code: "weekly-ten-wins", title: "Win 10 ranked rounds", description: "Cipher Break or Hex Tactics.", kind: "weekly", metric: "wins", target: 10, rewardPoints: 1_500 },
  { code: "weekly-two-tournaments", title: "Enter two tournaments", description: "Any entry type.", kind: "weekly", metric: "tournaments", target: 2, rewardPoints: 1_200 },
  { code: "weekly-twenty-sessions", title: "Play twenty sessions", description: "Consistency beats intensity.", kind: "weekly", metric: "sessions", target: 20, rewardPoints: 900 },
  { code: "milestone-convert-100k", title: "Convert 100,000 Points", description: "Lifetime Points converted to MTT.", kind: "milestone", metric: "conversions", target: 100_000, rewardPoints: 5_000 },
  { code: "milestone-refer-ten", title: "Refer ten active players", description: "They must complete five sessions each.", kind: "milestone", metric: "referrals", target: 10, rewardPoints: 3_000 },
];

export interface AchievementSeed {
  code: string;
  title: string;
  description: string;
  tier: "bronze" | "silver" | "gold" | "platinum";
  rewardPoints: number;
  criteria: Record<string, unknown>;
}

export const ACHIEVEMENTS: AchievementSeed[] = [
  { code: "first-blood", title: "First Blood", description: "Complete your first game session.", tier: "bronze", rewardPoints: 100, criteria: { metric: "sessions", value: 1 } },
  { code: "century", title: "Century", description: "Play 100 sessions.", tier: "silver", rewardPoints: 750, criteria: { metric: "sessions", value: 100 } },
  { code: "converter", title: "Converter", description: "Convert Points to MTT for the first time.", tier: "bronze", rewardPoints: 200, criteria: { metric: "conversions", value: 1 } },
  { code: "staker", title: "Staker", description: "Open your first staking position.", tier: "bronze", rewardPoints: 300, criteria: { metric: "stakes", value: 1 } },
  { code: "podium", title: "Podium", description: "Finish top three in any tournament.", tier: "gold", rewardPoints: 2_500, criteria: { metric: "tournament_rank", value: 3 } },
  { code: "diamond-hands", title: "Diamond Hands", description: "Hold a 180-day stake to maturity.", tier: "platinum", rewardPoints: 5_000, criteria: { metric: "stake_matured_days", value: 180 } },
  { code: "community-builder", title: "Community Builder", description: "Refer ten active players.", tier: "gold", rewardPoints: 3_000, criteria: { metric: "referrals", value: 10 } },
];

export interface StoreItemSeed {
  sku: string;
  name: string;
  description: string;
  category: "cosmetic" | "boost" | "energy" | "pass";
  rarity: "common" | "rare" | "epic" | "legendary";
  priceMtt: string;
  pricePoints: number | null;
  hue: number;
  consumable: boolean;
  tradable: boolean;
}

/**
 * Store catalogue.
 *
 * Two price columns, because they are two different economic events: an MTT
 * purchase is platform revenue and therefore commissionable, while a Points
 * purchase is a sink that creates no revenue event at all. Items priced in both
 * exist so that distinction is exercised.
 */
export const STORE_ITEMS: StoreItemSeed[] = [
  { sku: "SKIN-NEON-01", name: "Neon Circuit Skin", description: "Animated trail for Neon Rush.", category: "cosmetic", rarity: "rare", priceMtt: "45", pricePoints: 40_000, hue: 24, consumable: false, tradable: true },
  { sku: "SKIN-HEX-01", name: "Obsidian Hex Board", description: "Board theme for Hex Tactics.", category: "cosmetic", rarity: "epic", priceMtt: "120", pricePoints: null, hue: 276, consumable: false, tradable: true },
  { sku: "BOOST-PTS-20", name: "Points Boost +20%", description: "Twenty-four hours of boosted Points.", category: "boost", rarity: "common", priceMtt: "15", pricePoints: 12_000, hue: 104, consumable: true, tradable: false },
  { sku: "BOOST-PTS-50", name: "Points Boost +50%", description: "Six hours of heavily boosted Points.", category: "boost", rarity: "rare", priceMtt: "30", pricePoints: 26_000, hue: 147, consumable: true, tradable: false },
  { sku: "ENERGY-05", name: "Energy Refill ×5", description: "Five extra paid-mode entries.", category: "energy", rarity: "common", priceMtt: "10", pricePoints: 9_000, hue: 190, consumable: true, tradable: false },
  { sku: "PASS-SEASON-01", name: "Season One Pass", description: "Season rewards track and ranked access.", category: "pass", rarity: "legendary", priceMtt: "250", pricePoints: null, hue: 319, consumable: false, tradable: false },
];

export interface FraudRuleSeed {
  code: string;
  name: string;
  description: string;
  kind:
    | "velocity" | "structuring" | "self_referral_ring" | "bot_farming"
    | "multi_account" | "device_cluster" | "impossible_travel" | "cap_hugging";
  thresholds: Record<string, number>;
  baseRiskScore: number;
}

/**
 * Detection rules, seeded ENABLED but ADVISORY.
 *
 * `autoFreeze` is false on every row and is not seedable here on purpose:
 * freezing a member's funds without a human decision is a policy choice that
 * belongs to Compliance, made deliberately in the admin UI where it is audited —
 * not something a seed script turns on for a whole platform.
 */
export const FRAUD_RULES: FraudRuleSeed[] = [
  { code: "FR-VELOCITY", name: "Withdrawal velocity", description: "Many withdrawal requests in a short window — the signature of an account being drained.", kind: "velocity", thresholds: { windowMinutes: 60, maxWithdrawals: 5 }, baseRiskScore: 60 },
  { code: "FR-STRUCTURING", name: "Structuring", description: "Repeated withdrawals sized just under the review threshold. Each is individually compliant; the intent shows in the sequence.", kind: "structuring", thresholds: { windowHours: 24, minCount: 3, withinPctOfThreshold: 95 }, baseRiskScore: 75 },
  { code: "FR-SELF-REFERRAL", name: "Mutual referral ring", description: "Accounts referring each other, which manufactures commission from no real spend.", kind: "self_referral_ring", thresholds: { minMutualPairs: 1 }, baseRiskScore: 80 },
  { code: "FR-BOT-FARMING", name: "Bot farming", description: "High session volume with implausibly short durations.", kind: "bot_farming", thresholds: { windowHours: 24, minSessions: 60, maxMedianDurationMs: 4_000 }, baseRiskScore: 70 },
  { code: "FR-MULTI-ACCOUNT", name: "Multi-accounting", description: "Several accounts sharing a device fingerprint.", kind: "multi_account", thresholds: { windowDays: 30, maxAccountsPerDevice: 3 }, baseRiskScore: 65 },
  { code: "FR-DEVICE-CLUSTER", name: "Device cluster", description: "A larger cluster of accounts on one device, typical of a farm.", kind: "device_cluster", thresholds: { windowDays: 7, maxAccountsPerDevice: 5 }, baseRiskScore: 70 },
  { code: "FR-IMPOSSIBLE-TRAVEL", name: "Impossible travel", description: "Sign-ins from locations no traveller could cover in the time between them.", kind: "impossible_travel", thresholds: { maxKmPerHour: 900 }, baseRiskScore: 55 },
  { code: "FR-CAP-HUGGING", name: "Cap hugging", description: "An account earning exactly to its daily cap, day after day — automation, not play.", kind: "cap_hugging", thresholds: { windowDays: 7, minDaysAtCap: 6 }, baseRiskScore: 50 },
];

/** Role → module permission matrix. Least privilege, and only one role approves. */
export const ROLE_PERMISSIONS: {
  role: string;
  module: string;
  canRead: boolean;
  canWrite: boolean;
  canApprove: boolean;
}[] = [
  /* Support sees members and tickets, and can change neither money nor policy. */
  { role: "support", module: "members", canRead: true, canWrite: false, canApprove: false },
  { role: "support", module: "support", canRead: true, canWrite: true, canApprove: false },
  { role: "support", module: "kyc", canRead: true, canWrite: false, canApprove: false },

  /* Compliance reviews identity and payouts, and approves what Finance proposes. */
  { role: "compliance", module: "members", canRead: true, canWrite: true, canApprove: false },
  { role: "compliance", module: "kyc", canRead: true, canWrite: true, canApprove: true },
  { role: "compliance", module: "withdrawals", canRead: true, canWrite: true, canApprove: true },
  { role: "compliance", module: "fraud", canRead: true, canWrite: true, canApprove: true },
  { role: "compliance", module: "reports", canRead: true, canWrite: false, canApprove: false },
  { role: "compliance", module: "legal", canRead: true, canWrite: false, canApprove: true },

  /* Finance proposes economic policy but cannot approve its own proposal. */
  { role: "finance_admin", module: "treasury", canRead: true, canWrite: true, canApprove: false },
  { role: "finance_admin", module: "conversion", canRead: true, canWrite: true, canApprove: false },
  { role: "finance_admin", module: "commission", canRead: true, canWrite: true, canApprove: false },
  { role: "finance_admin", module: "reports", canRead: true, canWrite: true, canApprove: false },
  { role: "finance_admin", module: "withdrawals", canRead: true, canWrite: false, canApprove: false },

  /* Super admin reads everything and approves; the four-eyes check still stops
   * them approving their own request. */
  { role: "super_admin", module: "members", canRead: true, canWrite: true, canApprove: true },
  { role: "super_admin", module: "treasury", canRead: true, canWrite: true, canApprove: true },
  { role: "super_admin", module: "conversion", canRead: true, canWrite: true, canApprove: true },
  { role: "super_admin", module: "commission", canRead: true, canWrite: true, canApprove: true },
  { role: "super_admin", module: "withdrawals", canRead: true, canWrite: true, canApprove: true },
  { role: "super_admin", module: "fraud", canRead: true, canWrite: true, canApprove: true },
  { role: "super_admin", module: "legal", canRead: true, canWrite: true, canApprove: true },
  { role: "super_admin", module: "config", canRead: true, canWrite: true, canApprove: true },
  { role: "super_admin", module: "reports", canRead: true, canWrite: true, canApprove: true },

  /* ------------------------------------------------------------------------ *
   * The dual-control queue.
   *
   * Every role that can be asked to be the second pair of eyes needs to be able
   * to DECIDE a request — otherwise a four-eyes flow has a proposer and no
   * approver, and the change simply never happens. Finance is deliberately
   * included: it approves other people's requests, and the four-eyes check
   * itself is what stops it approving its own.
   * ------------------------------------------------------------------------ */
  { role: "compliance", module: "approvals", canRead: true, canWrite: true, canApprove: true },
  { role: "finance_admin", module: "approvals", canRead: true, canWrite: true, canApprove: true },
  { role: "super_admin", module: "approvals", canRead: true, canWrite: true, canApprove: true },
  /* Support can see the queue so it can tell a member their case is with a
   * reviewer, and cannot decide anything in it. */
  { role: "support", module: "approvals", canRead: true, canWrite: false, canApprove: false },

  /* ------------------------------------------------------------------------ *
   * Content and catalogue.
   *
   * These are the screens that change what members see and what they can buy.
   * They move money indirectly — a mispriced store item or an over-generous
   * points rule is an economic change — so writing them sits with Super Admin,
   * while Finance and Compliance can read what is live.
   * ------------------------------------------------------------------------ */
  { role: "super_admin", module: "cms", canRead: true, canWrite: true, canApprove: true },
  { role: "super_admin", module: "games", canRead: true, canWrite: true, canApprove: true },
  { role: "super_admin", module: "quests", canRead: true, canWrite: true, canApprove: true },
  { role: "super_admin", module: "store", canRead: true, canWrite: true, canApprove: true },
  { role: "super_admin", module: "tournaments", canRead: true, canWrite: true, canApprove: true },
  { role: "super_admin", module: "staking", canRead: true, canWrite: true, canApprove: true },
  { role: "super_admin", module: "notifications", canRead: true, canWrite: true, canApprove: true },

  /* Finance owns the economics of the catalogue: pool parameters and prize
   * settlement are treasury decisions wearing a game's clothes. */
  { role: "finance_admin", module: "staking", canRead: true, canWrite: true, canApprove: false },
  { role: "finance_admin", module: "tournaments", canRead: true, canWrite: false, canApprove: true },
  { role: "finance_admin", module: "games", canRead: true, canWrite: false, canApprove: false },
  { role: "finance_admin", module: "quests", canRead: true, canWrite: false, canApprove: false },
  { role: "finance_admin", module: "store", canRead: true, canWrite: false, canApprove: false },

  /* Compliance reads the catalogue because a promotion is a marketing claim. */
  { role: "compliance", module: "cms", canRead: true, canWrite: true, canApprove: false },
  { role: "compliance", module: "games", canRead: true, canWrite: false, canApprove: false },
  { role: "compliance", module: "quests", canRead: true, canWrite: false, canApprove: false },
  { role: "compliance", module: "store", canRead: true, canWrite: false, canApprove: false },
  { role: "compliance", module: "tournaments", canRead: true, canWrite: false, canApprove: false },
  { role: "compliance", module: "staking", canRead: true, canWrite: false, canApprove: false },
  { role: "compliance", module: "notifications", canRead: true, canWrite: true, canApprove: false },

  { role: "support", module: "games", canRead: true, canWrite: false, canApprove: false },
  { role: "support", module: "quests", canRead: true, canWrite: false, canApprove: false },
  { role: "support", module: "store", canRead: true, canWrite: false, canApprove: false },
  { role: "support", module: "tournaments", canRead: true, canWrite: false, canApprove: false },

  /* ------------------------------------------------------------------------ *
   * Chain operations.
   *
   * Requeueing a stuck transaction or rewinding an indexer cursor is not a
   * business decision, but it is an irreversible one against a live chain. It
   * belongs to exactly one role.
   * ------------------------------------------------------------------------ */
  { role: "super_admin", module: "chain", canRead: true, canWrite: true, canApprove: true },
  { role: "finance_admin", module: "chain", canRead: true, canWrite: false, canApprove: false },
  { role: "compliance", module: "chain", canRead: true, canWrite: false, canApprove: false },

  /* Super Admin also needs the two modules the other roles own day to day, or
   * it cannot cover for them. */
  { role: "super_admin", module: "kyc", canRead: true, canWrite: true, canApprove: true },
  { role: "super_admin", module: "support", canRead: true, canWrite: true, canApprove: true },
];
