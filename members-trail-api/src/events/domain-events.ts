/* ============================================================================
 * Domain event catalogue.
 *
 * Events are the seam that lets this monolith be split later without rewriting
 * business logic: a module publishes what happened and does not know who cares.
 * Today they are delivered in-process; flipping EVENT_TRANSPORT to `rabbitmq`
 * fans the same payloads out to other services with no producer changes.
 *
 * Naming is `<aggregate>.<past-tense-verb>` so a topic binding reads naturally.
 * ========================================================================== */

export const Events = {
  /* identity */
  UserRegistered: "user.registered",
  UserVerified: "user.verified",
  UserStatusChanged: "user.status_changed",
  UserLoggedIn: "user.logged_in",
  UserLoginFailed: "user.login_failed",
  SessionRevoked: "user.session_revoked",
  PasswordChanged: "user.password_changed",

  /* kyc */
  KycSubmitted: "kyc.submitted",
  KycApproved: "kyc.approved",
  KycRejected: "kyc.rejected",
  KycMoreInfoRequested: "kyc.more_info",

  /* gameplay */
  GameSessionStarted: "game.session_started",
  GameSessionValidated: "game.session_validated",
  GameSessionRejected: "game.session_rejected",
  PointsCredited: "points.credited",
  PointsCapReached: "points.cap_reached",
  QuestCompleted: "quest.completed",
  AchievementUnlocked: "achievement.unlocked",
  TournamentRegistered: "tournament.registered",
  TournamentSettled: "tournament.settled",

  /* economy */
  RevenueRecognised: "revenue.recognised",
  RevenueReversed: "revenue.reversed",
  ConversionCompleted: "conversion.completed",
  DepositCompleted: "deposit.completed",
  WithdrawalRequested: "withdrawal.requested",
  WithdrawalApproved: "withdrawal.approved",
  WithdrawalRejected: "withdrawal.rejected",
  WithdrawalCompleted: "withdrawal.completed",

  /* staking */
  StakeRecorded: "staking.staked",
  UnstakeRecorded: "staking.unstaked",
  RewardClaimed: "staking.reward_claimed",
  RewardPoolFunded: "staking.pool_funded",

  /* referral */
  CommissionCalculated: "commission.calculated",
  CommissionReleased: "commission.released",
  CommissionClaimed: "commission.claimed",
  CommissionCapped: "commission.capped",
  CommissionClawedBack: "commission.clawed_back",

  /* treasury */
  TreasuryInflowRecorded: "treasury.inflow_recorded",
  TreasuryInflowReconciled: "treasury.inflow_reconciled",
  TreasuryOutflowApproved: "treasury.outflow_approved",
  TreasuryOutflowConfirmed: "treasury.outflow_confirmed",
  PayoutRatioBreach: "treasury.payout_ratio_breach",

  /* compliance & ops */
  FraudAlertRaised: "fraud.alert_raised",
  AccountFrozen: "compliance.account_frozen",
  ApprovalRequested: "approval.requested",
  ApprovalDecided: "approval.decided",
  TicketCreated: "support.ticket_created",
  TicketEscalated: "support.ticket_escalated",
  LegalVersionPublished: "legal.version_published",

  /* chain */
  ChainEventIndexed: "chain.event_indexed",
  ChainReorgDetected: "chain.reorg_detected",
  OutboundTxConfirmed: "chain.tx_confirmed",
  OutboundTxFailed: "chain.tx_failed",
} as const;

export type EventName = (typeof Events)[keyof typeof Events];

/** Envelope every publisher uses. `id` makes a consumer idempotent. */
export interface DomainEvent<T = Record<string, unknown>> {
  id: string;
  name: EventName;
  occurredAt: string;
  /** Correlates an event back to the HTTP request or job that caused it. */
  correlationId?: string;
  actorId?: string;
  payload: T;
}
