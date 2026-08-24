import {
  CreateDateColumn, DeleteDateColumn, PrimaryGeneratedColumn, UpdateDateColumn, VersionColumn,
} from "typeorm";

/* ============================================================================
 * Base entities.
 *
 * UUID primary keys rather than auto-increment: sequential ids leak volume,
 * invite enumeration, and make merging data across environments painful.
 *
 * DECIMAL column helper is defined here so no module can accidentally declare a
 * money column as float — see the note in common/utils/money.ts.
 * ========================================================================== */

export abstract class BaseEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @CreateDateColumn({ type: "datetime", precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ type: "datetime", precision: 6 })
  updatedAt!: Date;
}

/** For rows that must never be hard-deleted (financial and audit history). */
export abstract class SoftDeleteEntity extends BaseEntity {
  @DeleteDateColumn({ type: "datetime", precision: 6, nullable: true })
  deletedAt?: Date | null;
}

/**
 * For rows updated concurrently. TypeORM throws OptimisticLockVersionMismatch
 * on a stale write, which is what stops two requests from both spending the
 * same balance.
 */
export abstract class VersionedEntity extends BaseEntity {
  @VersionColumn()
  version!: number;
}

/** DECIMAL(36,18): exact to 18 dp, which is MTT's on-chain precision. */
export const MONEY = { type: "decimal", precision: 36, scale: 18, default: 0 } as const;
export const MONEY_NULLABLE = { type: "decimal", precision: 36, scale: 18, nullable: true } as const;
/** Fiat amounts: 2 dp is enough, 18 is misleading. */
export const FIAT = { type: "decimal", precision: 20, scale: 2, default: 0 } as const;
export const FIAT_NULLABLE = { type: "decimal", precision: 20, scale: 2, nullable: true } as const;

/**
 * TypeORM returns DECIMAL as string (correctly — a JS number can't hold it).
 * This transformer keeps that explicit at the type level so nobody does
 * arithmetic on it by accident.
 *
 * UNDEFINED IS PASSED THROUGH UNCHANGED, and that distinction is load-bearing.
 * An earlier version mapped it to null, which meant inserting a row without
 * naming every money column — `create({ userId })` for a fresh balance row —
 * sent NULL into NOT NULL columns instead of letting the column DEFAULT apply.
 * MySQL rejected it, so account registration failed at the balance insert. The
 * three states are genuinely different here:
 *
 *   undefined → "I am not setting this column" → the DB default (0) applies
 *   null      → "this column has no value"     → NULL, for nullable columns
 *   a value   → stringified, because DECIMAL is text on the wire
 */
export const decimalTransformer = {
  to: (v: string | number | null | undefined): string | null | undefined =>
    v === undefined ? undefined : v === null ? null : String(v),
  from: (v: string | null): string => v ?? "0",
};
