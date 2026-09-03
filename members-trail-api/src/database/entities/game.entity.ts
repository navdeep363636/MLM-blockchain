import { Column, Entity, Index, Unique } from "typeorm";
import { BaseEntity, MONEY, decimalTransformer } from "./base.entity";

/* ============================================================================
 * Game module.
 *
 * The security-relevant table here is `game_sessions`. Points are credited from
 * `serverScore`, never `clientScore` — the two are both stored so a discrepancy
 * is evidence, and `rejectionReason` records why a session earned nothing.
 * ========================================================================== */

export type EntryType = "free" | "paid" | "both";

/**
 * How a title turns a submitted telemetry stream into a score, and a score into
 * Points. Read by `GamesService.replay`; see the seed data for the per-title
 * values and why they are set the way they are.
 *
 * Typed rather than a bag of unknowns because every field here is load-bearing:
 * a wrong `pointsPerScore` silently mis-credits every session of that title, and
 * a missing `maxScore` removes the only bound on a forged stream.
 */
export interface GameScoringConfig {
  /** Telemetry event code that carries score. */
  scoreEvent?: number;
  /** Score per unit of telemetry value on a scoring frame. */
  scorePerUnit?: number;
  /** Hard ceiling on the replayed score, whatever the frames claim. */
  maxScore?: number;
  /** Score awarded per second survived, for endless titles. */
  scorePerSecond?: number;
  /** Points per unit of server score, before the title's band is applied. */
  pointsPerScore?: number;
}

@Entity("games")
@Index("idx_game_active", ["active"])
export class Game extends BaseEntity {
  @Column({ type: "varchar", length: 64, unique: true })
  slug!: string;

  @Column({ type: "varchar", length: 120 })
  title!: string;

  @Column({ type: "varchar", length: 40 })
  genre!: string;

  @Column({ type: "text" })
  blurb!: string;

  /** Drives the procedural artwork on the frontend — no image assets needed. */
  @Column({ type: "int", default: 24 })
  thumbnailHue!: number;

  @Column({ type: "int", default: 0 })
  pointsPerSessionMin!: number;

  @Column({ type: "int", default: 0 })
  pointsPerSessionMax!: number;

  @Column({ type: "enum", enum: ["free", "paid", "both"], default: "free" })
  entryType!: EntryType;

  @Column({ ...MONEY, transformer: decimalTransformer })
  entryFee!: string;

  /** Per-user, per-day ceiling for this title (FRD G-02 anti-farming). */
  @Column({ type: "int", default: 3000 })
  dailyPointsCap!: number;

  /** Ceiling for a single session, independent of the daily cap. */
  @Column({ type: "int", default: 1000 })
  sessionPointsCap!: number;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @Column({ type: "decimal", precision: 3, scale: 2, default: 0 })
  rating!: string;

  @Column({ type: "int", default: 0 })
  players30d!: number;

  /** Server-side scoring config: rules the validator uses to recompute a score. */
  @Column({ type: "json", nullable: true })
  scoringConfig?: GameScoringConfig | null;
}

/* ------------------------------- points rules ----------------------------- */

@Entity("points_rules")
@Index("idx_rule_game_action", ["gameId", "action"])
export class PointsRule extends BaseEntity {
  @Column({ type: "uuid", nullable: true })
  gameId?: string | null;

  /** e.g. "win", "session_complete", "daily_quest", "rewarded_ad" */
  @Column({ type: "varchar", length: 64 })
  action!: string;

  @Column({ type: "int" })
  points!: number;

  @Column({ type: "int", default: 0 })
  dailyCapPerUser!: number;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ type: "int", default: 1 })
  version!: number;

  /** Rules take effect on a schedule and are never applied retroactively. */
  @Column({ type: "datetime", precision: 6 })
  effectiveFrom!: Date;

  @Column({ type: "uuid", nullable: true })
  proposedById?: string | null;

  @Column({ type: "uuid", nullable: true })
  approvedById?: string | null;
}

/* ------------------------------ game sessions ----------------------------- */

export type SessionMode = "free" | "paid" | "tournament" | "demo";
export type SessionStatus = "open" | "submitted" | "validated" | "rejected" | "abandoned";

