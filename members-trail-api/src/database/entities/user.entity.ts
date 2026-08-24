import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne, Unique } from "typeorm";
import { BaseEntity, SoftDeleteEntity } from "./base.entity";

export type UserStatus =
  | "pending_verification"   // registered, email/phone not yet confirmed
  | "verified_kyc_pending"   // contactable, can play free mode
  | "active"                 // KYC Tier 1+, full features
  | "suspended"              // policy action, reversible
  | "frozen"                 // compliance hold on funds
  | "closed";

export type KycTier = 0 | 1 | 2;
export type AppRole = "player" | "support" | "compliance" | "finance_admin" | "super_admin";
export type WalletType = "external" | "custodial";
export type TwoFaMethod = "none" | "sms" | "totp";

@Entity("users")
@Index("idx_users_status", ["status"])
@Index("idx_users_kyc", ["kycTier"])
@Index("idx_users_referred_by", ["referredById"])
@Index("idx_users_risk", ["riskScore"])
@Index("idx_users_created", ["createdAt"])
export class User extends SoftDeleteEntity {
  /** Public-facing reference. Never expose the UUID in user-visible surfaces. */
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  /* --------------------------------- contact ----------------------------- */

  @Column({ type: "varchar", length: 320 })
  email!: string;

  /**
   * HMAC of the lowercased email. Unique index lives here rather than on
   * `email` so lookup is constant-time and case-insensitive without a
   * functional index, and so the column is safe to log.
   */
  @Column({ type: "varchar", length: 64, unique: true })
  emailHash!: string;

  @Column({ type: "datetime", precision: 6, nullable: true })
  emailVerifiedAt?: Date | null;

  @Column({ type: "varchar", length: 32, nullable: true })
  phone?: string | null;

  @Column({ type: "varchar", length: 64, nullable: true, unique: true })
  phoneHash?: string | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  phoneVerifiedAt?: Date | null;

  /* ---------------------------------- auth ------------------------------- */

  @Column({ type: "varchar", length: 255, select: false })
  passwordHash!: string;

  @Column({ type: "datetime", precision: 6, nullable: true })
  passwordChangedAt?: Date | null;

  @Column({ type: "enum", enum: ["none", "sms", "totp"], default: "none" })
  twoFaMethod!: TwoFaMethod;

  /** AES-256-GCM ciphertext. Never returned by default. */
  @Column({ type: "text", nullable: true, select: false })
  twoFaSecretEnc?: string | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  twoFaEnabledAt?: Date | null;

  /** Hashed single-use recovery codes, JSON array. */
  @Column({ type: "json", nullable: true, select: false })
  twoFaRecoveryCodes?: string[] | null;

  /* -------------------------------- profile ------------------------------ */

  @Column({ type: "varchar", length: 160 })
  fullName!: string;

  @Column({ type: "varchar", length: 60 })
  displayName!: string;

  @Column({ type: "varchar", length: 512, nullable: true })
  avatarUrl?: string | null;

  @Column({ type: "date", nullable: true })
  dateOfBirth?: string | null;

  @Column({ type: "varchar", length: 2 })
  country!: string;

  @Column({ type: "varchar", length: 8, default: "en" })
  locale!: string;

  @Column({ type: "varchar", length: 64, default: "UTC" })
  timezone!: string;

  /* --------------------------------- state ------------------------------- */

  @Column({
    type: "enum",
    enum: ["pending_verification", "verified_kyc_pending", "active", "suspended", "frozen", "closed"],
    default: "pending_verification",
  })
  status!: UserStatus;

  @Column({ type: "tinyint", default: 0 })
  kycTier!: KycTier;

  @Column({
    type: "enum",
    enum: ["player", "support", "compliance", "finance_admin", "super_admin"],
    default: "player",
  })
  role!: AppRole;

  @Column({ type: "boolean", default: false })
  isStaff!: boolean;

  @Column({ type: "text", nullable: true })
  statusReason?: string | null;

  /* -------------------------------- wallet ------------------------------- */

  @Column({ type: "varchar", length: 42, nullable: true })
  @Index("idx_users_wallet")
  walletAddress?: string | null;

  @Column({ type: "enum", enum: ["external", "custodial"], nullable: true })
  walletType?: WalletType | null;

  /** Once linked to a KYC'd identity, changing this requires re-verification. */
  @Column({ type: "datetime", precision: 6, nullable: true })
  walletLockedAt?: Date | null;

  /* ------------------------------- referral ------------------------------ */

  @Column({ type: "varchar", length: 32, unique: true })
  referralCode!: string;

  @Column({ type: "uuid", nullable: true })
  referredById?: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "referredById" })
  referredBy?: User | null;

  /**
   * Materialised ancestor path, root-first, e.g. "<l3>/<l2>/<l1>".
   * Makes the upline lookup for a commission a single indexed read instead of
   * three recursive queries on the hot path.
   */
  @Column({ type: "varchar", length: 512, nullable: true })
  @Index("idx_users_sponsor_path")
  sponsorPath?: string | null;

  @Column({ type: "int", default: 0 })
  referralDepth!: number;

  /* --------------------------- risk & anti-abuse ------------------------- */

  @Column({ type: "int", default: 0 })
  riskScore!: number;

  @Column({ type: "json", nullable: true })
  riskFlags?: string[] | null;

  /** Device/browser fingerprint seen at registration — used for cluster detection. */
  @Column({ type: "varchar", length: 128, nullable: true })
  @Index("idx_users_signup_fp")
  signupFingerprint?: string | null;

  @Column({ type: "varchar", length: 45, nullable: true })
  @Index("idx_users_signup_ip")
  signupIp?: string | null;

  /* -------------------------------- activity ----------------------------- */

  @Column({ type: "datetime", precision: 6, nullable: true })
  lastActiveAt?: Date | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  lastLoginAt?: Date | null;

  @Column({ type: "int", default: 0 })
  gameSessionCount!: number;

  /** Re-acceptance is required when a material legal version is published. */
  @Column({ type: "json", nullable: true })
  acceptedLegalVersions?: Record<string, string> | null;

  @OneToMany(() => UserSession, (s) => s.user)
  sessions?: UserSession[];
}

