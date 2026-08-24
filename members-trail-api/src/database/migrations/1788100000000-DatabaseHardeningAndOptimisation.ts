import type { MigrationInterface, QueryRunner } from "typeorm";

/* ============================================================================
 * Database hardening and optimisation.
 *
 * Four things, in this order, because each depends on the one before:
 *
 *  1. INDEXES for the queries this platform actually runs. Several sweeps were
 *     full-scanning tables they filter by time — `withdrawals` had no index with
 *     `createdAt` leading, so every AML cron read the whole table.
 *
 *  2. FOREIGN KEYS. The schema shipped with eight of them across sixty tables:
 *     the money tables were related by convention only. The delete rule on each
 *     is chosen from what the row MEANS — RESTRICT for financial and compliance
 *     records, CASCADE for rows that are meaningless without their parent.
 *     One correction: `points_ledger.userId` was CASCADE, which would have
 *     destroyed an immutable financial ledger on a member delete while leaving
 *     their `transactions` (RESTRICT) behind.
 *
 *  3. VIEWS. Read-only aggregation, replacing the four-to-thirteen sequential
 *     scans that the solvency check, the treasury rollup and the operator
 *     dashboard each performed per call. No view decides policy.
 *
 *  4. ROUTINES and GUARD TRIGGERS. The procedures replace JavaScript loops that
 *     issued one statement per row (a leaderboard snapshot was up to 500 writes
 *     per metric, per period). The triggers only ever REFUSE — they make the
 *     ledger append-only and balances non-negative for every client, not just
 *     for code paths that remember to check.
 *
 * Deliberately absent: money math in SQL. No procedure computes a commission, a
 * cap or a conversion, and no trigger writes a balance. Those rules have one
 * home, in TypeScript, where they are tested; a second implementation here would
 * be a second answer, and the two would diverge the first time a rule changed.
 * ========================================================================== */

export class DatabaseHardeningAndOptimisation1788100000000 implements MigrationInterface {
  name = "DatabaseHardeningAndOptimisation1788100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /* ------------------------------- indexes ------------------------------ */
    for (const sql of DatabaseHardeningAndOptimisation1788100000000.INDEXES) {
      await queryRunner.query(sql);
    }

    /* ------------------------------ foreign keys -------------------------- */
    /* The generated name of the existing points_ledger constraint is a schema
     * hash, so it is looked up rather than assumed — the same migration has to
     * run against databases created by different TypeORM versions. */
    const existing = await queryRunner.query(
      `SELECT CONSTRAINT_NAME AS name
         FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'points_ledger'`,
    ) as { name: string }[];
    for (const row of existing) {
      await queryRunner.query(`ALTER TABLE points_ledger DROP FOREIGN KEY \`${row.name}\``);
    }

    for (const sql of DatabaseHardeningAndOptimisation1788100000000.FOREIGN_KEYS) {
      await queryRunner.query(sql);
    }

    /* -------------------------------- views ------------------------------- */
    for (const sql of DatabaseHardeningAndOptimisation1788100000000.VIEWS) {
      await queryRunner.query(sql);
    }

