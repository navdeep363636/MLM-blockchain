import { Column, Entity, Index, Unique } from "typeorm";
import { BaseEntity, MONEY, decimalTransformer } from "./base.entity";

/* ============================================================================
 * KYC, staking mirror, support, notifications, store, admin and chain tables.
 * ========================================================================== */

/* ----------------------------------- KYC ---------------------------------- */

export type KycStatus = "pending" | "in_review" | "approved" | "rejected" | "more_info";
export type KycDocKind = "id_front" | "id_back" | "selfie" | "address_proof" | "source_of_funds";

@Entity("kyc_submissions")
@Index("idx_kyc_status", ["status"])
@Index("idx_kyc_user", ["userId"])
export class KycSubmission extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "tinyint" })
  tier!: 1 | 2;

  @Column({ type: "enum", enum: ["pending", "in_review", "approved", "rejected", "more_info"], default: "pending" })
  status!: KycStatus;

  @Column({ type: "varchar", length: 60, nullable: true })
  provider?: string | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  providerRef?: string | null;

  /** 0–100. Below the auto-approve threshold routes to manual review. */
  @Column({ type: "int", nullable: true })
  providerConfidence?: number | null;

  @Column({ type: "int", default: 0 })
  riskScore!: number;

  @Column({ type: "varchar", length: 2, nullable: true })
  country?: string | null;

  /** Reviewer identity is retained per the AML policy's record-keeping period. */
  @Column({ type: "uuid", nullable: true })
  reviewedById?: string | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  reviewedAt?: Date | null;

  @Column({ type: "text", nullable: true })
  reviewerNotes?: string | null;

  @Column({ type: "text", nullable: true })
  rejectionReason?: string | null;

  /** Set when escalated to a Suspicious Activity Report. */
  @Column({ type: "datetime", precision: 6, nullable: true })
  sarFiledAt?: Date | null;

  /** Retention deadline — a cron purges documents past it. */
  @Column({ type: "datetime", precision: 6, nullable: true })
  retentionUntil?: Date | null;
}

@Entity("kyc_documents")
@Index("idx_kycdoc_submission", ["submissionId"])
export class KycDocument extends BaseEntity {
  @Column({ type: "uuid" })
  submissionId!: string;

  @Column({ type: "enum", enum: ["id_front", "id_back", "selfie", "address_proof", "source_of_funds"] })
  kind!: KycDocKind;

  /** AES-256-GCM ciphertext of the object-store key. The document itself is
   *  encrypted at rest by the store; this hides even its location. */
  @Column({ type: "text", select: false })
  storageKeyEnc!: string;

  @Column({ type: "varchar", length: 100 })
  mimeType!: string;

  @Column({ type: "int" })
  sizeBytes!: number;

  @Column({ type: "varchar", length: 64 })
  sha256!: string;

  @Column({ type: "datetime", precision: 6, nullable: true })
  purgedAt?: Date | null;
}

/** Append-only log of who read a KYC document. Required by the AML policy. */
@Entity("kyc_access_log")
@Index("idx_kycaccess_doc", ["documentId"])
@Index("idx_kycaccess_actor", ["actorId", "createdAt"])
export class KycAccessLog extends BaseEntity {
  @Column({ type: "uuid" })
  documentId!: string;

  @Column({ type: "uuid" })
  actorId!: string;

  @Column({ type: "varchar", length: 45, nullable: true })
  ip?: string | null;

  @Column({ type: "varchar", length: 120, nullable: true })
  reason?: string | null;
}

/* --------------------------- staking (chain mirror) ----------------------- */

/**
 * The chain is the source of truth for staking. These tables are an indexed
 * mirror so the API can answer list/aggregate queries without an RPC round trip
 * per request. `lastSyncedBlock` makes staleness visible rather than silent.
 */
@Entity("staking_pools")
@Unique("uq_pool_id", ["poolId"])
export class StakingPool extends BaseEntity {
  @Column({ type: "int" })
  poolId!: number;

  @Column({ type: "varchar", length: 60 })
  name!: string;

  @Column({ type: "int" })
  lockDays!: number;

  @Column({ type: "int" })
  rewardsDurationDays!: number;

  @Column({ type: "int" })
  earlyPenaltyBps!: number;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @Column({ ...MONEY, transformer: decimalTransformer })
  totalStaked!: string;

  @Column({ ...MONEY, transformer: decimalTransformer })
  totalRewardsFunded!: string;

  @Column({ ...MONEY, transformer: decimalTransformer })
  totalRewardsPaid!: string;

