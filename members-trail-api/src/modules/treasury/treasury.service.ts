import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import {
  RevenueEvent, TreasuryInflow, TreasuryOutflow, TreasuryPeriod, User,
} from "@/database/entities";
import { EventBusService, Events } from "@/events";
import { AuditService } from "@/modules/audit/audit.service";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import {
  COMMISSION_ELIGIBLE_STREAMS, OUTFLOW_MIN_APPROVERS, PAYOUT_RATIO_ALERT_BPS,
} from "@/modules/economy-config/economy-config.constants";
import {
  Ref, add, dec, gt, monthKey, sub, toDbAmount, fiat,
} from "@/common/utils";
import { paginate, type Paginated } from "@/common/dto";
import type {
  ApproveOutflowDto, HeadroomResponse, InflowQuery, OutflowQuery, ProposeOutflowDto,
  ReconcileBatchDto, RecogniseRevenueDto, TreasuryDashboardResponse,
} from "./dto/treasury.dto";

/* ============================================================================
 * The Revenue Treasury.
 *
 * This service owns the single rule the whole platform rests on:
 *
 *     cumulative outflow  <=  cumulative RECONCILED inflow, per period
 *
 * `assertHeadroom` is the enforcement point. It throws — it does not warn —
 * because a warning that funds a payout from an unreconciled deposit is exactly
 * the failure mode this design exists to prevent. The commission engine calls
 * the same method, so there is one implementation of the ceiling, not two.
 * ========================================================================== */

@Injectable()
export class TreasuryService {
  private readonly log = new Logger(TreasuryService.name);

  constructor(
    @InjectRepository(RevenueEvent) private readonly revenue: Repository<RevenueEvent>,
    @InjectRepository(TreasuryInflow) private readonly inflows: Repository<TreasuryInflow>,
    @InjectRepository(TreasuryOutflow) private readonly outflows: Repository<TreasuryOutflow>,
    @InjectRepository(TreasuryPeriod) private readonly periods: Repository<TreasuryPeriod>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: EconomyConfigService,
    private readonly routines: DbRoutinesService,
    private readonly audit: AuditService,
    private readonly bus: EventBusService,
  ) {}

  /* ------------------------------------------------------------------ *
   * Revenue recognition
   * ------------------------------------------------------------------ */

  /**
   * The ONE entry point for a settled real-money event.
   *
   * Idempotent on (processor, processorRef): a replayed payment webhook returns
   * the existing event rather than recognising the revenue twice — which would
   * inflate the payout ceiling and let the platform overpay.
   */
  async recognise(dto: RecogniseRevenueDto): Promise<RevenueEvent> {
    if (dto.processor && dto.processorRef) {
      const existing = await this.revenue.findOne({
        where: { processor: dto.processor, processorRef: dto.processorRef },
      });
      if (existing) {
        this.log.debug(`revenue replay ignored: ${dto.processor}/${dto.processorRef}`);
        return existing;
      }
    }

    const gross = dec(dto.grossAmount);
    const fee = dec(dto.processorFee);
    if (gross.lte(0)) throw new BadRequestException("Gross amount must be positive");
    if (fee.isNegative()) throw new BadRequestException("Processor fee cannot be negative");
    if (fee.gt(gross)) throw new BadRequestException("Processor fee cannot exceed the gross amount");

    const net = sub(gross.toString(), fee.toString());
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    const period = monthKey(occurredAt);

    const alloc = await this.config.treasuryAllocation();
    const bps = alloc.allocationBps[dto.stream] ?? 0;
    const toTreasury = toDbAmount(dec(net).mul(bps).div(10_000));

    /**
     * Commission eligibility is decided HERE and nowhere else. Advertising and
     * marketplace revenue fund the Treasury but are not attributable to a
     * member's purchase, so they can never generate a referral commission.
     */
    const commissionEligible = COMMISSION_ELIGIBLE_STREAMS.includes(dto.stream);

    const event = await this.revenue.save(
      this.revenue.create({
        ref: Ref.treasuryInflow().replace("TD-", "RE-"),
        userId: dto.userId,
        stream: dto.stream,
        grossAmount: toDbAmount(gross),
        netAmount: net,
        processorFee: toDbAmount(fee),
        currency: dto.currency ?? "INR",
        processor: dto.processor ?? null,
        processorRef: dto.processorRef ?? null,
        occurredAt,
        reconciled: false,
        commissionEligible,
      }),
    );

    /* Matching inflow, unreconciled until a settlement batch matches it. */
    await this.inflows.save(
      this.inflows.create({
        ref: Ref.treasuryInflow(),
        revenueEventId: event.id,
        stream: dto.stream,
        grossRevenue: toDbAmount(gross),
        allocationBps: bps,
        amountToTreasury: toTreasury,
        amountMtt: toDbAmount(dec(toTreasury).div(dec(alloc.fiatPerMtt || 1))),
        processorRef: dto.processorRef ?? null,
        reconciled: false,
        periodKey: period,
      }),
    );

    await this.bus.publish(Events.RevenueRecognised, {
      revenueEventId: event.id,
      ref: event.ref,
      userId: dto.userId,
      stream: dto.stream,
      netAmount: net,
      commissionEligible,
      periodKey: period,
    });

    return event;
  }

