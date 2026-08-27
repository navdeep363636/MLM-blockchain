import { Column, Entity, Index, Unique } from "typeorm";
import { BaseEntity } from "./base.entity";

/* ============================================================================
 * Admin, governance, fraud and chain-integration tables.
 * ========================================================================== */

/* -------------------------------- audit log ------------------------------- */

/**
 * Append-only. There is no update or delete path in the service, and the
 * migration grants only INSERT/SELECT to the application user in production
 * (see the note in the initial migration).
 */
@Entity("audit_logs")
@Index("idx_audit_actor_time", ["actorId", "createdAt"])
@Index("idx_audit_action", ["action"])
@Index("idx_audit_target", ["targetType", "targetId"])
export class AuditLog extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  @Column({ type: "uuid", nullable: true })
  actorId?: string | null;

  @Column({ type: "varchar", length: 60, nullable: true })
  actorRole?: string | null;

  /** Dotted verb, e.g. "treasury.outflow.approve", "kyc.decision.reject". */
  @Column({ type: "varchar", length: 120 })
  action!: string;

  @Column({ type: "varchar", length: 60, nullable: true })
  targetType?: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  targetId?: string | null;

  @Column({ type: "json", nullable: true })
  before?: Record<string, unknown> | null;

  @Column({ type: "json", nullable: true })
  after?: Record<string, unknown> | null;

  @Column({ type: "text", nullable: true })
  reason?: string | null;

  @Column({ type: "boolean", default: false })
  requiredSecondApproval!: boolean;

  @Column({ type: "uuid", nullable: true })
  approvedById?: string | null;

  @Column({ type: "varchar", length: 45, nullable: true })
  ip?: string | null;

  @Column({ type: "varchar", length: 400, nullable: true })
  userAgent?: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  requestId?: string | null;
}

/* --------------------------- four-eyes approvals -------------------------- */

export type ApprovalKind =
  | "conversion_rate" | "commission_plan" | "treasury_outflow" | "balance_adjustment"
  | "points_rule" | "staking_pool" | "user_status" | "legal_publish" | "role_assignment";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "applied";

/**
 * Generic dual-control record. Anything that moves money or changes the
 * compensation plan creates one of these; the applying service refuses to act
 * until `status = 'approved'` and `approverId != requesterId`.
 */
@Entity("approval_requests")
@Index("idx_approval_status_kind", ["status", "kind"])
export class ApprovalRequest extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  @Column({ type: "enum", enum: [
    "conversion_rate", "commission_plan", "treasury_outflow", "balance_adjustment",
    "points_rule", "staking_pool", "user_status", "legal_publish", "role_assignment",
  ] })
  kind!: ApprovalKind;

  @Column({ type: "varchar", length: 64, nullable: true })
  targetId?: string | null;

  @Column({ type: "json" })
  payload!: Record<string, unknown>;

  @Column({ type: "text" })
  reason!: string;

  @Column({ type: "uuid" })
  requestedById!: string;

  @Column({ type: "uuid", nullable: true })
  approverId?: string | null;

  @Column({ type: "enum", enum: ["pending", "approved", "rejected", "expired", "applied"], default: "pending" })
  status!: ApprovalStatus;

  @Column({ type: "text", nullable: true })
  decisionNote?: string | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  decidedAt?: Date | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  appliedAt?: Date | null;

  /** Pending approvals expire so a stale request can't be applied months later. */
  @Column({ type: "datetime", precision: 6 })
  expiresAt!: Date;

  /** True for actions the policy says need a hardware key, not just a password. */
  @Column({ type: "boolean", default: false })
  requiresHardwareKey!: boolean;
}

/* ------------------------------- RBAC matrix ------------------------------ */

@Entity("role_permissions")
@Unique("uq_roleperm", ["role", "module"])
export class RolePermission extends BaseEntity {
  @Column({ type: "varchar", length: 40 })
  role!: string;

  @Column({ type: "varchar", length: 60 })
  module!: string;

  @Column({ type: "boolean", default: false })
  canRead!: boolean;

  @Column({ type: "boolean", default: false })
  canWrite!: boolean;

  @Column({ type: "boolean", default: false })
  canApprove!: boolean;
}

/* ----------------------------- platform config ---------------------------- */

/**
 * Runtime configuration. Overrides the env defaults so Finance/Legal can change
 * a threshold without a deploy — and every change is versioned and audited.
 */
