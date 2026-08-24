import { Logger, type OnModuleInit } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { OnEvent } from "@nestjs/event-emitter";
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect,
  SubscribeMessage, WebSocketGateway, WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { RedisService } from "@/common/redis/redis.service";
import { CacheKeys } from "@/common/redis/cache.keys";
import { Events } from "@/events";

/* ============================================================================
 * The realtime gateway.
 *
 * What it is for: pushing a balance change, a validated session, a released
 * commission or a security alert to the member it concerns, without them
 * polling.
 *
 * The four rules that make it safe:
 *
 *  1. THE HANDSHAKE IS AUTHENTICATED, AND THE SESSION IS CHECKED AGAINST REDIS.
 *     A valid-looking JWT is not enough: a logged-out or revoked session must not
 *     keep receiving a member's financial events, and the revocation list lives
 *     in Redis. An unauthenticated socket is disconnected, not tolerated.
 *
 *  2. EVERY SOCKET JOINS EXACTLY ONE PRIVATE ROOM: `user:<id>`. There is no
 *     client-controlled subscribe: a socket cannot ask to join someone else's
 *     room, because the only join happens server-side from the verified token.
 *
 *  3. PAYLOADS ARE SUMMARIES, NOT RECORDS. A push says "your balance changed"
 *     with the new figure — it does not carry a ledger row, another member's id,
 *     or anything the member could not already read over HTTP.
 *
 *  4. THE SERVER IS THE SOURCE OF TRUTH; THIS IS A HINT. A client that missed a
 *     push must still be correct after a refresh, so nothing here is the only
 *     path by which state reaches the UI.
 *
 * Horizontal scale comes from the Redis adapter (see redis-io.adapter.ts): a
 * member connected to instance A still receives an event published on instance B.
 * ========================================================================== */

/** Rooms a member may be in. Deliberately a closed set. */
const userRoom = (userId: string): string => `user:${userId}`;
const staffRoom = "staff:ops";

interface AuthedSocket extends Socket {
  data: {
    userId?: string;
    jti?: string;
    isStaff?: boolean;
  };
}