  /**
   * Refund or chargeback. Publishes so the commission engine can claw back —
   * the money left the platform, so anything paid on top of it must come back.
   */
  async reverse(revenueEventId: string, reason: string, actorId?: string): Promise<RevenueEvent> {
    const event = await this.revenue.findOne({ where: { id: revenueEventId } });
    if (!event) throw new NotFoundException("Revenue event not found");
    if (event.reversedAt) return event;

    event.reversedAt = new Date();
    event.reversalReason = reason;
    const saved = await this.revenue.save(event);

    /* The inflow no longer counts toward the ceiling. Un-reconciling it is what
     * shrinks the period's headroom, so a refunded purchase cannot keep
     * justifying a payout. */
    await this.inflows.update({ revenueEventId }, { reconciled: false, reconciliationNote: `Reversed: ${reason}` });

    await this.audit.record({
      actorId, action: "treasury.revenue.reverse", targetType: "revenue_event",
      targetId: revenueEventId, reason, after: { reversedAt: saved.reversedAt },
    });

    await this.bus.publish(Events.RevenueReversed, {
      revenueEventId, ref: event.ref, userId: event.userId,
      netAmount: event.netAmount, reason,
    });

    return saved;
  }

  /* ------------------------------------------------------------------ *
   * The ceiling
   * ------------------------------------------------------------------ */

  /** Reconciled inflow, prior outflow and remaining headroom for a period. */
  async headroom(periodKey: string): Promise<HeadroomResponse> {
    const [inflow, outflow] = await Promise.all([
      this.sumInflow(periodKey, true),
      this.sumOutflow(periodKey),
    ]);
    const headroom = sub(inflow, outflow);
    return {
      periodKey,
      reconciledInflow: inflow,
      priorOutflow: outflow,
      headroom,
      withinBudget: !dec(headroom).isNegative(),
    };
  }

  /**
   * The guard. Throws when the requested amount would push the period's
   * cumulative outflow past its reconciled inflow.
   *
   * Called by both the outflow approval path and the commission engine, so
   * there is exactly one place the ceiling is defined.
   */
  async assertHeadroom(periodKey: string, amount: string, context = "outflow"): Promise<HeadroomResponse> {
    const h = await this.headroom(periodKey);

    if (gt(amount, h.headroom)) {
      throw new ForbiddenException({
        code: "TREASURY_HEADROOM_EXCEEDED",
        message:
          `Refused: this ${context} of ${toDbAmount(amount)} would exceed the reconciled ` +
          `Treasury inflow for ${periodKey}. Available headroom is ${h.headroom}. ` +
          `A payout may never be funded from unreconciled revenue.`,
        periodKey,
        requested: toDbAmount(amount),
        headroom: h.headroom,
        reconciledInflow: h.reconciledInflow,
        priorOutflow: h.priorOutflow,
      });
    }
    return h;
  }

  /* ------------------------------------------------------------------ *
   * Reconciliation
   * ------------------------------------------------------------------ */