@Entity("platform_config")
@Unique("uq_config_key_version", ["key", "version"])
@Index("idx_config_active", ["key", "active"])
export class PlatformConfig extends BaseEntity {
  @Column({ type: "varchar", length: 120 })
  key!: string;

  @Column({ type: "json" })
  value!: unknown;

  @Column({ type: "int", default: 1 })
  version!: number;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @Column({ type: "datetime", precision: 6 })
  effectiveFrom!: Date;

  @Column({ type: "uuid", nullable: true })
  updatedById?: string | null;

  @Column({ type: "text", nullable: true })
  note?: string | null;
}

/* -------------------------------- fraud ----------------------------------- */

export type FraudAlertKind =
  | "velocity" | "structuring" | "self_referral_ring" | "bot_farming"
  | "multi_account" | "device_cluster" | "impossible_travel" | "cap_hugging";

export type FraudSeverity = "low" | "medium" | "high" | "critical";
export type FraudAlertStatus = "open" | "investigating" | "actioned" | "dismissed";

@Entity("fraud_alerts")
@Index("idx_fraud_status_sev", ["status", "severity"])
@Index("idx_fraud_created", ["createdAt"])
export class FraudAlert extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  @Column({ type: "enum", enum: [
    "velocity", "structuring", "self_referral_ring", "bot_farming",
    "multi_account", "device_cluster", "impossible_travel", "cap_hugging",
  ] })
  kind!: FraudAlertKind;

  @Column({ type: "enum", enum: ["low", "medium", "high", "critical"] })
  severity!: FraudSeverity;

  @Column({ type: "int" })
  riskScore!: number;

  @Column({ type: "json" })
  affectedUserIds!: string[];

  @Column({ type: "text" })
  summary!: string;

  /** The specific signals that fired — what a reviewer needs to judge it. */
  @Column({ type: "json" })
  signals!: string[];

  @Column({ type: "json", nullable: true })
  evidence?: Record<string, unknown> | null;

  @Column({ type: "enum", enum: ["open", "investigating", "actioned", "dismissed"], default: "open" })
  status!: FraudAlertStatus;

  @Column({ type: "uuid", nullable: true })
  assigneeId?: string | null;

  @Column({ type: "text", nullable: true })
  resolutionNote?: string | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  resolvedAt?: Date | null;

  /** Dedupe key so the same pattern doesn't raise an alert every cron tick. */
  @Column({ type: "varchar", length: 128, nullable: true })
  @Index("idx_fraud_dedupe")
  dedupeKey?: string | null;
}

@Entity("fraud_rules")
@Unique("uq_fraud_rule_code", ["code"])
export class FraudRule extends BaseEntity {
  @Column({ type: "varchar", length: 64 })
  code!: string;

  @Column({ type: "varchar", length: 160 })
  name!: string;

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "enum", enum: [
    "velocity", "structuring", "self_referral_ring", "bot_farming",
    "multi_account", "device_cluster", "impossible_travel", "cap_hugging",
  ] })
  kind!: FraudAlertKind;

  /** Thresholds, e.g. { windowMinutes: 40, maxWithdrawals: 6 }. */
  @Column({ type: "json" })
  thresholds!: Record<string, number>;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  /** Whether firing should auto-freeze the account or only raise an alert. */
  @Column({ type: "boolean", default: false })
  autoFreeze!: boolean;

  @Column({ type: "int", default: 50 })
  baseRiskScore!: number;
}

/* --------------------------------- legal ---------------------------------- */

@Entity("legal_documents")
@Unique("uq_legal_slug_version", ["slug", "version"])
@Index("idx_legal_status", ["slug", "status"])
export class LegalDocument extends BaseEntity {
  @Column({ type: "varchar", length: 64 })
  slug!: string;

  @Column({ type: "varchar", length: 200 })
  title!: string;

  @Column({ type: "varchar", length: 20 })
  version!: string;

  @Column({ type: "enum", enum: ["draft", "legal_review", "published", "archived"], default: "draft" })
  status!: "draft" | "legal_review" | "published" | "archived";

  @Column({ type: "text" })
  summary!: string;

  @Column({ type: "json" })
  sections!: { heading: string; body: string[] }[];

  /** A material change forces re-acceptance on next login (FRD AD-11). */
  @Column({ type: "boolean", default: false })
  materialChange!: boolean;

  @Column({ type: "datetime", precision: 6, nullable: true })
  effectiveFrom?: Date | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  publishedAt?: Date | null;

  @Column({ type: "uuid", nullable: true })
  authoredById?: string | null;