    /* ------------------------- routines and triggers ---------------------- */
    for (const sql of DatabaseHardeningAndOptimisation1788100000000.ROUTINES) {
      await queryRunner.query(sql);
    }
    for (const sql of DatabaseHardeningAndOptimisation1788100000000.TRIGGERS) {
      await queryRunner.query(sql);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /* Reverse order: triggers and routines first (nothing depends on them),
     * then views, then the constraints, then the indexes those constraints
     * were using. */
    for (const name of TRIGGER_NAMES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS \`${name}\``);
    }
    for (const [kind, name] of ROUTINE_NAMES) {
      await queryRunner.query(`DROP ${kind} IF EXISTS \`${name}\``);
    }
    for (const name of VIEW_NAMES) {
      await queryRunner.query(`DROP VIEW IF EXISTS \`${name}\``);
    }
    for (const [table, name] of FOREIGN_KEYS_DOWN) {
      await queryRunner.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${name}\``);
    }

    /* Restores the original CASCADE on points_ledger, so `down` genuinely
     * returns the schema to what it was — including the flaw. A migration that
     * "fixes" something on the way down is not reversible. */
    await queryRunner.query(
      "ALTER TABLE points_ledger ADD CONSTRAINT fk_points_user_legacy " +
      "FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE",
    );

    for (const [name, table] of INDEX_NAMES) {
      await queryRunner.query(`DROP INDEX \`${name}\` ON \`${table}\``);
    }
  }

  /* -------------------------------------------------------------------- *
   * The statements. Kept as data rather than inline so `up` reads as the
   * order of operations and each statement keeps the comment explaining it.
   * -------------------------------------------------------------------- */

  private static readonly INDEXES: string[] = [
    `
      -- ============================================================================
      -- Indexes for the queries this platform actually runs.
      -- Each one names the query it serves; an index nobody's query can use is pure
      -- write-amplification.
      -- ============================================================================

      -- Every AML sweep and every report filters withdrawals by time, and there was no
      -- index with createdAt leading: the fraud crons full-scanned the table on every
      -- tick. idx_wd_user_time leads on userId and cannot serve a global range.
      CREATE INDEX idx_wd_created_status ON withdrawals (createdAt, status)
    `,
    `
      -- Structuring looks for requests that cleared auto-approval by a whisker.
      CREATE INDEX idx_wd_review_created ON withdrawals (reviewRequired, createdAt)
    `,
    `
      -- Solvency and the cap meter: both filter status, one per recipient.
      CREATE INDEX idx_comm_recipient_status ON commissions (recipientId, status)
    `,
    `
      -- Cap-hugging detection groups by recipient WITHIN a month; idx_comm_recipient_month
      -- leads on recipientId and cannot serve a month-wide scan.
      CREATE INDEX idx_comm_month_status ON commissions (monthKey, status)
    `,
    `
      -- The commission report groups by status and level over a date range.
      CREATE INDEX idx_comm_created_status_level ON commissions (createdAt, status, level)
    `,
    `
      -- Bot-farming and device-cluster sweeps, and the referral eligibility check
      -- (validated session count per member).
      CREATE INDEX idx_session_user_status ON game_sessions (userId, status)
    `,
    `
      CREATE INDEX idx_session_status_created ON game_sessions (status, createdAt)
    `,
    `
      CREATE INDEX idx_session_fp_created ON game_sessions (deviceFingerprint, createdAt, userId)
    `,
    `
      -- Treasury rollup reads one period at a time and always pairs the period with
      -- reconciliation state or status. Two single-column indexes force a merge.
      CREATE INDEX idx_inflow_period_reconciled ON treasury_inflows (periodKey, reconciled)
    `,
    `
      CREATE INDEX idx_outflow_period_status_dest ON treasury_outflows (periodKey, status, destination, fromReserve)
    `,
    `
      -- The revenue report and the payout ratio both range-scan occurredAt; the
      -- existing index leads on stream. Trailing member spend adds userId.
      CREATE INDEX idx_revenue_occurred ON revenue_events (occurredAt, stream)
    `,
    `
      CREATE INDEX idx_revenue_reconciled_occurred ON revenue_events (reconciled, occurredAt)
    `,
    `
      CREATE INDEX idx_revenue_user_reconciled ON revenue_events (userId, reconciled, occurredAt)
    `,
    `
      -- Dashboard: active members in the last 30 days was a full user scan.
      CREATE INDEX idx_users_last_active ON users (lastActiveAt)
    `,
    `
      -- Approval expiry and the decidable-by-me list.
      CREATE INDEX idx_approval_status_expires ON approval_requests (status, expiresAt)
    `,
    `
      -- Notification retention prunes on readAt; only createdAt was indexed.
      CREATE INDEX idx_notif_read_readat ON notifications (\`read\`, readAt)
    `,
    `
      -- Quest expiry sweep.
      CREATE INDEX idx_userquest_expires ON user_quests (expiresAt, claimedAt)
    `,
    `
      -- Conversion report: completed rows over a date range.
      CREATE INDEX idx_conv_status_created ON conversions (status, createdAt)
    `,
    `
      -- KYC report.
      CREATE INDEX idx_kyc_created_status ON kyc_submissions (createdAt, status)
    `,
    `
      -- Points report groups by source over a range; idx_points_source has no time.
      CREATE INDEX idx_points_created_source ON points_ledger (createdAt, source)
    `,
    `
      -- The ledger drift audit sums amount per user across the whole table.
      CREATE INDEX idx_points_user_amount ON points_ledger (userId, amount)
    `,
    `
      -- Treasury report ranges on createdAt.
      CREATE INDEX idx_outflow_created ON treasury_outflows (createdAt)
    `,
    `
      -- Marketplace listing expiry.
      CREATE INDEX idx_listing_status_created ON market_listings (status, createdAt)
    `,
    `
      -- Chain replay and rewind both range on block number.
      CREATE INDEX idx_event_block_orphaned ON chain_events (blockNumber, orphaned)
    `,
  ];

  private static readonly FOREIGN_KEYS: string[] = [
    `
      -- ============================================================================
      -- Foreign keys, with the delete rule chosen from what the row MEANS.
      --
      -- The schema shipped with eight foreign keys across sixty tables: the money
      -- tables were related by convention only, so a bad delete or a bad id could
      -- leave a commission pointing at a member who no longer existed, and nothing
      -- would notice until a report divided by it.
      --
      -- Two rules, applied consistently:
      --
      --   RESTRICT  the child is a financial or compliance record. You must not be
      --             able to delete the parent while it exists. This is deliberately
      --             inconvenient: an operator who needs to remove a member with money
      --             history has to deal with the history explicitly.
      --   CASCADE   the child is meaningless without the parent and has no audit
      --             value of its own (a session, a preference, a quest counter).
      --
      -- One correction: points_ledger.userId was CASCADE. The Points ledger is an
      -- immutable financial record — the same class of thing as \`transactions\`, which
      -- was RESTRICT. Deleting a member would have silently destroyed the ledger while
      -- leaving their transactions behind: two financial tables, two different answers.
      --
      -- The existing constraint is dropped in up() by looking its generated name
      -- up in information_schema: the name is a schema hash and differs between
      -- databases, so hard-coding it makes the migration run on exactly one of them.
      -- ============================================================================

      ALTER TABLE points_ledger
        ADD CONSTRAINT fk_points_user FOREIGN KEY (userId) REFERENCES users (id) ON DELETE RESTRICT
    `,
    `
      -- ------------------------- financial: RESTRICT ------------------------------
      ALTER TABLE withdrawals        ADD CONSTRAINT fk_wd_user        FOREIGN KEY (userId)         REFERENCES users (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE deposits           ADD CONSTRAINT fk_dep_user       FOREIGN KEY (userId)         REFERENCES users (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE conversions        ADD CONSTRAINT fk_conv_user      FOREIGN KEY (userId)         REFERENCES users (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE staking_positions  ADD CONSTRAINT fk_pos_user       FOREIGN KEY (userId)         REFERENCES users (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE staking_rewards    ADD CONSTRAINT fk_reward_user    FOREIGN KEY (userId)         REFERENCES users (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE commission_cap_usage ADD CONSTRAINT fk_cap_user     FOREIGN KEY (userId)         REFERENCES users (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE commissions        ADD CONSTRAINT fk_comm_downline  FOREIGN KEY (downlineUserId) REFERENCES users (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE game_sessions      ADD CONSTRAINT fk_session_user   FOREIGN KEY (userId)         REFERENCES users (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE tournament_entries ADD CONSTRAINT fk_entry_user     FOREIGN KEY (userId)         REFERENCES users (id) ON DELETE RESTRICT
    `,
    `
      -- Compliance records: which addresses were paid, who was verified, who read a
      -- passport scan. All of it has to outlive routine account maintenance.
      ALTER TABLE wallet_addresses   ADD CONSTRAINT fk_wallet_user    FOREIGN KEY (userId)         REFERENCES users (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE kyc_submissions    ADD CONSTRAINT fk_kyc_user       FOREIGN KEY (userId)         REFERENCES users (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE audit_logs         ADD CONSTRAINT fk_audit_actor    FOREIGN KEY (actorId)        REFERENCES users (id) ON DELETE RESTRICT
    `,
    `
      -- ----------------------- owned satellites: CASCADE --------------------------
      ALTER TABLE user_quests        ADD CONSTRAINT fk_userquest_user FOREIGN KEY (userId)  REFERENCES users (id) ON DELETE CASCADE
    `,
    `
      ALTER TABLE user_achievements  ADD CONSTRAINT fk_userach_user   FOREIGN KEY (userId)  REFERENCES users (id) ON DELETE CASCADE
    `,
    `
      ALTER TABLE user_inventory     ADD CONSTRAINT fk_inv_user       FOREIGN KEY (userId)  REFERENCES users (id) ON DELETE CASCADE
    `,
    `
      ALTER TABLE notifications      ADD CONSTRAINT fk_notif_user     FOREIGN KEY (userId)  REFERENCES users (id) ON DELETE CASCADE
    `,
    `
      ALTER TABLE notification_deliveries ADD CONSTRAINT fk_delivery_user FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
    `,
    `
      ALTER TABLE login_history      ADD CONSTRAINT fk_login_user     FOREIGN KEY (userId)  REFERENCES users (id) ON DELETE CASCADE
    `,
    `
      ALTER TABLE verification_tokens ADD CONSTRAINT fk_verif_user    FOREIGN KEY (userId)  REFERENCES users (id) ON DELETE CASCADE
    `,
    `
      ALTER TABLE leaderboard_snapshots ADD CONSTRAINT fk_lb_user     FOREIGN KEY (userId)  REFERENCES users (id) ON DELETE CASCADE
    `,
    `
      ALTER TABLE idempotency_keys   ADD CONSTRAINT fk_idem_user      FOREIGN KEY (userId)  REFERENCES users (id) ON DELETE CASCADE
    `,
    `
      ALTER TABLE tickets            ADD CONSTRAINT fk_ticket_user    FOREIGN KEY (userId)  REFERENCES users (id) ON DELETE CASCADE
    `,
    `
      -- The downline edge disappears with the member; the UPLINE side does not. An
      -- ancestor is load-bearing for other people's commission, so removing one has to
      -- be refused rather than quietly rewriting the tree.
      ALTER TABLE referral_edges     ADD CONSTRAINT fk_edge_user      FOREIGN KEY (userId)     REFERENCES users (id) ON DELETE CASCADE
    `,
    `
      ALTER TABLE referral_edges     ADD CONSTRAINT fk_edge_ancestor  FOREIGN KEY (ancestorId) REFERENCES users (id) ON DELETE RESTRICT
    `,
    `
      -- --------------------- within-domain parent/child ---------------------------
      ALTER TABLE ticket_messages    ADD CONSTRAINT fk_msg_ticket     FOREIGN KEY (ticketId)       REFERENCES tickets (id) ON DELETE CASCADE
    `,
    `
      ALTER TABLE kyc_documents      ADD CONSTRAINT fk_kycdoc_sub     FOREIGN KEY (submissionId)   REFERENCES kyc_submissions (id) ON DELETE CASCADE
    `,
    `
      ALTER TABLE notification_deliveries ADD CONSTRAINT fk_delivery_notif FOREIGN KEY (notificationId) REFERENCES notifications (id) ON DELETE CASCADE
    `,
    `
      ALTER TABLE user_quests        ADD CONSTRAINT fk_userquest_quest FOREIGN KEY (questId)       REFERENCES quests (id) ON DELETE CASCADE
    `,
    `
      ALTER TABLE user_achievements  ADD CONSTRAINT fk_userach_ach    FOREIGN KEY (achievementId)  REFERENCES achievements (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE user_inventory     ADD CONSTRAINT fk_inv_item       FOREIGN KEY (itemId)         REFERENCES store_items (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE market_listings    ADD CONSTRAINT fk_listing_seller FOREIGN KEY (sellerId)       REFERENCES users (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE market_listings    ADD CONSTRAINT fk_listing_item   FOREIGN KEY (itemId)         REFERENCES store_items (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE market_listings    ADD CONSTRAINT fk_listing_inv    FOREIGN KEY (inventoryItemId) REFERENCES user_inventory (id) ON DELETE CASCADE
    `,
    `
      ALTER TABLE game_sessions      ADD CONSTRAINT fk_session_game   FOREIGN KEY (gameId)         REFERENCES games (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE tournaments        ADD CONSTRAINT fk_tournament_game FOREIGN KEY (gameId)        REFERENCES games (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE tournament_entries ADD CONSTRAINT fk_entry_tournament FOREIGN KEY (tournamentId) REFERENCES tournaments (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE quests             ADD CONSTRAINT fk_quest_game     FOREIGN KEY (gameId)         REFERENCES games (id) ON DELETE SET NULL
    `,
    `
      ALTER TABLE points_rules       ADD CONSTRAINT fk_rule_game      FOREIGN KEY (gameId)         REFERENCES games (id) ON DELETE SET NULL
    `,
    `
      ALTER TABLE commissions        ADD CONSTRAINT fk_comm_revenue   FOREIGN KEY (revenueEventId) REFERENCES revenue_events (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE treasury_inflows   ADD CONSTRAINT fk_inflow_revenue FOREIGN KEY (revenueEventId) REFERENCES revenue_events (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE conversions        ADD CONSTRAINT fk_conv_tx        FOREIGN KEY (transactionId)  REFERENCES transactions (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE withdrawals        ADD CONSTRAINT fk_wd_tx          FOREIGN KEY (transactionId)  REFERENCES transactions (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE commissions        ADD CONSTRAINT fk_comm_outflow   FOREIGN KEY (treasuryOutflowId) REFERENCES treasury_outflows (id) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE staking_positions  ADD CONSTRAINT fk_pos_pool       FOREIGN KEY (poolId)         REFERENCES staking_pools (poolId) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE staking_rewards    ADD CONSTRAINT fk_reward_pool    FOREIGN KEY (poolId)         REFERENCES staking_pools (poolId) ON DELETE RESTRICT
    `,
    `
      ALTER TABLE staking_apr_history ADD CONSTRAINT fk_apr_pool      FOREIGN KEY (poolId)         REFERENCES staking_pools (poolId) ON DELETE RESTRICT
    `,
  ];

  private static readonly VIEWS: string[] = [
    `
      -- ============================================================================
      -- Views.
      --
      -- Every view here is READ-ONLY AGGREGATION over rows the services already own.
      -- None of them decides policy: no cap is applied, no rate is chosen, no amount
      -- is derived from a plan. That line matters — a view that computed a payable
      -- amount would be a second answer to a question the service already answers,
      -- and the two would drift the first time a rule changed.
      --
      -- SQL SECURITY INVOKER on all of them: privileges follow the caller, so a view
      -- can never hand a low-privilege connection data it could not read directly, and
      -- nothing breaks if the account that created it is dropped.
      -- ============================================================================

      -- The solvency invariant, in one row.
      --
      -- Replaces four sequential aggregate scans in CommissionService.fundingAvailable
      -- — which is called once per commission row during a three-level fan-out, so a
      -- single revenue event was costing a dozen table scans.
      --
      -- \`funded\` counts CONFIRMED commission-pool outflows only: an approved but
      -- unsubmitted transfer is not money in the pool, and counting it is how a pool
      -- goes overdrawn. Queued and pending-KYC commission are liabilities, not
      -- commitments, and are reported separately so the gap stays visible.
      CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_commission_solvency AS
      SELECT
        (SELECT COALESCE(SUM(o.amount), 0) FROM treasury_outflows o
          WHERE o.destination = 'commission_pool' AND o.status = 'confirmed')            AS poolFundedMtt,
        (SELECT COALESCE(SUM(c.amountMtt), 0) FROM commissions c
          WHERE c.status IN ('released', 'claimed'))                                     AS committedMtt,
        (SELECT COALESCE(SUM(c.amountMtt), 0) FROM commissions c
          WHERE c.status = 'queued')                                                     AS queuedMtt,
        (SELECT COALESCE(SUM(c.amountMtt), 0) FROM commissions c
          WHERE c.status = 'pending_kyc')                                                AS pendingKycMtt
    `,
    `
      -- Treasury aggregates per period.
      --
      -- Replaces six separate scans per rollup. The rollup itself — writing the
      -- treasury_periods row and deciding the payout-ratio threshold — stays in the
      -- service, because that is policy.
      CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_treasury_period AS
      SELECT
        p.periodKey,
        COALESCE(i.reconciledInflow, 0)     AS reconciledInflow,
        COALESCE(i.unreconciledInflow, 0)   AS unreconciledInflow,
        COALESCE(i.grossRevenue, 0)         AS grossRevenue,
        COALESCE(o.commissionPoolOut, 0)    AS commissionPoolOut,
        COALESCE(o.stakingPoolOut, 0)       AS stakingPoolOut,
        COALESCE(o.reserveOut, 0)           AS reserveOut,
        COALESCE(i.inflowCount, 0)          AS inflowCount,
        COALESCE(o.outflowCount, 0)         AS outflowCount
      FROM (
        SELECT periodKey FROM treasury_inflows
        UNION
        SELECT periodKey FROM treasury_outflows
        UNION
        SELECT periodKey FROM treasury_periods
      ) p
      LEFT JOIN (
        SELECT periodKey,
               SUM(CASE WHEN reconciled = 1 THEN amountMtt ELSE 0 END) AS reconciledInflow,
               SUM(CASE WHEN reconciled = 0 THEN amountMtt ELSE 0 END) AS unreconciledInflow,
               SUM(grossRevenue)                                      AS grossRevenue,
               COUNT(*)                                               AS inflowCount
        FROM treasury_inflows GROUP BY periodKey
      ) i ON i.periodKey = p.periodKey
      LEFT JOIN (
        SELECT periodKey,
               /* Only landed money counts as having left the Treasury. */
               SUM(CASE WHEN destination = 'commission_pool' AND status = 'confirmed' THEN amount ELSE 0 END) AS commissionPoolOut,
               SUM(CASE WHEN destination = 'staking_pool'    AND status = 'confirmed' THEN amount ELSE 0 END) AS stakingPoolOut,
               SUM(CASE WHEN fromReserve = 1                AND status = 'confirmed' THEN amount ELSE 0 END) AS reserveOut,
               COUNT(*)                                                                                      AS outflowCount
        FROM treasury_outflows GROUP BY periodKey
      ) o ON o.periodKey = p.periodKey
    `,
    `
      -- The payout ratio components, computed ONCE.
      --
      -- Reports and the Treasury service each derived a "payout ratio" independently,
      -- from different inputs — and they are not the same question:
      --
      --   commission ratio : released commission / reconciled NET REVENUE
      --                      "how much of what members spent went back out as commission"
      --   outflow ratio    : confirmed pool transfers / reconciled TREASURY INFLOW
      --                      "how much of the Treasury's share left the Treasury"
      --
      -- Both are legitimate, and they must not be added together: commission is PAID
      -- FROM the commission-pool transfer, so summing them counts the same money
      -- twice. So this view publishes the components and both ratios separately, and
      -- the two callers read the one they mean. What it removes is the duplication —
      -- there is now one definition of each number, not two implementations that
      -- drifted.
      CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_payout_ratio AS
      SELECT
        k.periodKey,
        COALESCE(r.reconciledNetRevenue, 0)  AS reconciledNetRevenue,
        COALESCE(c.releasedCommission, 0)    AS releasedCommission,
        COALESCE(o.confirmedOutflow, 0)      AS confirmedOutflow,
        COALESCE(i.reconciledInflow, 0)      AS reconciledTreasuryInflow,
        /* NULL, never 0, when the denominator is zero: "no revenue and no payouts" is
         * an undefined ratio, and reporting 0% for it reads as healthy. */
        CASE WHEN COALESCE(r.reconciledNetRevenue, 0) = 0 THEN NULL
             ELSE FLOOR(COALESCE(c.releasedCommission, 0) / r.reconciledNetRevenue * 10000)
        END AS commissionRatioBps,
        CASE WHEN COALESCE(i.reconciledInflow, 0) = 0 THEN NULL
             ELSE FLOOR(COALESCE(o.confirmedOutflow, 0) / i.reconciledInflow * 10000)
        END AS outflowRatioBps
      FROM (
        SELECT DATE_FORMAT(occurredAt, '%Y-%m') AS periodKey FROM revenue_events
        UNION SELECT monthKey  FROM commissions
        UNION SELECT periodKey FROM treasury_outflows
        UNION SELECT periodKey FROM treasury_inflows
      ) k
      LEFT JOIN (
        SELECT DATE_FORMAT(occurredAt, '%Y-%m') AS periodKey, SUM(netAmount) AS reconciledNetRevenue
        FROM revenue_events
        WHERE reconciled = 1 AND reversedAt IS NULL
        GROUP BY DATE_FORMAT(occurredAt, '%Y-%m')
      ) r ON r.periodKey = k.periodKey
      LEFT JOIN (
        SELECT monthKey AS periodKey, SUM(amount) AS releasedCommission
        FROM commissions WHERE status IN ('released', 'claimed')
        GROUP BY monthKey
      ) c ON c.periodKey = k.periodKey
      LEFT JOIN (
        SELECT periodKey, SUM(amount) AS confirmedOutflow
        FROM treasury_outflows WHERE status = 'confirmed'
        GROUP BY periodKey
      ) o ON o.periodKey = k.periodKey
      LEFT JOIN (
        SELECT periodKey, SUM(amountMtt) AS reconciledInflow
        FROM treasury_inflows WHERE reconciled = 1
        GROUP BY periodKey
      ) i ON i.periodKey = k.periodKey
    `,
    `
      -- Points ledger drift.
      --
      -- A balance is a cached projection of an immutable ledger; if they disagree,
      -- something wrote a balance outside LedgerService. There was no set-based way to
      -- check it, so the nightly audit skipped the walk entirely and the check never
      -- ran for anybody. This view makes it one query — and returns ONLY the rows that
      -- disagree, so an empty result is the healthy answer.
      CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_points_drift AS
      SELECT
        b.userId,
        b.points                       AS balancePoints,
        COALESCE(l.ledgerSum, 0)       AS ledgerPoints,
        b.points - COALESCE(l.ledgerSum, 0) AS drift
      FROM user_balances b
      LEFT JOIN (SELECT userId, SUM(amount) AS ledgerSum FROM points_ledger GROUP BY userId) l
        ON l.userId = b.userId
      WHERE b.points <> COALESCE(l.ledgerSum, 0)
    `,
    `
      -- What the platform owes its members in MTT, by bucket.
      --
      -- The counterpart to an on-chain treasury balance: custodial MTT is a liability,
      -- and reconciling it against what the wallet actually holds is the check that
      -- catches a crediting bug before a withdrawal does.
      CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_mtt_liability AS
      SELECT
        COUNT(*)                              AS accounts,
        COALESCE(SUM(mttAvailable), 0)         AS availableMtt,
        COALESCE(SUM(mttStaked), 0)            AS stakedMtt,
        COALESCE(SUM(mttPendingRewards), 0)    AS pendingRewardsMtt,
        COALESCE(SUM(mttLockedForWithdrawal), 0) AS lockedForWithdrawalMtt,
        COALESCE(SUM(commissionAvailable), 0)  AS commissionAvailableMtt,
        COALESCE(SUM(commissionPending), 0)    AS commissionPendingMtt,
        COALESCE(SUM(mttAvailable + mttStaked + mttPendingRewards + mttLockedForWithdrawal
                   + commissionAvailable + commissionPending), 0) AS totalLiabilityMtt,
        COALESCE(SUM(points), 0)               AS totalPoints
      FROM user_balances
    `,
    `
      -- The operator dashboard, in one row instead of thirteen round trips.
      CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_admin_kpis AS
      SELECT
        (SELECT COUNT(*) FROM users WHERE status <> 'closed')                                   AS members,
        (SELECT COUNT(*) FROM users WHERE lastActiveAt >= (NOW() - INTERVAL 30 DAY))            AS activeMembers30d,
        (SELECT COUNT(*) FROM users WHERE kycTier IN (1, 2))                                    AS kycVerified,
        (SELECT COUNT(*) FROM users WHERE status = 'frozen')                                    AS frozenAccounts,
        (SELECT COUNT(*) FROM withdrawals WHERE status = 'review')                              AS withdrawalsInReview,
        (SELECT COUNT(*) FROM fraud_alerts WHERE status IN ('open', 'investigating'))            AS openFraudAlerts,
        (SELECT COUNT(*) FROM approval_requests WHERE status = 'pending')                       AS pendingApprovals,
        (SELECT COUNT(*) FROM tickets
           WHERE firstResponseAt IS NULL AND slaDueAt < NOW()
             AND status NOT IN ('resolved', 'closed'))                                          AS breachedTickets,
        (SELECT COALESCE(SUM(amountMtt), 0) FROM commissions WHERE status = 'queued')            AS queuedCommissionMtt
    `,
    `
      -- Monthly cohorts, for the two reports whose GROUP BY key is a derived month.
      CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_member_signup_cohort AS
      SELECT DATE_FORMAT(createdAt, '%Y-%m') AS periodKey,
             COUNT(*)                                                    AS signups,
             SUM(CASE WHEN kycTier > 0 THEN 1 ELSE 0 END)                AS verified,
             SUM(CASE WHEN referredById IS NOT NULL THEN 1 ELSE 0 END)   AS referred,
             SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END)          AS closed
      FROM users
      GROUP BY DATE_FORMAT(createdAt, '%Y-%m')
    `,
    `
      CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_conversion_monthly AS
      SELECT DATE_FORMAT(createdAt, '%Y-%m') AS periodKey,
             rateApplied,
             COUNT(*)                        AS conversions,
             COALESCE(SUM(pointsSpent), 0)   AS pointsSpent,
             COALESCE(SUM(mttCredited), 0)   AS mttCredited
      FROM conversions
      WHERE status = 'completed'
      GROUP BY DATE_FORMAT(createdAt, '%Y-%m'), rateApplied
    `,
  ];

  private static readonly ROUTINES: string[] = [
    `
      -- ============================================================================
      -- Routines.
      --
      -- What is here: SET-BASED WORK. Each procedure replaces a JavaScript loop that
      -- issued one statement per row — a leaderboard snapshot was up to 500 single-row
      -- writes per metric, and the cron ran it for four metrics across three periods.
      --
      -- What is deliberately NOT here: MONEY MATH. There is no procedure that decides
      -- a commission, applies a cap, or converts Points to MTT. Those rules live in
      -- one place, in TypeScript, where they are unit-tested and audited; a second
      -- implementation in SQL would be a second answer, and the two would diverge the
      -- first time a rule changed. The one function below is a calendar helper with no
      -- policy in it.
      --
      -- Every routine is SQL SECURITY INVOKER: it runs with the caller's privileges,
      -- never the creator's.
      --
      -- Every procedure RETURNS A RESULT SET rather than using OUT parameters. Reading
      -- an OUT parameter takes two statements (\`CALL\`, then \`SELECT @out\`), and with a
      -- connection pool those two can land on different connections — the session
      -- variable is gone and the caller silently reads NULL. A result set comes back
      -- from the CALL itself, on the connection that ran it.
      -- ============================================================================

      -- The UTC month key, so SQL objects and the application agree on what "period"
      -- means. \`periodKey\` is UTC everywhere in this platform: a local-time month
      -- boundary would let a member convert twice against one monthly cap.
      CREATE FUNCTION fn_month_key(p_at DATETIME(6))
      RETURNS CHAR(7)
      DETERMINISTIC
      SQL SECURITY INVOKER
      BEGIN
        RETURN DATE_FORMAT(CONVERT_TZ(p_at, @@session.time_zone, '+00:00'), '%Y-%m');
      END
    `,
    `
      -- ---------------------------------------------------------------------------
      -- Leaderboard snapshot: one statement instead of up to 500.
      --
      -- Takes the whole board as a JSON array [{userId, score, rank}]. The unique key
      -- (metric, periodKey, userId) turns the insert into an upsert, so re-running a
      -- snapshot for the same period corrects it rather than duplicating it.
      -- ---------------------------------------------------------------------------
      CREATE PROCEDURE sp_leaderboard_snapshot_upsert(
        IN  p_metric     VARCHAR(32),
        IN  p_period_key VARCHAR(16),
        IN  p_rows       JSON
      )
      MODIFIES SQL DATA
      SQL SECURITY INVOKER
      BEGIN
        INSERT INTO leaderboard_snapshots (id, createdAt, updatedAt, metric, periodKey, userId, score, \`rank\`)
        SELECT UUID(), NOW(6), NOW(6), p_metric, p_period_key, j.userId, j.score, j.rank
        FROM JSON_TABLE(
          p_rows, '$[*]' COLUMNS (
            userId VARCHAR(255) PATH '$.userId',
            score  BIGINT       PATH '$.score',
            \`rank\` INT          PATH '$.rank'
          )
        ) AS j
        ON DUPLICATE KEY UPDATE
          score     = VALUES(score),
          \`rank\`    = VALUES(\`rank\`),
          updatedAt = NOW(6);

        /* Rows SUBMITTED, not ROW_COUNT(): MySQL counts an ON DUPLICATE KEY update as
         * two rows affected, so ROW_COUNT() here reads as double the board size and
         * makes the cron log nonsense. */
        SELECT JSON_LENGTH(p_rows) AS affected;
      END
    `,
    `
      -- ---------------------------------------------------------------------------
      -- Quest progress: a conditional upsert, race-free.
      --
      -- The service read the row, added in JavaScript, clamped to the target and wrote
      -- it back — three statements and a lost-update window between them. Two
      -- concurrent sessions could both read 2, both write 3, and the member would lose
      -- a step. LEAST() in the UPDATE makes the clamp part of the same statement.
      --
      -- It reports whether THIS call completed the quest, so the caller knows whether
      -- to publish an event, without a second read.
      -- ---------------------------------------------------------------------------
      CREATE PROCEDURE sp_quest_progress(
        IN  p_user_id    VARCHAR(255),
        IN  p_quest_id   VARCHAR(255),
        IN  p_period_key VARCHAR(16),
        IN  p_amount     INT,
        IN  p_target     INT,
        IN  p_expires_at DATETIME(6)
      )
      MODIFIES SQL DATA
      SQL SECURITY INVOKER
      BEGIN
        DECLARE v_was_complete TINYINT DEFAULT 0;

        SELECT CASE WHEN completedAt IS NULL THEN 0 ELSE 1 END INTO v_was_complete
        FROM user_quests
        WHERE userId = p_user_id AND questId = p_quest_id AND periodKey = p_period_key;

        INSERT INTO user_quests
          (id, createdAt, updatedAt, userId, questId, periodKey, progress, pointsAwarded, expiresAt, completedAt)
        VALUES
          (UUID(), NOW(6), NOW(6), p_user_id, p_quest_id, p_period_key,
           LEAST(p_amount, p_target), 0, p_expires_at,
           CASE WHEN LEAST(p_amount, p_target) >= p_target THEN NOW(6) ELSE NULL END)
        ON DUPLICATE KEY UPDATE
          progress    = LEAST(p_target, progress + p_amount),
          /* Already-completed instances keep their original timestamp: a quest is
           * completed once, and further play must not re-stamp it. */
          completedAt = CASE
                          WHEN completedAt IS NOT NULL THEN completedAt
                          WHEN LEAST(p_target, progress + p_amount) >= p_target THEN NOW(6)
                          ELSE NULL
                        END,
          updatedAt   = NOW(6);

        /* \`completed\` means COMPLETED BY THIS CALL, not "is complete" — the caller
         * publishes an event on the transition, and a quest that was already finished
         * must not fire it again on every later signal. */
        SELECT
          progress                                                                   AS progress,
          CASE WHEN completedAt IS NOT NULL AND v_was_complete = 0 THEN 1 ELSE 0 END  AS completed,
          CASE WHEN completedAt IS NULL THEN 0 ELSE 1 END                            AS isComplete
        FROM user_quests
        WHERE userId = p_user_id AND questId = p_quest_id AND periodKey = p_period_key;
      END
    `,
    `
      -- ---------------------------------------------------------------------------
      -- Dual-control requests that nobody answered.
      --
      -- 72 hours is the window; an expired request must be re-raised, not silently
      -- approved late. One UPDATE replaces up to a thousand.
      -- ---------------------------------------------------------------------------
      CREATE PROCEDURE sp_expire_stale_approvals()
      MODIFIES SQL DATA
      SQL SECURITY INVOKER
      BEGIN
        UPDATE approval_requests
           SET status = 'expired', decisionNote = 'Expired unanswered', updatedAt = NOW(6)
         WHERE status = 'pending' AND expiresAt <= NOW(6);
        SELECT ROW_COUNT() AS affected;
      END
    `,
    `
      -- ---------------------------------------------------------------------------
      -- Notification retention. Bounded DELETE rather than loading rows to remove them.
      -- ---------------------------------------------------------------------------
      CREATE PROCEDURE sp_prune_read_notifications(
        IN  p_cutoff   DATETIME(6),
        IN  p_limit    INT
      )
      MODIFIES SQL DATA
      SQL SECURITY INVOKER
      BEGIN
        DELETE FROM notifications
         WHERE \`read\` = 1 AND readAt IS NOT NULL AND readAt < p_cutoff
         ORDER BY readAt ASC
         LIMIT p_limit;
        SELECT ROW_COUNT() AS affected;
      END
    `,
    `
      CREATE PROCEDURE sp_mark_notifications_read(
        IN  p_user_id  VARCHAR(255),
        IN  p_ids      JSON
      )
      MODIFIES SQL DATA
      SQL SECURITY INVOKER
      BEGIN
        DECLARE v_i INT DEFAULT 0;
        DECLARE v_id VARCHAR(36);
        DECLARE v_total INT DEFAULT 0;

        /* A loop over the ids rather than a JOIN against JSON_TABLE.
         *
         * JSON_TABLE gives its columns the SERVER's default character set, not the
         * table's — so joining one against an id column raises "illegal mix of
         * collations" on any server whose default differs from the schema's. That
         * depends on how the server was installed, which means the JOIN form works on
         * one machine and fails on the next. A routine variable takes the routine's own
         * character set and compares cleanly with either.
         *
         * Each iteration is a single-row indexed UPDATE, and the whole loop is still
         * ONE round trip from the application — which is the round trip that mattered. */
        WHILE v_i < JSON_LENGTH(p_ids) DO
          SET v_id = JSON_UNQUOTE(JSON_EXTRACT(p_ids, CONCAT('$[', v_i, ']')));

          UPDATE notifications
             SET \`read\` = 1, readAt = NOW(6), updatedAt = NOW(6)
           /* Scoped to the owner: an id from another member's inbox must not match. */
           WHERE id = v_id AND userId = p_user_id AND \`read\` = 0;

          SET v_total = v_total + ROW_COUNT();
          SET v_i = v_i + 1;
        END WHILE;

        SELECT v_total AS affected;
      END
    `,
    `
      CREATE PROCEDURE sp_mark_all_notifications_read(IN  p_user_id  VARCHAR(255))
      MODIFIES SQL DATA
      SQL SECURITY INVOKER
      BEGIN
        UPDATE notifications
           SET \`read\` = 1, readAt = NOW(6), updatedAt = NOW(6)
         WHERE userId = p_user_id AND \`read\` = 0;
        SELECT ROW_COUNT() AS affected;
      END
    `,
    `
      -- ---------------------------------------------------------------------------
      -- Risk scores from a detection sweep.
      --
      -- GREATEST, never assignment: a sweep may only raise a score. Lowering one is a
      -- compliance decision a human makes, and letting a cron overwrite a manually
      -- raised score would quietly clear an investigation.
      -- ---------------------------------------------------------------------------
      CREATE PROCEDURE sp_bump_risk_scores(
        IN  p_user_ids JSON,
        IN  p_score    INT
      )
      MODIFIES SQL DATA
      SQL SECURITY INVOKER
      BEGIN
        DECLARE v_i INT DEFAULT 0;
        DECLARE v_id VARCHAR(36);
        DECLARE v_total INT DEFAULT 0;

        /* Looped for the same reason as sp_mark_notifications_read: a JSON_TABLE join
         * against an id column depends on the server's default character set matching
         * the schema's. Each iteration is one indexed UPDATE on the primary key. */
        WHILE v_i < JSON_LENGTH(p_user_ids) DO
          SET v_id = JSON_UNQUOTE(JSON_EXTRACT(p_user_ids, CONCAT('$[', v_i, ']')));

          UPDATE users
             SET riskScore = LEAST(100, GREATEST(riskScore, p_score)), updatedAt = NOW(6)
           WHERE id = v_id AND riskScore < p_score;

          SET v_total = v_total + ROW_COUNT();
          SET v_i = v_i + 1;
        END WHILE;

        SELECT v_total AS affected;
      END
    `,
    `
      -- ---------------------------------------------------------------------------
      -- Marketplace listings past their TTL.
      --
      -- Two statements in one transaction: the listing expires AND the item is
      -- unlocked back to its owner. Doing these separately is how an item ends up
      -- locked to a listing that no longer exists — unsellable, with no way for the
      -- member to tell why.
      -- ---------------------------------------------------------------------------
      CREATE PROCEDURE sp_expire_stale_listings(IN p_cutoff DATETIME(6))
      MODIFIES SQL DATA
      SQL SECURITY INVOKER
      BEGIN
        START TRANSACTION;

        UPDATE user_inventory inv
           JOIN market_listings l ON l.inventoryItemId = inv.id
           SET inv.lockedByListingId = NULL, inv.updatedAt = NOW(6)
         WHERE l.status = 'active' AND l.createdAt < p_cutoff
           AND inv.lockedByListingId = l.id;

        UPDATE market_listings
           SET status = 'expired', updatedAt = NOW(6)
         WHERE status = 'active' AND createdAt < p_cutoff;

        SELECT ROW_COUNT() AS affected;
        COMMIT;
      END
    `,
    `
      -- ---------------------------------------------------------------------------
      -- Chain event maintenance.
      --
      -- Both of these were loops over up to ten thousand rows. \`orphaned\` is set, never
      -- deleted: an event that was reorganised away is evidence about what the platform
      -- believed, and the dispatcher needs it to undo what it applied.
      -- ---------------------------------------------------------------------------
      CREATE PROCEDURE sp_reset_chain_events_for_replay(
        IN  p_from     BIGINT,
        IN  p_to       BIGINT
      )
      MODIFIES SQL DATA
      SQL SECURITY INVOKER
      BEGIN
        UPDATE chain_events
           SET processedAt = NULL, processAttempts = 0, processError = NULL, updatedAt = NOW(6)
         WHERE blockNumber BETWEEN p_from AND p_to AND orphaned = 0;
        SELECT ROW_COUNT() AS affected;
      END
    `,
    `
      CREATE PROCEDURE sp_mark_chain_events_orphaned(
        IN  p_contract   VARCHAR(60),
        IN  p_from_block BIGINT
      )
      MODIFIES SQL DATA
      SQL SECURITY INVOKER
      BEGIN
        /* Counted before the write: how many of the orphaned events had already been
         * applied to balances is the number an operator needs, and it is unavailable
         * afterwards. */
        SELECT COUNT(*) INTO @processed
          FROM chain_events
         WHERE contractName = p_contract AND blockNumber > p_from_block
           AND orphaned = 0 AND processedAt IS NOT NULL;

        UPDATE chain_events
           SET orphaned = 1, updatedAt = NOW(6)
         WHERE contractName = p_contract AND blockNumber > p_from_block AND orphaned = 0;

        SELECT ROW_COUNT() AS affected, @processed AS processedBeforeRewind;
      END
    `,
  ];

  private static readonly TRIGGERS: string[] = [
    `
      -- ============================================================================
      -- Guard triggers.
      --
      -- These make the platform's invariants true AT THE DATABASE, for every client —
      -- the API, a migration, a psql-at-2am, a future reporting job. What they do NOT
      -- do is move money: no trigger writes a balance, credits a bucket or derives an
      -- amount. LedgerService is the only writer of balances, and a trigger that
      -- adjusted one would be a second writer — precisely the drift the nightly audit
      -- exists to catch.
      --
      -- So every trigger here only ever REFUSES.
      --
      -- The escape hatch: each destructive guard yields to \`@mt_maintenance = 1\`.
      -- Retention purges and lawful erasure genuinely need to delete history, and a
      -- guard with no legitimate override gets dropped in a hurry by whoever is on call.
      -- It is a guard against accident and application bugs, not a security boundary —
      -- anyone who can set a session variable could drop the trigger instead. The
      -- application never sets it; only a human running maintenance does.
      -- ============================================================================

      -- The Points ledger is append-only. Every balance is derived from it, so an
      -- edited entry is a balance that can never be reconciled again.
      CREATE TRIGGER trg_points_ledger_no_update BEFORE UPDATE ON points_ledger
      FOR EACH ROW
      BEGIN
        IF COALESCE(@mt_maintenance, 0) <> 1 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'LEDGER_IMMUTABLE: points_ledger rows cannot be updated. Post a reversal entry instead.';
        END IF;
      END
    `,
    `
      CREATE TRIGGER trg_points_ledger_no_delete BEFORE DELETE ON points_ledger
      FOR EACH ROW
      BEGIN
        IF COALESCE(@mt_maintenance, 0) <> 1 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'LEDGER_IMMUTABLE: points_ledger rows cannot be deleted. Post a reversal entry instead.';
        END IF;
      END
    `,
    `
      -- Money that moved, and the revenue it came from. Status may change; the row may
      -- not disappear.
      CREATE TRIGGER trg_transactions_no_delete BEFORE DELETE ON transactions
      FOR EACH ROW
      BEGIN
        IF COALESCE(@mt_maintenance, 0) <> 1 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'AUDIT_IMMUTABLE: transactions cannot be deleted.';
        END IF;
      END
    `,
    `
      CREATE TRIGGER trg_commissions_no_delete BEFORE DELETE ON commissions
      FOR EACH ROW
      BEGIN
        IF COALESCE(@mt_maintenance, 0) <> 1 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'AUDIT_IMMUTABLE: commissions cannot be deleted. Claw back instead.';
        END IF;
      END
    `,
    `
      CREATE TRIGGER trg_revenue_events_no_delete BEFORE DELETE ON revenue_events
      FOR EACH ROW
      BEGIN
        IF COALESCE(@mt_maintenance, 0) <> 1 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'AUDIT_IMMUTABLE: revenue_events cannot be deleted. Reverse instead.';
        END IF;
      END
    `,
    `
      -- The audit log is the record of who did what. An editable audit log is not one.
      CREATE TRIGGER trg_audit_logs_no_update BEFORE UPDATE ON audit_logs
      FOR EACH ROW
      BEGIN
        IF COALESCE(@mt_maintenance, 0) <> 1 THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUDIT_IMMUTABLE: audit_logs cannot be modified.';
        END IF;
      END
    `,
    `
      CREATE TRIGGER trg_audit_logs_no_delete BEFORE DELETE ON audit_logs
      FOR EACH ROW
      BEGIN
        IF COALESCE(@mt_maintenance, 0) <> 1 THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AUDIT_IMMUTABLE: audit_logs cannot be deleted.';
        END IF;
      END
    `,
    `
      -- No bucket of a member's balance may go negative. The service refuses this
      -- already; this is the backstop that makes it true even if a future code path
      -- forgets, and there is no maintenance override — a negative balance is never
      -- a legitimate state.
      CREATE TRIGGER trg_balance_no_negative_insert BEFORE INSERT ON user_balances
      FOR EACH ROW
      BEGIN
        IF NEW.points < 0 OR NEW.mttAvailable < 0 OR NEW.mttStaked < 0
           OR NEW.mttPendingRewards < 0 OR NEW.commissionPending < 0
           OR NEW.commissionAvailable < 0 OR NEW.mttLockedForWithdrawal < 0 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'BALANCE_NEGATIVE: a balance bucket cannot be negative.';
        END IF;
      END
    `,
    `
      CREATE TRIGGER trg_balance_no_negative_update BEFORE UPDATE ON user_balances
      FOR EACH ROW
      BEGIN
        IF NEW.points < 0 OR NEW.mttAvailable < 0 OR NEW.mttStaked < 0
           OR NEW.mttPendingRewards < 0 OR NEW.commissionPending < 0
           OR NEW.commissionAvailable < 0 OR NEW.mttLockedForWithdrawal < 0 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'BALANCE_NEGATIVE: a balance bucket cannot be negative.';
        END IF;
        -- Lifetime commission only ever grows. A clawback reduces what is claimable,
        -- never what was historically earned, and the distinction is what makes the
        -- figure meaningful.
        IF NEW.commissionLifetime < OLD.commissionLifetime THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'LIFETIME_DECREASE: commissionLifetime cannot decrease.';
        END IF;
      END
    `,
    `
      -- The compensation plan pays three levels. There is no level four anywhere in
      -- this system, and a row claiming one would be paid by any future query that
      -- trusted the column.
      CREATE TRIGGER trg_commission_depth_insert BEFORE INSERT ON commissions
      FOR EACH ROW
      BEGIN
        IF NEW.level < 1 OR NEW.level > 3 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'COMMISSION_DEPTH: level must be 1, 2 or 3.';
        END IF;
        IF NEW.recipientId = NEW.downlineUserId THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'SELF_REFERRAL: a member cannot earn commission on their own spend.';
        END IF;
      END
    `,
    `
      CREATE TRIGGER trg_commission_depth_update BEFORE UPDATE ON commissions
      FOR EACH ROW
      BEGIN
        IF NEW.level < 1 OR NEW.level > 3 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'COMMISSION_DEPTH: level must be 1, 2 or 3.';
        END IF;
      END
    `,
    `
      -- A published legal document is what members accepted. Editing one in place
      -- rewrites the terms of an agreement that has already been agreed to; a change
      -- is a new version.
      CREATE TRIGGER trg_legal_published_immutable BEFORE UPDATE ON legal_documents
      FOR EACH ROW
      BEGIN
        IF OLD.status = 'published'
           AND (NEW.sections <> OLD.sections OR NEW.summary <> OLD.summary
                OR NEW.version <> OLD.version OR NEW.slug <> OLD.slug)
           AND COALESCE(@mt_maintenance, 0) <> 1 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'LEGAL_PUBLISHED_IMMUTABLE: publish a new version instead of editing a published one.';
        END IF;
      END
    `,
    `
      -- A conversion at a zero or negative rate would divide by zero or mint MTT.
      CREATE TRIGGER trg_conversion_rate_sane BEFORE INSERT ON conversions
      FOR EACH ROW
      BEGIN
        IF NEW.rateApplied <= 0 THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RATE_INVALID: rateApplied must be positive.';
        END IF;
        IF NEW.pointsSpent <= 0 THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POINTS_INVALID: pointsSpent must be positive.';
        END IF;
      END
    `,
    `
      -- A withdrawal of zero or less is not a withdrawal.
      CREATE TRIGGER trg_withdrawal_amount_positive BEFORE INSERT ON withdrawals
      FOR EACH ROW
      BEGIN
        IF NEW.amountMtt <= 0 THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AMOUNT_INVALID: amountMtt must be positive.';
        END IF;
      END
    `,
  ];

}

