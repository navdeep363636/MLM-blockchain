/* ============================================================================
 * Domain types for Members Trail. These mirror the FRD's data model and are
 * the contract between the UI and whatever fetches the data (mock or real API).
 * ========================================================================== */

import type { KycTier, StatusKind } from "@/components/ui/badge";

export type { KycTier, StatusKind };

/* --------------------------------- User ---------------------------------- */

export type UserStatus = "unverified" | "verified_kyc_pending" | "active" | "suspended" | "frozen";
export type StaffRole = "support" | "compliance" | "finance_admin" | "super_admin";

export interface User {
  id: string;
  displayName: string;
  fullName: string;
  email: string;
  phone: string;
  country: string;
  dateOfBirth: string;
  avatarUrl?: string | null;
  status: UserStatus;
  kycTier: KycTier;
  twoFactorEnabled: boolean;
  walletAddress?: string | null;
  walletType: "external" | "custodial" | null;
  referralCode: string;
  referredBy?: string | null;
  joinedAt: string;
  lastActiveAt: string;
  riskScore: number;      // 0-100, from the fraud engine
  riskFlags: string[];
}

/* ------------------------------- Balances -------------------------------- */

export interface Balances {
  points: number;
  pointsToday: number;
  mttAvailable: number;
  mttStaked: number;
  mttPendingRewards: number;
  commissionPending: number;   // accrued, not yet KYC-released
  commissionAvailable: number; // claimable now
  commissionLifetime: number;
  usdRate: number;             // MTT -> USD estimate
}

/* --------------------------------- Games -------------------------------- */

export interface Game {
  id: string;
  slug: string;
  title: string;
  genre: string;
  blurb: string;
  thumbnailHue: number;        // drives the generated gradient art
  pointsPerSessionMin: number;
  pointsPerSessionMax: number;
  entryType: "free" | "paid" | "both";
  entryFee?: number;
  players30d: number;
  rating: number;
  active: boolean;
  dailyPointsCap: number;
}

export interface Tournament {
  id: string;
  gameId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  entryFee: number;
  prizePool: number;
  participants: number;
  maxParticipants: number;
  status: "scheduled" | "live" | "completed";
  format: string;
  prizeSplit: { place: string; share: number }[];
  registered?: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  metric: number;
  change: number;
  isCurrentUser?: boolean;
}

export type QuestKind = "daily" | "weekly" | "milestone";

export interface Quest {
  id: string;
  kind: QuestKind;
  title: string;
  description: string;
  progress: number;
  target: number;
  rewardPoints: number;
  expiresAt?: string;
  claimed: boolean;
  /**
   * The server's own verdict — NOT `progress >= target` recomputed client-side.
   * They usually agree, but an admin raising `target` after a member already
   * completed it under the old target is a real case where they diverge: the
   * server keeps `completedAt`, but a client recompute against the new target
   * would hide a "Claim" button for a reward already earned.
   */
  completed: boolean;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
  unlockedAt?: string;
  rewardPoints: number;
  tier: "bronze" | "silver" | "gold" | "platinum";
}

/* -------------------------------- Ledgers -------------------------------- */

/* Must mirror the backend's PointsSource union exactly (economy.entity.ts) — a
 * value missing here renders as literal "undefined" wherever a label/tone map
 * is keyed on it, for a source that is genuinely reachable in production. */
export type PointsSource =
  | "gameplay" | "quest" | "achievement" | "ad" | "tournament" | "purchase"
  | "referral_bonus" | "conversion" | "admin_adjustment" | "reversal";

export interface PointsEntry {
  id: string;
  date: string;
  source: PointsSource;
  gameTitle?: string;
  amount: number;          // negative for conversions out
  runningBalance: number;
  note?: string;
}

export type TxType =
  | "conversion" | "stake" | "unstake" | "reward_claim" | "commission_claim"
  | "deposit" | "withdrawal" | "store_purchase" | "marketplace_sale" | "tournament_entry";

export interface Transaction {
  id: string;
  date: string;
  type: TxType;
  amountMtt: number;       // signed
  amountFiat?: number;
  status: StatusKind;
  txHash?: string;         // present for on-chain events
  /** Set for withdrawals — drives AML source tagging in the FRD. */
  sourceTag?: "gameplay" | "staking" | "referral";
  note?: string;
}

/* -------------------------------- Staking -------------------------------- */

export interface StakingPool {
  poolId: number;
  name: string;
  lockDays: number;              // 0 = flexible
  rewardsDurationDays: number;
  earlyPenaltyBps: number;       // applies to unclaimed rewards ONLY
  active: boolean;
  totalStaked: number;
  totalRewardsFunded: number;
  totalRewardsPaid: number;
  /** Variable, derived from treasury inflow. Never advertised as fixed. */
  currentApr: number;
  aprHistory: { period: string; apr: number }[];
}

export interface StakePosition {
  poolId: number;
  amount: number;
  lockEnd: string;
  pendingRewards: number;
  stakedAt: string;
}

export interface RewardEntry {
  id: string;
  date: string;
  poolId: number;
  poolName: string;
  accrued: number;
  claimed: boolean;
  txHash?: string;
}

/* ------------------------------- Referrals ------------------------------- */

export interface ReferralNode {
  id: string;
  /** Anonymised per the FRD: "Member #4821" — never real contact details. */
  label: string;
  level: 1 | 2 | 3;
  joinedAt: string;
  active: boolean;
  /** Aggregate only — the referrer never sees another user's exact balances. */
  contributedCommission: number;
  children: ReferralNode[];
}