  @Column({ type: "uuid", nullable: true })
  approvedById?: string | null;
}

@Entity("cms_content")
@Unique("uq_cms_key_locale", ["key", "locale"])
export class CmsContent extends BaseEntity {
  @Column({ type: "varchar", length: 120 })
  key!: string;

  @Column({ type: "varchar", length: 8, default: "en" })
  locale!: string;

  @Column({ type: "json" })
  content!: unknown;

  @Column({ type: "enum", enum: ["draft", "published"], default: "draft" })
  status!: "draft" | "published";

  @Column({ type: "uuid", nullable: true })
  updatedById?: string | null;
}

/* ------------------------------ chain layer ------------------------------- */

/**
 * Indexer cursor. Storing the block HASH alongside the number is what makes
 * reorg detection possible: on each tick we re-read the stored block and, if
 * its hash changed, rewind and re-scan rather than silently missing events.
 */
@Entity("indexer_cursors")
@Unique("uq_cursor_key", ["cursorKey"])
export class IndexerCursor extends BaseEntity {
  /** e.g. "staking@0xabc…" — contract plus address, so a redeploy starts fresh. */
  @Column({ type: "varchar", length: 120 })
  cursorKey!: string;

  @Column({ type: "bigint", transformer: { to: (v: number) => String(v), from: (v: string) => Number(v) } })
  lastBlock!: number;

  @Column({ type: "varchar", length: 66, nullable: true })
  lastBlockHash?: string | null;

  @Column({ type: "int", default: 0 })
  reorgCount!: number;

  @Column({ type: "datetime", precision: 6, nullable: true })
  lastRunAt?: Date | null;

  @Column({ type: "text", nullable: true })
  lastError?: string | null;
}

/**
 * Every decoded on-chain event. The unique constraint on (txHash, logIndex) is
 * the dedupe guarantee: a reorg re-scan or an overlapping batch cannot process
 * the same event twice, which for a commission or reward would mean paying twice.
 */
@Entity("chain_events")
@Unique("uq_event_tx_log", ["txHash", "logIndex"])
@Index("idx_event_name_block", ["eventName", "blockNumber"])
@Index("idx_event_processed", ["processedAt"])
export class ChainEvent extends BaseEntity {
  @Column({ type: "varchar", length: 42 })
  contractAddress!: string;

  @Column({ type: "varchar", length: 60 })
  contractName!: string;

  @Column({ type: "varchar", length: 80 })
  eventName!: string;

  @Column({ type: "bigint", transformer: { to: (v: number) => String(v), from: (v: string) => Number(v) } })
  blockNumber!: number;

  @Column({ type: "varchar", length: 66 })
  blockHash!: string;

  @Column({ type: "datetime", precision: 6, nullable: true })
  blockTime?: Date | null;

  @Column({ type: "varchar", length: 66 })
  txHash!: string;

  @Column({ type: "int" })
  logIndex!: number;

  @Column({ type: "json" })
  args!: Record<string, unknown>;

  @Column({ type: "datetime", precision: 6, nullable: true })
  processedAt?: Date | null;

  @Column({ type: "int", default: 0 })
  processAttempts!: number;

  @Column({ type: "text", nullable: true })
  processError?: string | null;

  /** Set when a reorg invalidated this event — kept for the audit trail. */
  @Column({ type: "boolean", default: false })
  orphaned!: boolean;
}

export type OutboundTxKind =
  | "record_commission" | "fund_reward_pool" | "deposit_commission_pool"
  | "set_kyc_approved" | "clawback" | "transfer" | "create_pool" | "set_pool_active"
  /* Added with the MTTPayout rail and the completed contract surface. `transfer`
   * is kept for the direct-token fallback path so historic rows still decode. */
  | "payout" | "fund_payout_float" | "sweep_payout_float"
  | "pause" | "unpause" | "set_daily_limit" | "approve" | "set_penalty_receiver";

export type OutboundTxStatus =
  | "queued" | "signing" | "submitted" | "confirmed" | "failed" | "abandoned";

/**
 * Outbound transaction queue with explicit nonce management.
 *
 * A naive "just call the contract" approach breaks under concurrency: two
 * simultaneous sends grab the same nonce and one silently replaces the other.
 * Every send goes through this table, nonces are assigned under a lock, and a
 * stuck transaction is repriced rather than duplicated.
 */