/* --------------------------- names, for down() ------------------------- */

const INDEX_NAMES: [string, string][] = [["idx_wd_created_status", "withdrawals"], ["idx_wd_review_created", "withdrawals"], ["idx_comm_recipient_status", "commissions"], ["idx_comm_month_status", "commissions"], ["idx_comm_created_status_level", "commissions"], ["idx_session_user_status", "game_sessions"], ["idx_session_status_created", "game_sessions"], ["idx_session_fp_created", "game_sessions"], ["idx_inflow_period_reconciled", "treasury_inflows"], ["idx_outflow_period_status_dest", "treasury_outflows"], ["idx_revenue_occurred", "revenue_events"], ["idx_revenue_reconciled_occurred", "revenue_events"], ["idx_revenue_user_reconciled", "revenue_events"], ["idx_users_last_active", "users"], ["idx_approval_status_expires", "approval_requests"], ["idx_notif_read_readat", "notifications"], ["idx_userquest_expires", "user_quests"], ["idx_conv_status_created", "conversions"], ["idx_kyc_created_status", "kyc_submissions"], ["idx_points_created_source", "points_ledger"], ["idx_points_user_amount", "points_ledger"], ["idx_outflow_created", "treasury_outflows"], ["idx_listing_status_created", "market_listings"], ["idx_event_block_orphaned", "chain_events"]];