  /**
   * Matches a batch of inflows against the processor's settlement total.
   *
   * A mismatch does NOT reconcile the batch: an unexplained difference between
   * what we think we earned and what the processor actually settled is exactly
   * the signal that must block downstream payouts, not be rounded away.
   */
  async reconcileBatch(dto: ReconcileBatchDto, actorId: string): Promise<{
    reconciled: number; reportedTotal: string; settlementTotal: string; matched: boolean;
  }> {
    const rows = await this.inflows.find({ where: { id: In(dto.inflowIds) } });
    if (rows.length !== dto.inflowIds.length) {
      throw new BadRequestException("One or more inflow ids were not found");
    }
    if (rows.some((r) => r.reconciled)) {
      throw new BadRequestException("One or more inflows are already reconciled");
    }

    const reportedTotal = rows.reduce((s, r) => add(s, r.amountToTreasury), toDbAmount(0));
    const matched = dec(reportedTotal).eq(dec(dto.settlementTotal));

    if (!matched) {
      const note =
        `Settlement mismatch: reported ${reportedTotal}, processor settled ${toDbAmount(dto.settlementTotal)}`;
      await this.inflows.update({ id: In(dto.inflowIds) }, { reconciliationNote: note });
      await this.audit.record({
        actorId, action: "treasury.reconcile.mismatch", targetType: "treasury_inflow",
        targetId: dto.inflowIds.join(","), reason: dto.reason,
        after: { reportedTotal, settlementTotal: dto.settlementTotal },
      });
      throw new BadRequestException({
        code: "SETTLEMENT_MISMATCH",
        message:
          `${note}. The batch was not reconciled — resolve the difference before ` +
          `these inflows can fund a payout.`,
        reportedTotal, settlementTotal: toDbAmount(dto.settlementTotal),
      });
    }

    const now = new Date();
    await this.inflows.update(
      { id: In(dto.inflowIds) },
      { reconciled: true, reconciledById: actorId, reconciledAt: now, reconciliationNote: null },
    );

    /* The revenue events behind them become reconciled too — that flag is what
     * the commission engine gates on. */
    const eventIds = rows.map((r) => r.revenueEventId).filter((v): v is string => !!v);
    if (eventIds.length) await this.revenue.update({ id: In(eventIds) }, { reconciled: true, settledAt: now });

    await this.audit.record({
      actorId, action: "treasury.reconcile", targetType: "treasury_inflow",
      targetId: dto.inflowIds.join(","), reason: dto.reason,
      after: { count: rows.length, total: reportedTotal },
    });

    for (const r of rows) {
      await this.bus.publish(Events.TreasuryInflowReconciled, {
        inflowId: r.id, ref: r.ref, periodKey: r.periodKey,
        amountToTreasury: r.amountToTreasury, stream: r.stream,
      });
    }

    await this.rollupPeriod(rows[0].periodKey);

    return { reconciled: rows.length, reportedTotal, settlementTotal: toDbAmount(dto.settlementTotal), matched: true };
  }

  /* ------------------------------------------------------------------ *
   * Outflows — dual control
   * ------------------------------------------------------------------ */

  async proposeOutflow(dto: ProposeOutflowDto, actorId: string): Promise<TreasuryOutflow> {
    if (dto.destination === "staking_pool" && dto.poolId === undefined) {
      throw new BadRequestException("poolId is required when funding a staking pool");
    }
    if (dec(dto.amount).lte(0)) throw new BadRequestException("Amount must be positive");

    const fromReserve = dto.fromReserve === "true";

    /* A reserve draw is explicitly exempt from the revenue ceiling — that is
     * what the reserve is for — but it is recorded as such so the published
     * real-revenue-funded ratio stays honest. */
    const h = fromReserve
      ? await this.headroom(dto.periodKey)
      : await this.assertHeadroom(dto.periodKey, dto.amount, "funding transfer");

    const row = await this.outflows.save(
      this.outflows.create({
        ref: Ref.treasuryOutflow(),
        destination: dto.destination,
        poolId: dto.destination === "staking_pool" ? dto.poolId : null,
        amount: toDbAmount(dto.amount),
        status: "proposed",
        proposedById: actorId,
        headroomAtApproval: h.headroom,
        fromReserve,
        rationale: dto.rationale,
        periodKey: dto.periodKey,
      }),
    );

    await this.audit.record({
      actorId, action: "treasury.outflow.propose", targetType: "treasury_outflow",
      targetId: row.id, reason: dto.rationale, requiredSecondApproval: true,
      after: { amount: row.amount, destination: row.destination, fromReserve, headroom: h.headroom },
    });

    return row;
  }

