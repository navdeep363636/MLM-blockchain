import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Deposit, User } from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { EventBusService, Events } from "@/events";
import { paginate, safeSort, type Paginated } from "@/common/dto";
import { Decimal, Ref, dec, toDbAmount } from "@/common/utils";
import { AuditService } from "@/modules/audit/audit.service";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import type {
  AdminDepositQuery, CreateDepositRequest, DepositHistoryQuery, DepositIntentResponse,
  DepositResponse,
} from "./dto/deposit.dto";

/* ============================================================================
 * Deposits (FRD W-03).
 *
 * The single rule this module exists to enforce: **a deposit credits nothing
 * until the processor's own settlement says the money arrived** (conventions §9).
 *
 * The client's "payment succeeded" callback is a hint about what to render, not
 * an authorisation to mint MTT. Crediting on it means anyone who can call the
 * API can fabricate a balance — no card, no chargeback, no trace.
 *
 * So: `initiate()` records an intent and returns a reference. Credit happens in
 * `creditReconciled()`, which is reachable only from the webhook processor after
 * the payload has been signature-verified, and which is idempotent on the
 * processor's own reference so a re-delivered webhook cannot credit twice.
 *
 * A deposit is also NEVER revenue. Nobody bought anything — the member moved
 * their own money in. It therefore writes no `revenue_events` row and can never
 * generate referral commission (conventions §3).
 * ========================================================================== */

const SORT_COLUMNS = ["createdAt", "amountFiat", "status"] as const;

/** Supported settlement currencies. An unknown currency would be priced by
 *  accident, so it is refused rather than assumed to be the default. */
const SUPPORTED_CURRENCIES = new Set(["INR", "USD", "EUR", "AED", "GBP"]);

@Injectable()
export class DepositService {
  private readonly log = new Logger(DepositService.name);

  constructor(
    @InjectRepository(Deposit) private readonly deposits: Repository<Deposit>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly ledger: LedgerService,
    private readonly bus: EventBusService,
    private readonly config: EconomyConfigService,
    private readonly audit: AuditService,
  ) {}

  /* ==================================================================== *
   * Intent
   * ==================================================================== */

  /**
   * Records the member's intent to deposit and returns the reference the client
   * hands to the payment processor. Credits nothing.
   */
  async initiate(
    userId: string,
    dto: CreateDepositRequest,
    ip: string | null,
  ): Promise<DepositIntentResponse> {
    const currency = dto.currency.toUpperCase();
    if (!SUPPORTED_CURRENCIES.has(currency)) {
      throw new BadRequestException({
        code: "CURRENCY_UNSUPPORTED",
        message: `${currency} is not a supported settlement currency`,
      });
    }
    const amount = dec(dto.amountFiat);
    if (amount.lte(0)) throw new BadRequestException("Deposit amount must be positive");

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("Account not found");
    if (user.status === "frozen" || user.status === "closed" || user.status === "suspended") {
      throw new ConflictException({
        code: `ACCOUNT_${user.status.toUpperCase()}`,
        message: "This account cannot deposit in its current state",
      });
    }

    const ref = Ref.deposit();
    const row = await this.deposits.save(
      this.deposits.create({
        ref,
        userId,
        method: dto.method,
        amountFiat: amount.toFixed(2, Decimal.ROUND_DOWN),
        currency,
        status: "initiated",
        /* Our own reference until the processor assigns theirs. Unique so a
         * webhook can be matched even before the processor ref is known. */
        processorRef: null,
        amountMtt: null,
      }),
    );

    await this.audit.record({
      actorId: userId,
      action: "wallet.deposit.initiate",
      targetType: "deposit",
      targetId: row.id,
      after: { amountFiat: row.amountFiat, currency, method: dto.method },
      ip,
    });

    const indicativeMtt = await this.priceInMtt(row.amountFiat);

    return {
      ...toView(row),
      processorReference: row.ref,
      /* Indicative only. The rate applied is the one in force at reconciliation,
       * because that is when the platform actually receives the money. */
      indicativeMtt,
      creditsOnReconciliationOnly: true,
    };
  }