const FOREIGN_KEYS_DOWN: [string, string][] = [["points_ledger", "fk_points_user"], ["withdrawals", "fk_wd_user"], ["deposits", "fk_dep_user"], ["conversions", "fk_conv_user"], ["staking_positions", "fk_pos_user"], ["staking_rewards", "fk_reward_user"], ["commission_cap_usage", "fk_cap_user"], ["commissions", "fk_comm_downline"], ["game_sessions", "fk_session_user"], ["tournament_entries", "fk_entry_user"], ["wallet_addresses", "fk_wallet_user"], ["kyc_submissions", "fk_kyc_user"], ["audit_logs", "fk_audit_actor"], ["user_quests", "fk_userquest_user"], ["user_achievements", "fk_userach_user"], ["user_inventory", "fk_inv_user"], ["notifications", "fk_notif_user"], ["notification_deliveries", "fk_delivery_user"], ["login_history", "fk_login_user"], ["verification_tokens", "fk_verif_user"], ["leaderboard_snapshots", "fk_lb_user"], ["idempotency_keys", "fk_idem_user"], ["tickets", "fk_ticket_user"], ["referral_edges", "fk_edge_user"], ["referral_edges", "fk_edge_ancestor"], ["ticket_messages", "fk_msg_ticket"], ["kyc_documents", "fk_kycdoc_sub"], ["notification_deliveries", "fk_delivery_notif"], ["user_quests", "fk_userquest_quest"], ["user_achievements", "fk_userach_ach"], ["user_inventory", "fk_inv_item"], ["market_listings", "fk_listing_seller"], ["market_listings", "fk_listing_item"], ["market_listings", "fk_listing_inv"], ["game_sessions", "fk_session_game"], ["tournaments", "fk_tournament_game"], ["tournament_entries", "fk_entry_tournament"], ["quests", "fk_quest_game"], ["points_rules", "fk_rule_game"], ["commissions", "fk_comm_revenue"], ["treasury_inflows", "fk_inflow_revenue"], ["conversions", "fk_conv_tx"], ["withdrawals", "fk_wd_tx"], ["commissions", "fk_comm_outflow"], ["staking_positions", "fk_pos_pool"], ["staking_rewards", "fk_reward_pool"], ["staking_apr_history", "fk_apr_pool"]];

