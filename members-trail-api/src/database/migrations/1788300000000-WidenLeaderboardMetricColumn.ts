import type { MigrationInterface, QueryRunner } from "typeorm";

/* ============================================================================
 * Widens `leaderboard_snapshots.metric` to fit a full per-title key.
 *
 * The per-title metric key is `${metric}:${gameId}` — up to 8 chars of metric
 * name, a colon, and a full UUID (36 chars) = 45 chars. The column was
 * `varchar(32)`, so the service truncated `gameId` to its first 8 hex
 * characters to fit. With enough titles in the catalog that is a real
 * collision risk: two games sharing the same 8-char prefix silently merge
 * into one leaderboard. The service now keys on the full gameId; this
 * migration makes the column able to hold it.
 * ========================================================================== */

export class WidenLeaderboardMetricColumn1788300000000 implements MigrationInterface {
  name = "WidenLeaderboardMetricColumn1788300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `leaderboard_snapshots` MODIFY `metric` VARCHAR(64) NOT NULL",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /* Any per-title snapshot row written under the full-gameId scheme will not
     * fit back into varchar(32) — truncating on the way down would silently
     * corrupt those rows' keys, so they are dropped instead. Global (non
     * per-title) rows are always short and are unaffected. */
    await queryRunner.query(
      "DELETE FROM `leaderboard_snapshots` WHERE CHAR_LENGTH(`metric`) > 32",
    );
    await queryRunner.query(
      "ALTER TABLE `leaderboard_snapshots` MODIFY `metric` VARCHAR(32) NOT NULL",
    );
  }
}
