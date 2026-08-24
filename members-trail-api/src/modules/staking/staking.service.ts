import {
  BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { Repository } from "typeorm";
import {
  StakingAprHistory, StakingPool, StakingPosition, StakingReward,
} from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { EventBusService, Events } from "@/events";
import { Jobs, Queues, jobKey } from "@/queues/queue.constants";
import { chainConfig, type ChainConfig } from "@/config/configuration";
import { RedisService } from "@/common/redis/redis.service";
import { paginate, type Paginated } from "@/common/dto";
import {
  Decimal, Ref, add, applyBps, dec, gt, gte, monthKey, sub, toDbAmount,
} from "@/common/utils";
import { AuditService } from "@/modules/audit/audit.service";
import type {
  AprPointResponse, ClaimRewardsRequest, RewardHistoryQuery, StakeRequest, StakingIntentResponse,
  StakingPoolResponse, StakingPositionResponse, StakingRewardResponse, StakingSummaryResponse,
  UnstakePreviewResponse, UnstakeRequest, UpsertPoolRequest,
} from "./dto/staking.dto";

/* ============================================================================
 * Staking (FRD S-01 … S-04).
 *
 * THE CHAIN IS THE SOURCE OF TRUTH. These tables are an indexed mirror so the
 * API can answer "show me my positions" without an RPC round trip per request.
 * Everything below follows from that:
 *
 *  1. NO POSITION IS EVER INVENTED HERE. A stake, unstake or claim from a member
 *     produces an *intent*: a signed transaction queued for submission. The
 *     position changes when the chain event is indexed, not when the API returns
 *     200. Writing the position optimistically and reconciling later is how a
 *     mirror ends up disagreeing with the chain with no way to tell which is
 *     right.
 *
 *  2. CUSTODIAL FUNDS ARE RESERVED AT INTENT TIME, via the ledger's atomic
 *     bucket transfer (available → staked). This is not the same as inventing a
 *     position: it stops the member spending the same MTT twice while the
 *     transaction is in flight. If the transaction fails terminally the watcher
 *     calls `revertStakeIntent()` and the reservation is returned in full.
 *
 *  3. THE EARLY-EXIT PENALTY APPLIES TO UNCLAIMED REWARDS ONLY — NEVER TO
 *     PRINCIPAL. Cutting principal would make staking a product that can lose
 *     the member's own money, which is a completely different regulatory animal
 *     from one that forfeits unearned yield. `previewUnstake` returns both
 *     numbers separately so the UI cannot conflate them.
 *
 *  4. APR IS DERIVED, NEVER PROMISED. It is computed after the fact as
 *     inflow ÷ TVL annualised over the period, and stored as history. There is
 *     no field anywhere in this module that promises a future rate.
 * ========================================================================== */

/** A mirror further behind than this is reported as stale rather than presented
 *  as current. Silence about staleness is worse than the staleness. */
const STALE_AFTER_MS = 15 * 60_000;

const INTENT_LOCK_TTL_SECONDS = 30;

/** Days used to annualise a monthly APR observation. */
const DAYS_IN_YEAR = 365;

@Injectable()
export class StakingService {
  private readonly log = new Logger(StakingService.name);

  constructor(
    @InjectRepository(StakingPool) private readonly pools: Repository<StakingPool>,
    @InjectRepository(StakingPosition) private readonly positions: Repository<StakingPosition>,
    @InjectRepository(StakingReward) private readonly rewards: Repository<StakingReward>,
    @InjectRepository(StakingAprHistory) private readonly aprHistory: Repository<StakingAprHistory>,
    private readonly ledger: LedgerService,
    private readonly bus: EventBusService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    @Inject(chainConfig.KEY) private readonly chain: ChainConfig,
    @InjectQueue(Queues.ChainTx) private readonly txQueue: Queue,
  ) {}

  /* ==================================================================== *
   * Reads
   * ==================================================================== */

  async listPools(includeInactive = false): Promise<StakingPoolResponse[]> {
    const rows = await this.pools.find({
      where: includeInactive ? {} : { active: true },
      order: { lockDays: "ASC" },
    });
    return rows.map((p) => this.poolView(p));
  }

  async positionsFor(userId: string): Promise<StakingSummaryResponse> {
    const rows = await this.positions.find({ where: { userId }, order: { poolId: "ASC" } });
    const pools = await this.poolMap();

    const positions = rows
      .filter((p) => gt(p.amount, 0) || gt(p.pendingRewards, 0))
      .map((p) => this.positionView(p, pools.get(p.poolId)?.name ?? `Pool ${p.poolId}`));

    const claimed = await this.rewards
      .createQueryBuilder("r")
      .select("COALESCE(SUM(r.accrued), 0)", "sum")
      .where("r.userId = :userId", { userId })
      .andWhere("r.claimed = true")
      .getRawOne<{ sum: string | null }>();

    return {
      totalStakedMtt: positions.reduce((acc, p) => add(acc, p.amount), toDbAmount(0)),
      totalPendingRewardsMtt: positions.reduce((acc, p) => add(acc, p.pendingRewards), toDbAmount(0)),
      lifetimeRewardsClaimedMtt: toDbAmount(claimed?.sum ?? 0),
      activePositions: positions.filter((p) => gt(p.amount, 0)).length,
      positions,
    };
  }

  /**
   * What the member would actually receive if they unstaked right now.
   *
   * Returns principal and rewards as separate figures, with the penalty applied
   * only to the latter. A single "you'll get X" number would hide exactly the
   * distinction the member needs to make the decision.
   */
  async previewUnstake(userId: string, poolId: number): Promise<UnstakePreviewResponse> {
    const { pool, position } = await this.requirePosition(userId, poolId);

    const early = Boolean(position.lockEnd && position.lockEnd.getTime() > Date.now());
    const penaltyBps = early ? pool.earlyPenaltyBps : 0;

    /* The penalty base is pendingRewards. Principal is never an input to this
     * calculation — see rule 3 in the header. */
    const penalty = penaltyBps > 0 ? applyBps(position.pendingRewards, penaltyBps) : toDbAmount(0);
    const rewardsPayable = sub(position.pendingRewards, penalty);

    return {
      poolId,
      principal: toDbAmount(position.amount),
      pendingRewards: toDbAmount(position.pendingRewards),
      early,
      penaltyBps,
      penaltyMtt: penalty,
      rewardsPayable,
      totalReceived: add(position.amount, rewardsPayable),
      penaltyFreeAt: early && position.lockEnd ? position.lockEnd.toISOString() : null,
    };
  }

  async rewardHistory(userId: string, q: RewardHistoryQuery): Promise<Paginated<StakingRewardResponse>> {
    const qb = this.rewards.createQueryBuilder("r").where("r.userId = :userId", { userId });
    if (q.poolId !== undefined) qb.andWhere("r.poolId = :poolId", { poolId: q.poolId });
    if (q.from) qb.andWhere("r.createdAt >= :from", { from: q.from });
    if (q.to) qb.andWhere("r.createdAt <= :to", { to: q.to });

    const [rows, total] = await qb
      .orderBy("r.createdAt", q.sortDir)
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();

    return paginate(
      rows.map((r) => ({
        ref: r.ref,
        poolId: r.poolId,
        accrued: toDbAmount(r.accrued),
        claimed: r.claimed,
        periodKey: r.periodKey,
        txHash: r.txHash ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      q,
    );
  }

  /** Trailing APR observations for a pool — the chart data, labelled as history. */
  async aprSeries(poolId: number, months = 12): Promise<AprPointResponse[]> {
    const rows = await this.aprHistory.find({
      where: { poolId },
      order: { periodKey: "DESC" },
      take: Math.min(months, 60),
    });
    return rows
      .reverse()
      .map((r) => ({
        periodKey: r.periodKey,
        apr: r.apr,
        inflow: toDbAmount(r.inflow),
        tvl: toDbAmount(r.tvl),
      }));
  }

  /* ==================================================================== *
   * Intents — queued, never applied here
   * ==================================================================== */

  async requestStake(userId: string, dto: StakeRequest): Promise<StakingIntentResponse> {
    const amount = toDbAmount(dto.amountMtt);
    if (dec(amount).lte(0)) throw new BadRequestException("Stake amount must be positive");

    const pool = await this.pools.findOne({ where: { poolId: dto.poolId } });
    if (!pool) throw new NotFoundException(`Pool ${dto.poolId} not found`);
    if (!pool.active) {
      throw new ConflictException({
        code: "POOL_CLOSED",
        message: "This pool is no longer accepting stakes",
      });
    }

    return this.underIntentLock(userId, dto.poolId, "stake", async () => {
      const balance = await this.ledger.getBalance(userId);
      if (!gte(balance.mttAvailable, amount)) {
        throw new ConflictException({
          code: "INSUFFICIENT_BALANCE",
          message: "Insufficient available MTT balance",
          available: toDbAmount(balance.mttAvailable),
          requested: amount,
        });
      }

      const ref = Ref.transaction();

      /* Reserve, do not credit a position. available → staked is atomic in the
       * ledger; the position itself is written by the indexer when the chain
       * confirms. See rules 1 and 2 in the header. */
      await this.ledger.transferBucket({
        userId,
        from: "available",
        to: "staked",
        amount,
        type: "stake",
        idempotencyKey: `stake-intent:${ref}`,
        note: `Stake intent ${ref} into pool ${dto.poolId}`,
        metadata: { poolId: dto.poolId, intentRef: ref },
      });

      await this.txQueue.add(
        Jobs.SubmitTx,
        {
          intentRef: ref,
          userId,
          kind: "stake",
          contract: this.chain.contracts.staking,
          poolId: dto.poolId,
          amountMtt: amount,
        },
        { jobId: jobKey(`stake:${ref}`) },
      );

      this.log.log(`stake intent ${ref}: ${amount} MTT → pool ${dto.poolId} (${userId})`);

      return {
        action: "stake",
        poolId: dto.poolId,
        amountMtt: amount,
        status: "queued",
        ref,
        penaltyMtt: null,
      };
    });
  }

  /**
   * Queues an unstake.
   *
   * Requires explicit acceptance of the penalty while the lock is active: a
   * member must not discover a forfeit after the fact, and the accepted figure
   * is snapshotted onto the job so the amount they agreed to is the amount
   * applied even if the pool's penalty changes in between.
   */
  async requestUnstake(userId: string, dto: UnstakeRequest): Promise<StakingIntentResponse> {
    const preview = await this.previewUnstake(userId, dto.poolId);

    if (dec(preview.principal).lte(0)) {
      throw new ConflictException({
        code: "NO_POSITION",
        message: "There is nothing staked in this pool",
      });
    }
    if (preview.early && !dto.acceptPenalty) {
      throw new ConflictException({
        code: "PENALTY_NOT_ACCEPTED",
        message: "This position is still locked; unstaking now forfeits part of the unclaimed rewards",
        penaltyMtt: preview.penaltyMtt,
        penaltyBps: preview.penaltyBps,
        penaltyFreeAt: preview.penaltyFreeAt,
        /* Stated explicitly so no client renders this as a cut to principal. */
        principalReturnedInFull: true,
      });
    }

    return this.underIntentLock(userId, dto.poolId, "unstake", async () => {
      const ref = Ref.transaction();

      await this.txQueue.add(
        Jobs.SubmitTx,
        {
          intentRef: ref,
          userId,
          kind: "unstake",
          contract: this.chain.contracts.staking,
          poolId: dto.poolId,
          amountMtt: preview.principal,
          /* Snapshot of what the member agreed to. */
          penaltyMtt: preview.penaltyMtt,
          penaltyBps: preview.penaltyBps,
          early: preview.early,
        },
        { jobId: jobKey(`unstake:${ref}`) },
      );

      return {
        action: "unstake",
        poolId: dto.poolId,
        amountMtt: preview.principal,
        status: "queued",
        ref,
        penaltyMtt: preview.penaltyMtt,
      };
    });
  }

  async requestClaim(userId: string, dto: ClaimRewardsRequest): Promise<StakingIntentResponse> {
    const { position } = await this.requirePosition(userId, dto.poolId);
    if (dec(position.pendingRewards).lte(0)) {
      throw new ConflictException({
        code: "NO_REWARDS",
        message: "There are no unclaimed rewards in this pool",
      });
    }

    return this.underIntentLock(userId, dto.poolId, "claim", async () => {
      const ref = Ref.reward();
      await this.txQueue.add(
        Jobs.SubmitTx,
        {
          intentRef: ref,
          userId,
          kind: "claim",
          contract: this.chain.contracts.staking,
          poolId: dto.poolId,
          amountMtt: toDbAmount(position.pendingRewards),
        },
        { jobId: jobKey(`claim:${ref}`) },
      );

      return {
        action: "claim",
        poolId: dto.poolId,
        amountMtt: toDbAmount(position.pendingRewards),
        status: "queued",
        ref,
        penaltyMtt: null,
      };
    });
  }

  /* ==================================================================== *
   * Mirror — called by the indexer and the tx watcher only
   * ==================================================================== */

  /**
   * Applies a confirmed on-chain stake.
   *
   * The chain's amount is authoritative: if it disagrees with what we reserved,
   * the reservation is corrected to match rather than the other way round, and
   * the drift is logged. A mirror that argues with the chain is just a second
   * source of truth.
   */
  async mirrorStake(params: {
    userId: string;
    poolId: number;
    amountMtt: string;
    lockEnd: Date | null;
    blockNumber: number;
    txHash: string;
  }): Promise<void> {
    const pool = await this.pools.findOne({ where: { poolId: params.poolId } });
    const position = await this.getOrCreatePosition(params.userId, params.poolId);

    position.amount = add(position.amount, params.amountMtt);
    position.stakedAt = position.stakedAt ?? new Date();
    position.lockEnd =
      params.lockEnd ??
      (pool && pool.lockDays > 0
        ? new Date(Date.now() + pool.lockDays * 86_400_000)
        : position.lockEnd ?? null);
    position.lastSyncedBlock = params.blockNumber;
    await this.positions.save(position);

    if (pool) {
      pool.totalStaked = add(pool.totalStaked, params.amountMtt);
      pool.lastSyncedBlock = params.blockNumber;
      await this.pools.save(pool);
    }

    await this.bus.publish(Events.StakeRecorded, {
      userId: params.userId,
      poolId: params.poolId,
      amountMtt: toDbAmount(params.amountMtt),
      lockEnd: position.lockEnd ? position.lockEnd.toISOString() : null,
      txHash: params.txHash,
      blockNumber: params.blockNumber,
    });
  }

  /**
   * Applies a confirmed on-chain unstake: principal returns to the spendable
   * balance in full, and the penalty is taken out of the rewards only.
   */
  async mirrorUnstake(params: {
    userId: string;
    poolId: number;
    principalMtt: string;
    rewardsPaidMtt: string;
    penaltyMtt: string;
    blockNumber: number;
    txHash: string;
  }): Promise<void> {
    const position = await this.getOrCreatePosition(params.userId, params.poolId);

    /* Principal: staked → available, in full. The penalty is NOT deducted here. */
    await this.ledger.transferBucket({
      userId: params.userId,
      from: "staked",
      to: "available",
      amount: toDbAmount(params.principalMtt),
      type: "unstake",
      idempotencyKey: `unstake:${params.txHash}:${params.poolId}`,
      note: `Unstake from pool ${params.poolId}`,
      txHash: params.txHash,
      metadata: { poolId: params.poolId, penaltyMtt: toDbAmount(params.penaltyMtt) },
    });

    if (gt(params.rewardsPaidMtt, 0)) {
      await this.ledger.mutateMtt({
        userId: params.userId,
        type: "reward_claim",
        amountMtt: toDbAmount(params.rewardsPaidMtt),
        idempotencyKey: `unstake-rewards:${params.txHash}:${params.poolId}`,
        status: "completed",
        bucket: "available",
        txHash: params.txHash,
        note: `Staking rewards on exit from pool ${params.poolId}`,
      });
    }

    position.amount = maxZero(sub(position.amount, params.principalMtt));
    position.pendingRewards = toDbAmount(0);
    position.lastSyncedBlock = params.blockNumber;
    if (dec(position.amount).lte(0)) position.lockEnd = null;
    await this.positions.save(position);

    const pool = await this.pools.findOne({ where: { poolId: params.poolId } });
    if (pool) {
      pool.totalStaked = maxZero(sub(pool.totalStaked, params.principalMtt));
      pool.totalRewardsPaid = add(pool.totalRewardsPaid, params.rewardsPaidMtt);
      pool.lastSyncedBlock = params.blockNumber;
      await this.pools.save(pool);
    }

    await this.bus.publish(Events.UnstakeRecorded, {
      userId: params.userId,
      poolId: params.poolId,
      principalMtt: toDbAmount(params.principalMtt),
      rewardsPaidMtt: toDbAmount(params.rewardsPaidMtt),
      penaltyMtt: toDbAmount(params.penaltyMtt),
      /* Recorded on the event so any consumer — reporting, support, the member's
       * statement — sees that the penalty never touched principal. */
      penaltyAppliedTo: "unclaimed_rewards",
      txHash: params.txHash,
    });
  }

  /** Applies a confirmed reward claim. */
  async mirrorRewardClaim(params: {
    userId: string;
    poolId: number;
    amountMtt: string;
    blockNumber: number;
    txHash: string;
    periodKey?: string;
  }): Promise<void> {
    await this.ledger.mutateMtt({
      userId: params.userId,
      type: "reward_claim",
      amountMtt: toDbAmount(params.amountMtt),
      idempotencyKey: `reward-claim:${params.txHash}:${params.poolId}`,
      status: "completed",
      bucket: "available",
      txHash: params.txHash,
      note: `Staking rewards claimed from pool ${params.poolId}`,
    });

    const position = await this.getOrCreatePosition(params.userId, params.poolId);
    position.pendingRewards = maxZero(sub(position.pendingRewards, params.amountMtt));
    position.lastSyncedBlock = params.blockNumber;
    await this.positions.save(position);

    await this.rewards.save(
      this.rewards.create({
        ref: Ref.reward(),
        userId: params.userId,
        poolId: params.poolId,
        accrued: toDbAmount(params.amountMtt),
        claimed: true,
        txHash: params.txHash,
        periodKey: params.periodKey ?? monthKey(),
      }),
    );

    const pool = await this.pools.findOne({ where: { poolId: params.poolId } });
    if (pool) {
      pool.totalRewardsPaid = add(pool.totalRewardsPaid, params.amountMtt);
      pool.lastSyncedBlock = params.blockNumber;
      await this.pools.save(pool);
    }

    await this.bus.publish(Events.RewardClaimed, {
      userId: params.userId,
      poolId: params.poolId,
      amountMtt: toDbAmount(params.amountMtt),
      txHash: params.txHash,
    });
  }

  /** Records reward funding arriving in a pool (from a confirmed treasury outflow). */
  async mirrorPoolFunding(params: {
    poolId: number;
    amountMtt: string;
    blockNumber: number;
    txHash: string;
  }): Promise<void> {
    const pool = await this.pools.findOne({ where: { poolId: params.poolId } });
    if (!pool) {
      this.log.warn(`funding for unknown pool ${params.poolId} — ignoring until the pool is mirrored`);
      return;
    }
    pool.totalRewardsFunded = add(pool.totalRewardsFunded, params.amountMtt);
    pool.lastSyncedBlock = params.blockNumber;
    await this.pools.save(pool);

    await this.bus.publish(Events.RewardPoolFunded, {
      poolId: params.poolId,
      amountMtt: toDbAmount(params.amountMtt),
      txHash: params.txHash,
    });
  }

  /**
   * Sets a position's accrued rewards from an authoritative chain read.
   *
   * Assignment, not accumulation: the chain's pending figure already accounts
   * for everything, so adding to a local number would double-count on every
   * sync.
   */
  async syncPendingRewards(params: {
    userId: string;
    poolId: number;
    pendingRewardsMtt: string;
    blockNumber: number;
  }): Promise<void> {
    const position = await this.getOrCreatePosition(params.userId, params.poolId);
    const before = position.pendingRewards;
    position.pendingRewards = toDbAmount(params.pendingRewardsMtt);
    position.lastSyncedBlock = params.blockNumber;
    await this.positions.save(position);

    if (!dec(before).eq(dec(position.pendingRewards))) {
      this.log.debug(
        `pool ${params.poolId} rewards for ${params.userId}: ${before} → ${position.pendingRewards}`,
      );
    }
  }

  /**
   * Returns a reservation after a terminally failed stake transaction.
   *
   * Idempotent through the ledger key derived from the intent ref: a watcher
   * that reports the same failure twice cannot hand the member the funds twice.
   */
  async revertStakeIntent(params: {
    userId: string;
    intentRef: string;
    amountMtt: string;
    reason: string;
  }): Promise<void> {
    await this.ledger.transferBucket({
      userId: params.userId,
      from: "staked",
      to: "available",
      amount: toDbAmount(params.amountMtt),
      type: "unstake",
      idempotencyKey: `stake-revert:${params.intentRef}`,
      note: `Stake intent ${params.intentRef} failed: ${params.reason}`.slice(0, 255),
    });
    this.log.error(`stake intent ${params.intentRef} reverted: ${params.reason}`);
  }

  /* ==================================================================== *
   * APR — derived after the fact
   * ==================================================================== */

  /**
   * Computes and stores the realised APR for a pool over a period.
   *
   *   APR = inflow ÷ TVL × (365 ÷ periodDays) × 100
   *
   * A pool with no TVL has no APR — not zero, not infinity. Reporting 0% for an
   * empty pool would imply an observation nobody made.
   */
  async recomputeApr(poolId: number, periodKey = monthKey()): Promise<AprPointResponse | null> {
    const pool = await this.pools.findOne({ where: { poolId } });
    if (!pool) throw new NotFoundException(`Pool ${poolId} not found`);

    const tvl = toDbAmount(pool.totalStaked);
    if (dec(tvl).lte(0)) {
      this.log.debug(`pool ${poolId} has no TVL for ${periodKey} — no APR observation recorded`);
      return null;
    }

    const inflowRaw = await this.rewards
      .createQueryBuilder("r")
      .select("COALESCE(SUM(r.accrued), 0)", "sum")
      .where("r.poolId = :poolId", { poolId })
      .andWhere("r.periodKey = :periodKey", { periodKey })
      .getRawOne<{ sum: string | null }>();

    const inflow = toDbAmount(inflowRaw?.sum ?? 0);
    const periodDays = daysInPeriod(periodKey);

    const apr = dec(inflow)
      .div(dec(tvl))
      .mul(DAYS_IN_YEAR / periodDays)
      .mul(100)
      .toFixed(4, Decimal.ROUND_DOWN);

    const existing = await this.aprHistory.findOne({ where: { poolId, periodKey } });
    const row = existing ?? this.aprHistory.create({ poolId, periodKey });
    row.apr = apr;
    row.inflow = inflow;
    row.tvl = tvl;
    await this.aprHistory.save(row);

    pool.currentApr = apr;
    await this.pools.save(pool);

    return { periodKey, apr, inflow, tvl };
  }

  /* ==================================================================== *
   * Admin
   * ==================================================================== */

  /**
   * Mirrors a pool's on-chain configuration.
   *
   * This writes the *mirror*, not the contract: it cannot change the lock or the
   * penalty a member is actually subject to. Recorded in the audit trail because
   * a mirror that disagrees with the chain misleads every member who reads it.
   */
  async upsertPool(dto: UpsertPoolRequest, actorId: string, ip: string | null): Promise<StakingPoolResponse> {
    const existing = await this.pools.findOne({ where: { poolId: dto.poolId } });
    const before = existing
      ? {
          name: existing.name, lockDays: existing.lockDays,
          earlyPenaltyBps: existing.earlyPenaltyBps, active: existing.active,
        }
      : null;

    const row = existing ?? this.pools.create({ poolId: dto.poolId });
    row.name = dto.name;
    row.lockDays = dto.lockDays;
    row.rewardsDurationDays = dto.rewardsDurationDays;
    row.earlyPenaltyBps = dto.earlyPenaltyBps;
    row.active = dto.active;
    const saved = await this.pools.save(row);

    await this.audit.recordOrThrow({
      actorId,
      action: existing ? "staking.pool.update" : "staking.pool.create",
      targetType: "staking_pool",
      targetId: saved.id,
      before,
      after: {
        poolId: dto.poolId, name: dto.name, lockDays: dto.lockDays,
        earlyPenaltyBps: dto.earlyPenaltyBps, active: dto.active,
      },
      reason: dto.reason,
      ip,
    });

    return this.poolView(saved);
  }

  /* ------------------------------------------------------------------ */

  /**
   * Serialises one member's intents per pool.
   *
   * Without this, two taps on "stake" both read the same available balance and
   * both reserve it. The ledger would catch the second on the balance check, but
   * only after a second transaction had already been queued.
   */
  private async underIntentLock<T>(
    userId: string,
    poolId: number,
    action: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const result = await this.redis.withLock(
      `staking:intent:${userId}:${poolId}`,
      INTENT_LOCK_TTL_SECONDS,
      fn,
    );
    if (result === null) {
      throw new ConflictException({
        code: "STAKING_INTENT_IN_FLIGHT",
        message: `Another ${action} for this pool is already being submitted`,
      });
    }
    return result;
  }

  private async requirePosition(
    userId: string,
    poolId: number,
  ): Promise<{ pool: StakingPool; position: StakingPosition }> {
    const pool = await this.pools.findOne({ where: { poolId } });
    if (!pool) throw new NotFoundException(`Pool ${poolId} not found`);
    const position = await this.positions.findOne({ where: { userId, poolId } });
    if (!position) throw new NotFoundException("No position in this pool");
    return { pool, position };
  }

  private async getOrCreatePosition(userId: string, poolId: number): Promise<StakingPosition> {
    const found = await this.positions.findOne({ where: { userId, poolId } });
    if (found) return found;
    return this.positions.save(
      this.positions.create({
        userId,
        poolId,
        amount: toDbAmount(0),
        pendingRewards: toDbAmount(0),
      }),
    );
  }

  private async poolMap(): Promise<Map<number, StakingPool>> {
    const rows = await this.pools.find();
    return new Map(rows.map((p) => [p.poolId, p]));
  }

  private poolView(p: StakingPool): StakingPoolResponse {
    const synced = p.lastSyncedBlock !== null && p.lastSyncedBlock !== undefined;
    return {
      poolId: p.poolId,
      name: p.name,
      lockDays: p.lockDays,
      rewardsDurationDays: p.rewardsDurationDays,
      earlyPenaltyBps: p.earlyPenaltyBps,
      active: p.active,
      totalStaked: toDbAmount(p.totalStaked),
      totalRewardsFunded: toDbAmount(p.totalRewardsFunded),
      totalRewardsPaid: toDbAmount(p.totalRewardsPaid),
      currentApr: p.currentApr,
      /* Funded minus paid. A pool advertising rewards it cannot pay is the
       * staking equivalent of an unbacked commission. */
      rewardsRemaining: maxZero(sub(p.totalRewardsFunded, p.totalRewardsPaid)),
      lastSyncedBlock: p.lastSyncedBlock ?? null,
      stale: !synced || Date.now() - p.updatedAt.getTime() > STALE_AFTER_MS,
    };
  }

  private positionView(p: StakingPosition, poolName: string): StakingPositionResponse {
    const locked = Boolean(p.lockEnd && p.lockEnd.getTime() > Date.now());
    return {
      poolId: p.poolId,
      poolName,
      amount: toDbAmount(p.amount),
      pendingRewards: toDbAmount(p.pendingRewards),
      stakedAt: p.stakedAt ? p.stakedAt.toISOString() : null,
      lockEnd: p.lockEnd ? p.lockEnd.toISOString() : null,
      locked,
      unlocksInSeconds: locked && p.lockEnd
        ? Math.max(0, Math.ceil((p.lockEnd.getTime() - Date.now()) / 1_000))
        : 0,
      lastSyncedBlock: p.lastSyncedBlock ?? null,
    };
  }
}

/** Clamps a signed amount at zero — a mirror must never show a negative stake. */
function maxZero(v: string): string {
  return dec(v).isNegative() ? toDbAmount(0) : toDbAmount(v);
}

/** Days in the period a `YYYY-MM` (or `YYYY-MM-DD`) key describes. */
export function daysInPeriod(periodKey: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(periodKey)) return 1;
  const [y, m] = periodKey.split("-").map(Number);
  if (!y || !m) return 30;
  /* Day 0 of the next month is the last day of this one. */
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