  /**
   * Derived, never promised. Recomputed each period as
   * inflow(period) / TVL(pool, period) × (365 / periodDays) × 100.
   */
  @Column({ type: "decimal", precision: 8, scale: 4, default: 0 })
  currentApr!: string;

  @Column({ type: "bigint", nullable: true, transformer: {
    to: (v: number | null) => (v == null ? null : String(v)),
    from: (v: string | null) => (v == null ? null : Number(v)),
  } })
  lastSyncedBlock?: number | null;
}

@Entity("staking_positions")
@Unique("uq_position_user_pool", ["userId", "poolId"])
@Index("idx_position_lockend", ["lockEnd"])
export class StakingPosition extends BaseEntity {
  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "int" })
  poolId!: number;

  @Column({ ...MONEY, transformer: decimalTransformer })
  amount!: string;

  @Column({ type: "datetime", precision: 6, nullable: true })
  lockEnd?: Date | null;

  @Column({ ...MONEY, transformer: decimalTransformer })
  pendingRewards!: string;

  @Column({ type: "datetime", precision: 6, nullable: true })
  stakedAt?: Date | null;

  @Column({ type: "bigint", nullable: true, transformer: {
    to: (v: number | null) => (v == null ? null : String(v)),
    from: (v: string | null) => (v == null ? null : Number(v)),
  } })
  lastSyncedBlock?: number | null;
}

@Entity("staking_apr_history")
@Unique("uq_apr_pool_period", ["poolId", "periodKey"])
export class StakingAprHistory extends BaseEntity {
  @Column({ type: "int" })
  poolId!: number;

  @Column({ type: "varchar", length: 10 })
  periodKey!: string;

  @Column({ type: "decimal", precision: 8, scale: 4 })
  apr!: string;

  @Column({ ...MONEY, transformer: decimalTransformer })
  inflow!: string;

  @Column({ ...MONEY, transformer: decimalTransformer })
  tvl!: string;
}

@Entity("staking_rewards")
@Index("idx_reward_user_time", ["userId", "createdAt"])
export class StakingReward extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "int" })
  poolId!: number;

  @Column({ ...MONEY, transformer: decimalTransformer })
  accrued!: string;

  @Column({ type: "boolean", default: false })
  claimed!: boolean;

  @Column({ type: "varchar", length: 66, nullable: true })
  txHash?: string | null;

  @Column({ type: "varchar", length: 10 })
  periodKey!: string;
}

/* --------------------------------- store ---------------------------------- */

export type ItemCategory = "cosmetic" | "boost" | "energy" | "pass";
export type ItemRarity = "common" | "rare" | "epic" | "legendary";

@Entity("store_items")
@Index("idx_item_category", ["category"])
export class StoreItem extends BaseEntity {
  @Column({ type: "varchar", length: 64, unique: true })
  sku!: string;

  @Column({ type: "varchar", length: 160 })
  name!: string;

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "enum", enum: ["cosmetic", "boost", "energy", "pass"] })
  category!: ItemCategory;

  @Column({ type: "enum", enum: ["common", "rare", "epic", "legendary"], default: "common" })
  rarity!: ItemRarity;

  @Column({ ...MONEY, transformer: decimalTransformer })
  priceMtt!: string;

  @Column({ type: "int", nullable: true })
  pricePoints?: number | null;

  @Column({ type: "int", default: 24 })
  hue!: number;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  /** Consumables can't be resold or refunded once used. */
  @Column({ type: "boolean", default: false })
  consumable!: boolean;

  @Column({ type: "boolean", default: true })
  tradable!: boolean;
}

@Entity("user_inventory")
@Index("idx_inv_user", ["userId"])
export class UserInventoryItem extends BaseEntity {
  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "uuid" })
  itemId!: string;

  @Column({ type: "int", default: 1 })
  quantity!: number;

  @Column({ type: "datetime", precision: 6, nullable: true })
  consumedAt?: Date | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  expiresAt?: Date | null;

  /** Set while the item is listed, so it can't be sold twice or consumed mid-sale. */
  @Column({ type: "uuid", nullable: true })
  lockedByListingId?: string | null;
}

export type ListingStatus = "active" | "sold" | "cancelled" | "expired";

@Entity("market_listings")
@Index("idx_listing_status", ["status"])
export class MarketListing extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  @Column({ type: "uuid" })
  sellerId!: string;

  @Column({ type: "uuid" })
  inventoryItemId!: string;

  @Column({ type: "uuid" })
  itemId!: string;

  @Column({ ...MONEY, transformer: decimalTransformer })
  askMtt!: string;

  @Column({ type: "enum", enum: ["active", "sold", "cancelled", "expired"], default: "active" })
  status!: ListingStatus;

  @Column({ type: "uuid", nullable: true })
  buyerId?: string | null;

  @Column({ ...MONEY, transformer: decimalTransformer })
  feeMtt!: string;

  /** Marketplace fees are a Treasury revenue stream (FRD W-06). */
  @Column({ type: "uuid", nullable: true })
  revenueEventId?: string | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  soldAt?: Date | null;
}