@WebSocketGateway({
  namespace: "/realtime",
  /* CORS for sockets is configured in main.ts alongside the HTTP origins, so
   * there is one list of allowed origins rather than two that drift. */
  cors: { credentials: true },
  /* A dead client should be noticed in seconds, not minutes: a stale socket
   * holding a room membership is a slow leak. */
  pingInterval: 20_000,
  pingTimeout: 10_000,
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  private readonly log = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    this.log.log("realtime gateway ready on /realtime");
  }

  /* ==================================================================== *
   * Connection lifecycle
   * ==================================================================== */

  /**
   * Authenticates the handshake.
   *
   * Rule 1: the token is verified AND the session is checked against Redis, then
   * the socket is joined to its own room server-side. A socket that fails any of
   * that is disconnected immediately — leaving it connected but unjoined would
   * mean an unauthenticated client holding a server resource indefinitely.
   */
  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) {
        this.deny(client, "no token");
        return;
      }

      const payload = await this.jwt.verifyAsync<{
        sub: string;
        jti: string;
        isStaff?: boolean;
      }>(token);

      /* The revocation check. A JWT stays cryptographically valid until it
       * expires; the session record is what says it is still live. */
      const session = await this.redis.get<unknown>(CacheKeys.session(payload.jti));
      if (!session) {
        this.deny(client, "session revoked or expired");
        return;
      }

      client.data.userId = payload.sub;
      client.data.jti = payload.jti;
      client.data.isStaff = Boolean(payload.isStaff);

      /* Rule 2: the only join, and it comes from the verified token. */
      await client.join(userRoom(payload.sub));
      if (payload.isStaff) await client.join(staffRoom);

      client.emit("ready", {
        connected: true,
        /* Stated so a client author does not build on pushes alone. */
        note: "Realtime events are hints. The HTTP API remains the source of truth.",
      });
    } catch (e) {
      this.deny(client, e instanceof Error ? e.message : "handshake failed");
    }
  }

  handleDisconnect(client: AuthedSocket): void {
    if (client.data.userId) {
      this.log.debug(`socket disconnected for ${client.data.userId}`);
    }
  }

  private extractToken(client: AuthedSocket): string | null {
    const auth = client.handshake.auth as { token?: string } | undefined;
    if (auth?.token) return auth.token.replace(/^Bearer\s+/i, "");

    const header = client.handshake.headers.authorization;
    if (typeof header === "string" && header.length > 0) {
      return header.replace(/^Bearer\s+/i, "");
    }
    return null;
  }

  private deny(client: AuthedSocket, reason: string): void {
    this.log.warn(`socket rejected: ${reason}`);
    /* No detail to the client: a precise reason tells a prober what to change. */
    client.emit("unauthorized", { message: "Authentication required" });
    client.disconnect(true);
  }

  /* ==================================================================== *
   * Client messages
   * ==================================================================== */

  /**
   * The only message a client may send.
   *
   * There is deliberately no `subscribe`: a client that could name its own room
   * could name someone else's. Room membership is decided at handshake from the
   * token and never changes.
   */
  @SubscribeMessage("ping")
  handlePing(@ConnectedSocket() client: AuthedSocket, @MessageBody() _body: unknown): { pong: number } {
    void client;
    return { pong: Date.now() };
  }

  /* ==================================================================== *
   * Domain events → pushes
   * ==================================================================== */

  /**
   * Every handler below follows rule 3: it forwards a SUMMARY to the one member
   * it concerns, containing nothing they could not already read over HTTP.
   *
   * The listeners are `@OnEvent` on the in-process bus, so a module publishing a
   * domain fact does not know or care that a socket exists.
   */

  @OnEvent(Events.PointsCredited)
  onPointsCredited(payload: {
    userId: string; amount: number; source: string; runningBalance: number;
  }): void {
    this.toUser(payload.userId, "points.credited", {
      amount: payload.amount,
      source: payload.source,
      balance: payload.runningBalance,
    });
  }

  @OnEvent(Events.GameSessionValidated)
  onSessionValidated(payload: {
    userId: string; ref: string; serverScore: number; pointsAwarded: number; pointsCapped: number;
  }): void {
    this.toUser(payload.userId, "session.validated", {
      ref: payload.ref,
      /* The server score, because that is what was credited from. */
      serverScore: payload.serverScore,
      pointsAwarded: payload.pointsAwarded,
      pointsCapped: payload.pointsCapped,
    });
  }

  @OnEvent(Events.ConversionCompleted)
  onConversionCompleted(payload: {
    userId: string; ref: string; pointsSpent: number; mttCredited: string;
  }): void {
    this.toUser(payload.userId, "conversion.completed", {
      ref: payload.ref,
      pointsSpent: payload.pointsSpent,
      mttCredited: payload.mttCredited,
    });
  }

  @OnEvent(Events.CommissionReleased)
  onCommissionReleased(payload: { recipientId: string; ref: string; amountMtt: string }): void {
    this.toUser(payload.recipientId, "commission.released", {
      ref: payload.ref,
      amountMtt: payload.amountMtt,
    });
  }

  @OnEvent(Events.CommissionCalculated)
  onCommissionCalculated(payload: {
    recipientId: string; level: number; amountMtt: string; status: string;
  }): void {
    this.toUser(payload.recipientId, "commission.calculated", {
      level: payload.level,
      amountMtt: payload.amountMtt,
      /* The status matters: a member should see that something is queued for
       * funding rather than believing it is claimable. */
      status: payload.status,
    });
  }

  @OnEvent(Events.WithdrawalApproved)
  onWithdrawalApproved(payload: { userId: string; ref: string; amountMtt: string }): void {
    this.toUser(payload.userId, "withdrawal.approved", {
      ref: payload.ref,
      amountMtt: payload.amountMtt,
    });
  }

  @OnEvent(Events.WithdrawalCompleted)
  onWithdrawalCompleted(payload: {
    userId: string; ref: string; amountMtt: string; txHash: string;
  }): void {
    this.toUser(payload.userId, "withdrawal.completed", {
      ref: payload.ref,
      amountMtt: payload.amountMtt,
      txHash: payload.txHash,
    });
  }

  @OnEvent(Events.WithdrawalRejected)
  onWithdrawalRejected(payload: { userId: string; ref: string; reason: string }): void {
    this.toUser(payload.userId, "withdrawal.rejected", {
      ref: payload.ref,
      reason: payload.reason,
    });
  }

  @OnEvent(Events.DepositCompleted)
  onDepositCompleted(payload: { userId: string; ref: string; amountMtt: string }): void {
    this.toUser(payload.userId, "deposit.completed", {
      ref: payload.ref,
      amountMtt: payload.amountMtt,
    });
  }

  @OnEvent(Events.StakeRecorded)
  onStakeRecorded(payload: { userId: string; poolId: number; amountMtt: string }): void {
    this.toUser(payload.userId, "staking.staked", {
      poolId: payload.poolId,
      amountMtt: payload.amountMtt,
    });
  }

  @OnEvent(Events.UnstakeRecorded)
  onUnstakeRecorded(payload: {
    userId: string; poolId: number; principalMtt: string; rewardsPaidMtt: string; penaltyMtt: string;
  }): void {
    this.toUser(payload.userId, "staking.unstaked", {
      poolId: payload.poolId,
      principalMtt: payload.principalMtt,
      rewardsPaidMtt: payload.rewardsPaidMtt,
      penaltyMtt: payload.penaltyMtt,
      /* Repeated on the wire so a UI cannot render the penalty as a cut to
       * principal. */
      penaltyAppliedTo: "unclaimed_rewards",
    });
  }

  @OnEvent(Events.RewardClaimed)
  onRewardClaimed(payload: { userId: string; poolId: number; amountMtt: string }): void {
    this.toUser(payload.userId, "staking.reward_claimed", {
      poolId: payload.poolId,
      amountMtt: payload.amountMtt,
    });
  }

  @OnEvent(Events.QuestCompleted)
  onQuestCompleted(payload: {
    userId: string; questId: string; title: string; rewardPoints: number;
  }): void {
    this.toUser(payload.userId, "quest.completed", {
      questId: payload.questId,
      title: payload.title,
      rewardPoints: payload.rewardPoints,
      claimRequired: true,
    });
  }

  @OnEvent(Events.AchievementUnlocked)
  onAchievementUnlocked(payload: {
    userId: string; code: string; title: string; pointsAwarded: number;
  }): void {
    this.toUser(payload.userId, "achievement.unlocked", {
      code: payload.code,
      title: payload.title,
      pointsAwarded: payload.pointsAwarded,
    });
  }

  @OnEvent(Events.KycApproved)
  onKycApproved(payload: { userId: string; tier: number }): void {
    this.toUser(payload.userId, "kyc.approved", { tier: payload.tier });
  }

  @OnEvent(Events.KycRejected)
  onKycRejected(payload: { userId: string; reason?: string }): void {
    this.toUser(payload.userId, "kyc.rejected", { reason: payload.reason ?? null });
  }

  /**
   * An account freeze is pushed AND is the one push that matters most.
   *
   * A member whose funds have just been held should see it immediately, on every
   * open tab, rather than discovering it when a withdrawal fails.
   */
  @OnEvent(Events.AccountFrozen)
  onAccountFrozen(payload: { userId: string; reason: string }): void {
    this.toUser(payload.userId, "account.frozen", { reason: payload.reason });
  }

  @OnEvent(Events.UserStatusChanged)
  onStatusChanged(payload: { userId: string; to: string; reason: string }): void {
    this.toUser(payload.userId, "account.status_changed", {
      status: payload.to,
      reason: payload.reason,
    });
  }

  @OnEvent(Events.TournamentSettled)
  onTournamentSettled(payload: { ref: string; paidEntries: number; totalPaid: string }): void {
    /* Not member-specific, so it goes nowhere near a user room: each winner
     * learns their own result from their prize transaction. Staff see the
     * settlement. */
    this.toStaff("tournament.settled", {
      ref: payload.ref,
      paidEntries: payload.paidEntries,
      totalPaid: payload.totalPaid,
    });
  }

  /* ------------------------- staff-facing pushes ------------------------- */

  @OnEvent(Events.FraudAlertRaised)
  onFraudAlert(payload: { ref?: string; kind: string; severity?: string }): void {
    this.toStaff("fraud.alert", {
      ref: payload.ref ?? null,
      kind: payload.kind,
      severity: payload.severity ?? "unknown",
    });
  }

  @OnEvent(Events.PayoutRatioBreach)
  onPayoutRatioBreach(payload: { payoutRatioBps: number; thresholdBps?: number }): void {
    this.toStaff("treasury.payout_ratio_breach", {
      payoutRatioBps: payload.payoutRatioBps,
      thresholdBps: payload.thresholdBps ?? null,
    });
  }

  @OnEvent(Events.ChainReorgDetected)
  onReorg(payload: { contract: string; rewoundTo: number; orphanedProcessed: number }): void {
    this.toStaff("chain.reorg", {
      contract: payload.contract,
      rewoundTo: payload.rewoundTo,
      /* The dangerous number: events that were already applied to balances. */
      orphanedProcessed: payload.orphanedProcessed,
    });
  }

  @OnEvent(Events.ApprovalRequested)
  onApprovalRequested(payload: { kind: string; ref?: string; targetId?: string | null }): void {
    this.toStaff("approval.requested", {
      kind: payload.kind,
      ref: payload.ref ?? null,
      targetId: payload.targetId ?? null,
    });
  }

  /* ==================================================================== *
   * Emit helpers
   * ==================================================================== */

  /**
   * Sends to one member's private room.
   *
   * Guarded: an event with no user id must never be broadcast as a fallback,
   * which is how one member's balance ends up on another's screen.
   */
  private toUser(userId: string | undefined, event: string, payload: Record<string, unknown>): void {
    if (!userId) {
      this.log.warn(`refusing to emit ${event} with no recipient`);
      return;
    }
    if (!this.server) return;
    this.server.to(userRoom(userId)).emit(event, { ...payload, at: new Date().toISOString() });
  }

  private toStaff(event: string, payload: Record<string, unknown>): void {
    if (!this.server) return;
    this.server.to(staffRoom).emit(event, { ...payload, at: new Date().toISOString() });
  }

  /** Connected socket count, for the health endpoint. */
  connectionCount(): number {
    return this.server?.sockets?.sockets?.size ?? 0;
  }
}