@Entity("game_sessions")
@Index("idx_session_user_time", ["userId", "createdAt"])
@Index("idx_session_status", ["status"])
@Index("idx_session_game", ["gameId"])
@Index("idx_session_fingerprint", ["deviceFingerprint"])
export class GameSession extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "uuid" })
  gameId!: string;

  @Column({ type: "uuid", nullable: true })
  tournamentId?: string | null;

  @Column({ type: "enum", enum: ["free", "paid", "tournament", "demo"], default: "free" })
  mode!: SessionMode;

  /**
   * Server-generated deterministic seed. The client renders from it, and the
   * validator replays from it — which is what makes a client-reported score
   * checkable rather than trusted.
   */
  @Column({ type: "varchar", length: 64 })
  seed!: string;

  /** HMAC the client must echo, proving the session token wasn't fabricated. */
  @Column({ type: "varchar", length: 64, select: false })
  sessionSecret!: string;

  @Column({ type: "datetime", precision: 6 })
  startedAt!: Date;

  @Column({ type: "datetime", precision: 6, nullable: true })
  endedAt?: Date | null;

  @Column({ type: "int", nullable: true })
  durationMs?: number | null;

  /** What the client claimed. Never used for credit. */
  @Column({ type: "int", nullable: true })
  clientScore?: number | null;

  /** What the server computed. This is what Points are derived from. */
  @Column({ type: "int", nullable: true })
  serverScore?: number | null;

  @Column({ type: "enum", enum: ["open", "submitted", "validated", "rejected", "abandoned"], default: "open" })
  status!: SessionStatus;

  @Column({ type: "int", default: 0 })
  pointsAwarded!: number;

  /** Non-null whenever a session earned nothing, so support can explain why. */
  @Column({ type: "varchar", length: 255, nullable: true })
  rejectionReason?: string | null;

  /** Rolling hash of the signed telemetry stream — tamper evidence. */
  @Column({ type: "varchar", length: 64, nullable: true })
  telemetryHash?: string | null;

  @Column({ type: "int", default: 0 })
  telemetryFrames!: number;

  /** Populated by the anti-cheat heuristics, e.g. ["input_variance_low"]. */
  @Column({ type: "json", nullable: true })
  anomalyFlags?: string[] | null;

  @Column({ type: "varchar", length: 45, nullable: true })
  ip?: string | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  deviceFingerprint?: string | null;
}

/* ------------------------------- tournaments ------------------------------ */

export type TournamentStatus = "draft" | "scheduled" | "live" | "completed" | "cancelled";

@Entity("tournaments")
@Index("idx_tournament_status_start", ["status", "startsAt"])
export class Tournament extends BaseEntity {
  @Column({ type: "varchar", length: 32, unique: true })
  ref!: string;

  @Column({ type: "uuid" })
  gameId!: string;

  @Column({ type: "varchar", length: 160 })
  name!: string;

  @Column({ type: "datetime", precision: 6 })
  startsAt!: Date;

  @Column({ type: "datetime", precision: 6 })
  endsAt!: Date;

  @Column({ ...MONEY, transformer: decimalTransformer })
  entryFee!: string;

  @Column({ ...MONEY, transformer: decimalTransformer })
  prizePool!: string;

  @Column({ type: "int", default: 0 })
  participants!: number;

  @Column({ type: "int", default: 1000 })
  maxParticipants!: number;

  @Column({ type: "enum", enum: ["draft", "scheduled", "live", "completed", "cancelled"], default: "draft" })
  status!: TournamentStatus;

  @Column({ type: "varchar", length: 200 })
  format!: string;

  /** Published BEFORE entry opens and immutable thereafter (FRD G-03). */
  @Column({ type: "json" })
  prizeSplit!: { place: string; share: number }[];

  @Column({ type: "datetime", precision: 6, nullable: true })
  prizeSplitLockedAt?: Date | null;

  @Column({ type: "text", nullable: true })
  rules?: string | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  settledAt?: Date | null;
}

