/* ============================================================================
 * Every react-query cache key in the app.
 *
 * Centralised for one reason: invalidation. A mutation and a socket event both
 * need to say "the balance changed", and if the key is spelled inline in three
 * places then two of them will eventually disagree and the screen will show a
 * stale figure with no error anywhere. Keys are also hierarchical — invalidating
 * `qk.wallet()` clears the balance, the transaction list and the withdrawals in
 * one call, because after a withdrawal all three are wrong together.
 *
 * The convention is `[domain, ...specifics]`, coarsest first.
 * ========================================================================== */

export const qk = {
  /* identity */
  me: () => ["me"] as const,
  security: () => ["me", "security"] as const,
  sessions: () => ["me", "sessions"] as const,
  loginHistory: () => ["me", "login-history"] as const,

  /* money — the balance is its own key because almost everything invalidates it */
  wallet: () => ["wallet"] as const,
  balance: () => ["wallet", "balance"] as const,
  transactions: (filters?: unknown) => ["wallet", "transactions", filters ?? null] as const,
  withdrawals: () => ["wallet", "withdrawals"] as const,
  withdrawalLimits: () => ["wallet", "withdrawal-limits"] as const,
  walletAddresses: () => ["wallet", "addresses"] as const,
  deposits: () => ["wallet", "deposits"] as const,

  /* points and conversion */
  points: () => ["points"] as const,
  pointsHistory: (filters?: unknown) => ["points", "history", filters ?? null] as const,
  pointsSummary: () => ["points", "summary"] as const,
  pointsCaps: () => ["points", "caps"] as const,
  conversion: () => ["conversion"] as const,
  conversionRate: () => ["conversion", "rate"] as const,
  conversionSummary: () => ["conversion", "summary"] as const,
  conversionQuote: (points: number) => ["conversion", "quote", points] as const,

  /* play */
  games: () => ["games"] as const,
  game: (slug: string) => ["games", slug] as const,
  tournaments: () => ["tournaments"] as const,
  /* Whose entries these are is the caller's; the key is per-session because the
     whole cache is cleared on sign-out. */
  myTournamentEntries: () => ["tournaments", "mine"] as const,
  tournament: (ref: string) => ["tournaments", ref] as const,
  leaderboard: (metric?: string, period?: string) =>
    ["leaderboard", metric ?? "points", period ?? "weekly"] as const,
  quests: () => ["quests"] as const,
  achievements: () => ["quests", "achievements"] as const,

  /* staking */
  staking: () => ["staking"] as const,
  stakingPools: () => ["staking", "pools"] as const,
  stakePositions: () => ["staking", "positions"] as const,
  stakingRewards: () => ["staking", "rewards"] as const,

  /* referral */
  referral: () => ["referral"] as const,
  referralStats: () => ["referral", "stats"] as const,
  referralCap: () => ["referral", "cap"] as const,
  referralDownline: () => ["referral", "downline"] as const,
  commissions: () => ["referral", "commissions"] as const,

  /* store */
  store: () => ["store"] as const,
  storeItems: () => ["store", "items"] as const,
  inventory: () => ["store", "inventory"] as const,
  market: () => ["store", "market"] as const,
  marketPolicy: () => ["store", "market", "policy"] as const,

  /* comms */
  notifications: () => ["notifications"] as const,
  notificationUnread: () => ["notifications", "unread"] as const,
  notificationPrefs: () => ["notifications", "preferences"] as const,
  tickets: () => ["tickets"] as const,
  ticket: (ref: string) => ["tickets", ref] as const,

  /* kyc + legal */
  kycMine: () => ["kyc", "mine"] as const,
  legalDocuments: () => ["legal", "documents"] as const,
  legalDocument: (slug: string) => ["legal", "documents", slug] as const,

  /* public */
  publicStats: () => ["public", "stats"] as const,
  publicConfig: () => ["public", "config"] as const,

  /* admin */
  admin: () => ["admin"] as const,
  adminMe: () => ["admin", "me"] as const,
  adminKpis: () => ["admin", "kpis"] as const,
  adminMembers: (filters?: unknown) => ["admin", "members", filters ?? null] as const,
  adminStaff: () => ["admin", "staff"] as const,
  adminPermissions: () => ["admin", "permissions"] as const,
  adminApprovals: () => ["admin", "approvals"] as const,
  adminAudit: (filters?: unknown) => ["admin", "audit", filters ?? null] as const,
  adminKycQueue: () => ["admin", "kyc-queue"] as const,
  adminFraudAlerts: () => ["admin", "fraud", "alerts"] as const,
  adminFraudRules: () => ["admin", "fraud", "rules"] as const,
  adminTreasuryInflows: () => ["admin", "treasury", "inflows"] as const,
  adminTreasuryOutflows: () => ["admin", "treasury", "outflows"] as const,
  adminTreasuryDashboard: () => ["admin", "treasury", "dashboard"] as const,
  adminConversionRates: () => ["admin", "conversion", "rates"] as const,
  adminConversionCaps: () => ["admin", "conversion", "caps"] as const,
  adminCommissionPlans: () => ["admin", "commission", "plans"] as const,
  adminCommissions: () => ["admin", "commission", "list"] as const,
  adminSolvency: () => ["admin", "commission", "solvency"] as const,
  adminPointsRules: () => ["admin", "games", "points-rules"] as const,
  adminGames: () => ["admin", "games"] as const,
  adminTournaments: () => ["admin", "tournaments"] as const,
  adminStakingPools: () => ["admin", "staking", "pools"] as const,
  adminStoreItems: () => ["admin", "store", "items"] as const,
  adminTickets: (filters?: unknown) => ["admin", "tickets", filters ?? null] as const,
  adminTicket: (ref: string) => ["admin", "tickets", ref] as const,
  adminLegalDocuments: () => ["admin", "legal", "documents"] as const,
  adminCmsContent: () => ["admin", "cms", "content"] as const,
  adminWithdrawals: () => ["admin", "wallet", "withdrawals"] as const,
  adminChainStatus: () => ["admin", "chain", "status"] as const,

  /* admin analytics */
  analytics: () => ["admin", "analytics"] as const,
  revenueByStream: (months: number) => ["admin", "analytics", "revenue", months] as const,
  payoutVsInflow: (months: number) => ["admin", "analytics", "payout", months] as const,
  stakingTvl: (months: number) => ["admin", "analytics", "tvl", months] as const,
  kycFunnel: () => ["admin", "analytics", "kyc-funnel"] as const,
  cohortRetention: (months: number) => ["admin", "analytics", "cohort", months] as const,
} as const;
