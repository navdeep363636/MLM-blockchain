import { Injectable, Logger } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { fiat, toDbAmount } from "@/common/utils";

/* ============================================================================
 * The single door to the database's views and stored procedures.
 *
 * Every `CALL` and every view read in this codebase goes through here. That is
 * the point: raw SQL scattered across twenty services is SQL nobody can audit,
 * and a renamed column becomes a runtime error in a cron at 3am instead of a
 * compile error. One file means one place to look when a procedure changes.
 *
 * The division of labour this service assumes:
 *
 *   VIEWS AND PROCEDURES do set-based work — aggregate a period, upsert five
 *   hundred leaderboard rows, expire a thousand stale approvals in one
 *   statement. They contain no policy.
 *
 *   SERVICES decide. Caps, rates, plan depth, whether a payout may proceed —
 *   all of that stays in TypeScript where it is unit-tested. Nothing here
 *   computes an amount a member receives.
 *
 * Every method is documented with what it replaced, because the reason each one
 * exists is a round-trip count.
 * ========================================================================== */

/** A `CALL` returns `[rows[], okPacket]`; a view read returns `rows[]`. */
type CallResult<T> = [T[], unknown];

export interface CommissionSolvencyRow {
  poolFundedMtt: string;
  committedMtt: string;
  queuedMtt: string;
  pendingKycMtt: string;
}

export interface TreasuryPeriodRow {
  periodKey: string;
  reconciledInflow: string;
  unreconciledInflow: string;
  grossRevenue: string;
  commissionPoolOut: string;
  stakingPoolOut: string;
  reserveOut: string;
  inflowCount: number;
  outflowCount: number;
}

export interface PayoutRatioRow {
  periodKey: string;
  reconciledNetRevenue: string;
  releasedCommission: string;
  confirmedOutflow: string;
  reconciledTreasuryInflow: string;
  /** Released commission over reconciled NET REVENUE. Null when there is none. */
  commissionRatioBps: number | null;
  /** Confirmed pool transfers over reconciled TREASURY INFLOW. Null when there is none. */
  outflowRatioBps: number | null;
}

export interface PointsDriftRow {
  userId: string;
  balancePoints: string;
  ledgerPoints: string;
  drift: string;
}

export interface MttLiabilityRow {
  accounts: number;
  availableMtt: string;
  stakedMtt: string;
  pendingRewardsMtt: string;
  lockedForWithdrawalMtt: string;
  commissionAvailableMtt: string;
  commissionPendingMtt: string;
  totalLiabilityMtt: string;
  totalPoints: string;
}

export interface AdminKpiRow {
  members: number;
  activeMembers30d: number;
  kycVerified: number;
  frozenAccounts: number;
  withdrawalsInReview: number;
  openFraudAlerts: number;
  pendingApprovals: number;
  breachedTickets: number;
  queuedCommissionMtt: string;
}

export interface LeaderboardSnapshotRow {
  userId: string;
  score: number;
  rank: number;
}

export interface QuestProgressResult {
  progress: number;
  /** True only when THIS call completed the quest — the caller publishes on the
   *  transition, and an already-finished quest must not fire it again. */
  completed: boolean;
  isComplete: boolean;
}

