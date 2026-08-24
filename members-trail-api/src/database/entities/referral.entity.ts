import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from "typeorm";
import { BaseEntity, FIAT, MONEY, decimalTransformer } from "./base.entity";
import { User } from "./user.entity";

/* ============================================================================
 * Referral programme.
 *
 * The rules this schema exists to make enforceable (FRD §2.4, §7):
 *  - Depth is capped at 3. There is no level 4 column, by design.
 *  - Commission is calculated on a `revenue_events` row only. There is a
 *    non-null FK to it, so a commission that does not trace to real settled
 *    revenue cannot be inserted.
 *  - Every row records the Treasury deposit that funded it, so the payout is
 *    reconstructable rather than asserted.
 *  - Monthly caps are enforced per recipient per `monthKey`.
 * ========================================================================== */

/**
 * Denormalised upline. One row per (descendant, ancestor) pair up to depth 3.
 * Written once at registration. The alternative — walking `referredById` three
 * times per revenue event — is three queries on the hottest path in the system.
 */
@Entity("referral_edges")
@Unique("uq_edge_user_ancestor", ["userId", "ancestorId"])
@Index("idx_edge_ancestor_level", ["ancestorId", "level"])
@Index("idx_edge_user", ["userId"])
export class ReferralEdge extends BaseEntity {
  /** The downline member (the one who spends). */
  @Column({ type: "uuid" })
  userId!: string;

  /** The upline member (the one who may earn). */
  @Column({ type: "uuid" })
  ancestorId!: string;

  /** 1 = direct sponsor, 2 = sponsor's sponsor, 3 = third tier. Never > 3. */
  @Column({ type: "tinyint" })
  level!: 1 | 2 | 3;
}

/* -------------------------------- commissions ----------------------------- */

export type CommissionTrigger = "iap" | "tournament_entry" | "subscription";

export type CommissionStatus =
  /** Calculated, awaiting the recipient's KYC before it can be released. */
  | "pending_kyc"
  /** Calculated and within cap, but the commission pool is short — waits for funding. */
  | "queued"
  /** Released to a claimable balance. */
  | "released"
  /** Transferred to the user. */
  | "claimed"
  /** Not paid because it exceeded the recipient's monthly cap. Never carried over. */
  | "capped"
  /** Reversed after a refund, chargeback or fraud finding. */
  | "clawed_back"
  /** Rejected by anti-abuse rules (self-referral, immature account, loop). */
  | "rejected";

@Entity("commissions")
@Unique("uq_commission_event_recipient", ["revenueEventId", "recipientId"])
@Index("idx_comm_recipient_month", ["recipientId", "monthKey"])
@Index("idx_comm_status", ["status"])
@Index("idx_comm_downline", ["downlineUserId"])
@Index("idx_comm_created", ["createdAt"])
export class Commission extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  /** Who earns it. */
  @Column({ type: "uuid" })
  recipientId!: string;

  @ManyToOne(() => User, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "recipientId" })
  recipient?: User;

  /** Whose spend generated it. Surfaced to the recipient only anonymised. */
  @Column({ type: "uuid" })
  downlineUserId!: string;

  @Column({ type: "tinyint" })
  level!: 1 | 2 | 3;

  /**
   * Hard link to the settled revenue event. NOT NULLABLE on purpose: this is
   * the schema-level expression of "commission only ever comes from real
   * revenue". There is no way to record a commission without one.
   */
  @Column({ type: "uuid" })
  revenueEventId!: string;

  @Column({ type: "enum", enum: ["iap", "tournament_entry", "subscription"] })
  triggerType!: CommissionTrigger;

  /** The net eligible spend the rate was applied to. */
  @Column({ ...FIAT, transformer: decimalTransformer })
  eligibleSpend!: string;

  @Column({ type: "int" })
  rateBps!: number;

  /** Amount actually payable after the cap was applied. */
  @Column({ ...FIAT, transformer: decimalTransformer })
  amount!: string;

  /** What the raw calculation produced before the cap. */
  @Column({ ...FIAT, transformer: decimalTransformer })
  grossAmount!: string;

  /** grossAmount − amount. Non-zero means the cap bit. Never carried forward. */
  @Column({ ...FIAT, transformer: decimalTransformer })
  cappedAmount!: string;

  @Column({ ...MONEY, transformer: decimalTransformer })
  amountMtt!: string;

  @Column({ type: "enum", enum: [
    "pending_kyc", "queued", "released", "claimed", "capped", "clawed_back", "rejected",
  ], default: "pending_kyc" })
  status!: CommissionStatus;

  /** The Treasury deposit that funded this payout. Shown to the user. */
  @Column({ type: "varchar", length: 32, nullable: true })
  treasuryInflowRef?: string | null;

  @Column({ type: "uuid", nullable: true })
  treasuryOutflowId?: string | null;

  /** bytes32 passed to recordCommission() on-chain, for cross-referencing. */
  @Column({ type: "varchar", length: 66, nullable: true })
  sourceEventId?: string | null;

  @Column({ type: "varchar", length: 66, nullable: true })
  txHash?: string | null;

  /** YYYY-MM of the triggering event — the bucket the monthly cap applies to. */
  @Column({ type: "varchar", length: 10 })
  monthKey!: string;

  @Column({ type: "datetime", precision: 6, nullable: true })
  releasedAt?: Date | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  claimedAt?: Date | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  clawedBackAt?: Date | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  clawbackReason?: string | null;

  /** Why an anti-abuse rule refused it — surfaced to compliance, not the user. */
  @Column({ type: "varchar", length: 255, nullable: true })
  rejectionReason?: string | null;
}

