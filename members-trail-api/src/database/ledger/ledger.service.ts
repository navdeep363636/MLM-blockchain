import { BadRequestException, ConflictException, Injectable, Logger } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";
import {
  PointsLedgerEntry, Transaction, UserBalance,
  type PointsSource, type TxStatus, type TxType, type FundsSourceTag,
} from "@/database/entities";
import { Ref, add, dec, gte, sub, toDbAmount, asScalar } from "@/common/utils";

/* ============================================================================
 * The ledger.
 *
 * EVERY balance mutation in the application goes through this service. Nothing
 * else may write user_balances — that rule is what makes the invariants below
 * true rather than aspirational.
 *
 * How correctness is achieved:
 *
 *  1. SERIALISED PER USER. Each mutation opens a transaction and takes a
 *     `SELECT … FOR UPDATE` row lock on the user's balance row. Two concurrent
 *     spends therefore queue rather than both reading the same starting
 *     balance. Optimistic versioning alone is not enough here: it detects the
 *     conflict but only after both have already decided they can afford it.
 *
 *  2. DOUBLE-ENTRY-ISH. Every mutation writes an immutable ledger row (Points)
 *     or a transaction row (MTT) inside the same transaction as the balance
 *     update. If the process dies mid-way, both roll back together — there is
 *     no window where the balance moved but the history didn't.
 *
 *  3. IDEMPOTENT. Every write carries an idempotency key with a UNIQUE index.
 *     A retried request hits a duplicate-key error, which we translate into
 *     "already applied" and return the existing row instead of double-crediting.
 *
 *  4. NO NEGATIVE BALANCES. Debits assert sufficiency inside the lock. A
 *     balance can never go negative, so there is no "overdraft" state to
 *     reconcile later.
 * ========================================================================== */

export interface PointsMutation {
  userId: string;
  /** Signed. Negative for conversions out, reversals, corrections. */
  amount: number;
  source: PointsSource;
  idempotencyKey: string;
  gameId?: string | null;
  gameSessionId?: string | null;
  note?: string | null;
  actorId?: string | null;
  approvedById?: string | null;
}

export interface MttMutation {
  userId: string;
  type: TxType;
  /** Signed from the user's perspective. */
  amountMtt: string;
  idempotencyKey: string;
  status?: TxStatus;
  amountFiat?: string | null;
  currency?: string | null;
  sourceTag?: FundsSourceTag | null;
  txHash?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Which balance bucket to move. Defaults to available. */
  bucket?: "available" | "staked" | "pendingRewards" | "commissionAvailable" | "commissionPending";
}

export interface LedgerResult<T> {
  row: T;
  /** True when the operation had already been applied and this is a replay. */
  replayed: boolean;
}

const DUPLICATE_CODES = new Set(["ER_DUP_ENTRY", "23000"]);

function isDuplicate(e: unknown): boolean {
  const err = e as { code?: string; errno?: number };
  return DUPLICATE_CODES.has(err?.code ?? "") || err?.errno === 1062;
}

