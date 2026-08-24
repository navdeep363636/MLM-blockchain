import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from "typeorm";
import { BaseEntity, FIAT, MONEY, decimalTransformer } from "./base.entity";
import { User } from "./user.entity";

/* ============================================================================
 * The Revenue Treasury — the compliance backbone of the platform.
 *
 * The chain of custody the whole design rests on:
 *
 *   revenue_events        a real-money event actually settled with a processor
 *        ↓ (reconciled against processor settlement data)
 *   treasury_inflows      the share of that revenue allocated to the Treasury
 *        ↓ (multisig-approved, on-chain)
 *   treasury_outflows     funding a staking reward pool or the commission pool
 *        ↓
 *   staking rewards / referral commissions paid to users
 *
 * The invariant enforced in code and asserted by tests: cumulative outflow can
 * never exceed cumulative RECONCILED inflow for the period. An unreconciled
 * deposit can never justify a payout.
 * ========================================================================== */

export type RevenueStream = "iap" | "tournament" | "marketplace" | "advertising" | "subscription";

/**
 * A settled real-money event. This is the ONLY table a referral commission may
 * be calculated from — hence `commissionEligible`, which is false for anything
 * that is not a genuine purchase (a Points conversion, a stake, a deposit).
 */
@Entity("revenue_events")
@Unique("uq_revenue_processor_ref", ["processor", "processorRef"])
@Index("idx_revenue_user", ["userId"])
@Index("idx_revenue_stream_time", ["stream", "occurredAt"])
@Index("idx_revenue_eligible", ["commissionEligible", "commissionProcessedAt"])
export class RevenueEvent extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  /** The spending user. Their upline is who may earn commission on this event. */
  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "userId" })
  user?: User;

  @Column({ type: "enum", enum: ["iap", "tournament", "marketplace", "advertising", "subscription"] })
  stream!: RevenueStream;

  @Column({ ...FIAT, transformer: decimalTransformer })
  grossAmount!: string;

  /** Gross minus processor fees. Commission is calculated on NET, and the
   *  frontend says so — this is the field that must be used. */
  @Column({ ...FIAT, transformer: decimalTransformer })
  netAmount!: string;

  @Column({ ...FIAT, transformer: decimalTransformer })
  processorFee!: string;

  @Column({ type: "varchar", length: 3, default: "INR" })
  currency!: string;

  @Column({ type: "varchar", length: 60, nullable: true })
  processor?: string | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  processorRef?: string | null;

  @Column({ type: "datetime", precision: 6 })
  occurredAt!: Date;

  @Column({ type: "datetime", precision: 6, nullable: true })
  settledAt?: Date | null;

  /** True only after the settlement batch is matched. Gates everything downstream. */
  @Column({ type: "boolean", default: false })
  reconciled!: boolean;

  /**
   * Whether this event can generate referral commission. Advertising revenue,
   * for instance, funds the Treasury but is not attributable to a member's
   * purchase, so it is not commissionable.
   */
  @Column({ type: "boolean", default: false })
  commissionEligible!: boolean;

  /** Set once the commission engine has fanned this event out to the upline.
   *  Its presence is what makes the engine idempotent. */
  @Column({ type: "datetime", precision: 6, nullable: true })
  commissionProcessedAt?: Date | null;

  /** Set if the purchase is later refunded or charged back — triggers clawback. */
  @Column({ type: "datetime", precision: 6, nullable: true })
  reversedAt?: Date | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  reversalReason?: string | null;

  @Column({ type: "json", nullable: true })
  metadata?: Record<string, unknown> | null;
}

/* --------------------------------- inflows -------------------------------- */

@Entity("treasury_inflows")
@Index("idx_inflow_period", ["periodKey"])
@Index("idx_inflow_reconciled", ["reconciled"])
export class TreasuryInflow extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  @Column({ type: "uuid", nullable: true })
  revenueEventId?: string | null;

  @Column({ type: "enum", enum: ["iap", "tournament", "marketplace", "advertising", "subscription"] })
  stream!: RevenueStream;

  @Column({ ...FIAT, transformer: decimalTransformer })
  grossRevenue!: string;

  /** Basis points of net revenue allocated to the Treasury for this stream. */
  @Column({ type: "int" })
  allocationBps!: number;

  @Column({ ...FIAT, transformer: decimalTransformer })
  amountToTreasury!: string;

  /** MTT equivalent at the rate in force when the inflow was recorded. */
  @Column({ ...MONEY, transformer: decimalTransformer })
  amountMtt!: string;

  @Column({ type: "varchar", length: 128, nullable: true })
  processorRef?: string | null;

  @Column({ type: "boolean", default: false })
  reconciled!: boolean;

  @Column({ type: "uuid", nullable: true })
  reconciledById?: string | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  reconciledAt?: Date | null;

  /** Populated when reported revenue and processor settlement disagree. */
  @Column({ type: "text", nullable: true })
  reconciliationNote?: string | null;

  /** YYYY-MM. The period the payout ceiling is computed over. */
  @Column({ type: "varchar", length: 10 })
  periodKey!: string;
}

