import type { MigrationInterface, QueryRunner } from "typeorm";

/* ============================================================================
 * Chain surface completion + the MTTPayout rail.
 *
 * One column changes: `outbound_transactions.kind`.
 *
 * It is a MySQL ENUM, and the eight values it shipped with covered only the
 * calls the original (and, as it turned out, incorrectly-typed) relayer ABI knew
 * how to make. The completed contract surface adds the payout rail, the pause
 * controls and the treasury approval step, so the enum has to grow with it.
 *
 * WHY ADD-ONLY, AND WHY NO BACKFILL
 * ---------------------------------
 * Every existing value is preserved verbatim. `transfer` in particular stays,
 * even though new withdrawals settle through `payout` instead: historic rows
 * record what actually happened, and rewriting them to a value that did not
 * exist at the time would falsify the audit trail on the one table that proves
 * what the platform sent on chain.
 *
 * Down() narrows the enum again, which MySQL will refuse if any row holds one of
 * the new values — correctly. A down-migration that silently dropped payout rows
 * would destroy settlement records.
 * ========================================================================== */

const OLD_KINDS = [
  "record_commission", "fund_reward_pool", "deposit_commission_pool",
  "set_kyc_approved", "clawback", "transfer", "create_pool", "set_pool_active",
];

const NEW_KINDS = [
  ...OLD_KINDS,
  "payout", "fund_payout_float", "sweep_payout_float",
  "pause", "unpause", "set_daily_limit", "approve", "set_penalty_receiver",
];

const asEnum = (values: string[]) => values.map((v) => `'${v}'`).join(",");

export class ChainSurfaceAndPayoutRail1788200000000 implements MigrationInterface {
  name = "ChainSurfaceAndPayoutRail1788200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`outbound_transactions\`
       MODIFY COLUMN \`kind\` ENUM(${asEnum(NEW_KINDS)}) NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /* Refuse rather than truncate. If rows hold the new values, narrowing the
     * enum would coerce them to '' on a non-strict server — a settlement record
     * silently losing what kind of settlement it was. */
    const rows = await queryRunner.query(
      `SELECT COUNT(*) AS n FROM \`outbound_transactions\`
       WHERE \`kind\` NOT IN (${asEnum(OLD_KINDS)})`,
    );
    const count = Number(rows?.[0]?.n ?? 0);
    if (count > 0) {
      throw new Error(
        `Refusing to narrow outbound_transactions.kind: ${count} row(s) use one of the ` +
        `new values. Those are real settlement records — migrate or archive them first.`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE \`outbound_transactions\`
       MODIFY COLUMN \`kind\` ENUM(${asEnum(OLD_KINDS)}) NOT NULL`,
    );
  }
}