export interface CommissionEntry {
  id: string;
  date: string;
  downlineLabel: string;
  level: 1 | 2 | 3;
  triggerType: "iap" | "tournament_entry" | "subscription";
  eligibleSpend: number;
  rate: number;              // e.g. 0.08
  amount: number;
  status: StatusKind;
  /** Every line must trace to the treasury deposit that funded it. */
  treasuryDepositRef: string;
  sourceEventId: string;
}

export interface ReferralSummary {
  code: string;
  link: string;
  directCount: number;
  totalDownline: number;
  byLevel: { level: 1 | 2 | 3; count: number; earned: number }[];
  earnedLifetime: number;
  earnedThisMonth: number;
  monthlyCap: number;
  monthlyCapUsed: number;
}

/* ------------------------------ Notifications ---------------------------- */

export type NotificationKind =
  | "transaction" | "security" | "kyc" | "reward" | "commission" | "tournament" | "system" | "promo";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  href?: string;
}

/* --------------------------------- Support ------------------------------- */

export type TicketCategory = "account" | "kyc" | "withdrawal" | "commission" | "gameplay" | "technical" | "other";
export type TicketStatus = "open" | "pending_user" | "escalated" | "resolved" | "closed";

export interface TicketMessage {
  id: string;
  author: string;
  authorRole: "user" | "agent" | "system";
  body: string;
  createdAt: string;
  internal?: boolean;
}

export interface Ticket {
  id: string;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: "low" | "normal" | "high" | "urgent";
  userId: string;
  userName: string;
  assignee?: string;
  createdAt: string;
  updatedAt: string;
  slaDueAt: string;
  messages: TicketMessage[];
  /** Financial disputes route to compliance-trained agents. */
  financialDispute: boolean;
}

/* ---------------------------------- Store -------------------------------- */

export interface StoreItem {
  id: string;
  name: string;
  category: "cosmetic" | "boost" | "energy" | "pass";
  rarity: "common" | "rare" | "epic" | "legendary";
  priceMtt?: number;
  pricePoints?: number;
  hue: number;
  owned?: boolean;
  description: string;
}

export interface MarketListing {
  id: string;
  itemName: string;
  rarity: StoreItem["rarity"];
  sellerLabel: string;
  askMtt: number;
  listedAt: string;
  hue: number;
}

/* ---------------------------------- Admin -------------------------------- */

export interface KycSubmission {
  id: string;
  userId: string;
  userName: string;
  submittedAt: string;
  tier: 1 | 2;
  riskScore: number;
  status: "pending" | "approved" | "rejected" | "more_info";
  documents: { kind: "id_front" | "id_back" | "selfie" | "address_proof"; filename: string }[];
  providerConfidence: number;
  country: string;
  notes?: string;
}

export type RevenueStream = "iap" | "tournament" | "marketplace" | "advertising" | "subscription";

export interface TreasuryInflow {
  id: string;
  date: string;
  stream: RevenueStream;
  grossRevenue: number;
  treasuryAllocationPct: number;
  amountToTreasury: number;
  processorRef: string;
  reconciled: boolean;
}

export interface TreasuryOutflow {
  id: string;
  date: string;
  destination: "staking_pool" | "commission_pool";
  poolId?: number;
  amount: number;
  txHash: string;
  approvedBy: string[];
}

export interface FraudAlert {
  id: string;
  raisedAt: string;
  kind: "velocity" | "structuring" | "self_referral_ring" | "bot_farming" | "multi_account" | "device_cluster";
  severity: "low" | "medium" | "high" | "critical";
  riskScore: number;
  affectedUsers: { id: string; name: string }[];
  summary: string;
  status: "open" | "investigating" | "dismissed" | "actioned";
  signals: string[];
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  actorRole: StaffRole;
  action: string;
  target: string;
  before?: string;
  after?: string;
  ip: string;
  requiresSecondApproval: boolean;
  approvedBy?: string;
}

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  twoFactorEnabled: boolean;
  lastActiveAt: string;
  active: boolean;
}

export interface RolePermission {
  module: string;
  read: boolean;
  write: boolean;
  approve: boolean;
}

export interface LegalDocument {
  slug: string;
  title: string;
  version: string;
  /* "archived" is a state the admin list serves and this union used to omit,
   * so a superseded version arrived typed as something it is not. */
  status: "draft" | "legal_review" | "published" | "archived";
  /* Nullable because a draft has neither: nothing has been published, and no
   * effective date has been chosen yet. Both render through formatDate/timeAgo,
   * which show an em dash for an absent value. */
  updatedAt: string | null;
  effectiveFrom: string | null;
  /** Material changes force re-acceptance on next login. */
  materialChange: boolean;
  summary: string;
  sections: { heading: string; body: string[] }[];
}

export interface ConversionRateConfig {
  pointsPerMtt: number;
  effectiveFrom: string;
  proposedBy?: string;
  approvedBy?: string;
  status: "active" | "scheduled" | "pending_approval" | "superseded";
}

export interface CommissionConfig {
  levels: { level: 1 | 2 | 3; ratePct: number }[];
  eligibleTypes: CommissionEntry["triggerType"][];
  monthlyCapAbsolute: number;
  monthlyCapMultiplier: number;
  monthlyCapBase: number;
  maxDepth: number;
  minAccountAgeDays: number;
  minGameplaySessions: number;
}

export interface PointsRule {
  gameId: string;
  gameTitle: string;
  action: string;
  points: number;
  dailyCapPerUser: number;
  enabled: boolean;
}