  /* ==================================================================== *
   * Reconciliation — the only path that credits
   * ==================================================================== */

  /**
   * Credits a deposit against a *settled* processor record.
   *
   * Called by the webhook processor once the payload signature has been
   * verified. Idempotent twice over: on the processor's reference, and on the
   * ledger idempotency key derived from the deposit id.
   */
  async creditReconciled(params: {
    ref: string;
    processor: string;
    processorRef: string;
    settledAmountFiat: string;
    currency: string;
    payload?: Record<string, unknown> | null;
  }): Promise<DepositResponse> {
    const row = await this.deposits.findOne({ where: { ref: params.ref } });
    if (!row) throw new NotFoundException(`Deposit ${params.ref} not found`);

    if (row.status === "completed") {
      /* Re-delivered webhook. Returning the existing row is the correct
       * response — the money is already credited exactly once. */
      this.log.debug(`deposit ${row.ref} already reconciled — ignoring replay`);
      return toView(row);
    }
    if (row.status === "refunded") {
      throw new ConflictException({
        code: "DEPOSIT_REFUNDED",
        message: "This deposit was refunded and cannot be credited",
      });
    }

    /* The settled amount is authoritative — the processor may have taken a
     * currency conversion or applied a partial capture. Crediting the amount the
     * member *asked* to deposit rather than the amount that arrived would credit
     * money the platform never received. */
    if (dec(params.settledAmountFiat).lte(0)) {
      throw new BadRequestException("Settled amount must be positive");
    }
    if (params.currency.toUpperCase() !== row.currency) {
      throw new ConflictException({
        code: "CURRENCY_MISMATCH",
        message: `Settlement currency ${params.currency} does not match the deposit's ${row.currency}`,
      });
    }

    const settled = dec(params.settledAmountFiat).toFixed(2, Decimal.ROUND_DOWN);
    const mtt = await this.priceInMtt(settled);
    if (dec(mtt).lte(0)) {
      throw new ConflictException({
        code: "AMOUNT_TOO_SMALL",
        message: "The settled amount does not convert to a non-zero MTT amount",
      });
    }

    const { replayed } = await this.ledger.mutateMtt({
      userId: row.userId,
      type: "deposit",
      amountMtt: mtt,
      /* Derived from the deposit id, so a retried job resolves to the same
       * ledger row instead of crediting again. */
      idempotencyKey: `deposit:${row.id}`,
      status: "completed",
      amountFiat: settled,
      currency: row.currency,
      sourceTag: "deposit",
      bucket: "available",
      note: `Deposit ${row.ref} via ${params.processor}`,
      metadata: { processor: params.processor, processorRef: params.processorRef },
    });

    row.status = "completed";
    row.amountFiat = settled;
    row.amountMtt = toDbAmount(mtt);
    row.processor = params.processor;
    row.processorRef = params.processorRef;
    row.reconciledAt = new Date();
    row.settledAt = new Date();
    row.processorPayload = params.payload ?? null;
    await this.deposits.save(row);

    await this.audit.recordOrThrow({
      actorId: null,
      action: "wallet.deposit.reconcile",
      targetType: "deposit",
      targetId: row.id,
      after: {
        amountFiat: settled, amountMtt: row.amountMtt,
        processor: params.processor, processorRef: params.processorRef,
      },
      reason: replayed ? "ledger replay — credited once" : null,
    });

    await this.bus.publish(Events.DepositCompleted, {
      userId: row.userId,
      ref: row.ref,
      amountFiat: settled,
      currency: row.currency,
      amountMtt: row.amountMtt,
      processor: params.processor,
      /* Explicit: a deposit is the member's own money moving in, not platform
       * revenue, and must never reach the commission engine. */
      commissionable: false,
    });

    return toView(row);
  }