/* ------------------------------ plan versions ----------------------------- */

/**
 * Versioned compensation plan. Never edited in place: a change creates a new
 * row requiring a second approver, and historical commissions keep pointing at
 * the version that produced them.
 */
@Entity("commission_plans")
@Index("idx_plan_status", ["status"])
export class CommissionPlan extends BaseEntity {
  @Column({ type: "int" })
  version!: number;

  @Column({ type: "int", default: 800 })
  l1Bps!: number;

  @Column({ type: "int", default: 300 })
  l2Bps!: number;

  @Column({ type: "int", default: 100 })
  l3Bps!: number;

  @Column({ type: "tinyint", default: 3 })
  maxDepth!: number;

  @Column({ type: "json" })
  eligibleTriggers!: CommissionTrigger[];

  @Column({ ...FIAT, transformer: decimalTransformer })
  monthlyCapAbsolute!: string;

  /** cap = min(absolute, multiplier × trailing-3-month spend + base) */
  @Column({ type: "decimal", precision: 8, scale: 2, default: 5 })
  capMultiplier!: string;

  @Column({ ...FIAT, transformer: decimalTransformer })
  capBase!: string;

  @Column({ type: "int", default: 7 })
  minAccountAgeDays!: number;

  @Column({ type: "int", default: 5 })
  minGameplaySessions!: number;

  @Column({ type: "enum", enum: ["pending_approval", "scheduled", "active", "superseded", "rejected"], default: "pending_approval" })
  status!: "pending_approval" | "scheduled" | "active" | "superseded" | "rejected";

  @Column({ type: "datetime", precision: 6 })
  effectiveFrom!: Date;

  @Column({ type: "uuid" })
  proposedById!: string;

  @Column({ type: "uuid", nullable: true })
  approvedById?: string | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  approvedAt?: Date | null;

  /**
   * The simulator's projection at approval time: total commission liability
   * against Treasury inflow. FRD AD-07 requires this before publishing.
   */
  @Column({ type: "json", nullable: true })
  simulationSnapshot?: Record<string, unknown> | null;

  @Column({ type: "text", nullable: true })
  rationale?: string | null;
}

/* ------------------------------ monthly caps ------------------------------ */

/**
 * Per-recipient, per-month cap usage. A row here is the authoritative record;
 * Redis holds a cache of it for the hot path. Persisting it means a Redis flush
 * cannot reset someone's cap and let them exceed it.
 */
@Entity("commission_cap_usage")
@Unique("uq_cap_user_month", ["userId", "monthKey"])
export class CommissionCapUsage extends BaseEntity {
  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "varchar", length: 10 })
  monthKey!: string;

  @Column({ ...FIAT, transformer: decimalTransformer })
  capAmount!: string;

  @Column({ ...FIAT, transformer: decimalTransformer })
  usedAmount!: string;

  @Column({ ...FIAT, transformer: decimalTransformer })
  cappedAwayAmount!: string;

  /** Trailing-3-month own spend used to derive the cap, kept for auditability. */
  @Column({ ...FIAT, transformer: decimalTransformer })
  trailingSpend!: string;

  @Column({ type: "int", default: 0 })
  entryCount!: number;
}
