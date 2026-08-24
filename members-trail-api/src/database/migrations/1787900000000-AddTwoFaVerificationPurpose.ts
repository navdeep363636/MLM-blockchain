import type { MigrationInterface, QueryRunner } from "typeorm";

/* ============================================================================
 * Gives two-factor codes their own verification purpose.
 *
 * Before this, a 2FA SMS code was stored as `phone_verify`. Two consequences,
 * both real:
 *
 *  - `OtpService.issue` supersedes any live code for the same (purpose, target),
 *    so enrolling in 2FA silently cancelled a pending phone verification.
 *  - A code minted to prove ownership of a phone number satisfied a login
 *    challenge, and vice versa. They are different claims.
 *
 * Adding an enum value is additive and safe on a live table: no existing row
 * changes, and MySQL rewrites only the column definition.
 * ========================================================================== */

export class AddTwoFaVerificationPurpose1787900000000 implements MigrationInterface {
  name = "AddTwoFaVerificationPurpose1787900000000";

  private readonly withTwoFa =
    "enum('email_verify','phone_verify','password_reset','wallet_link','email_change','two_fa')";

  private readonly withoutTwoFa =
    "enum('email_verify','phone_verify','password_reset','wallet_link','email_change')";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`verification_tokens\` MODIFY \`purpose\` ${this.withTwoFa} NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /* Any token still carrying the new purpose has to go before the value can be
     * removed — a short-lived one-time code, so deleting it costs a member one
     * "request a new code" at worst. Leaving it would make the ALTER fail. */
    await queryRunner.query(`DELETE FROM \`verification_tokens\` WHERE \`purpose\` = 'two_fa'`);
    await queryRunner.query(
      `ALTER TABLE \`verification_tokens\` MODIFY \`purpose\` ${this.withoutTwoFa} NOT NULL`,
    );
  }
}
