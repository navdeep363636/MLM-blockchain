import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne, Unique } from "typeorm";
import { BaseEntity, FIAT, FIAT_NULLABLE, MONEY, MONEY_NULLABLE, VersionedEntity, decimalTransformer } from "./base.entity";
import { User } from "./user.entity";

/* ============================================================================
 * The money layer.
 *
 * Design rules, all of them load-bearing:
 *  1. `user_balances` is the only mutable source of truth for a balance, and it
 *     is VERSIONED. Every write goes through a row lock + version check, so two
 *     concurrent spends cannot both succeed.
 *  2. Every balance change writes an immutable ledger row. The balance is a
 *     cached projection of the ledger; the ledger is the record. If they ever
 *     disagree, the ledger wins and the reconciliation cron reports it.
 *  3. Every ledger row carries an idempotency key. A retried request cannot
 *     double-credit.
 * ========================================================================== */

@Entity("user_balances")
export class UserBalance extends VersionedEntity {
  @Column({ type: "uuid", unique: true })
  userId!: string;

  @OneToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user?: User;

  /** Points are integral by definition — no fractional Points exist. */
  @Column({ type: "bigint", default: 0, transformer: {
    to: (v: number | string) => String(v ?? 0),
    from: (v: string) => Number(v ?? 0),
  } })
  points!: number;

  @Column({ ...MONEY, transformer: decimalTransformer })
  mttAvailable!: string;

  /** Mirror of on-chain staked principal, refreshed by the indexer. */
  @Column({ ...MONEY, transformer: decimalTransformer })
  mttStaked!: string;

  @Column({ ...MONEY, transformer: decimalTransformer })
  mttPendingRewards!: string;

  /** Accrued but not KYC-released, or awaiting commission-pool funding. */
  @Column({ ...MONEY, transformer: decimalTransformer })
  commissionPending!: string;

  /** Released and claimable. */
  @Column({ ...MONEY, transformer: decimalTransformer })
  commissionAvailable!: string;

  @Column({ ...MONEY, transformer: decimalTransformer })
  commissionLifetime!: string;

  /** Reserved against in-flight withdrawals so a balance can't be double-spent
   *  while a request sits in the compliance queue. */
  @Column({ ...MONEY, transformer: decimalTransformer })
  mttLockedForWithdrawal!: string;

  @Column({ type: "datetime", precision: 6, nullable: true })
  lastLedgerAt?: Date | null;
}

/* ----------------------------- points ledger ------------------------------ */

export type PointsSource =
  | "gameplay" | "quest" | "achievement" | "ad" | "tournament" | "purchase"
  | "referral_bonus" | "conversion" | "admin_adjustment" | "reversal";

@Entity("points_ledger")
@Unique("uq_points_idem", ["idempotencyKey"])
@Index("idx_points_user_time", ["userId", "createdAt"])
@Index("idx_points_source", ["source"])
@Index("idx_points_session", ["gameSessionId"])
export class PointsLedgerEntry extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user?: User;

  @Column({
    type: "enum",
    enum: ["gameplay", "quest", "achievement", "ad", "tournament", "purchase",
           "referral_bonus", "conversion", "admin_adjustment", "reversal"],
  })
  source!: PointsSource;

  /** Signed: positive credits, negative debits (conversions out, reversals). */
  @Column({ type: "bigint", transformer: { to: (v: number) => String(v), from: (v: string) => Number(v) } })
  amount!: number;

  /** Balance immediately after this entry — makes the ledger auditable without
   *  replaying every prior row. */
  @Column({ type: "bigint", transformer: { to: (v: number) => String(v), from: (v: string) => Number(v) } })
  runningBalance!: number;

  @Column({ type: "uuid", nullable: true })
  gameId?: string | null;

  @Column({ type: "uuid", nullable: true })
  gameSessionId?: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  note?: string | null;

  /** Set for admin adjustments — FRD AD-02 requires a documented reason. */
  @Column({ type: "uuid", nullable: true })
  actorId?: string | null;

  @Column({ type: "uuid", nullable: true })
  approvedById?: string | null;

  @Column({ type: "varchar", length: 128 })
  idempotencyKey!: string;
}

/* ------------------------------ transactions ------------------------------ */

export type TxType =
  | "conversion" | "stake" | "unstake" | "reward_claim" | "commission_claim"
  | "deposit" | "withdrawal" | "store_purchase" | "marketplace_sale"
  | "marketplace_purchase" | "tournament_entry" | "prize_payout" | "clawback"
  | "admin_adjustment";

export type TxStatus =
  | "pending" | "queued" | "processing" | "review" | "completed" | "failed" | "cancelled";

