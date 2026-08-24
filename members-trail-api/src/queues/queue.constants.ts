/* ============================================================================
 * Queue registry.
 *
 * Queues live in this folder, isolated from feature modules, so the worker
 * fleet can be deployed separately from the API by simply running the app with
 * QUEUE_WORKERS_ENABLED=true and the HTTP server disabled. Nothing in a feature
 * module imports a processor — they enqueue by name only.
 * ========================================================================== */

export const Queues = {
  /** Server-side game result validation and Points crediting. */
  GameValidation: "game-validation",
  /** Fans a settled revenue event out to the upline. The compliance-critical one. */
  Commission: "commission",
  /** Signs and submits on-chain transactions with managed nonces. */
  ChainTx: "chain-tx",
  /** Indexes contract events in batches with reorg handling. */
  ChainIndex: "chain-index",
  /** Email / SMS / push fanout. */
  Notification: "notification",
  /** Payment and KYC provider callbacks, processed off the request path. */
  Webhook: "webhook",
  /** Outbound webhooks to partners, with retry/backoff. */
  OutboundWebhook: "outbound-webhook",
  /** Withdrawal lifecycle: cooling-off release, compliance routing, payout. */
  Withdrawal: "withdrawal",
  /** Fraud rule evaluation, off the hot path. */
  Fraud: "fraud",
  /** Report generation and CSV/PDF exports. */
  Report: "report",
  /** Leaderboard rebuilds and snapshotting. */
  Leaderboard: "leaderboard",
  /** Treasury period rollups and reconciliation. */
  Treasury: "treasury",
} as const;

export type QueueName = (typeof Queues)[keyof typeof Queues];
export const ALL_QUEUES: QueueName[] = Object.values(Queues);

/**
 * Per-queue job options. Money-moving queues get more attempts and longer
 * backoff than cosmetic ones, and none of them lose their history immediately —
 * `removeOnComplete` keeps a window for debugging a user's complaint.
 */
export const QueueDefaults: Record<QueueName, {
  attempts: number;
  backoffMs: number;
  removeOnComplete: number;
  removeOnFail: number;
  /** Optional per-queue rate cap, e.g. to respect an RPC provider's limits. */
  limiter?: { max: number; duration: number };
}> = {
  [Queues.GameValidation]: { attempts: 3, backoffMs: 2_000, removeOnComplete: 1_000, removeOnFail: 5_000 },
  [Queues.Commission]:     { attempts: 8, backoffMs: 10_000, removeOnComplete: 5_000, removeOnFail: 20_000 },
  [Queues.ChainTx]:        { attempts: 6, backoffMs: 15_000, removeOnComplete: 5_000, removeOnFail: 20_000, limiter: { max: 5, duration: 1_000 } },
  [Queues.ChainIndex]:     { attempts: 5, backoffMs: 5_000, removeOnComplete: 200, removeOnFail: 1_000, limiter: { max: 10, duration: 1_000 } },
  [Queues.Notification]:   { attempts: 5, backoffMs: 5_000, removeOnComplete: 2_000, removeOnFail: 10_000 },
  [Queues.Webhook]:        { attempts: 6, backoffMs: 5_000, removeOnComplete: 2_000, removeOnFail: 20_000 },
  [Queues.OutboundWebhook]:{ attempts: 8, backoffMs: 30_000, removeOnComplete: 1_000, removeOnFail: 10_000 },
  [Queues.Withdrawal]:     { attempts: 6, backoffMs: 20_000, removeOnComplete: 5_000, removeOnFail: 20_000 },
  [Queues.Fraud]:          { attempts: 3, backoffMs: 5_000, removeOnComplete: 1_000, removeOnFail: 5_000 },
  [Queues.Report]:         { attempts: 2, backoffMs: 30_000, removeOnComplete: 200, removeOnFail: 500 },
  [Queues.Leaderboard]:    { attempts: 3, backoffMs: 5_000, removeOnComplete: 100, removeOnFail: 500 },
  [Queues.Treasury]:       { attempts: 5, backoffMs: 15_000, removeOnComplete: 500, removeOnFail: 2_000 },
};

/* --------------------------------- job names ------------------------------ */

export const Jobs = {
  ValidateSession: "validate-session",
  ProcessRevenueEvent: "process-revenue-event",
  ReleaseCommission: "release-commission",
  ClawbackCommission: "clawback-commission",
  SubmitTx: "submit-tx",
  WatchTx: "watch-tx",
  IndexRange: "index-range",
  SyncStaking: "sync-staking",
  SendNotification: "send-notification",
  ProcessWebhook: "process-webhook",
  DeliverWebhook: "deliver-webhook",
  ReleaseCoolingOff: "release-cooling-off",
  ProcessWithdrawal: "process-withdrawal",
  EvaluateFraudRules: "evaluate-fraud-rules",
  GenerateReport: "generate-report",
  RebuildLeaderboard: "rebuild-leaderboard",
  SnapshotLeaderboard: "snapshot-leaderboard",
  RollupTreasuryPeriod: "rollup-treasury-period",
  ReconcileSettlements: "reconcile-settlements",
  SettleTournament: "settle-tournament",
} as const;

export type JobName = (typeof Jobs)[keyof typeof Jobs];

/* --------------------------------- job ids -------------------------------- */

/**
 * Sanitises a domain idempotency key into a BullMQ custom job id.
 *
 * BullMQ refuses a custom id containing ":" — it concatenates the id into the
 * Redis key `<prefix>:<queue>:<id>`, so a colon inside the id could push a job
 * into a neighbouring key namespace. Our idempotency keys are colon-delimited
 * everywhere else in the codebase (`payout:<id>`, `deposit:<id>`) because that
 * is the ledger's convention, so this is the single place that translates.
 *
 * Anything outside [A-Za-z0-9._-] collapses to a "-", so a fragment that ever
 * came from user input cannot shape a Redis key. The prefixes are distinct per
 * call site, which is what keeps two different keys from mapping onto the same
 * id — the substitution is not reversible, so a new caller must not rely on the
 * raw key surviving.
 */
export function jobKey(key: string): string {
  const sanitised = key.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  /* An empty id would make BullMQ generate a sequential one, silently losing
   * the deduplication the caller asked for. Better to fail loudly. */
  if (sanitised.length === 0) throw new Error(`jobKey: "${key}" sanitises to an empty job id`);
  return sanitised;
}