@Entity("tournament_entries")
@Unique("uq_entry_tournament_user", ["tournamentId", "userId"])
@Index("idx_entry_user", ["userId"])
export class TournamentEntry extends BaseEntity {
  @Column({ type: "uuid" })
  tournamentId!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ ...MONEY, transformer: decimalTransformer })
  paidAmount!: string;

  /** The revenue event the entry fee produced — this is what makes an entry fee
   *  commissionable, and it links the fee to the Treasury allocation. */
  @Column({ type: "uuid", nullable: true })
  revenueEventId?: string | null;

  @Column({ type: "int", nullable: true })
  bestScore?: number | null;

  @Column({ type: "int", nullable: true })
  rank?: number | null;

  @Column({ ...MONEY, transformer: decimalTransformer })
  prizeAmount!: string;

  @Column({ type: "datetime", precision: 6, nullable: true })
  prizePaidAt?: Date | null;

  @Column({ type: "boolean", default: false })
  disqualified!: boolean;

  @Column({ type: "varchar", length: 255, nullable: true })
  disqualificationReason?: string | null;
}

/* --------------------------- quests & achievements ------------------------ */

export type QuestKind = "daily" | "weekly" | "milestone";

@Entity("quests")
@Index("idx_quest_kind_active", ["kind", "active"])
export class Quest extends BaseEntity {
  @Column({ type: "varchar", length: 160 })
  title!: string;

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "enum", enum: ["daily", "weekly", "milestone"] })
  kind!: QuestKind;

  @Column({ type: "uuid", nullable: true })
  gameId?: string | null;

  /** Machine-checkable objective, e.g. { metric: "sessions", value: 3 }. */
  @Column({ type: "json" })
  objective!: Record<string, unknown>;

  @Column({ type: "int" })
  target!: number;

  @Column({ type: "int" })
  rewardPoints!: number;

  @Column({ type: "boolean", default: true })
  active!: boolean;
}

@Entity("user_quests")
@Unique("uq_userquest_period", ["userId", "questId", "periodKey"])
@Index("idx_userquest_user", ["userId"])
export class UserQuest extends BaseEntity {
  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "uuid" })
  questId!: string;

  /** YYYY-MM-DD for daily, YYYY-Www for weekly, "lifetime" for milestones. */
  @Column({ type: "varchar", length: 16 })
  periodKey!: string;

  @Column({ type: "int", default: 0 })
  progress!: number;

  @Column({ type: "datetime", precision: 6, nullable: true })
  completedAt?: Date | null;

  @Column({ type: "datetime", precision: 6, nullable: true })
  claimedAt?: Date | null;

  /** Awarded amount may be below rewardPoints when the daily cap intervened. */
  @Column({ type: "int", default: 0 })
  pointsAwarded!: number;

  @Column({ type: "datetime", precision: 6, nullable: true })
  expiresAt?: Date | null;
}

export type AchievementTier = "bronze" | "silver" | "gold" | "platinum";

@Entity("achievements")
export class Achievement extends BaseEntity {
  @Column({ type: "varchar", length: 64, unique: true })
  code!: string;

  @Column({ type: "varchar", length: 160 })
  title!: string;

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "enum", enum: ["bronze", "silver", "gold", "platinum"], default: "bronze" })
  tier!: AchievementTier;

  @Column({ type: "int", default: 0 })
  rewardPoints!: number;

  @Column({ type: "json" })
  criteria!: Record<string, unknown>;

  @Column({ type: "boolean", default: true })
  active!: boolean;
}

@Entity("user_achievements")
@Unique("uq_userach", ["userId", "achievementId"])
export class UserAchievement extends BaseEntity {
  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "uuid" })
  achievementId!: string;

  @Column({ type: "datetime", precision: 6 })
  unlockedAt!: Date;

  @Column({ type: "int", default: 0 })
  pointsAwarded!: number;
}

/* -------------------------------- leaderboard ----------------------------- */

/**
 * Persisted snapshot of a leaderboard period. Redis sorted sets serve live
 * reads; this table is what survives a Redis flush and what historical rank
 * queries and prize settlement read from.
 */
@Entity("leaderboard_snapshots")
@Unique("uq_lb_snapshot", ["metric", "periodKey", "userId"])
@Index("idx_lb_lookup", ["metric", "periodKey", "rank"])
export class LeaderboardSnapshot extends BaseEntity {
  @Column({ type: "varchar", length: 64 })
  metric!: string;

  @Column({ type: "varchar", length: 16 })
  periodKey!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "bigint", transformer: { to: (v: number) => String(v), from: (v: string) => Number(v) } })
  score!: number;

  @Column({ type: "int" })
  rank!: number;
}