export type FundsSourceTag = "gameplay" | "staking" | "referral" | "deposit" | "prize";

@Entity("transactions")
@Unique("uq_tx_idem", ["idempotencyKey"])
@Index("idx_tx_user_time", ["userId", "createdAt"])
@Index("idx_tx_type_status", ["type", "status"])
@Index("idx_tx_hash", ["txHash"])
export class Transaction extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "userId" })
  user?: User;

  @Column({ type: "enum", enum: [
    "conversion", "stake", "unstake", "reward_claim", "commission_claim",
    "deposit", "withdrawal", "store_purchase", "marketplace_sale",
    "marketplace_purchase", "tournament_entry", "prize_payout", "clawback",
    "admin_adjustment",
  ] })
  type!: TxType;

  /** Signed MTT delta from the user's perspective. */
  @Column({ ...MONEY, transformer: decimalTransformer })
  amountMtt!: string;

  @Column({ ...FIAT_NULLABLE, transformer: decimalTransformer })
  amountFiat?: string | null;

  @Column({ type: "varchar", length: 3, nullable: true })
  currency?: string | null;

  @Column({ type: "enum", enum: ["pending", "queued", "processing", "review", "completed", "failed", "cancelled"], default: "pending" })
  status!: TxStatus;

  /** AML source tagging — FRD W-04 requires withdrawals to carry provenance. */
  @Column({ type: "enum", enum: ["gameplay", "staking", "referral", "deposit", "prize"], nullable: true })
  sourceTag?: FundsSourceTag | null;

  @Column({ type: "varchar", length: 66, nullable: true })
  txHash?: string | null;

  @Column({ type: "int", nullable: true })
  chainId?: number | null;

  @Column({ type: "bigint", nullable: true, transformer: {
    to: (v: number | null) => (v === null || v === undefined ? null : String(v)),
    from: (v: string | null) => (v === null ? null : Number(v)),
  } })
  blockNumber?: number | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  note?: string | null;

  @Column({ type: "text", nullable: true })
  failureReason?: string | null;

  @Column({ type: "json", nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({ type: "varchar", length: 128 })
  idempotencyKey!: string;

  @Column({ type: "datetime", precision: 6, nullable: true })
  settledAt?: Date | null;
}

/* ------------------------------- conversion ------------------------------- */

export type RateStatus = "pending_approval" | "scheduled" | "active" | "superseded" | "rejected";

@Entity("conversion_rates")
@Index("idx_rate_status", ["status"])
@Index("idx_rate_effective", ["effectiveFrom"])
export class ConversionRate extends BaseEntity {
  @Column({ type: "int" })
  pointsPerMtt!: number;

  @Column({ type: "datetime", precision: 6 })
  effectiveFrom!: Date;

  @Column({ type: "enum", enum: ["pending_approval", "scheduled", "active", "superseded", "rejected"], default: "pending_approval" })
  status!: RateStatus;

  /* Four-eyes: the proposer can never be the approver. Enforced in the service
   * and asserted by a unit test — a DB check constraint can't express it. */
  @Column({ type: "uuid" })
  proposedById!: string;

  @Column({ type: "uuid", nullable: true })
  approvedById?: string | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  approvedAt?: Date | null;

  @Column({ type: "text", nullable: true })
  rationale?: string | null;

  @Column({ type: "text", nullable: true })
  rejectionReason?: string | null;
}

@Entity("conversions")
@Unique("uq_conv_idem", ["idempotencyKey"])
@Index("idx_conv_user_time", ["userId", "createdAt"])
export class Conversion extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "bigint", transformer: { to: (v: number) => String(v), from: (v: string) => Number(v) } })
  pointsSpent!: number;

  @Column({ type: "int" })
  rateApplied!: number;

  @Column({ ...MONEY, transformer: decimalTransformer })
  mttCredited!: string;

  @Column({ type: "enum", enum: ["pending", "queued", "processing", "review", "completed", "failed", "cancelled"], default: "pending" })
  status!: TxStatus;

  @Column({ type: "uuid", nullable: true })
  transactionId?: string | null;

  @Column({ type: "varchar", length: 66, nullable: true })
  txHash?: string | null;

  @Column({ type: "varchar", length: 128 })
  idempotencyKey!: string;
}

/* ------------------------------- withdrawals ------------------------------ */

export type WithdrawalKind = "mtt" | "fiat";
export type WithdrawalStatus =
  | "pending" | "cooling_off" | "review" | "approved" | "processing"
  | "completed" | "rejected" | "cancelled" | "failed";