const VIEW_NAMES: string[] = ["v_commission_solvency", "v_treasury_period", "v_payout_ratio", "v_points_drift", "v_mtt_liability", "v_admin_kpis", "v_member_signup_cohort", "v_conversion_monthly"];

const ROUTINE_NAMES: [string, string][] = [["FUNCTION", "fn_month_key"], ["PROCEDURE", "sp_leaderboard_snapshot_upsert"], ["PROCEDURE", "sp_quest_progress"], ["PROCEDURE", "sp_expire_stale_approvals"], ["PROCEDURE", "sp_prune_read_notifications"], ["PROCEDURE", "sp_mark_notifications_read"], ["PROCEDURE", "sp_mark_all_notifications_read"], ["PROCEDURE", "sp_bump_risk_scores"], ["PROCEDURE", "sp_expire_stale_listings"], ["PROCEDURE", "sp_reset_chain_events_for_replay"], ["PROCEDURE", "sp_mark_chain_events_orphaned"]];

const TRIGGER_NAMES: string[] = ["trg_points_ledger_no_update", "trg_points_ledger_no_delete", "trg_transactions_no_delete", "trg_commissions_no_delete", "trg_revenue_events_no_delete", "trg_audit_logs_no_update", "trg_audit_logs_no_delete", "trg_balance_no_negative_insert", "trg_balance_no_negative_update", "trg_commission_depth_insert", "trg_commission_depth_update", "trg_legal_published_immutable", "trg_conversion_rate_sane", "trg_withdrawal_amount_positive"];