/* -------------------------------- support --------------------------------- */

export type TicketCategory = "account" | "kyc" | "withdrawal" | "commission" | "gameplay" | "technical" | "other";
export type TicketStatus = "open" | "pending_user" | "escalated" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

@Entity("tickets")
@Index("idx_ticket_status", ["status"])
@Index("idx_ticket_user", ["userId"])
@Index("idx_ticket_sla", ["slaDueAt"])
export class Ticket extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "varchar", length: 200 })
  subject!: string;

  @Column({ type: "enum", enum: ["account", "kyc", "withdrawal", "commission", "gameplay", "technical", "other"] })
  category!: TicketCategory;

  @Column({ type: "enum", enum: ["open", "pending_user", "escalated", "resolved", "closed"], default: "open" })
  status!: TicketStatus;

  @Column({ type: "enum", enum: ["low", "normal", "high", "urgent"], default: "normal" })
  priority!: TicketPriority;

  /**
   * Withdrawal and commission tickets are auto-routed to compliance-trained
   * agents with SLA tracking (FRD N-02). Set by the service, not the client.
   */
  @Column({ type: "boolean", default: false })
  financialDispute!: boolean;

  @Column({ type: "uuid", nullable: true })
  assigneeId?: string | null;

  @Column({ type: "datetime", precision: 6 })
  slaDueAt!: Date;

  @Column({ type: "datetime", precision: 6, nullable: true })
  firstResponseAt?: Date | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  resolvedAt?: Date | null;

  @Column({ type: "int", nullable: true })
  satisfactionRating?: number | null;

  /** Reference to the disputed entity, e.g. a commission or withdrawal ref. */
  @Column({ type: "varchar", length: 64, nullable: true })
  disputedRef?: string | null;

  @Column({ type: "uuid", nullable: true })
  mergedIntoId?: string | null;
}

@Entity("ticket_messages")
@Index("idx_msg_ticket", ["ticketId", "createdAt"])
export class TicketMessage extends BaseEntity {
  @Column({ type: "uuid" })
  ticketId!: string;

  @Column({ type: "uuid", nullable: true })
  authorId?: string | null;

  @Column({ type: "enum", enum: ["user", "agent", "system"] })
  authorRole!: "user" | "agent" | "system";

  @Column({ type: "text" })
  body!: string;

  /** Internal notes are never returned on the player-facing endpoint. */
  @Column({ type: "boolean", default: false })
  internal!: boolean;

  @Column({ type: "json", nullable: true })
  attachments?: { name: string; storageKey: string; size: number }[] | null;
}

/* ----------------------------- notifications ------------------------------ */

export type NotificationKind =
  | "transaction" | "security" | "kyc" | "reward" | "commission"
  | "tournament" | "system" | "promo";

@Entity("notifications")
@Index("idx_notif_user_read", ["userId", "read"])
@Index("idx_notif_created", ["createdAt"])
export class Notification extends BaseEntity {
  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "enum", enum: [
    "transaction", "security", "kyc", "reward", "commission", "tournament", "system", "promo",
  ] })
  kind!: NotificationKind;

  @Column({ type: "varchar", length: 200 })
  title!: string;

  @Column({ type: "text" })
  body!: string;

  @Column({ type: "varchar", length: 300, nullable: true })
  href?: string | null;

  @Column({ type: "boolean", default: false })
  read!: boolean;

  @Column({ type: "datetime", precision: 6, nullable: true })
  readAt?: Date | null;

  @Column({ type: "json", nullable: true })
  data?: Record<string, unknown> | null;
}

@Entity("notification_deliveries")
@Index("idx_delivery_status", ["status"])
export class NotificationDelivery extends BaseEntity {
  @Column({ type: "uuid", nullable: true })
  notificationId?: string | null;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "enum", enum: ["email", "sms", "push", "in_app"] })
  channel!: "email" | "sms" | "push" | "in_app";

  @Column({ type: "varchar", length: 320 })
  target!: string;

  @Column({ type: "enum", enum: ["queued", "sent", "delivered", "failed", "suppressed"], default: "queued" })
  status!: "queued" | "sent" | "delivered" | "failed" | "suppressed";

  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ type: "text", nullable: true })
  lastError?: string | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  providerMessageId?: string | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  sentAt?: Date | null;
}