/* ------------------------------- sessions --------------------------------- */

@Entity("user_sessions")
@Index("idx_sessions_user", ["userId"])
@Index("idx_sessions_expires", ["expiresAt"])
export class UserSession extends BaseEntity {
  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, (u) => u.sessions, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user?: User;

  /** JWT id. The access token is only honoured while this row's Redis key lives. */
  @Column({ type: "varchar", length: 64, unique: true })
  jti!: string;

  /** HMAC of the refresh token. The raw token is never stored. */
  @Column({ type: "varchar", length: 64 })
  @Index("idx_sessions_refresh")
  refreshTokenHash!: string;

  /** Rotation chain: set when this token is exchanged, to detect reuse. */
  @Column({ type: "varchar", length: 64, nullable: true })
  replacedByHash?: string | null;

  @Column({ type: "varchar", length: 200, nullable: true })
  device?: string | null;

  @Column({ type: "varchar", length: 45, nullable: true })
  ip?: string | null;

  @Column({ type: "varchar", length: 400, nullable: true })
  userAgent?: string | null;

  @Column({ type: "varchar", length: 120, nullable: true })
  location?: string | null;

  @Column({ type: "datetime", precision: 6 })
  expiresAt!: Date;

  @Column({ type: "datetime", precision: 6, nullable: true })
  lastActiveAt?: Date | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  revokedAt?: Date | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  revokedReason?: string | null;
}

/* ----------------------------- login history ------------------------------ */

@Entity("login_history")
@Index("idx_login_user_time", ["userId", "createdAt"])
@Index("idx_login_ip", ["ip"])
export class LoginHistory extends BaseEntity {
  @Column({ type: "uuid", nullable: true })
  userId?: string | null;

  /** Recorded even for unknown accounts so credential stuffing is visible. */
  @Column({ type: "varchar", length: 320, nullable: true })
  identifier?: string | null;

  @Column({ type: "boolean" })
  success!: boolean;

  @Column({ type: "varchar", length: 64, nullable: true })
  failureReason?: string | null;

  @Column({ type: "varchar", length: 45, nullable: true })
  ip?: string | null;

  @Column({ type: "varchar", length: 400, nullable: true })
  userAgent?: string | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  fingerprint?: string | null;
}

/* --------------------------- verification tokens -------------------------- */

/**
 * Why a token exists.
 *
 * `two_fa` is separate from `phone_verify` deliberately. Both send six digits to
 * the same handset, so sharing a purpose looked harmless — but `issue()`
 * supersedes any live code for the (purpose, target) pair, so enrolling in 2FA
 * silently cancelled a pending phone verification, and a code minted to prove a
 * phone number would satisfy a login challenge. A second factor and a contact
 * proof are different claims and must not be interchangeable.
 */
export type VerificationPurpose =
  | "email_verify" | "phone_verify" | "password_reset" | "wallet_link" | "email_change"
  | "two_fa";

@Entity("verification_tokens")
@Unique("uq_verif_purpose_hash", ["purpose", "tokenHash"])
@Index("idx_verif_user", ["userId", "purpose"])
@Index("idx_verif_expires", ["expiresAt"])
export class VerificationToken extends BaseEntity {
  @Column({ type: "uuid", nullable: true })
  userId?: string | null;

  @Column({
    type: "enum",
    enum: ["email_verify", "phone_verify", "password_reset", "wallet_link", "email_change", "two_fa"],
  })
  purpose!: VerificationPurpose;

  /** HMAC of the OTP or link token — the raw value only exists in the message. */
  @Column({ type: "varchar", length: 64 })
  tokenHash!: string;

  /** Target being proven (email address, phone number, wallet address). */
  @Column({ type: "varchar", length: 320, nullable: true })
  target?: string | null;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ type: "datetime", precision: 6 })
  expiresAt!: Date;

  @Column({ type: "datetime", precision: 6, nullable: true })
  consumedAt?: Date | null;

  @Column({ type: "varchar", length: 45, nullable: true })
  requestedIp?: string | null;
}

/* -------------------------- notification prefs ---------------------------- */

@Entity("notification_preferences")
export class NotificationPreference extends BaseEntity {
  @Column({ type: "uuid", unique: true })
  userId!: string;

  @OneToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user?: User;

  /**
   * Shape: { transaction: { email: true, sms: false, push: true }, … }
   * Security notifications are always delivered and are not represented here —
   * a user must not be able to mute "someone signed into your account".
   */
  @Column({ type: "json" })
  channels!: Record<string, { email: boolean; sms: boolean; push: boolean }>;

  @Column({ type: "boolean", default: true })
  marketingOptIn!: boolean;
}