  /**
   * Adds an approval. Requires OUTFLOW_MIN_APPROVERS distinct approvers, none
   * of whom may be the proposer — the four-eyes rule, enforced rather than
   * documented. Headroom is re-checked at approval time because inflows may
   * have been un-reconciled by a refund since the proposal.
   */
  async approveOutflow(id: string, dto: ApproveOutflowDto, actorId: string): Promise<TreasuryOutflow> {
    const row = await this.outflows.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Outflow not found");
    if (row.status !== "proposed") {
      throw new BadRequestException(`Outflow is ${row.status} and can no longer be approved`);
    }
    if (row.proposedById === actorId) {
      throw new ForbiddenException({
        code: "FOUR_EYES_VIOLATION",
        message: "You proposed this transfer and therefore cannot approve it",
      });
    }

    const approvers = new Set(row.approvedByIds ?? []);
    if (approvers.has(actorId)) {
      throw new BadRequestException("You have already approved this transfer");
    }
    approvers.add(actorId);
    row.approvedByIds = [...approvers];

    if (!row.fromReserve) {
      const h = await this.assertHeadroom(row.periodKey, row.amount, "funding transfer");
      row.headroomAtApproval = h.headroom;
    }

    const enough = row.approvedByIds.length >= OUTFLOW_MIN_APPROVERS;
    if (enough) {
      row.status = "approved";
      row.approvedAt = new Date();
    }
    const saved = await this.outflows.save(row);

    await this.audit.record({
      actorId, action: "treasury.outflow.approve", targetType: "treasury_outflow",
      targetId: id, reason: dto.note, requiredSecondApproval: true, approvedById: actorId,
      after: { approvers: row.approvedByIds, status: saved.status },
    });

    if (enough) {
      await this.bus.publish(Events.TreasuryOutflowApproved, {
        outflowId: saved.id, ref: saved.ref, destination: saved.destination,
        poolId: saved.poolId, amount: saved.amount, periodKey: saved.periodKey,
        fromReserve: saved.fromReserve,
      });
    }
    return saved;
  }

