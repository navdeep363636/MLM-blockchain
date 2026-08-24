/* ============================================================================
 * Explicit entity registry.
 *
 * Deliberately a hand-maintained list rather than a glob or a filtered barrel
 * export: TypeORM silently ignores an entity it wasn't given, which shows up
 * later as a mysteriously missing table. An explicit list makes a forgotten
 * entity a visible omission in review.
 * ========================================================================== */

import {
  User, UserSession, LoginHistory, VerificationToken, NotificationPreference,
} from "./user.entity";
import {
  UserBalance, PointsLedgerEntry, Transaction, ConversionRate, Conversion,
  Withdrawal, Deposit, WalletAddress,
} from "./economy.entity";
import {
  RevenueEvent, TreasuryInflow, TreasuryOutflow, TreasuryPeriod,
} from "./treasury.entity";
import {
  ReferralEdge, Commission, CommissionPlan, CommissionCapUsage,
} from "./referral.entity";
import {
  Game, PointsRule, GameSession, Tournament, TournamentEntry, Quest, UserQuest,
  Achievement, UserAchievement, LeaderboardSnapshot,
} from "./game.entity";
import {
  KycSubmission, KycDocument, KycAccessLog, StakingPool, StakingPosition,
  StakingAprHistory, StakingReward, StoreItem, UserInventoryItem, MarketListing,
  Ticket, TicketMessage, Notification, NotificationDelivery,
} from "./ops.entity";
import {
  AuditLog, ApprovalRequest, RolePermission, PlatformConfig, FraudAlert,
  FraudRule, LegalDocument, CmsContent, IndexerCursor, ChainEvent,
  OutboundTransaction, WebhookEvent, OutboundWebhook, IdempotencyKey,
} from "./admin.entity";

export const ENTITIES = [
  /* identity */
  User, UserSession, LoginHistory, VerificationToken, NotificationPreference,
  /* economy */
  UserBalance, PointsLedgerEntry, Transaction, ConversionRate, Conversion,
  Withdrawal, Deposit, WalletAddress,
  /* treasury */
  RevenueEvent, TreasuryInflow, TreasuryOutflow, TreasuryPeriod,
  /* referral */
  ReferralEdge, Commission, CommissionPlan, CommissionCapUsage,
  /* games */
  Game, PointsRule, GameSession, Tournament, TournamentEntry, Quest, UserQuest,
  Achievement, UserAchievement, LeaderboardSnapshot,
  /* kyc + staking + store + support + notifications */
  KycSubmission, KycDocument, KycAccessLog, StakingPool, StakingPosition,
  StakingAprHistory, StakingReward, StoreItem, UserInventoryItem, MarketListing,
  Ticket, TicketMessage, Notification, NotificationDelivery,
  /* admin + chain + webhooks */
  AuditLog, ApprovalRequest, RolePermission, PlatformConfig, FraudAlert,
  FraudRule, LegalDocument, CmsContent, IndexerCursor, ChainEvent,
  OutboundTransaction, WebhookEvent, OutboundWebhook, IdempotencyKey,
] as const;
