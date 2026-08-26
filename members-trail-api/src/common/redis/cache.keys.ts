/* ============================================================================
 * Every cache key in the application. Centralised so TTLs are reviewable and
 * invalidation can't miss a key that was invented inline somewhere.
 *
 * Financial figures are deliberately NOT cached beyond a couple of seconds —
 * FRD D-01 requires balances to be read live from the ledger.
 * ========================================================================== */

export const CacheKeys = {
  /* identity */
  session: (jti: string) => `session:${jti}`,
  refresh: (userId: string, jti: string) => `refresh:${userId}:${jti}`,
  loginAttempts: (identifier: string) => `login:attempts:${identifier}`,
  otp: (channel: string, target: string) => `otp:${channel}:${target}`,
  otpAttempts: (channel: string, target: string) => `otp:attempts:${channel}:${target}`,
  otpCooldown: (channel: string, target: string) => `otp:cooldown:${channel}:${target}`,
  passwordReset: (tokenHash: string) => `pwreset:${tokenHash}`,
  twoFaChallenge: (challengeId: string) => `2fa:${challengeId}`,

  /* economy — short TTLs only */
  balances: (userId: string) => `bal:${userId}`,
  conversionRate: () => `cfg:conversion-rate`,
  platformConfig: (key: string) => `cfg:${key}`,

  /* caps — day/month buckets, keyed by period so they expire naturally */
  pointsIssuedToday: (userId: string, day: string) => `cap:points:${userId}:${day}`,
  pointsIssuedTodayGame: (userId: string, gameId: string, day: string) => `cap:points:${userId}:${gameId}:${day}`,
  conversionToday: (userId: string, day: string) => `cap:conv:${userId}:${day}`,
  conversionMonth: (userId: string, month: string) => `cap:conv:${userId}:${month}`,
  commissionMonth: (userId: string, month: string) => `cap:comm:${userId}:${month}`,

  /* leaderboards */
  leaderboard: (metric: string, period: string) => `lb:${metric}:${period}`,

  /* chain */
  indexerCursor: (contract: string) => `idx:cursor:${contract}`,
  chainRead: (fn: string, args: string) => `chain:${fn}:${args}`,

  /* idempotency & locks */
  idempotency: (scope: string, key: string) => `idem:${scope}:${key}`,
  /** Short-lived guard against two copies of one delivery arriving at once. */
  webhookInflight: (provider: string, eventId: string) => `wh:${provider}:${eventId}`,

  /* public stats */
  publicStats: () => `public:stats`,

  /* dashboard analytics — a monthly series, not a live figure */
  analytics: (name: string, months: number) => `analytics:${name}:${months}`,
} as const;

/** TTLs in seconds. Named so a reviewer can see intent, not just a number. */
export const Ttl = {
  /** Financial figures: effectively live. */
  balances: 3,
  publicStats: 300,
  /** Long enough that a stand-up costs one query; short enough that a reconciliation shows up. */
  analytics: 60,
  platformConfig: 60,
  conversionRate: 30,
  chainRead: 15,
  leaderboard: 60,
  /** Caps live until the period rolls over; set explicitly by the caller. */
  day: 60 * 60 * 26,
  month: 60 * 60 * 24 * 32,
  idempotency: 60 * 60 * 24,
  /**
   * Two minutes, not seven days.
   *
   * This key only has to catch the case the database cannot: two copies of the
   * same delivery in flight at the same instant, before either has committed a
   * row. Durable deduplication is the UNIQUE(provider, eventId) index, which
   * never expires. A week-long reservation added nothing and created a real
   * failure mode — after a database restore, or in a fresh environment sharing a
   * Redis, a genuine delivery would be answered "duplicate" while no row existed
   * for it.
   */
  webhookInflight: 120,
} as const;