@Entity("outbound_transactions")
@Unique("uq_outbound_idem", ["idempotencyKey"])
@Index("idx_outbound_status", ["status"])
@Index("idx_outbound_nonce", ["fromAddress", "nonce"])
export class OutboundTransaction extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  @Column({ type: "enum", enum: [
    "record_commission", "fund_reward_pool", "deposit_commission_pool",
    "set_kyc_approved", "clawback", "transfer", "create_pool", "set_pool_active",
    "payout", "fund_payout_float", "sweep_payout_float",
    "pause", "unpause", "set_daily_limit", "approve", "set_penalty_receiver",
  ] })
  kind!: OutboundTxKind;

  @Column({ type: "varchar", length: 42 })
  fromAddress!: string;

  @Column({ type: "varchar", length: 42 })
  toAddress!: string;

  @Column({ type: "varchar", length: 80 })
  functionName!: string;

  @Column({ type: "json" })
  args!: unknown[];

  @Column({ type: "int", nullable: true })
  nonce?: number | null;

  @Column({ type: "enum", enum: ["queued", "signing", "submitted", "confirmed", "failed", "abandoned"], default: "queued" })
  status!: OutboundTxStatus;

  @Column({ type: "varchar", length: 66, nullable: true })
  txHash?: string | null;

  @Column({ type: "bigint", nullable: true, transformer: {
    to: (v: number | null) => (v == null ? null : String(v)),
    from: (v: string | null) => (v == null ? null : Number(v)),
  } })
  blockNumber?: number | null;

  @Column({ type: "bigint", nullable: true, transformer: {
    to: (v: string | null) => v, from: (v: string | null) => v,
  } })
  gasUsed?: string | null;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ type: "text", nullable: true })
  lastError?: string | null;

  /** Correlates back to the domain row that requested the send. */
  @Column({ type: "varchar", length: 60, nullable: true })
  relatedType?: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  relatedId?: string | null;

  @Column({ type: "varchar", length: 128 })
  idempotencyKey!: string;

  @Column({ type: "datetime", precision: 6, nullable: true })
  submittedAt?: Date | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  confirmedAt?: Date | null;
}

/* -------------------------------- webhooks -------------------------------- */

@Entity("webhook_events")
@Unique("uq_webhook_provider_event", ["provider", "eventId"])
@Index("idx_webhook_processed", ["processedAt"])
export class WebhookEvent extends BaseEntity {
  @Column({ type: "varchar", length: 60 })
  provider!: string;

  /** Provider's own event id — the dedupe key for a replayed delivery. */
  @Column({ type: "varchar", length: 191 })
  eventId!: string;

  @Column({ type: "varchar", length: 120, nullable: true })
  eventType?: string | null;

  @Column({ type: "json" })
  payload!: Record<string, unknown>;

  @Column({ type: "boolean" })
  signatureValid!: boolean;

  @Column({ type: "datetime", precision: 6, nullable: true })
  processedAt?: Date | null;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ type: "text", nullable: true })
  error?: string | null;

  @Column({ type: "varchar", length: 45, nullable: true })
  sourceIp?: string | null;
}

@Entity("outbound_webhooks")
@Index("idx_outwh_status", ["status", "nextRetryAt"])
export class OutboundWebhook extends BaseEntity {
  @Column({ type: "varchar", length: 500 })
  url!: string;

  @Column({ type: "varchar", length: 120 })
  event!: string;

  @Column({ type: "json" })
  payload!: Record<string, unknown>;

  @Column({ type: "enum", enum: ["queued", "sent", "failed", "abandoned"], default: "queued" })
  status!: "queued" | "sent" | "failed" | "abandoned";

  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ type: "int", nullable: true })
  lastStatusCode?: number | null;

  @Column({ type: "text", nullable: true })
  lastError?: string | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  nextRetryAt?: Date | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  deliveredAt?: Date | null;
}

/* ------------------------------ idempotency ------------------------------- */

/**
 * Durable idempotency record. Redis handles the hot path, but a Redis flush
 * must not turn a replayed payment webhook into a double credit — so money
 * paths also write here.
 */
@Entity("idempotency_keys")
@Unique("uq_idem_scope_key", ["scope", "key"])
@Index("idx_idem_expires", ["expiresAt"])
export class IdempotencyKey extends BaseEntity {
  @Column({ type: "varchar", length: 60 })
  scope!: string;

  @Column({ type: "varchar", length: 191 })
  key!: string;

  @Column({ type: "uuid", nullable: true })
  userId?: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  resultRef?: string | null;

  @Column({ type: "datetime", precision: 6 })
  expiresAt!: Date;
}
