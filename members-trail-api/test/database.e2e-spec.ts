import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DataSource } from "typeorm";
import { AppModule } from "@/app.module";
import { configureApp } from "@/bootstrap";
import { DbRoutinesService, EXPECTED_OBJECTS } from "@/database/routines/db-routines.service";

/* ============================================================================
 * The database's own guarantees, against a real MySQL.
 *
 * Everything here is a thing the application cannot test about itself. A mock
 * repository will happily accept a negative balance, delete a ledger row, or
 * return whatever a view is supposed to compute. These tests ask the database.
 *
 * They are grouped by what they prove:
 *
 *   1. the objects exist at all (a half-run migration is the likeliest failure)
 *   2. the foreign keys refuse what they should and cascade what they should
 *   3. every guard trigger actually refuses
 *   4. each view's arithmetic matches what the service would have computed
 *   5. the procedures do the set-based work they replaced loops with
 * ========================================================================== */

jest.setTimeout(180_000);

describe("Database objects (e2e)", () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let routines: DbRoutinesService;

  /** Rows this suite created, torn down in reverse dependency order. */
  const cleanup: string[] = [];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, bodyParser: true });
    configureApp(app);
    await app.init();

    ds = app.get(DataSource);
    routines = app.get(DbRoutinesService);

    /* Purge anything this suite left behind on a previous run.
     *
     * It uses fixed ids so the assertions can be exact, which means a run that
     * failed halfway leaves rows that collide with the next run's inserts — and
     * the failure then looks like a duplicate key rather than the original
     * problem. Declared as maintenance, because the guard triggers are doing
     * their job on the audit tables. */
    await ds.query("SET @mt_maintenance = 1");
    for (const sql of [
      "DELETE FROM leaderboard_snapshots WHERE periodKey = 'proc-test'",
      "DELETE FROM user_quests WHERE questId = 'q-proc-1'",
      "DELETE FROM quests WHERE id = 'q-proc-1'",
      "DELETE FROM market_listings WHERE id = 'ml-proc-1'",
      "DELETE FROM user_inventory WHERE id = 'inv-proc-1'",
      "DELETE FROM store_items WHERE id = 'si-proc-1'",
      "DELETE FROM approval_requests WHERE ref LIKE 'AP-%'",
      "DELETE FROM chain_events WHERE id IN ('ce-1','ce-2')",
      "DELETE FROM notifications WHERE id IN ('n-mine','n-theirs','ntf-fk-1')",
      "DELETE FROM commissions WHERE ref LIKE 'CM-%'",
      "DELETE FROM points_ledger WHERE ref LIKE 'PT-%'",
      "DELETE FROM revenue_events WHERE ref LIKE 'RV-%'",
      "DELETE FROM treasury_outflows WHERE ref LIKE 'TO-V%'",
      "DELETE FROM user_balances WHERE userId LIKE '%-%' AND userId IN (SELECT id FROM users WHERE email LIKE '%@dbtest.local')",
      "DELETE FROM users WHERE email LIKE '%@dbtest.local'",
    ]) {
      await ds.query(sql).catch(() => undefined);
    }
    await ds.query("SET @mt_maintenance = 0");
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      /* The guard triggers refuse deletes from the audit tables, which is the
       * point of them — so the teardown declares itself as maintenance, exactly
       * as a retention job or a lawful-erasure job would have to. */
      await ds.query("SET @mt_maintenance = 1");
      for (const sql of cleanup.reverse()) await ds.query(sql).catch(() => undefined);
      await ds.query("SET @mt_maintenance = 0");
    }
    await app?.close();
  });

  /** Creates a member and registers its teardown. Returns the id. */
  async function member(id: string, over: Record<string, string | number> = {}): Promise<string> {
    await ds.query(
      `INSERT INTO users (id, createdAt, updatedAt, ref, email, emailHash, passwordHash, fullName,
                          displayName, country, locale, timezone, status, kycTier, role, isStaff,
                          referralCode, referralDepth, riskScore)
       VALUES (?, NOW(6), NOW(6), ?, ?, ?, 'x', 'T', 'T', 'GB', 'en', 'UTC', 'active', ?, 'player', 0, ?, 0, ?)`,
      [id, `USR-${id}`, `${id}@dbtest.local`, `hash-${id}`, over.kycTier ?? 0, `CODE-${id}`, over.riskScore ?? 0],
    );
    await ds.query(
      "INSERT INTO user_balances (id, createdAt, updatedAt, version, userId) VALUES (?, NOW(6), NOW(6), 1, ?)",
      [`bal-${id}`, id],
    );
    cleanup.push(`DELETE FROM user_balances WHERE userId = '${id}'`);
    cleanup.push(`DELETE FROM users WHERE id = '${id}'`);
    return id;
  }

  /* ------------------------------------------------------------------ *
   * 1. the objects exist
   * ------------------------------------------------------------------ */

  describe("schema objects", () => {
    it("has every view, routine and trigger the migration creates", async () => {
      const objects = await routines.schemaObjects();
      expect(objects.views).toBeGreaterThanOrEqual(EXPECTED_OBJECTS.views);
      expect(objects.routines).toBeGreaterThanOrEqual(EXPECTED_OBJECTS.routines);
      expect(objects.triggers).toBeGreaterThanOrEqual(EXPECTED_OBJECTS.triggers);
      expect(objects.healthy).toBe(true);
    });

    it("reports a half-migrated database as unhealthy through the readiness probe", async () => {
      /* The count is what the probe checks, so the count is what this asserts —
       * a database migrated to an older version answers a ping perfectly well and
       * then fails on the first cron tick. */
      const objects = await routines.schemaObjects();
      expect(objects.healthy).toBe(
        objects.views >= EXPECTED_OBJECTS.views
        && objects.routines >= EXPECTED_OBJECTS.routines
        && objects.triggers >= EXPECTED_OBJECTS.triggers,
      );
    });
  });

  /* ------------------------------------------------------------------ *
   * 2. foreign keys
   * ------------------------------------------------------------------ */

  describe("foreign keys", () => {
    it("relates the money tables at all — they used to be related by convention only", async () => {
      const rows = await ds.query<{ n: number }[]>(
        `SELECT COUNT(*) AS n FROM information_schema.REFERENTIAL_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE()`,
      );
      /* Eight before this migration, across sixty tables. */
      expect(Number(rows[0].n)).toBeGreaterThanOrEqual(50);
    });

    it("RESTRICTS the delete of a member who has financial history", async () => {
      const rows = await ds.query<{ table_name: string; delete_rule: string }[]>(
        `SELECT rc.TABLE_NAME AS table_name, rc.DELETE_RULE AS delete_rule
           FROM information_schema.REFERENTIAL_CONSTRAINTS rc
          WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
            AND rc.TABLE_NAME IN ('points_ledger','transactions','withdrawals','deposits',
                                  'conversions','commissions','revenue_events','wallet_addresses',
                                  'kyc_submissions','game_sessions','audit_logs')`,
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.delete_rule).toBe("RESTRICT");
      }
    });

    it("does not let a member with a ledger entry be deleted", async () => {
      const id = await member("fk-restrict-1");
      await ds.query(
        `INSERT INTO points_ledger (id, createdAt, updatedAt, ref, userId, source, amount,
                                    runningBalance, idempotencyKey)
         VALUES (?, NOW(6), NOW(6), 'PT-FK1', ?, 'gameplay', 10, 10, 'idem-fk-1')`,
        ["pl-fk-1", id],
      );
      cleanup.push(`DELETE FROM points_ledger WHERE id = 'pl-fk-1'`);

      /* The whole reason the rule is RESTRICT: the ledger is what every balance
       * is derived from, so losing it silently is unrecoverable. */
      await expect(ds.query(`DELETE FROM users WHERE id = '${id}'`)).rejects.toThrow();
    });

    it("CASCADES the rows that are meaningless without their member", async () => {
      const id = await member("fk-cascade-1");
      await ds.query(
        `INSERT INTO notifications (id, createdAt, updatedAt, userId, kind, title, body, \`read\`)
         VALUES ('ntf-fk-1', NOW(6), NOW(6), ?, 'system', 't', 'b', 0)`,
        [id],
      );

      await ds.query(`DELETE FROM user_balances WHERE userId = '${id}'`);
      await ds.query(`DELETE FROM users WHERE id = '${id}'`);

      const left = await ds.query<{ n: number }[]>(
        "SELECT COUNT(*) AS n FROM notifications WHERE id = 'ntf-fk-1'",
      );
      expect(Number(left[0].n)).toBe(0);
    });

    it("refuses a commission pointing at a revenue event that does not exist", async () => {
      const id = await member("fk-orphan-1");
      await expect(
        ds.query(
          `INSERT INTO commissions (id, createdAt, updatedAt, ref, recipientId, downlineUserId,
                                    level, revenueEventId, triggerType, eligibleSpend, rateBps,
                                    amount, grossAmount, cappedAmount, amountMtt, status, monthKey)
           VALUES ('cm-fk-1', NOW(6), NOW(6), 'CM-FK1', ?, ?, 1, 'no-such-event', 'iap',
                   100, 800, 8, 8, 0, 8, 'queued', '2026-08')`,
          [id, id],
        ),
      ).rejects.toThrow();
    });
  });

  /* ------------------------------------------------------------------ *
   * 3. guard triggers
   * ------------------------------------------------------------------ */

  describe("guard triggers", () => {
    it("makes the Points ledger append-only", async () => {
      const id = await member("trg-ledger-1");
      await ds.query(
        `INSERT INTO points_ledger (id, createdAt, updatedAt, ref, userId, source, amount,
                                    runningBalance, idempotencyKey)
         VALUES ('pl-trg-1', NOW(6), NOW(6), 'PT-TRG1', ?, 'gameplay', 100, 100, 'idem-trg-1')`,
        [id],
      );
      cleanup.push(`DELETE FROM points_ledger WHERE id = 'pl-trg-1'`);

      await expect(
        ds.query("UPDATE points_ledger SET amount = 999999 WHERE id = 'pl-trg-1'"),
      ).rejects.toThrow(/LEDGER_IMMUTABLE/);

      await expect(
        ds.query("DELETE FROM points_ledger WHERE id = 'pl-trg-1'"),
      ).rejects.toThrow(/LEDGER_IMMUTABLE/);
    });

    it("refuses a negative balance bucket", async () => {
      const id = await member("trg-balance-1");
      await expect(
        ds.query(`UPDATE user_balances SET mttAvailable = -1 WHERE userId = '${id}'`),
      ).rejects.toThrow(/BALANCE_NEGATIVE/);
      await expect(
        ds.query(`UPDATE user_balances SET points = -1 WHERE userId = '${id}'`),
      ).rejects.toThrow(/BALANCE_NEGATIVE/);
    });

    it("refuses to reduce lifetime commission — a clawback lowers what is claimable, not what was earned", async () => {
      const id = await member("trg-lifetime-1");
      await ds.query(`UPDATE user_balances SET commissionLifetime = 100 WHERE userId = '${id}'`);
      await expect(
        ds.query(`UPDATE user_balances SET commissionLifetime = 50 WHERE userId = '${id}'`),
      ).rejects.toThrow(/LIFETIME_DECREASE/);
    });

    it("refuses a fourth commission level — there is no level four in this plan", async () => {
      const id = await member("trg-depth-1");
      await ds.query(
        `INSERT INTO revenue_events (id, createdAt, updatedAt, ref, userId, stream, grossAmount,
                                     netAmount, processorFee, currency, occurredAt, reconciled,
                                     commissionEligible)
         VALUES ('rev-trg-1', NOW(6), NOW(6), 'RV-TRG1', ?, 'iap', 100, 100, 0, 'INR', NOW(6), 1, 1)`,
        [id],
      );
      cleanup.push(`DELETE FROM revenue_events WHERE id = 'rev-trg-1'`);

      await expect(
        ds.query(
          `INSERT INTO commissions (id, createdAt, updatedAt, ref, recipientId, downlineUserId,
                                    level, revenueEventId, triggerType, eligibleSpend, rateBps,
                                    amount, grossAmount, cappedAmount, amountMtt, status, monthKey)
           VALUES ('cm-trg-1', NOW(6), NOW(6), 'CM-TRG1', ?, ?, 4, 'rev-trg-1', 'iap',
                   100, 100, 1, 1, 0, 1, 'queued', '2026-08')`,
          [id, id],
        ),
      ).rejects.toThrow(/COMMISSION_DEPTH/);
    });

    it("refuses commission paid to the spender themselves", async () => {
      const id = await member("trg-self-1");
      await ds.query(
        `INSERT INTO revenue_events (id, createdAt, updatedAt, ref, userId, stream, grossAmount,
                                     netAmount, processorFee, currency, occurredAt, reconciled,
                                     commissionEligible)
         VALUES ('rev-trg-2', NOW(6), NOW(6), 'RV-TRG2', ?, 'iap', 100, 100, 0, 'INR', NOW(6), 1, 1)`,
        [id],
      );
      cleanup.push(`DELETE FROM revenue_events WHERE id = 'rev-trg-2'`);

      await expect(
        ds.query(
          `INSERT INTO commissions (id, createdAt, updatedAt, ref, recipientId, downlineUserId,
                                    level, revenueEventId, triggerType, eligibleSpend, rateBps,
                                    amount, grossAmount, cappedAmount, amountMtt, status, monthKey)
           VALUES ('cm-trg-2', NOW(6), NOW(6), 'CM-TRG2', ?, ?, 1, 'rev-trg-2', 'iap',
                   100, 100, 1, 1, 0, 1, 'queued', '2026-08')`,
          [id, id],
        ),
      ).rejects.toThrow(/SELF_REFERRAL/);
    });

    it("refuses a conversion at a zero rate, which would mint MTT", async () => {
      const id = await member("trg-rate-1");
      await expect(
        ds.query(
          `INSERT INTO conversions (id, createdAt, updatedAt, ref, userId, pointsSpent,
                                    rateApplied, mttCredited, status, idempotencyKey)
           VALUES ('cv-trg-1', NOW(6), NOW(6), 'CV-TRG1', ?, 1000, 0, 1, 'completed', 'idem-cv-1')`,
          [id],
        ),
      ).rejects.toThrow(/RATE_INVALID/);
    });

    it("refuses a withdrawal of zero", async () => {
      const id = await member("trg-wd-1");
      await expect(
        ds.query(
          `INSERT INTO withdrawals (id, createdAt, updatedAt, ref, userId, kind, amountMtt,
                                    destination, sourceTag, status, kycTierAtRequest, idempotencyKey)
           VALUES ('wd-trg-1', NOW(6), NOW(6), 'WD-TRG1', ?, 'mtt', 0, '0xabc', 'gameplay',
                   'pending', 1, 'idem-wd-1')`,
          [id],
        ),
      ).rejects.toThrow(/AMOUNT_INVALID/);
    });

    it("yields to an explicit maintenance flag, so lawful erasure is still possible", async () => {
      /* The guards protect against application bugs and stray statements, not
       * against a human doing declared maintenance — a guard with no legitimate
       * override is a guard that gets dropped at 3am. */
      const id = await member("trg-maint-1");
      await ds.query(
        `INSERT INTO points_ledger (id, createdAt, updatedAt, ref, userId, source, amount,
                                    runningBalance, idempotencyKey)
         VALUES ('pl-maint-1', NOW(6), NOW(6), 'PT-MNT1', ?, 'gameplay', 5, 5, 'idem-maint-1')`,
        [id],
      );

      await ds.query("SET @mt_maintenance = 1");
      await expect(ds.query("DELETE FROM points_ledger WHERE id = 'pl-maint-1'")).resolves.toBeDefined();
      await ds.query("SET @mt_maintenance = 0");

      /* And the guard is back on straight afterwards. */
      await ds.query(
        `INSERT INTO points_ledger (id, createdAt, updatedAt, ref, userId, source, amount,
                                    runningBalance, idempotencyKey)
         VALUES ('pl-maint-2', NOW(6), NOW(6), 'PT-MNT2', ?, 'gameplay', 5, 5, 'idem-maint-2')`,
        [id],
      );
      cleanup.push(`DELETE FROM points_ledger WHERE id = 'pl-maint-2'`);
      await expect(
        ds.query("DELETE FROM points_ledger WHERE id = 'pl-maint-2'"),
      ).rejects.toThrow(/LEDGER_IMMUTABLE/);
    });
  });

  /* ------------------------------------------------------------------ *
   * 4. views
   * ------------------------------------------------------------------ */

  describe("views", () => {
    it("computes solvency from CONFIRMED pool funding only", async () => {
      const staff = await member("view-solv-staff");

      await ds.query(
        `INSERT INTO treasury_outflows (id, createdAt, updatedAt, ref, destination, amount,
                                        status, proposedById, headroomAtApproval, fromReserve, periodKey)
         VALUES ('to-view-1', NOW(6), NOW(6), 'TO-V1', 'commission_pool', 100, 'confirmed', ?, 0, 0, '2026-08'),
                ('to-view-2', NOW(6), NOW(6), 'TO-V2', 'commission_pool', 500, 'approved',  ?, 0, 0, '2026-08')`,
        [staff, staff],
      );
      cleanup.push("DELETE FROM treasury_outflows WHERE id IN ('to-view-1','to-view-2')");

      const solvency = await routines.commissionSolvency();

      /* The approved-but-unsubmitted 500 is NOT funding: counting it is how a
       * pool goes overdrawn. */
      expect(Number(solvency.poolFundedMtt)).toBe(100);
    });

    it("finds a balance that disagrees with its ledger, and stays quiet when they agree", async () => {
      const id = await member("view-drift-1");
      await ds.query(
        `INSERT INTO points_ledger (id, createdAt, updatedAt, ref, userId, source, amount,
                                    runningBalance, idempotencyKey)
         VALUES ('pl-drift-1', NOW(6), NOW(6), 'PT-DR1', ?, 'gameplay', 300, 300, 'idem-drift-1')`,
        [id],
      );
      cleanup.push("DELETE FROM points_ledger WHERE id = 'pl-drift-1'");

      /* The balance says 500, the ledger says 300 — the exact situation the
       * nightly audit exists to catch, and which it could not see before. */
      await ds.query(`UPDATE user_balances SET points = 500 WHERE userId = '${id}'`);

      const drifted = await routines.pointsDrift(50);
      const row = drifted.find((d) => d.userId === id);
      expect(row).toBeDefined();
      expect(Number(row!.drift)).toBe(200);

      await ds.query(`UPDATE user_balances SET points = 300 WHERE userId = '${id}'`);
      const after = await routines.pointsDrift(50);
      expect(after.find((d) => d.userId === id)).toBeUndefined();
    });

    it("sums what the platform owes members across every bucket", async () => {
      const id = await member("view-liab-1");
      await ds.query(
        `UPDATE user_balances SET mttAvailable = 10, mttStaked = 20, commissionAvailable = 5
          WHERE userId = '${id}'`,
      );

      const liability = await routines.mttLiability();

      expect(Number(liability.totalLiabilityMtt)).toBeGreaterThanOrEqual(35);
      expect(Number(liability.accounts)).toBeGreaterThanOrEqual(1);
    });

    it("keeps the two payout ratios separate, because they answer different questions", async () => {
      const id = await member("view-ratio-1");
      await ds.query(
        `INSERT INTO revenue_events (id, createdAt, updatedAt, ref, userId, stream, grossAmount,
                                     netAmount, processorFee, currency, occurredAt, reconciled,
                                     commissionEligible)
         VALUES ('rev-ratio-1', NOW(6), NOW(6), 'RV-R1', ?, 'iap', 1000, 1000, 0, 'INR',
                 '2026-07-15 12:00:00', 1, 1)`,
        [id],
      );
      cleanup.push("DELETE FROM revenue_events WHERE id = 'rev-ratio-1'");
      await ds.query(
        `INSERT INTO commissions (id, createdAt, updatedAt, ref, recipientId, downlineUserId,
                                  level, revenueEventId, triggerType, eligibleSpend, rateBps,
                                  amount, grossAmount, cappedAmount, amountMtt, status, monthKey)
         VALUES ('cm-ratio-1', NOW(6), NOW(6), 'CM-R1', ?, ?, 1, 'rev-ratio-1', 'iap',
                 1000, 800, 80, 80, 0, 80, 'released', '2026-07')`,
        [id, await member("view-ratio-2")],
      );
      cleanup.push("DELETE FROM commissions WHERE id = 'cm-ratio-1'");

      const ratio = await routines.payoutRatio("2026-07");

      /* 80 of 1000 = 800 bps. The commission ratio counts commission against
       * member spend; the outflow ratio counts pool transfers against Treasury
       * inflow. Summing them would count the same money twice. */
      expect(Number(ratio.commissionRatioBps)).toBe(800);
      expect(ratio.outflowRatioBps).toBeNull();
    });

    it("reports an undefined ratio as NULL rather than a healthy-looking zero", async () => {
      const ratio = await routines.payoutRatio("1999-01");
      expect(ratio.commissionRatioBps).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ *
   * 5. procedures
   * ------------------------------------------------------------------ */

  describe("procedures", () => {
    it("writes a whole leaderboard in one call, and re-running a period corrects it", async () => {
      const a = await member("proc-lb-1");
      const b = await member("proc-lb-2");
      cleanup.push("DELETE FROM leaderboard_snapshots WHERE periodKey = 'proc-test'");

      const first = await routines.leaderboardSnapshotUpsert("points", "proc-test", [
        { userId: a, score: 900, rank: 1 },
        { userId: b, score: 500, rank: 2 },
      ]);
      expect(first).toBe(2);

      /* Same period again with a new standing: an upsert, not a duplicate. */
      await routines.leaderboardSnapshotUpsert("points", "proc-test", [
        { userId: b, score: 1500, rank: 1 },
        { userId: a, score: 900, rank: 2 },
      ]);

      const rows = await ds.query<{ userId: string; score: string; rank: number }[]>(
        "SELECT userId, score, `rank` FROM leaderboard_snapshots WHERE periodKey = 'proc-test' ORDER BY `rank`",
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].userId).toBe(b);
      expect(Number(rows[0].score)).toBe(1500);
    });

    it("advances a quest, clamps at the target, and reports completion exactly once", async () => {
      const id = await member("proc-quest-1");
      await ds.query(
        `INSERT INTO quests (id, createdAt, updatedAt, title, description, kind, objective,
                             target, rewardPoints, active)
         VALUES ('q-proc-1', NOW(6), NOW(6), 'Three', 'd', 'daily', '{}', 3, 250, 1)`,
      );
      cleanup.push("DELETE FROM user_quests WHERE questId = 'q-proc-1'");
      cleanup.push("DELETE FROM quests WHERE id = 'q-proc-1'");

      const params = { userId: id, questId: "q-proc-1", periodKey: "2026-08-24", target: 3, expiresAt: null };

      const first = await routines.questProgress({ ...params, amount: 2 });
      expect(first).toEqual({ progress: 2, completed: false, isComplete: false });

      /* Overshoot: clamped inside the UPDATE, which is also what closes the
       * lost-update window two concurrent sessions used to race through. */
      const second = await routines.questProgress({ ...params, amount: 99 });
      expect(second).toEqual({ progress: 3, completed: true, isComplete: true });

      /* Already finished — the caller must not publish a second completion. */
      const third = await routines.questProgress({ ...params, amount: 1 });
      expect(third).toEqual({ progress: 3, completed: false, isComplete: true });
    });

    it("only RAISES a risk score, never lowers one", async () => {
      const id = await member("proc-risk-1", { riskScore: 40 });

      await routines.bumpRiskScores([id], 80);
      let rows = await ds.query<{ riskScore: number }[]>(
        `SELECT riskScore FROM users WHERE id = '${id}'`,
      );
      expect(Number(rows[0].riskScore)).toBe(80);

      /* A sweep may not clear an investigation a human raised. */
      await routines.bumpRiskScores([id], 20);
      rows = await ds.query(`SELECT riskScore FROM users WHERE id = '${id}'`);
      expect(Number(rows[0].riskScore)).toBe(80);
    });

    it("expires only PENDING approvals that are actually past their deadline", async () => {
      const staff = await member("proc-appr-1");
      await ds.query(
        `INSERT INTO approval_requests (id, createdAt, updatedAt, ref, kind, payload, reason,
                                        requestedById, status, expiresAt, requiresHardwareKey)
         VALUES ('ap-1', NOW(6), NOW(6), 'AP-1', 'points_rule', '{}', 'r', ?, 'pending',
                 NOW(6) - INTERVAL 1 HOUR, 0),
                ('ap-2', NOW(6), NOW(6), 'AP-2', 'points_rule', '{}', 'r', ?, 'pending',
                 NOW(6) + INTERVAL 1 DAY, 0),
                ('ap-3', NOW(6), NOW(6), 'AP-3', 'points_rule', '{}', 'r', ?, 'approved',
                 NOW(6) - INTERVAL 1 HOUR, 0)`,
        [staff, staff, staff],
      );
      cleanup.push("DELETE FROM approval_requests WHERE id IN ('ap-1','ap-2','ap-3')");

      const expired = await routines.expireStaleApprovals();
      expect(expired).toBe(1);

      const rows = await ds.query<{ id: string; status: string }[]>(
        "SELECT id, status FROM approval_requests WHERE id IN ('ap-1','ap-2','ap-3') ORDER BY id",
      );
      expect(rows.map((r) => r.status)).toEqual(["expired", "pending", "approved"]);
    });

    it("marks notifications read only for their owner", async () => {
      const mine = await member("proc-ntf-1");
      const theirs = await member("proc-ntf-2");
      await ds.query(
        `INSERT INTO notifications (id, createdAt, updatedAt, userId, kind, title, body, \`read\`)
         VALUES ('n-mine', NOW(6), NOW(6), ?, 'system', 't', 'b', 0),
                ('n-theirs', NOW(6), NOW(6), ?, 'system', 't', 'b', 0)`,
        [mine, theirs],
      );
      cleanup.push("DELETE FROM notifications WHERE id IN ('n-mine','n-theirs')");

      /* Passing someone else's id must not mark their row read. */
      const affected = await routines.markNotificationsRead(mine, ["n-mine", "n-theirs"]);
      expect(affected).toBe(1);

      const rows = await ds.query<{ id: string; read: number }[]>(
        "SELECT id, `read` FROM notifications WHERE id IN ('n-mine','n-theirs') ORDER BY id",
      );
      expect(rows.find((r) => r.id === "n-theirs")!.read).toBe(0);
    });

    it("expires a listing AND releases the item lock together", async () => {
      const seller = await member("proc-list-1");
      await ds.query(
        `INSERT INTO store_items (id, createdAt, updatedAt, sku, name, description, category,
                                  rarity, priceMtt, hue, active, consumable, tradable)
         VALUES ('si-proc-1', NOW(6), NOW(6), 'SKU-PROC-1', 'n', 'd', 'cosmetic', 'common', 10, 1, 1, 0, 1)`,
      );
      await ds.query(
        `INSERT INTO user_inventory (id, createdAt, updatedAt, userId, itemId, quantity, lockedByListingId)
         VALUES ('inv-proc-1', NOW(6), NOW(6), ?, 'si-proc-1', 1, 'ml-proc-1')`,
        [seller],
      );
      await ds.query(
        `INSERT INTO market_listings (id, createdAt, updatedAt, ref, sellerId, inventoryItemId,
                                      itemId, askMtt, status, feeMtt)
         VALUES ('ml-proc-1', NOW(6) - INTERVAL 60 DAY, NOW(6), 'ML-P1', ?, 'inv-proc-1',
                 'si-proc-1', 50, 'active', 1)`,
        [seller],
      );
      cleanup.push("DELETE FROM market_listings WHERE id = 'ml-proc-1'");
      cleanup.push("DELETE FROM user_inventory WHERE id = 'inv-proc-1'");
      cleanup.push("DELETE FROM store_items WHERE id = 'si-proc-1'");

      const expired = await routines.expireStaleListings(new Date());
      expect(expired).toBeGreaterThanOrEqual(1);

      const listing = await ds.query<{ status: string }[]>(
        "SELECT status FROM market_listings WHERE id = 'ml-proc-1'",
      );
      const item = await ds.query<{ lockedByListingId: string | null }[]>(
        "SELECT lockedByListingId FROM user_inventory WHERE id = 'inv-proc-1'",
      );

      expect(listing[0].status).toBe("expired");
      /* The half that used to be a separate write: an item left locked to a
       * listing that no longer exists is unsellable, with nothing to explain why. */
      expect(item[0].lockedByListingId).toBeNull();
    });

    it("counts already-applied events before orphaning them, because afterwards it cannot", async () => {
      await ds.query(
        `INSERT INTO chain_events (id, createdAt, updatedAt, contractAddress, contractName,
                                   eventName, blockNumber, blockHash, txHash, logIndex, args,
                                   processedAt, processAttempts, orphaned)
         VALUES ('ce-1', NOW(6), NOW(6), '0xabc', 'staking', 'Staked', 200, '0xh1', '0xt1', 0, '{}',
                 NOW(6), 1, 0),
                ('ce-2', NOW(6), NOW(6), '0xabc', 'staking', 'Staked', 201, '0xh2', '0xt2', 0, '{}',
                 NULL, 0, 0)`,
      );
      cleanup.push("DELETE FROM chain_events WHERE id IN ('ce-1','ce-2')");

      const result = await routines.markChainEventsOrphaned("staking", 199);

      expect(result.orphaned).toBe(2);
      /* The dangerous number: one of them had already been applied to a balance. */
      expect(result.processedBeforeRewind).toBe(1);

      const rows = await ds.query<{ orphaned: number }[]>(
        "SELECT orphaned FROM chain_events WHERE id IN ('ce-1','ce-2')",
      );
      expect(rows.every((r) => Number(r.orphaned) === 1)).toBe(true);
    });

    it("keeps SQL and the application agreed on what a period key is", async () => {
      /* The month key is UTC everywhere in this platform: a local-time boundary
       * would let a member convert twice against one monthly cap. */
      const rows = await ds.query<{ k: string }[]>(
        "SELECT fn_month_key('2026-08-24 23:59:59') AS k",
      );
      expect(rows[0].k).toBe("2026-08");
    });
  });
});