@Entity("withdrawals")
@Unique("uq_wd_idem", ["idempotencyKey"])
@Index("idx_wd_user_time", ["userId", "createdAt"])
@Index("idx_wd_status", ["status"])
export class Withdrawal extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "enum", enum: ["mtt", "fiat"] })
  kind!: WithdrawalKind;

  @Column({ ...MONEY, transformer: decimalTransformer })
  amountMtt!: string;

  @Column({ ...FIAT_NULLABLE, transformer: decimalTransformer })
  amountFiat?: string | null;

  /** Wallet address, or an encrypted bank-detail blob for fiat. */
  @Column({ type: "text" })
  destination!: string;

  @Column({ type: "varchar", length: 42, nullable: true })
  destinationAddress?: string | null;

  @Column({ type: "enum", enum: ["gameplay", "staking", "referral", "deposit", "prize"] })
  sourceTag!: FundsSourceTag;

  @Column({ type: "enum", enum: [
    "pending", "cooling_off", "review", "approved", "processing",
    "completed", "rejected", "cancelled", "failed",
  ], default: "pending" })
  status!: WithdrawalStatus;

  @Column({ type: "tinyint" })
  kycTierAtRequest!: number;

  /** True when the amount exceeded the auto-approve threshold. */
  @Column({ type: "boolean", default: false })
  reviewRequired!: boolean;

  /** Set when the destination is new — FRD W-04 anti-fraud cooling-off. */
  @Column({ type: "datetime", precision: 6, nullable: true })
  coolingOffUntil?: Date | null;

  @Column({ type: "uuid", nullable: true })
  reviewedById?: string | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  reviewedAt?: Date | null;

  @Column({ type: "text", nullable: true })
  reviewNotes?: string | null;

  @Column({ type: "text", nullable: true })
  rejectionReason?: string | null;

  @Column({ type: "varchar", length: 66, nullable: true })
  txHash?: string | null;

  @Column({ type: "uuid", nullable: true })
  transactionId?: string | null;

  @Column({ type: "varchar", length: 128 })
  idempotencyKey!: string;

  @Column({ type: "varchar", length: 45, nullable: true })
  requestIp?: string | null;
}

/* --------------------------------- deposits ------------------------------- */

export type DepositMethod = "card" | "upi" | "bank" | "crypto";
export type DepositStatus = "initiated" | "pending" | "processing" | "completed" | "failed" | "expired" | "refunded";

@Entity("deposits")
@Index("idx_dep_user_time", ["userId", "createdAt"])
@Index("idx_dep_processor_ref", ["processorRef"])
export class Deposit extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "enum", enum: ["card", "upi", "bank", "crypto"] })
  method!: DepositMethod;

  @Column({ ...FIAT, transformer: decimalTransformer })
  amountFiat!: string;

  @Column({ type: "varchar", length: 3, default: "INR" })
  currency!: string;

  @Column({ ...MONEY_NULLABLE, transformer: decimalTransformer })
  amountMtt?: string | null;

  @Column({ type: "varchar", length: 60, nullable: true })
  processor?: string | null;

  /** Unique per processor so a replayed webhook cannot credit twice. */
  @Column({ type: "varchar", length: 128, nullable: true, unique: true })
  processorRef?: string | null;

  @Column({ type: "enum", enum: ["initiated", "pending", "processing", "completed", "failed", "expired", "refunded"], default: "initiated" })
  status!: DepositStatus;

  /** Credited only after the processor settlement is reconciled — never on a
   *  client-side confirmation (FRD W-03). */
  @Column({ type: "datetime", precision: 6, nullable: true })
  reconciledAt?: Date | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  settledAt?: Date | null;

  @Column({ type: "varchar", length: 66, nullable: true })
  txHash?: string | null;

  @Column({ type: "json", nullable: true })
  processorPayload?: Record<string, unknown> | null;
}

/* ----------------------------- wallet addresses --------------------------- */

@Entity("wallet_addresses")
@Unique("uq_wallet_user_address", ["userId", "address"])
@Index("idx_wallet_address", ["address"])
export class WalletAddress extends BaseEntity {
  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "varchar", length: 42 })
  address!: string;

  @Column({ type: "enum", enum: ["external", "custodial"] })
  type!: "external" | "custodial";

  @Column({ type: "boolean", default: false })
  isPrimary!: boolean;

  /** Proven by signature (external) or by custody (platform wallet). */
  @Column({ type: "datetime", precision: 6, nullable: true })
  verifiedAt?: Date | null;

  /** First withdrawal to a new address waits out the cooling-off window. */
  @Column({ type: "datetime", precision: 6, nullable: true })
  whitelistedAt?: Date | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  firstUsedAt?: Date | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  label?: string | null;
}