  /** Marks a deposit failed or expired. Credits nothing, so needs no unwinding. */
  async markUnsuccessful(
    ref: string,
    status: "failed" | "expired" | "refunded",
    reason: string,
  ): Promise<void> {
    const row = await this.deposits.findOne({ where: { ref } });
    if (!row) return;
    if (row.status === "completed" && status !== "refunded") {
      /* A completed deposit cannot silently become failed — that would leave
       * credited MTT with no matching settlement. */
      throw new ConflictException({
        code: "DEPOSIT_ALREADY_CREDITED",
        message: "A credited deposit can only be reversed by an explicit refund",
      });
    }
    row.status = status;
    row.processorPayload = { ...(row.processorPayload ?? {}), reason };
    await this.deposits.save(row);
    this.log.warn(`deposit ${row.ref} → ${status}: ${reason}`);
  }

  /* ==================================================================== *
   * Reads
   * ==================================================================== */

  async history(userId: string, q: DepositHistoryQuery): Promise<Paginated<DepositResponse>> {
    const sortBy = safeSort(q.sortBy, SORT_COLUMNS, "createdAt");
    const qb = this.deposits.createQueryBuilder("d").where("d.userId = :userId", { userId });
    if (q.status) qb.andWhere("d.status = :status", { status: q.status });
    if (q.from) qb.andWhere("d.createdAt >= :from", { from: q.from });
    if (q.to) qb.andWhere("d.createdAt <= :to", { to: q.to });
    if (q.q) qb.andWhere("d.ref LIKE :s", { s: `%${q.q}%` });

    const [rows, total] = await qb
      .orderBy(`d.${sortBy}`, q.sortDir)
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();
    return paginate(rows.map(toView), total, q);
  }

  async adminList(q: AdminDepositQuery): Promise<Paginated<DepositResponse & { userId: string }>> {
    const sortBy = safeSort(q.sortBy, SORT_COLUMNS, "createdAt");
    const qb = this.deposits.createQueryBuilder("d");
    if (q.userId) qb.andWhere("d.userId = :userId", { userId: q.userId });
    if (q.status) qb.andWhere("d.status = :status", { status: q.status });
    if (q.from) qb.andWhere("d.createdAt >= :from", { from: q.from });
    if (q.to) qb.andWhere("d.createdAt <= :to", { to: q.to });
    if (q.q) qb.andWhere("(d.ref LIKE :s OR d.processorRef LIKE :s)", { s: `%${q.q}%` });

    const [rows, total] = await qb
      .orderBy(`d.${sortBy}`, q.sortDir)
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();
    return paginate(rows.map((r) => ({ ...toView(r), userId: r.userId })), total, q);
  }

  /**
   * Unreconciled deposits older than the cutoff — the reconciliation cron's work
   * list. A deposit stuck in `pending` is either a processor problem or a member
   * owed their money; either way somebody must look at it.
   */
  async stale(olderThanMinutes: number): Promise<Deposit[]> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
    return this.deposits
      .createQueryBuilder("d")
      .where("d.status IN (:...statuses)", { statuses: ["initiated", "pending", "processing"] })
      .andWhere("d.createdAt < :cutoff", { cutoff })
      .orderBy("d.createdAt", "ASC")
      .take(500)
      .getMany();
  }

  /* ------------------------------------------------------------------ */

  /** Fiat → MTT at the admin-managed reference price, truncated down. */
  private async priceInMtt(amountFiat: string): Promise<string> {
    const { fiatPerMtt } = await this.config.treasuryAllocation();
    if (dec(fiatPerMtt).lte(0)) {
      throw new ConflictException({
        code: "REFERENCE_PRICE_UNSET",
        message: "No MTT reference price is configured — deposits cannot be priced",
      });
    }
    return toDbAmount(dec(amountFiat).div(dec(fiatPerMtt)));
  }
}

function toView(d: Deposit): DepositResponse {
  return {
    ref: d.ref,
    createdAt: d.createdAt.toISOString(),
    method: d.method,
    amountFiat: d.amountFiat,
    currency: d.currency,
    amountMtt: d.amountMtt ? toDbAmount(d.amountMtt) : null,
    status: d.status,
    reconciledAt: d.reconciledAt ? d.reconciledAt.toISOString() : null,
    settledAt: d.settledAt ? d.settledAt.toISOString() : null,
    txHash: d.txHash ?? null,
  };
}