/* -------------------------------- outflows -------------------------------- */

export type OutflowDestination = "staking_pool" | "commission_pool";
export type OutflowStatus = "proposed" | "approved" | "submitted" | "confirmed" | "failed" | "rejected";

@Entity("treasury_outflows")
@Index("idx_outflow_period", ["periodKey"])
@Index("idx_outflow_status", ["status"])
export class TreasuryOutflow extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  @Column({ type: "enum", enum: ["staking_pool", "commission_pool"] })
  destination!: OutflowDestination;

  /** Null for the commission pool, set for a specific staking pool. */
  @Column({ type: "int", nullable: true })
  poolId?: number | null;

  @Column({ ...MONEY, transformer: decimalTransformer })
  amount!: string;

  @Column({ type: "enum", enum: ["proposed", "approved", "submitted", "confirmed", "failed", "rejected"], default: "proposed" })
  status!: OutflowStatus;

  @Column({ type: "uuid" })
  proposedById!: string;

  /** Multisig co-signers. FRD AD-08 requires more than one approver for funds. */
  @Column({ type: "json", nullable: true })
  approvedByIds?: string[] | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  approvedAt?: Date | null;

  @Column({ type: "varchar", length: 66, nullable: true })
  txHash?: string | null;

  @Column({ type: "bigint", nullable: true, transformer: {
    to: (v: number | null) => (v == null ? null : String(v)),
    from: (v: string | null) => (v == null ? null : Number(v)),
  } })
  blockNumber?: number | null;

  /**
   * Snapshot of the headroom check at approval time: reconciled inflow minus
   * prior outflow for the period. Stored so an auditor can see the transfer was
   * within budget when it was approved, not just that it is now.
   */
  @Column({ ...MONEY, transformer: decimalTransformer })
  headroomAtApproval!: string;

  /** True when the amount came from the 15% Treasury Reserve rather than
   *  real revenue. Tracked because FRD §8.4 requires the split to be published. */
  @Column({ type: "boolean", default: false })
  fromReserve!: boolean;

  @Column({ type: "text", nullable: true })
  rationale?: string | null;

  @Column({ type: "text", nullable: true })
  failureReason?: string | null;

  @Column({ type: "varchar", length: 10 })
  periodKey!: string;
}

/* ---------------------------- period rollup ------------------------------- */

/**
 * Materialised per-period totals. Recomputed by a cron rather than derived on
 * every dashboard load — the admin KPI panel reads this, and it is also the
 * table the payout-ratio alert watches.
 */
@Entity("treasury_periods")
@Unique("uq_treasury_period", ["periodKey"])
export class TreasuryPeriod extends BaseEntity {
  @Column({ type: "varchar", length: 10 })
  periodKey!: string;

  @Column({ ...FIAT, transformer: decimalTransformer })
  grossRevenue!: string;

  @Column({ ...MONEY, transformer: decimalTransformer })
  reconciledInflow!: string;

  @Column({ ...MONEY, transformer: decimalTransformer })
  unreconciledInflow!: string;

  @Column({ ...MONEY, transformer: decimalTransformer })
  commissionOutflow!: string;

  @Column({ ...MONEY, transformer: decimalTransformer })
  stakingOutflow!: string;

  @Column({ ...MONEY, transformer: decimalTransformer })
  reserveFunded!: string;

  /** (commission + staking outflow) / reconciled inflow × 10000.
   *  The single most important compliance KPI. Must stay under 10000. */
  @Column({ type: "int", default: 0 })
  payoutRatioBps!: number;

  @Column({ type: "int", default: 0 })
  realRevenueFundedBps!: number;

  @Column({ type: "datetime", precision: 6, nullable: true })
  computedAt?: Date | null;
}