  /** Called by the chain module once the funding transaction confirms. */
  async markOutflowConfirmed(id: string, txHash: string, blockNumber: number): Promise<void> {
    await this.outflows.update({ id }, { status: "confirmed", txHash, blockNumber });
    const row = await this.outflows.findOne({ where: { id } });
    if (row) {
      await this.rollupPeriod(row.periodKey);
      await this.bus.publish(Events.TreasuryOutflowConfirmed, {
        outflowId: id, ref: row.ref, txHash, destination: row.destination,
        poolId: row.poolId, amount: row.amount, periodKey: row.periodKey,
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Period rollup and dashboard
   * ------------------------------------------------------------------ */

  /**
   * Recomputes the period totals and raises an alert as the payout ratio
   * approaches its ceiling. Run by a cron and after every reconciliation.
   */
  async rollupPeriod(periodKey: string): Promise<TreasuryPeriod> {
    /* One query, through v_treasury_period. This was six aggregate scans, and
     * `dashboard()` calls it on every read — so opening the Treasury screen
     * recomputed and rewrote the period row six queries at a time. The view
     * aggregates; every threshold decision below stays here. */
    const totals = await this.routines.treasuryPeriod(periodKey);
    const reconciled = toDbAmount(totals.reconciledInflow);
    const unreconciled = toDbAmount(totals.unreconciledInflow);
    const commissionOut = toDbAmount(totals.commissionPoolOut);
    const stakingOut = toDbAmount(totals.stakingPoolOut);
    const reserveOut = toDbAmount(totals.reserveOut);
    const gross = fiat(totals.grossRevenue);

    const totalOut = add(commissionOut, stakingOut);
    const payoutRatioBps = dec(reconciled).lte(0)
      ? 0
      : Math.round(dec(totalOut).div(dec(reconciled)).mul(10_000).toNumber());
    const realRevenueFundedBps = dec(totalOut).lte(0)
      ? 10_000
      : Math.round(dec(sub(totalOut, reserveOut)).div(dec(totalOut)).mul(10_000).toNumber());

    let row = await this.periods.findOne({ where: { periodKey } });
    row = row ?? this.periods.create({ periodKey });
    Object.assign(row, {
      grossRevenue: gross,
      reconciledInflow: reconciled,
      unreconciledInflow: unreconciled,
      commissionOutflow: commissionOut,
      stakingOutflow: stakingOut,
      reserveFunded: reserveOut,
      payoutRatioBps,
      realRevenueFundedBps,
      computedAt: new Date(),
    });
    const saved = await this.periods.save(row);

    if (payoutRatioBps >= PAYOUT_RATIO_ALERT_BPS) {
      this.log.warn(`payout ratio ${payoutRatioBps / 100}% for ${periodKey} — at or above alert threshold`);
      await this.bus.publish(Events.PayoutRatioBreach, {
        periodKey, payoutRatioBps, reconciledInflow: reconciled, totalOutflow: totalOut,
        thresholdBps: PAYOUT_RATIO_ALERT_BPS,
      });
    }
    return saved;
  }

  async dashboard(periodKey?: string): Promise<TreasuryDashboardResponse> {
    const period = periodKey ?? monthKey();
    const rollup = await this.rollupPeriod(period);

    const totalOutflow = add(rollup.commissionOutflow, rollup.stakingOutflow);
    const headroom = sub(rollup.reconciledInflow, totalOutflow);

    const byStreamRaw = await this.inflows
      .createQueryBuilder("i")
      .select("i.stream", "stream")
      .addSelect("COALESCE(SUM(i.grossRevenue), 0)", "gross")
      .addSelect("COALESCE(SUM(i.amountToTreasury), 0)", "toTreasury")
      .where("i.periodKey = :period", { period })
      .groupBy("i.stream")
      .getRawMany<{ stream: string; gross: string; toTreasury: string }>();

    const [unreconciledCount, mismatchCount] = await Promise.all([
      this.inflows.count({ where: { periodKey: period, reconciled: false } }),
      this.inflows
        .createQueryBuilder("i")
        .where("i.periodKey = :period", { period })
        .andWhere("i.reconciliationNote IS NOT NULL")
        .getCount(),
    ]);

    const bps = rollup.payoutRatioBps;
    const ratioBand: TreasuryDashboardResponse["ratioBand"] =
      bps >= 10_000 ? "breach" : bps >= 9_000 ? "escalate" : bps >= 7_500 ? "watch" : "safe";

    return {
      periodKey: period,
      reconciledInflow: rollup.reconciledInflow,
      unreconciledInflow: rollup.unreconciledInflow,
      commissionOutflow: rollup.commissionOutflow,
      stakingOutflow: rollup.stakingOutflow,
      totalOutflow,
      headroom,
      payoutRatioBps: bps,
      realRevenueFundedBps: rollup.realRevenueFundedBps,
      ratioBand,
      reserveFunded: rollup.reserveFunded,
      byStream: byStreamRaw.map((r) => ({
        stream: r.stream,
        gross: toDbAmount(r.gross),
        toTreasury: toDbAmount(r.toTreasury),
      })),
      unreconciledCount,
      mismatchCount,
    };
  }

  /* ------------------------------------------------------------------ *
   * Lists
   * ------------------------------------------------------------------ */

  async listInflows(q: InflowQuery): Promise<Paginated<TreasuryInflow>> {
    const qb = this.inflows.createQueryBuilder("i");
    if (q.stream) qb.andWhere("i.stream = :stream", { stream: q.stream });
    if (q.periodKey) qb.andWhere("i.periodKey = :period", { period: q.periodKey });
    if (q.reconciled) qb.andWhere("i.reconciled = :rec", { rec: q.reconciled === "true" });
    if (q.from && q.to) qb.andWhere("i.createdAt BETWEEN :from AND :to", { from: q.from, to: q.to });
    qb.orderBy("i.createdAt", q.sortDir).skip(q.skip).take(q.limit);
    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, q);
  }

  async listOutflows(q: OutflowQuery): Promise<Paginated<TreasuryOutflow>> {
    const qb = this.outflows.createQueryBuilder("o");
    if (q.destination) qb.andWhere("o.destination = :d", { d: q.destination });
    if (q.status) qb.andWhere("o.status = :s", { s: q.status });
    if (q.periodKey) qb.andWhere("o.periodKey = :p", { p: q.periodKey });
    qb.orderBy("o.createdAt", q.sortDir).skip(q.skip).take(q.limit);
    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, q);
  }

  /* ------------------------------------------------------------------ *
   * Sums
   * ------------------------------------------------------------------ */

  private async sumInflow(periodKey: string, reconciled: boolean): Promise<string> {
    const r = await this.inflows
      .createQueryBuilder("i")
      .select("COALESCE(SUM(i.amountToTreasury), 0)", "sum")
      .where("i.periodKey = :periodKey", { periodKey })
      .andWhere("i.reconciled = :reconciled", { reconciled })
      .getRawOne<{ sum: string }>();
    return toDbAmount(r?.sum ?? 0);
  }

  private async sumOutflow(periodKey: string, destination?: "staking_pool" | "commission_pool"): Promise<string> {
    const qb = this.outflows
      .createQueryBuilder("o")
      .select("COALESCE(SUM(o.amount), 0)", "sum")
      .where("o.periodKey = :periodKey", { periodKey })
      /* Proposed transfers are excluded; only committed money counts against
       * the ceiling, otherwise an abandoned proposal blocks real funding. */
      .andWhere("o.status IN (:...statuses)", { statuses: ["approved", "submitted", "confirmed"] });
    if (destination) qb.andWhere("o.destination = :destination", { destination });
    const r = await qb.getRawOne<{ sum: string }>();
    return toDbAmount(r?.sum ?? 0);
  }

  /* sumReserveOutflow and sumGrossRevenue used to live here. They are now two
   * columns of v_treasury_period — deleted rather than left in place, because a
   * second implementation of a total nobody calls is the one that gets edited by
   * mistake later. */
}