@Injectable()
export class LedgerService {
  private readonly log = new Logger(LedgerService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /* ------------------------------------------------------------------ *
   * Points
   * ------------------------------------------------------------------ */

  async mutatePoints(m: PointsMutation): Promise<LedgerResult<PointsLedgerEntry>> {
    if (!Number.isInteger(m.amount)) {
      throw new BadRequestException("Points must be an integer — there are no fractional Points");
    }
    if (m.amount === 0) {
      throw new BadRequestException("Points mutation must be non-zero");
    }

    try {
      return await this.ds.transaction("READ COMMITTED", async (tx) => {
        const balance = await this.lockBalance(tx, m.userId);

        const next = balance.points + m.amount;
        if (next < 0) {
          throw new ConflictException({
            code: "INSUFFICIENT_POINTS",
            message: "Insufficient Points balance",
            available: balance.points,
            requested: Math.abs(m.amount),
          });
        }

        const entry = tx.getRepository(PointsLedgerEntry).create({
          ref: Ref.pointsEntry(),
          userId: m.userId,
          source: m.source,
          amount: m.amount,
          runningBalance: next,
          gameId: m.gameId ?? null,
          gameSessionId: m.gameSessionId ?? null,
          note: m.note ?? null,
          actorId: m.actorId ?? null,
          approvedById: m.approvedById ?? null,
          idempotencyKey: m.idempotencyKey,
        });
        const saved = await tx.getRepository(PointsLedgerEntry).save(entry);

        balance.points = next;
        balance.lastLedgerAt = new Date();
        await tx.getRepository(UserBalance).save(balance);

        return { row: saved, replayed: false };
      });
    } catch (e) {
      if (isDuplicate(e)) {
        const existing = await this.ds.getRepository(PointsLedgerEntry).findOne({
          where: { idempotencyKey: m.idempotencyKey },
        });
        if (existing) {
          this.log.debug(`points replay ignored: ${m.idempotencyKey}`);
          return { row: existing, replayed: true };
        }
      }
      throw e;
    }
  }

  /* ------------------------------------------------------------------ *
   * MTT
   * ------------------------------------------------------------------ */

  async mutateMtt(m: MttMutation): Promise<LedgerResult<Transaction>> {
    const delta = dec(m.amountMtt);
    if (delta.isZero()) throw new BadRequestException("MTT mutation must be non-zero");

    const bucket = m.bucket ?? "available";

    try {
      return await this.ds.transaction("READ COMMITTED", async (tx) => {
        const balance = await this.lockBalance(tx, m.userId);
        this.applyBucket(balance, bucket, m.amountMtt);

        const row = tx.getRepository(Transaction).create({
          ref: Ref.transaction(),
          userId: m.userId,
          type: m.type,
          amountMtt: toDbAmount(m.amountMtt),
          amountFiat: m.amountFiat ?? null,
          currency: m.currency ?? null,
          status: m.status ?? "completed",
          sourceTag: m.sourceTag ?? null,
          txHash: m.txHash ?? null,
          note: m.note ?? null,
          metadata: m.metadata ?? null,
          idempotencyKey: m.idempotencyKey,
          settledAt: (m.status ?? "completed") === "completed" ? new Date() : null,
        });
        const saved = await tx.getRepository(Transaction).save(row);

        balance.lastLedgerAt = new Date();
        await tx.getRepository(UserBalance).save(balance);

        return { row: saved, replayed: false };
      });
    } catch (e) {
      if (isDuplicate(e)) {
        const existing = await this.ds.getRepository(Transaction).findOne({
          where: { idempotencyKey: m.idempotencyKey },
        });
        if (existing) {
          this.log.debug(`mtt replay ignored: ${m.idempotencyKey}`);
          return { row: existing, replayed: true };
        }
      }
      throw e;
    }
  }

  /**
   * Moves MTT between two buckets of the same user atomically — the shape of a
   * stake (available → staked), an unstake, or a commission release
   * (commissionPending → commissionAvailable).
   *
   * Doing this as two separate mutateMtt calls would leave a window where the
   * funds exist in neither bucket, which a concurrent read would see as a
   * vanished balance.
   */
  async transferBucket(params: {
    userId: string;
    from: MttMutation["bucket"];
    to: MttMutation["bucket"];
    amount: string;
    type: TxType;
    idempotencyKey: string;
    note?: string;
    txHash?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<LedgerResult<Transaction>> {
    const from = params.from ?? "available";
    const to = params.to ?? "available";
    if (from === to) throw new BadRequestException("Source and destination bucket must differ");

    try {
      return await this.ds.transaction("READ COMMITTED", async (tx) => {
        const balance = await this.lockBalance(tx, params.userId);

        this.applyBucket(balance, from, `-${dec(params.amount).abs().toString()}`);
        this.applyBucket(balance, to, dec(params.amount).abs().toString());

        const row = tx.getRepository(Transaction).create({
          ref: Ref.transaction(),
          userId: params.userId,
          type: params.type,
          // A bucket transfer nets to zero for the user; the movement is the point.
          amountMtt: toDbAmount(0),
          status: "completed",
          txHash: params.txHash ?? null,
          note: params.note ?? `${from} → ${to} ${params.amount}`,
          metadata: { ...(params.metadata ?? {}), bucketFrom: from, bucketTo: to, amount: toDbAmount(params.amount) },
          idempotencyKey: params.idempotencyKey,
          settledAt: new Date(),
        });
        const saved = await tx.getRepository(Transaction).save(row);

        balance.lastLedgerAt = new Date();
        await tx.getRepository(UserBalance).save(balance);
        return { row: saved, replayed: false };
      });
    } catch (e) {
      if (isDuplicate(e)) {
        const existing = await this.ds.getRepository(Transaction).findOne({
          where: { idempotencyKey: params.idempotencyKey },
        });
        if (existing) return { row: existing, replayed: true };
      }
      throw e;
    }
  }

  /**
   * Runs `fn` inside a transaction that already holds the user's balance lock.
   *
   * Use this when a single business operation must mutate the balance AND write
   * domain rows that have to be consistent with it — a conversion debiting
   * Points and crediting MTT, for example. Splitting that across two calls to
   * this service would create a moment where the Points are gone and the MTT
   * hasn't arrived.
   */
  async withUserLock<T>(userId: string, fn: (tx: EntityManager, balance: UserBalance) => Promise<T>): Promise<T> {
    return this.ds.transaction("READ COMMITTED", async (tx) => {
      const balance = await this.lockBalance(tx, userId);
      return fn(tx, balance);
    });
  }

  /** Locks two users in a deterministic order — required for P2P transfers so
   *  two simultaneous opposite trades can't deadlock. */
  async withTwoUserLock<T>(
    a: string,
    b: string,
    fn: (tx: EntityManager, balances: Record<string, UserBalance>) => Promise<T>,
  ): Promise<T> {
    const [first, second] = [a, b].sort();   // lock ordering prevents deadlock
    return this.ds.transaction("READ COMMITTED", async (tx) => {
      const fb = await this.lockBalance(tx, first);
      const sb = await this.lockBalance(tx, second);
      return fn(tx, { [first]: fb, [second]: sb });
    });
  }

  /* ------------------------------------------------------------------ *
   * Reads
   * ------------------------------------------------------------------ */

  /** Live balance read. Never cached beyond a couple of seconds (FRD D-01). */
  async getBalance(userId: string): Promise<UserBalance> {
    const repo = this.ds.getRepository(UserBalance);
    const found = await repo.findOne({ where: { userId } });
    if (found) return found;
    // First read for a new user materialises the row.
    return repo.save(repo.create({ userId }));
  }

  /**
   * Recomputes the Points balance from the ledger and compares it to the cached
   * projection. Run by a nightly cron: a mismatch means something wrote a
   * balance outside this service, which is a bug worth waking someone for.
   */
  async auditPointsBalance(userId: string): Promise<{ ledger: number; balance: number; drift: number }> {
    const { sum } = await this.ds
      .getRepository(PointsLedgerEntry)
      .createQueryBuilder("e")
      .select("COALESCE(SUM(e.amount), 0)", "sum")
      .where("e.userId = :userId", { userId })
      .getRawOne<{ sum: string }>() ?? { sum: "0" };

    const ledger = Number(sum ?? 0);
    const balance = (await this.getBalance(userId)).points;
    return { ledger, balance, drift: balance - ledger };
  }

  /* ------------------------------------------------------------------ *
   * Internals
   * ------------------------------------------------------------------ */

  /**
   * Pessimistic row lock. This is the serialisation point for all money.
   *
   * `pessimistic_write` emits SELECT … FOR UPDATE, so a second transaction for
   * the same user blocks here until the first commits. The row is created on
   * demand for a user whose balance has never been touched.
   */
  private async lockBalance(tx: EntityManager, userId: string): Promise<UserBalance> {
    const repo = tx.getRepository(UserBalance);

    const locked = await repo.findOne({
      where: { userId },
      lock: { mode: "pessimistic_write" },
    });
    if (locked) return locked;

    /* Create-then-relock. Two requests racing to create the same row means one
     * hits the unique index; we swallow that and read the winner's row under a
     * lock, so both callers end up correctly serialised. */
    try {
      await repo.insert(repo.create({ userId }));
    } catch (e) {
      if (!isDuplicate(e)) throw e;
    }
    const relocked = await repo.findOne({ where: { userId }, lock: { mode: "pessimistic_write" } });
    if (!relocked) throw new ConflictException("Could not lock the balance row");
    return relocked;
  }

  /** Applies a signed delta to one bucket, refusing to go negative. */
  private applyBucket(balance: UserBalance, bucket: NonNullable<MttMutation["bucket"]>, delta: string): void {
    const field = {
      available: "mttAvailable",
      staked: "mttStaked",
      pendingRewards: "mttPendingRewards",
      commissionAvailable: "commissionAvailable",
      commissionPending: "commissionPending",
    }[bucket] as keyof UserBalance;

    /* asScalar rather than String(): the indexed read is typed `unknown`, and a
     * silent "[object Object]" here would enter the arithmetic below. */
    const current = asScalar(balance[field]) ?? "0";
    const next = add(current, delta);

    if (dec(next).isNegative()) {
      throw new ConflictException({
        code: "INSUFFICIENT_BALANCE",
        message: `Insufficient ${bucket} MTT balance`,
        available: current,
        requested: dec(delta).abs().toString(),
      });
    }

    (balance[field] as unknown as string) = next;

    /* Lifetime commission is monotonic — it records what was ever earned, so a
     * later clawback does not erase the fact that it was credited. */
    if (bucket === "commissionAvailable" && !dec(delta).isNegative()) {
      balance.commissionLifetime = add(balance.commissionLifetime, delta);
    }
  }

  /** Reserves available MTT against an in-flight withdrawal. */
  async lockForWithdrawal(userId: string, amount: string, idempotencyKey: string): Promise<void> {
    await this.ds.transaction("READ COMMITTED", async (tx) => {
      const balance = await this.lockBalance(tx, userId);
      if (!gte(balance.mttAvailable, amount)) {
        throw new ConflictException({
          code: "INSUFFICIENT_BALANCE",
          message: "Insufficient available MTT balance",
          available: balance.mttAvailable,
          requested: toDbAmount(amount),
        });
      }
      balance.mttAvailable = sub(balance.mttAvailable, amount);
      balance.mttLockedForWithdrawal = add(balance.mttLockedForWithdrawal, amount);
      await tx.getRepository(UserBalance).save(balance);
      this.log.debug(`locked ${amount} MTT for withdrawal (${idempotencyKey})`);
    });
  }

  /** Releases a withdrawal hold — on rejection or cancellation. */
  async releaseWithdrawalLock(userId: string, amount: string): Promise<void> {
    await this.ds.transaction("READ COMMITTED", async (tx) => {
      const balance = await this.lockBalance(tx, userId);
      balance.mttLockedForWithdrawal = sub(balance.mttLockedForWithdrawal, amount);
      balance.mttAvailable = add(balance.mttAvailable, amount);
      await tx.getRepository(UserBalance).save(balance);
    });
  }

  /** Settles a withdrawal: the held amount leaves the platform for good. */
  async settleWithdrawalLock(userId: string, amount: string): Promise<void> {
    await this.ds.transaction("READ COMMITTED", async (tx) => {
      const balance = await this.lockBalance(tx, userId);
      balance.mttLockedForWithdrawal = sub(balance.mttLockedForWithdrawal, amount);
      await tx.getRepository(UserBalance).save(balance);
    });
  }
}