@Injectable()
export class DbRoutinesService {
  private readonly log = new Logger(DbRoutinesService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /* ==================================================================== *
   * Views
   * ==================================================================== */

  /**
   * The commission solvency invariant, in one query.
   *
   * Replaces four sequential aggregate scans — and `fundingAvailable` is called
   * once per commission row during a three-level fan-out, so one revenue event
   * was costing a dozen full scans of `commissions` and `treasury_outflows`.
   */
  async commissionSolvency(): Promise<CommissionSolvencyRow> {
    const rows = await this.ds.query<CommissionSolvencyRow[]>(
      "SELECT * FROM v_commission_solvency",
    );
    const row = rows[0];
    /* A view over empty tables still returns a row of zeros, so a missing row
     * means the view itself is gone — worth failing loudly rather than
     * reporting a solvent pool. */
    if (!row) throw new Error("v_commission_solvency returned no row — has the migration been run?");

    return {
      poolFundedMtt: toDbAmount(row.poolFundedMtt),
      committedMtt: toDbAmount(row.committedMtt),
      queuedMtt: toDbAmount(row.queuedMtt),
      pendingKycMtt: toDbAmount(row.pendingKycMtt),
    };
  }

  /**
   * Treasury aggregates for one period.
   *
   * Replaces six aggregate queries per rollup — and the rollup ran on every
   * dashboard read as well as from two crons.
   */
  async treasuryPeriod(periodKey: string): Promise<TreasuryPeriodRow> {
    const rows = await this.ds.query<TreasuryPeriodRow[]>(
      "SELECT * FROM v_treasury_period WHERE periodKey = ?",
      [periodKey],
    );
    const row = rows[0];
    /* A period with no rows at all is normal — a month that has not started yet
     * has no inflows — so zeros are the honest answer, not an error. */
    return row ?? {
      periodKey,
      reconciledInflow: toDbAmount(0),
      unreconciledInflow: toDbAmount(0),
      grossRevenue: fiat(0),
      commissionPoolOut: toDbAmount(0),
      stakingPoolOut: toDbAmount(0),
      reserveOut: toDbAmount(0),
      inflowCount: 0,
      outflowCount: 0,
    };
  }

  /**
   * The payout ratio components for a period.
   *
   * Reports and the Treasury service each derived a "payout ratio" from
   * different inputs — and they are genuinely different questions (commission
   * against member spend; pool transfers against Treasury inflow). They must not
   * be summed: commission is PAID FROM the pool transfer, so adding them counts
   * the same money twice. The view publishes both, computed once, and each caller
   * reads the one it means.
   */
  async payoutRatio(periodKey: string): Promise<PayoutRatioRow> {
    const rows = await this.ds.query<PayoutRatioRow[]>(
      "SELECT * FROM v_payout_ratio WHERE periodKey = ?",
      [periodKey],
    );
    return rows[0] ?? {
      periodKey,
      reconciledNetRevenue: fiat(0),
      releasedCommission: fiat(0),
      confirmedOutflow: toDbAmount(0),
      reconciledTreasuryInflow: toDbAmount(0),
      /* Null, not zero: no revenue means the ratio is undefined, and reporting
       * 0% for "we earned nothing and paid nothing" reads as healthy when it is
       * simply unknown. */
      commissionRatioBps: null,
      outflowRatioBps: null,
    };
  }

  /**
   * Accounts whose Points balance disagrees with their ledger.
   *
   * A balance is a cached projection of an immutable ledger; if they differ,
   * something wrote a balance outside LedgerService. There was no set-based way
   * to check this, so the nightly audit skipped the walk and the check never ran
   * for anyone. An empty result is the healthy answer.
   */
  async pointsDrift(limit = 100): Promise<PointsDriftRow[]> {
    return this.ds.query<PointsDriftRow[]>(
      "SELECT * FROM v_points_drift ORDER BY ABS(drift) DESC LIMIT ?",
      [Math.min(limit, 1_000)],
    );
  }

  /** What the platform owes members, by bucket — the counterpart to an on-chain balance. */
  async mttLiability(): Promise<MttLiabilityRow> {
    const rows = await this.ds.query<MttLiabilityRow[]>("SELECT * FROM v_mtt_liability");
    const row = rows[0];
    if (!row) throw new Error("v_mtt_liability returned no row — has the migration been run?");
    return row;
  }

  /** The operator dashboard counters, in one row instead of thirteen round trips. */
  async adminKpis(): Promise<AdminKpiRow> {
    const rows = await this.ds.query<AdminKpiRow[]>("SELECT * FROM v_admin_kpis");
    const row = rows[0];
    if (!row) throw new Error("v_admin_kpis returned no row — has the migration been run?");
    return row;
  }

  /* ==================================================================== *
   * Procedures
   * ==================================================================== */

  /**
   * Writes a whole leaderboard in one statement.
   *
   * This was up to 500 single-row saves per metric; the cron ran four metrics
   * across three periods, so a tick could be six thousand round trips. The
   * unique key makes it an upsert, so re-running a period corrects it rather
   * than duplicating it.
   */
  async leaderboardSnapshotUpsert(
    metric: string,
    periodKey: string,
    rows: LeaderboardSnapshotRow[],
  ): Promise<number> {
    if (rows.length === 0) return 0;

    const result = await this.ds.query<CallResult<{ affected: string }>>(
      "CALL sp_leaderboard_snapshot_upsert(?, ?, ?)",
      [metric, periodKey, JSON.stringify(rows)],
    );
    return Number(result[0]?.[0]?.affected ?? 0);
  }

  /**
   * Advances one quest instance.
   *
   * The service read the row, added in JavaScript, clamped to the target and
   * wrote it back — three statements with a lost-update window between them, so
   * two concurrent sessions could both read 2 and both write 3. The clamp is now
   * part of the same statement.
   */
  async questProgress(params: {
    userId: string;
    questId: string;
    periodKey: string;
    amount: number;
    target: number;
    expiresAt: Date | null;
  }): Promise<QuestProgressResult> {
    const result = await this.ds.query<CallResult<{ progress: number; completed: string; isComplete: string }>>(
      "CALL sp_quest_progress(?, ?, ?, ?, ?, ?)",
      [params.userId, params.questId, params.periodKey, params.amount, params.target, params.expiresAt],
    );
    const row = result[0]?.[0];
    if (!row) throw new Error("sp_quest_progress returned no row");

    return {
      progress: Number(row.progress),
      completed: Number(row.completed) === 1,
      isComplete: Number(row.isComplete) === 1,
    };
  }

  /** Expires dual-control requests nobody answered. One UPDATE, not one per row. */
  async expireStaleApprovals(): Promise<number> {
    return this.affected(await this.ds.query("CALL sp_expire_stale_approvals()"));
  }

  /** Bounded delete of read notifications past retention. */
  async pruneReadNotifications(cutoff: Date, limit: number): Promise<number> {
    return this.affected(
      await this.ds.query("CALL sp_prune_read_notifications(?, ?)", [cutoff, Math.min(limit, 20_000)]),
    );
  }

  /** Marks specific notifications read, scoped to their owner. */
  async markNotificationsRead(userId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.affected(
      await this.ds.query("CALL sp_mark_notifications_read(?, ?)", [userId, JSON.stringify(ids)]),
    );
  }

  /** Marks a member's whole inbox read. Was up to 5 000 single-row updates. */
  async markAllNotificationsRead(userId: string): Promise<number> {
    return this.affected(await this.ds.query("CALL sp_mark_all_notifications_read(?)", [userId]));
  }

  /**
   * Raises risk scores from a detection sweep.
   *
   * GREATEST, never assignment: a sweep may only raise a score. Lowering one is
   * a compliance decision a human makes, and a cron that overwrote a manually
   * raised score would quietly close an investigation.
   */
  async bumpRiskScores(userIds: string[], score: number): Promise<number> {
    if (userIds.length === 0) return 0;
    return this.affected(
      await this.ds.query("CALL sp_bump_risk_scores(?, ?)", [JSON.stringify(userIds), score]),
    );
  }

  /**
   * Expires marketplace listings past their TTL and unlocks the items.
   *
   * Both halves in one transaction, because doing them separately is how an item
   * ends up locked to a listing that no longer exists — unsellable, with nothing
   * to tell the member why.
   */
  async expireStaleListings(cutoff: Date): Promise<number> {
    return this.affected(await this.ds.query("CALL sp_expire_stale_listings(?)", [cutoff]));
  }

  /** Clears the processed marker on a block range so the dispatcher replays it. */
  async resetChainEventsForReplay(fromBlock: number, toBlock: number): Promise<number> {
    return this.affected(
      await this.ds.query("CALL sp_reset_chain_events_for_replay(?, ?)", [fromBlock, toBlock]),
    );
  }

  /**
   * Marks a contract's events above a block as orphaned, after a reorg.
   *
   * Reports how many of them had ALREADY been applied to balances — the number
   * an operator actually needs, and one that cannot be recovered after the write.
   */
  async markChainEventsOrphaned(
    contract: string,
    fromBlock: number,
  ): Promise<{ orphaned: number; processedBeforeRewind: number }> {
    const result = await this.ds.query<CallResult<{ affected: string; processedBeforeRewind: string }>>(
      "CALL sp_mark_chain_events_orphaned(?, ?)",
      [contract, fromBlock],
    );
    const row = result[0]?.[0];
    return {
      orphaned: Number(row?.affected ?? 0),
      processedBeforeRewind: Number(row?.processedBeforeRewind ?? 0),
    };
  }

  /* ==================================================================== *
   * Health
   * ==================================================================== */

  /**
   * Whether the database objects this service depends on are actually present.
   *
   * Called by the readiness probe. Without it, a database that was migrated
   * without the last migration looks healthy right up to the first cron tick,
   * and then fails in a worker log nobody is watching.
   */
  async schemaObjects(): Promise<{ views: number; routines: number; triggers: number; healthy: boolean }> {
    const [views, routines, triggers] = await Promise.all([
      this.count("SELECT COUNT(*) AS n FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE()"),
      this.count("SELECT COUNT(*) AS n FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()"),
      this.count("SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()"),
    ]);

    const healthy = views >= EXPECTED_OBJECTS.views
      && routines >= EXPECTED_OBJECTS.routines
      && triggers >= EXPECTED_OBJECTS.triggers;

    if (!healthy) {
      this.log.error(
        `schema objects missing: views ${views}/${EXPECTED_OBJECTS.views}, ` +
        `routines ${routines}/${EXPECTED_OBJECTS.routines}, ` +
        `triggers ${triggers}/${EXPECTED_OBJECTS.triggers} — run the migrations`,
      );
    }

    return { views, routines, triggers, healthy };
  }

  /* ------------------------------------------------------------------ */

  /** Unwraps `[rows, okPacket]` and reads the `affected` column as a number. */
  private affected(result: unknown): number {
    const rows = Array.isArray(result) ? (result as CallResult<{ affected?: string | number }>)[0] : null;
    const value = Array.isArray(rows) ? rows[0]?.affected : undefined;
    return Number(value ?? 0);
  }

  private async count(sql: string): Promise<number> {
    const rows = await this.ds.query<{ n: number | string }[]>(sql);
    return Number(rows[0]?.n ?? 0);
  }
}

/**
 * What the migration creates. Asserted by the readiness probe and by a test, so
 * a dropped view or a half-run migration is caught rather than discovered.
 */
export const EXPECTED_OBJECTS = { views: 8, routines: 11, triggers: 14 } as const;
