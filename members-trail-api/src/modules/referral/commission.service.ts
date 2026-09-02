import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import {
  Commission, CommissionCapUsage, CommissionPlan, GameSession, ReferralEdge, RevenueEvent,
  TreasuryOutflow, User, UserBalance, type CommissionStatus, type CommissionTrigger,
} from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { EventBusService, Events } from "@/events";
import { RedisService } from "@/common/redis/redis.service";
import { paginate, safeSort, type Paginated } from "@/common/dto";
import {
  add, anonLabel, applyBps, clampToHeadroom, dec, fiat, gt, monthKey, mul, Ref,
  sub, toDbAmount, trailingMonths,
} from "@/common/utils";
import { AuditService } from "@/modules/audit/audit.service";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import { CommissionPlanService, streamToTrigger } from "./commission-plan.service";
import {
  MAX_DEPTH, type AdminCommissionQuery, type CapMeterResponse, type ClaimCommissionResponse,
  type CommissionEarningsResponse, type CommissionQuery, type CommissionResponse,
  type SolvencyResponse,
} from "./dto/commission.dto";

/* ============================================================================
 * The referral commission engine.
 *
 * This is the module a regulator reads first, so every rule it enforces is
 * written here in the order it is applied, with the reason it exists:
 *
 *  1. COMMISSION COMES ONLY FROM SETTLED, RECONCILED, COMMISSION-ELIGIBLE
 *     REVENUE. The `commissions.revenueEventId` FK is non-nullable, so a
 *     commission with no real purchase behind it cannot physically be recorded.
 *     Unreconciled revenue is refused, not queued optimistically: the whole
 *     point of reconciliation is that we do not yet know the money arrived.
 *
 *  2. CALCULATED ON NET, NEVER GROSS. Processor fees never left the member's
 *     pocket into ours; paying commission on them pays out money we never had.
 *
 *  3. DEPTH CAPS AT 3. Enforced by the plan, by this engine, and by the schema.
 *     There is no level 4 to enable.
 *
 *  4. A MONTHLY CAP PER RECIPIENT, and the excess is NEVER CARRIED OVER.
 *     cap = min(absolute, multiplier × trailing-3-month own spend + base).
 *     Carrying the excess forward would turn a cap into a deferral, which is
 *     exactly the unbounded-earnings promise the cap exists to prevent.
 *
 *  5. THE SOLVENCY INVARIANT: cumulative commission RELEASED never exceeds
 *     cumulative confirmed Treasury funding of the commission pool. A commission
 *     that cannot be funded is calculated and QUEUED, never released. This is the
 *     backend mirror of the on-chain `totalRecorded <= totalDeposited` check, and
 *     it is what makes "paid from real revenue" a fact rather than a claim.
 *
 *  6. ANTI-ABUSE BEFORE ARITHMETIC. Self-referral, referral loops, immature
 *     accounts and accounts with no genuine gameplay are refused with a recorded
 *     reason — a rejected row, not a silent absence, so compliance can see the
 *     engine considered them.
 *
 *  7. A REFUND CLAWS BACK. Reversing the revenue reverses the commission, and
 *     returns the cap allowance it consumed, because the purchase never happened.
 *
 * Nothing here writes a balance except through LedgerService.
 * ========================================================================== */

const SORT_COLUMNS = ["createdAt", "amount", "level", "status"] as const;

/** Trailing window the cap's spend component is measured over (FRD R-04). */
const CAP_TRAILING_MONTHS = 3;

const CAP_LOCK_TTL_SECONDS = 20;

/** How long a cap application waits its turn. Well inside the lock's own TTL. */
const CAP_LOCK_WAIT_MS = 10_000;
const CLAIM_LOCK_TTL_SECONDS = 20;

/** Statuses that represent a real, funded obligation against the pool. */
const COMMITTED_STATUSES: CommissionStatus[] = ["released", "claimed"];

/** Statuses whose amount still counts against the recipient's monthly cap. */
const CAP_CONSUMING_STATUSES: CommissionStatus[] = [
  "pending_kyc", "queued", "released", "claimed",
];

export interface FanoutOutcome {
  revenueEventId: string;
  processed: boolean;
  /** Set when nothing was calculated, with the machine-readable reason. */
  skipped?: string;
  created: number;
  released: number;
  queued: number;
  pendingKyc: number;
  capped: number;
  rejected: number;
  totalPayableFiat: string;
  totalPayableMtt: string;
}

interface Candidate {
  recipient: User;
  level: 1 | 2 | 3;
  rateBps: number;
}

@Injectable()
export class CommissionService {
  private readonly log = new Logger(CommissionService.name);

  constructor(
    @InjectRepository(Commission) private readonly commissions: Repository<Commission>,
    @InjectRepository(CommissionCapUsage) private readonly capUsage: Repository<CommissionCapUsage>,
    @InjectRepository(ReferralEdge) private readonly edges: Repository<ReferralEdge>,
    @InjectRepository(RevenueEvent) private readonly revenue: Repository<RevenueEvent>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(GameSession) private readonly sessions: Repository<GameSession>,
    @InjectRepository(TreasuryOutflow) private readonly outflows: Repository<TreasuryOutflow>,
    private readonly plans: CommissionPlanService,
    private readonly ledger: LedgerService,
    private readonly bus: EventBusService,
    private readonly redis: RedisService,
    private readonly config: EconomyConfigService,
    private readonly audit: AuditService,
    private readonly routines: DbRoutinesService,
  ) {}

  /* ==================================================================== *
   * The engine
   * ==================================================================== */

  /**
   * Fans one settled revenue event out to its upline.
   *
   * Called by the Commission queue processor. Idempotent three ways: the event's
   * `commissionProcessedAt` stamp, the UNIQUE(revenueEventId, recipientId) index,
   * and the ledger's own idempotency keys.
   */
  async processRevenueEvent(revenueEventId: string): Promise<FanoutOutcome> {
    const event = await this.revenue.findOne({ where: { id: revenueEventId } });
    if (!event) throw new NotFoundException(`Revenue event ${revenueEventId} not found`);

    const empty = (skipped?: string): FanoutOutcome => ({
      revenueEventId,
      processed: false,
      skipped,
      created: 0, released: 0, queued: 0, pendingKyc: 0, capped: 0, rejected: 0,
      totalPayableFiat: fiat(0),
      totalPayableMtt: toDbAmount(0),
    });

    if (event.commissionProcessedAt) return empty("ALREADY_PROCESSED");
    if (event.reversedAt) return empty("EVENT_REVERSED");

    /* Rule 1. Not a queueing decision — a refusal. */
    if (!event.reconciled) return empty("NOT_RECONCILED");
    if (!event.commissionEligible) return empty("NOT_COMMISSION_ELIGIBLE");

    const trigger = streamToTrigger(event.stream);
    if (!trigger) return empty("STREAM_NOT_COMMISSIONABLE");

    const plan = await this.plans.active();
    if (!plan) {
      /* No approved plan means no approved rates. The event is left unprocessed
       * on purpose so it can be fanned out once a plan exists — refusing is
       * right, losing the revenue event is not. */
      this.log.error(`no active commission plan — revenue event ${event.ref} left unprocessed`);
      return empty("NO_ACTIVE_PLAN");
    }
    if (!plan.eligibleTriggers.includes(trigger)) return empty("TRIGGER_NOT_IN_PLAN");

    const candidates = await this.resolveUpline(event, plan);
    const month = monthKey(event.occurredAt);
    const fiatPerMtt = await this.referencePrice();

    const outcome: FanoutOutcome = {
      revenueEventId,
      processed: true,
      created: 0, released: 0, queued: 0, pendingKyc: 0, capped: 0, rejected: 0,
      totalPayableFiat: fiat(0),
      totalPayableMtt: toDbAmount(0),
    };

    for (const candidate of candidates) {
      const rejection = await this.screen(candidate, event, plan);
      if (rejection) {
        await this.recordRejected(candidate, event, trigger, month, rejection);
        outcome.rejected += 1;
        outcome.created += 1;
        continue;
      }

      /* Rule 2: NET. */
      const gross = fiat(applyBps(event.netAmount, candidate.rateBps));

      /* Rule 4: per-recipient monthly cap, serialised so two events for two
       * different downlines of the same recipient cannot both spend the same
       * remaining allowance. */
      const result = await this.redis.withLock(
        `commission:cap:${candidate.recipient.id}:${month}`,
        CAP_LOCK_TTL_SECONDS,
        () => this.applyCapAndRecord({ candidate, event, trigger, month, gross, fiatPerMtt, plan }),
        /* Wait for a turn rather than failing on contention. Two purchases by two
         * downlines of the SAME sponsor land together routinely, and each holder
         * finishes in milliseconds — so the throw below should be reserved for a
         * lock that is genuinely wedged, not for normal traffic. Without the wait
         * an operator processing a batch by hand got a 409 per collision, and the
         * queue spent its retry budget on work that only needed to queue. */
        { waitMs: CAP_LOCK_WAIT_MS },
      );

      if (result === null) {
        /* Still contended after the wait. Throwing lets the queue retry rather
         * than silently skipping someone's commission — but the message must not
         * claim to be retrying, because this call is not: it is telling its
         * caller to. The old wording said "retrying" and an operator driving this
         * by hand reasonably read that as "it will sort itself out". */
        throw new ConflictException({
          code: "CAP_LOCK_CONTENDED",
          message:
            `Another commission is still being applied against ${candidate.recipient.id}'s ` +
            `${month} cap after waiting ${CAP_LOCK_WAIT_MS}ms. Nothing was recorded for this ` +
            `event — retry it.`,
        });
      }

      outcome.created += 1;
      outcome.totalPayableFiat = fiat(add(outcome.totalPayableFiat, result.amount));
      outcome.totalPayableMtt = add(outcome.totalPayableMtt, result.amountMtt);
      if (result.status === "capped") outcome.capped += 1;
      else if (result.status === "released") outcome.released += 1;
      else if (result.status === "queued") outcome.queued += 1;
      else if (result.status === "pending_kyc") outcome.pendingKyc += 1;
    }

    /* Stamped last: if anything above threw, the event is reprocessed rather
     * than half-paid and marked done. */
    event.commissionProcessedAt = new Date();
    await this.revenue.save(event);

    this.log.log(
      `event ${event.ref}: ${outcome.created} commission rows ` +
      `(${outcome.released} released, ${outcome.queued} queued, ${outcome.capped} capped, ` +
      `${outcome.rejected} rejected)`,
    );
    return outcome;
  }

  /** Upline up to the plan's depth, hard-capped at 3 (rule 3). */
  private async resolveUpline(event: RevenueEvent, plan: CommissionPlan): Promise<Candidate[]> {
    const depth = Math.min(plan.maxDepth, MAX_DEPTH);
    const edges = await this.edges.find({
      where: { userId: event.userId },
      order: { level: "ASC" },
    });

    const candidates: Candidate[] = [];
    for (const edge of edges) {
      if (edge.level > depth) continue;
      const rateBps = this.plans.rateFor(plan, edge.level);
      if (rateBps <= 0) continue;
      const recipient = await this.users.findOne({ where: { id: edge.ancestorId } });
      if (!recipient) continue;
      candidates.push({ recipient, level: edge.level, rateBps });
    }
    return candidates;
  }

  /**
   * Anti-abuse screen (rule 6). Returns a rejection reason, or null to proceed.
   *
   * Ordered cheapest-and-most-serious first: an identity problem is a harder
   * refusal than an activity threshold, and finding it first keeps a fraudulent
   * signup from consuming database work.
   */
  private async screen(
    candidate: Candidate,
    event: RevenueEvent,
    plan: CommissionPlan,
  ): Promise<string | null> {
    const { recipient } = candidate;

    if (recipient.id === event.userId) return "SELF_REFERRAL";

    if (recipient.status === "closed" || recipient.status === "suspended") {
      return `RECIPIENT_${recipient.status.toUpperCase()}`;
    }
    if (recipient.status === "frozen") return "RECIPIENT_FROZEN";

    /* A cycle means the "upline" also sits in the spender's downline, which is
     * the shape of a mutual-referral farm. Edges are written once at
     * registration so this should be impossible; asserting it costs one indexed
     * lookup and catches a data-integrity bug before it pays money out. */
    const loop = await this.edges.findOne({
      where: { userId: recipient.id, ancestorId: event.userId },
    });
    if (loop) return "REFERRAL_LOOP";

    const ageDays = (Date.now() - recipient.createdAt.getTime()) / 86_400_000;
    if (ageDays < plan.minAccountAgeDays) return "ACCOUNT_TOO_NEW";

    if (plan.minGameplaySessions > 0) {
      /* Validated sessions only. Counting opened sessions would let a farm
       * satisfy the requirement by starting games it never played. */
      const played = await this.sessions.count({
        where: { userId: recipient.id, status: "validated" },
      });
      if (played < plan.minGameplaySessions) return "INSUFFICIENT_GAMEPLAY";
    }

    return null;
  }

  /**
   * Applies the monthly cap, decides the status against the solvency invariant,
   * and writes the commission row and the balance movement in one commit.
   *
   * Runs under the recipient's cap lock.
   */
  private async applyCapAndRecord(params: {
    candidate: Candidate;
    event: RevenueEvent;
    trigger: CommissionTrigger;
    month: string;
    gross: string;
    fiatPerMtt: string;
    plan: CommissionPlan;
  }): Promise<{ status: CommissionStatus; amount: string; amountMtt: string }> {
    const { candidate, event, trigger, month, gross, fiatPerMtt, plan } = params;

    /* Replay guard before any arithmetic: the UNIQUE index would also catch
     * this, but a duplicate-key error would abort the whole fan-out. */
    const existing = await this.commissions.findOne({
      where: { revenueEventId: event.id, recipientId: candidate.recipient.id },
    });
    if (existing) {
      return {
        status: existing.status,
        amount: fiat(existing.amount),
        amountMtt: toDbAmount(existing.amountMtt),
      };
    }

    const usage = await this.loadCapUsage(candidate.recipient.id, month, plan);
    const headroom = dec(usage.capAmount).minus(dec(usage.usedAmount));
    const { payable, capped } = clampToHeadroom(gross, headroom.isNegative() ? 0 : headroom.toString());

    const amount = fiat(payable);
    const cappedAway = fiat(capped);

    if (dec(amount).lte(0)) {
      /* Fully capped. Recorded rather than dropped, so the recipient can see the
       * cap bit and compliance can see the engine considered it. The excess is
       * NOT carried into next month (rule 4). */
      const row = await this.commissions.save(
        this.commissions.create({
          ref: Ref.commission(),
          recipientId: candidate.recipient.id,
          downlineUserId: event.userId,
          level: candidate.level,
          revenueEventId: event.id,
          triggerType: trigger,
          eligibleSpend: fiat(event.netAmount),
          rateBps: candidate.rateBps,
          amount: fiat(0),
          grossAmount: gross,
          cappedAmount: cappedAway,
          amountMtt: toDbAmount(0),
          status: "capped",
          monthKey: month,
        }),
      );

      usage.cappedAwayAmount = fiat(add(usage.cappedAwayAmount, cappedAway));
      usage.entryCount += 1;
      await this.capUsage.save(usage);

      await this.bus.publish(Events.CommissionCapped, {
        recipientId: candidate.recipient.id,
        ref: row.ref,
        level: candidate.level,
        grossAmount: gross,
        cappedAmount: cappedAway,
        monthKey: month,
        capAmount: usage.capAmount,
        /* Explicit so no consumer ever builds a carry-over feature. */
        carriedOver: false,
      });

      return { status: "capped", amount: fiat(0), amountMtt: toDbAmount(0) };
    }

    const amountMtt = this.toMtt(amount, fiatPerMtt);

    /* Rule 5: the solvency invariant decides whether this can be released now. */
    const kycOk = candidate.recipient.kycTier >= 1;
    const funding = await this.fundingAvailable();
    const fundable = !gt(amountMtt, funding.availableMtt);

    const status: CommissionStatus = !kycOk ? "pending_kyc" : fundable ? "released" : "queued";

    const inflowRef = fundable && kycOk ? await this.latestFundingRef() : null;

    const row = await this.ledger.withUserLock(candidate.recipient.id, async (tx, balance) => {
      const saved = await tx.getRepository(Commission).save(
        tx.getRepository(Commission).create({
          ref: Ref.commission(),
          recipientId: candidate.recipient.id,
          downlineUserId: event.userId,
          level: candidate.level,
          revenueEventId: event.id,
          triggerType: trigger,
          eligibleSpend: fiat(event.netAmount),
          rateBps: candidate.rateBps,
          amount,
          grossAmount: gross,
          cappedAmount: cappedAway,
          amountMtt,
          status,
          monthKey: month,
          treasuryInflowRef: inflowRef,
          releasedAt: status === "released" ? new Date() : null,
        }),
      );

      this.creditBucket(balance, status, amountMtt);
      await tx.getRepository(UserBalance).save(balance);
      return saved;
    });

    usage.usedAmount = fiat(add(usage.usedAmount, amount));
    if (gt(cappedAway, 0)) usage.cappedAwayAmount = fiat(add(usage.cappedAwayAmount, cappedAway));
    usage.entryCount += 1;
    await this.capUsage.save(usage);

    await this.bus.publish(Events.CommissionCalculated, {
      recipientId: candidate.recipient.id,
      ref: row.ref,
      level: candidate.level,
      downlineUserId: event.userId,
      revenueEventId: event.id,
      eligibleSpend: fiat(event.netAmount),
      rateBps: candidate.rateBps,
      amount,
      amountMtt,
      cappedAmount: cappedAway,
      status,
      monthKey: month,
      /* Recorded on the event itself so the audit trail shows commission was
       * computed on net, not gross. */
      calculatedOn: "netAmount",
    });

    if (status === "released") {
      await this.bus.publish(Events.CommissionReleased, {
        recipientId: candidate.recipient.id,
        ref: row.ref,
        amountMtt,
        treasuryInflowRef: inflowRef,
      });
    }
    if (status === "queued") {
      this.log.warn(
        `commission ${row.ref} queued: pool funding short by ` +
        `${sub(amountMtt, funding.availableMtt)} MTT`,
      );
    }

    return { status, amount, amountMtt };
  }

  /** Records a screened-out candidate, so a refusal is visible rather than absent. */
  private async recordRejected(
    candidate: Candidate,
    event: RevenueEvent,
    trigger: CommissionTrigger,
    month: string,
    reason: string,
  ): Promise<void> {
    const existing = await this.commissions.findOne({
      where: { revenueEventId: event.id, recipientId: candidate.recipient.id },
    });
    if (existing) return;

    await this.commissions.save(
      this.commissions.create({
        ref: Ref.commission(),
        recipientId: candidate.recipient.id,
        downlineUserId: event.userId,
        level: candidate.level,
        revenueEventId: event.id,
        triggerType: trigger,
        eligibleSpend: fiat(event.netAmount),
        rateBps: candidate.rateBps,
        amount: fiat(0),
        grossAmount: fiat(applyBps(event.netAmount, candidate.rateBps)),
        cappedAmount: fiat(0),
        amountMtt: toDbAmount(0),
        status: "rejected",
        monthKey: month,
        rejectionReason: reason,
      }),
    );

    this.log.debug(`commission rejected for ${candidate.recipient.id} on ${event.ref}: ${reason}`);
  }

  /* ==================================================================== *
   * Caps
   * ==================================================================== */

  /**
   * The recipient's cap row for a month, created on demand.
   *
   * The cap is recomputed from trailing spend each time the row is first
   * created; once created it is stable for the month, so a member's ceiling
   * cannot move under them mid-month by their own further spending.
   */
  private async loadCapUsage(
    userId: string,
    month: string,
    plan: CommissionPlan,
  ): Promise<CommissionCapUsage> {
    const existing = await this.capUsage.findOne({ where: { userId, monthKey: month } });
    if (existing) return existing;

    const trailingSpend = await this.trailingOwnSpend(userId);
    const capAmount = this.computeCap(plan, trailingSpend);

    return this.capUsage.save(
      this.capUsage.create({
        userId,
        monthKey: month,
        capAmount,
        usedAmount: fiat(0),
        cappedAwayAmount: fiat(0),
        trailingSpend,
        entryCount: 0,
      }),
    );
  }

  /** cap = min(absolute, multiplier × trailing-3-month own spend + base). */
  computeCap(plan: CommissionPlan, trailingSpend: string): string {
    const spendComponent = add(mul(trailingSpend, plan.capMultiplier), plan.capBase);
    const absolute = plan.monthlyCapAbsolute;
    return fiat(gt(spendComponent, absolute) ? absolute : spendComponent);
  }

  /**
   * The recipient's OWN reconciled net spend over the trailing window.
   *
   * `trailingMonths` returns a half-open [first-of-month-N-ago, first-of-this-month)
   * range, and the upper bound has to be applied. Using only `start` left the
   * window running up to today, i.e. INCLUDING the month whose cap it sets — so
   * a member with no prior spend could buy ₹2,000 of IAP on the 1st and lift
   * their own September ceiling from ₹100 to ₹10,100 in the same month, which is
   * exactly what the comment on the cap claims cannot happen.
   */
  private async trailingOwnSpend(userId: string): Promise<string> {
    const { start, end } = trailingMonths(CAP_TRAILING_MONTHS);
    const raw = await this.revenue
      .createQueryBuilder("e")
      .select("COALESCE(SUM(e.netAmount), 0)", "sum")
      .where("e.userId = :userId", { userId })
      .andWhere("e.reconciled = true")
      .andWhere("e.reversedAt IS NULL")
      .andWhere("e.occurredAt >= :start", { start })
      .andWhere("e.occurredAt < :end", { end })
      .getRawOne<{ sum: string | null }>();
    return fiat(raw?.sum ?? 0);
  }

  /** The recipient-facing cap meter (FRD R-04). */
  async capMeter(userId: string, month = monthKey()): Promise<CapMeterResponse> {
    const plan = await this.plans.active();
    if (!plan) {
      throw new ConflictException({
        code: "NO_ACTIVE_PLAN",
        message: "No approved commission plan is in force",
      });
    }

    const existing = await this.capUsage.findOne({ where: { userId, monthKey: month } });
    const trailingSpend = existing?.trailingSpend ?? (await this.trailingOwnSpend(userId));
    const capAmount = existing?.capAmount ?? this.computeCap(plan, trailingSpend);
    const usedAmount = existing?.usedAmount ?? fiat(0);

    return {
      monthKey: month,
      capAmount: fiat(capAmount),
      usedAmount: fiat(usedAmount),
      remainingAmount: fiat(
        dec(capAmount).minus(dec(usedAmount)).isNegative() ? 0 : sub(capAmount, usedAmount),
      ),
      cappedAwayAmount: fiat(existing?.cappedAwayAmount ?? 0),
      trailingSpend: fiat(trailingSpend),
      entryCount: existing?.entryCount ?? 0,
      absoluteCap: fiat(plan.monthlyCapAbsolute),
      capMultiplier: plan.capMultiplier,
      capBase: fiat(plan.capBase),
    };
  }

  /* ==================================================================== *
   * Solvency
   * ==================================================================== */

  /**
   * The invariant (rule 5).
   *
   * `funded` counts CONFIRMED commission-pool outflows only — an approved but
   * unsubmitted transfer is not money in the pool. `committed` counts released
   * and claimed commission. Queued and pending_kyc rows are liabilities, not
   * commitments, and are reported separately so the gap is visible.
   */
  async fundingAvailable(): Promise<SolvencyResponse> {
    /* One query, through v_commission_solvency. This used to be four sequential
     * aggregate scans, and it is called once per commission row during a
     * three-level fan-out — so a single revenue event cost a dozen full scans.
     * The view aggregates; the invariant below is still decided here. */
    const solvency = await this.routines.commissionSolvency();
    const funded = solvency.poolFundedMtt;
    const committed = solvency.committedMtt;
    const queued = solvency.queuedMtt;
    const pendingKyc = solvency.pendingKycMtt;

    const available = dec(funded).minus(dec(committed));

    return {
      poolFundedMtt: funded,
      committedMtt: committed,
      availableMtt: available.isNegative() ? toDbAmount(0) : toDbAmount(available),
      queuedMtt: queued,
      pendingKycMtt: pendingKyc,
      solvent: !available.isNegative(),
    };
  }

  private async sumConfirmedPoolFunding(): Promise<string> {
    const raw = await this.outflows
      .createQueryBuilder("o")
      .select("COALESCE(SUM(o.amount), 0)", "sum")
      .where("o.destination = :destination", { destination: "commission_pool" })
      /* Confirmed only: an approved transfer that has not landed cannot fund a
       * payout, and treating it as funding is how a pool goes overdrawn. */
      .andWhere("o.status = :status", { status: "confirmed" })
      .getRawOne<{ sum: string | null }>();
    return toDbAmount(raw?.sum ?? 0);
  }

  private async sumCommissionMtt(statuses: CommissionStatus[]): Promise<string> {
    const raw = await this.commissions
      .createQueryBuilder("c")
      .select("COALESCE(SUM(c.amountMtt), 0)", "sum")
      .where("c.status IN (:...statuses)", { statuses })
      .getRawOne<{ sum: string | null }>();
    return toDbAmount(raw?.sum ?? 0);
  }

  private async latestFundingRef(): Promise<string | null> {
    const row = await this.outflows.findOne({
      where: { destination: "commission_pool", status: "confirmed" },
      order: { createdAt: "DESC" },
    });
    return row?.ref ?? null;
  }

  /* ==================================================================== *
   * Release
   * ==================================================================== */

  /**
   * Releases queued commission, oldest first, while the pool can fund it.
   *
   * Called after a commission-pool funding is confirmed. Oldest-first is a
   * deliberate fairness choice: the alternative — largest-first, or unordered —
   * lets a late large earner jump a queue of small ones.
   */
  async releaseQueued(limit = 500): Promise<{ released: number; releasedMtt: string; remaining: number }> {
    const funding = await this.fundingAvailable();
    let available = dec(funding.availableMtt);
    if (available.lte(0)) {
      const remaining = await this.commissions.count({ where: { status: "queued" } });
      return { released: 0, releasedMtt: toDbAmount(0), remaining };
    }

    const rows = await this.commissions.find({
      where: { status: "queued" },
      order: { createdAt: "ASC" },
      take: Math.min(limit, 2_000),
    });

    const inflowRef = await this.latestFundingRef();
    let released = 0;
    let releasedMtt = toDbAmount(0);

    for (const row of rows) {
      if (dec(row.amountMtt).gt(available)) continue;

      /* A recipient whose KYC lapsed since calculation must not be released. */
      const recipient = await this.users.findOne({ where: { id: row.recipientId } });
      if (!recipient || recipient.kycTier < 1) {
        row.status = "pending_kyc";
        await this.commissions.save(row);
        continue;
      }

      if (!(await this.moveToReleased(row, inflowRef))) continue;
      available = available.minus(dec(row.amountMtt));
      releasedMtt = add(releasedMtt, row.amountMtt);
      released += 1;
    }

    const remaining = await this.commissions.count({ where: { status: "queued" } });
    if (released > 0) {
      this.log.log(`released ${released} queued commissions (${releasedMtt} MTT), ${remaining} still waiting`);
    }
    return { released, releasedMtt: toDbAmount(releasedMtt), remaining };
  }

  /**
   * Releases a recipient's commission that was held for KYC.
   *
   * Called when a KYC approval lands. Still subject to the solvency invariant:
   * clearing KYC does not conjure pool funding, so an unfundable row moves to
   * `queued`, not `released`.
   */
  async releaseForKyc(userId: string): Promise<{ released: number; queued: number }> {
    const recipient = await this.users.findOne({ where: { id: userId } });
    if (!recipient || recipient.kycTier < 1) return { released: 0, queued: 0 };

    const rows = await this.commissions.find({
      where: { recipientId: userId, status: "pending_kyc" },
      order: { createdAt: "ASC" },
    });
    if (rows.length === 0) return { released: 0, queued: 0 };

    const funding = await this.fundingAvailable();
    let available = dec(funding.availableMtt);
    const inflowRef = await this.latestFundingRef();

    let released = 0;
    let queued = 0;

    for (const row of rows) {
      if (dec(row.amountMtt).lte(available)) {
        await this.moveToReleased(row, inflowRef);
        available = available.minus(dec(row.amountMtt));
        released += 1;
      } else {
        /* Bucket stays commissionPending; only the status changes. */
        row.status = "queued";
        await this.commissions.save(row);
        queued += 1;
      }
    }

    return { released, queued };
  }

  /**
   * pending → available, atomically with the status change.
   *
   * The row is re-read FOR UPDATE inside the lock because `releaseQueued` has
   * four independent callers — the ten-minute cron, the CommissionPoolFunded
   * handler, the ReleaseCommission job and an admin endpoint — none of which
   * share a lock. Two of them selecting the same queued row both called this and
   * both credited: commissionAvailable went 0 -> 6 -> 12 while commissionPending
   * floored at 0. One commission row, twice the money, and the solvency view
   * could not see it because `committedMtt` still counted one row.
   */
  private async moveToReleased(row: Commission, inflowRef: string | null): Promise<boolean> {
    let applied = false;
    await this.ledger.withUserLock(row.recipientId, async (tx, balance) => {
      const fresh = await tx.getRepository(Commission).findOne({
        where: { id: row.id },
        lock: { mode: "pessimistic_write" },
      });
      if (!fresh || fresh.status !== "queued") {
        this.log.warn(`release skipped for ${row.ref}: already ${fresh?.status ?? "missing"}`);
        return;
      }
      applied = true;

      balance.commissionPending = nonNegative(sub(balance.commissionPending, row.amountMtt));
      balance.commissionAvailable = add(balance.commissionAvailable, row.amountMtt);
      /* Lifetime is monotonic: it records what was ever earned, and a later
       * clawback does not erase the fact that it was credited. */
      balance.commissionLifetime = add(balance.commissionLifetime, row.amountMtt);
      balance.lastLedgerAt = new Date();
      await tx.getRepository(UserBalance).save(balance);

      row.status = "released";
      row.releasedAt = new Date();
      row.treasuryInflowRef = row.treasuryInflowRef ?? inflowRef;
      await tx.getRepository(Commission).save(row);
    });

    if (!applied) return false;

    await this.bus.publish(Events.CommissionReleased, {
      recipientId: row.recipientId,
      ref: row.ref,
      amountMtt: toDbAmount(row.amountMtt),
      treasuryInflowRef: row.treasuryInflowRef ?? null,
    });
    return true;
  }

  /* ==================================================================== *
   * Claim
   * ==================================================================== */

  /**
   * Moves all released commission into the spendable balance.
   *
   * One transaction row for the whole claim rather than one per commission: the
   * member made one movement, and a statement full of dust entries is harder to
   * reconcile, not easier.
   */
  async claim(userId: string): Promise<ClaimCommissionResponse> {
    const result = await this.redis.withLock(
      `commission:claim:${userId}`,
      CLAIM_LOCK_TTL_SECONDS,
      () => this.claimUnderLock(userId),
    );
    if (result === null) {
      throw new ConflictException({
        code: "CLAIM_IN_FLIGHT",
        message: "A commission claim is already being processed for this account",
      });
    }
    return result;
  }

  private async claimUnderLock(userId: string): Promise<ClaimCommissionResponse> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("Account not found");
    if (user.kycTier < 1) {
      throw new ConflictException({
        code: "KYC_REQUIRED",
        message: "Identity verification is required before claiming commission",
      });
    }

    const rows = await this.commissions.find({
      where: { recipientId: userId, status: "released" },
      order: { createdAt: "ASC" },
      take: 1_000,
    });

    const pendingMtt = await this.sumRecipientMtt(userId, ["queued", "pending_kyc"]);

    if (rows.length === 0) {
      return {
        claimedMtt: toDbAmount(0),
        entries: 0,
        remainingPendingMtt: pendingMtt,
        transactionRef: null,
      };
    }

    const total = rows.reduce((acc, r) => add(acc, r.amountMtt), toDbAmount(0));
    const claimedAt = new Date();

    /* One atomic bucket move for the total, then the rows are marked claimed in
     * the same commit. */
    const { row: transaction } = await this.ledger.transferBucket({
      userId,
      from: "commissionAvailable",
      to: "available",
      amount: total,
      type: "commission_claim",
      /* Derived from the claimed set, so a retry with the same set resolves to
       * the same transaction instead of paying twice. */
      idempotencyKey: `commission-claim:${userId}:${rows[rows.length - 1].id}`,
      note: `Claimed ${rows.length} commission entries`,
      metadata: { entries: rows.length, refs: rows.map((r) => r.ref).slice(0, 50) },
    });

    await this.commissions.update(
      { id: In(rows.map((r) => r.id)) },
      { status: "claimed", claimedAt, txHash: null },
    );

    await this.bus.publish(Events.CommissionClaimed, {
      recipientId: userId,
      amountMtt: total,
      entries: rows.length,
      transactionRef: transaction.ref,
    });

    return {
      claimedMtt: total,
      entries: rows.length,
      remainingPendingMtt: pendingMtt,
      transactionRef: transaction.ref,
    };
  }

  /* ==================================================================== *
   * Clawback
   * ==================================================================== */

  /**
   * Reverses every commission generated by a revenue event (rule 7).
   *
   * Called when a purchase is refunded or charged back. Three things happen for
   * each row, and the third is the one people forget: the cap allowance the
   * commission consumed is returned, because the purchase that justified it
   * never really happened and the member should not lose the headroom for it.
   *
   * If the funds have already been claimed and spent, the shortfall is recorded
   * and a fraud alert raised rather than forcing the balance negative — a
   * negative balance is not a debt collection mechanism, it is a corrupt ledger.
   */
  async clawbackForRevenueEvent(
    revenueEventId: string,
    reason: string,
    actorId?: string,
  ): Promise<{ clawedBack: number; recoveredMtt: string; shortfallMtt: string }> {
    const rows = await this.commissions.find({
      where: {
        revenueEventId,
        status: In(["pending_kyc", "queued", "released", "claimed"] as CommissionStatus[]),
      },
    });

    let recovered = toDbAmount(0);
    let shortfall = toDbAmount(0);

    for (const row of rows) {
      const outcome = await this.clawbackRow(row, reason);
      recovered = add(recovered, outcome.recovered);
      shortfall = add(shortfall, outcome.shortfall);

      await this.audit.recordOrThrow({
        actorId: actorId ?? null,
        action: "commission.clawback",
        targetType: "commission",
        targetId: row.id,
        before: { status: row.status, amountMtt: toDbAmount(row.amountMtt) },
        after: { status: "clawed_back", recovered: outcome.recovered, shortfall: outcome.shortfall },
        reason,
      });
    }

    if (gt(shortfall, 0)) {
      /* The money is gone. Someone has to look at it. */
      await this.bus.publish(Events.FraudAlertRaised, {
        kind: "commission_clawback_shortfall",
        revenueEventId,
        shortfallMtt: toDbAmount(shortfall),
        reason,
        severity: "high",
      });
    }

    return {
      clawedBack: rows.length,
      recoveredMtt: toDbAmount(recovered),
      shortfallMtt: toDbAmount(shortfall),
    };
  }

  private async clawbackRow(
    row: Commission,
    reason: string,
  ): Promise<{ recovered: string; shortfall: string }> {
    const amount = toDbAmount(row.amountMtt);
    const previousStatus = row.status;

    const outcome = await this.ledger.withUserLock(row.recipientId, async (tx, balance) => {
      let recovered = toDbAmount(0);
      let remaining = dec(amount);

      const take = (field: "commissionPending" | "commissionAvailable" | "mttAvailable"): void => {
        if (remaining.lte(0)) return;
        const held = dec(String(balance[field] ?? 0));
        const taken = held.gte(remaining) ? remaining : held;
        if (taken.lte(0)) return;
        (balance[field]) = sub(String(balance[field] ?? 0), taken.toString());
        recovered = add(recovered, taken.toString());
        remaining = remaining.minus(taken);
      };

      /* Reclaim from the least-liquid bucket first: unreleased accrual, then
       * released-but-unclaimed, and only then the spendable balance. */
      if (previousStatus === "pending_kyc" || previousStatus === "queued") take("commissionPending");
      if (previousStatus === "released") take("commissionAvailable");
      if (previousStatus === "claimed") {
        take("mttAvailable");
        /* A claimed commission may have been re-credited elsewhere; sweep the
         * commission buckets too rather than declaring a shortfall early. */
        take("commissionAvailable");
        take("commissionPending");
      }

      balance.lastLedgerAt = new Date();
      await tx.getRepository(UserBalance).save(balance);

      row.status = "clawed_back";
      row.clawedBackAt = new Date();
      row.clawbackReason = remaining.lte(0)
        ? reason.slice(0, 255)
        : `${reason} (shortfall ${remaining.toString()} MTT)`.slice(0, 255);
      await tx.getRepository(Commission).save(row);

      return { recovered, shortfall: remaining.lte(0) ? toDbAmount(0) : toDbAmount(remaining) };
    });

    /* Return the cap allowance: the purchase never happened. */
    if (CAP_CONSUMING_STATUSES.includes(previousStatus) && gt(row.amount, 0)) {
      const usage = await this.capUsage.findOne({
        where: { userId: row.recipientId, monthKey: row.monthKey },
      });
      if (usage) {
        usage.usedAmount = fiat(nonNegativeFiat(sub(usage.usedAmount, row.amount)));
        await this.capUsage.save(usage);
      }
    }

    await this.bus.publish(Events.CommissionClawedBack, {
      recipientId: row.recipientId,
      ref: row.ref,
      amountMtt: amount,
      previousStatus,
      recoveredMtt: outcome.recovered,
      shortfallMtt: outcome.shortfall,
      reason,
    });

    return outcome;
  }

  /** Compliance-initiated clawback of a single commission (fraud finding). */
  async clawbackOne(id: string, reason: string, actorId: string): Promise<CommissionResponse> {
    const row = await this.commissions.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Commission not found");
    if (row.status === "clawed_back" || row.status === "rejected" || row.status === "capped") {
      throw new BadRequestException({
        code: "NOT_CLAWABLE",
        message: `A commission that is ${row.status} has nothing to reclaim`,
      });
    }

    await this.clawbackRow(row, reason);
    await this.audit.recordOrThrow({
      actorId,
      action: "commission.clawback.manual",
      targetType: "commission",
      targetId: row.id,
      before: { status: row.status },
      after: { status: "clawed_back" },
      reason,
    });

    return toCommissionView(row, anonLabel(row.downlineUserId));
  }

  /* ==================================================================== *
   * Reads
   * ==================================================================== */

  async history(userId: string, q: CommissionQuery): Promise<Paginated<CommissionResponse>> {
    const sortBy = safeSort(q.sortBy, SORT_COLUMNS, "createdAt");
    const qb = this.commissions.createQueryBuilder("c").where("c.recipientId = :userId", { userId });
    if (q.status) qb.andWhere("c.status = :status", { status: q.status });
    if (q.level) qb.andWhere("c.level = :level", { level: q.level });
    if (q.from) qb.andWhere("c.createdAt >= :from", { from: q.from });
    if (q.to) qb.andWhere("c.createdAt <= :to", { to: q.to });

    const [rows, total] = await qb
      .orderBy(`c.${sortBy}`, q.sortDir)
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();

    const labels = await this.anonLabels(rows.map((r) => r.downlineUserId));
    return paginate(rows.map((r) => toCommissionView(r, labels.get(r.downlineUserId) ?? "Member")), total, q);
  }

  async earnings(userId: string): Promise<CommissionEarningsResponse> {
    const balance = await this.ledger.getBalance(userId);
    const month = monthKey();

    const perLevel: string[] = [];
    for (const level of [1, 2, 3]) {
      const raw = await this.commissions
        .createQueryBuilder("c")
        .select("COALESCE(SUM(c.amountMtt), 0)", "sum")
        .where("c.recipientId = :userId", { userId })
        .andWhere("c.level = :level", { level })
        .andWhere("c.status IN (:...statuses)", { statuses: COMMITTED_STATUSES })
        .getRawOne<{ sum: string | null }>();
      perLevel.push(toDbAmount(raw?.sum ?? 0));
    }

    const thisMonth = await this.commissions
      .createQueryBuilder("c")
      .select("COALESCE(SUM(c.amountMtt), 0)", "sum")
      .addSelect("COUNT(*)", "count")
      .where("c.recipientId = :userId", { userId })
      .andWhere("c.monthKey = :month", { month })
      .andWhere("c.status IN (:...statuses)", { statuses: CAP_CONSUMING_STATUSES })
      .getRawOne<{ sum: string | null; count: string }>();

    const totalEntries = await this.commissions.count({ where: { recipientId: userId } });

    return {
      lifetimeMtt: toDbAmount(balance.commissionLifetime),
      claimableMtt: toDbAmount(balance.commissionAvailable),
      pendingMtt: toDbAmount(balance.commissionPending),
      thisMonthMtt: toDbAmount(thisMonth?.sum ?? 0),
      perLevelMtt: perLevel,
      totalEntries,
    };
  }

  async adminList(q: AdminCommissionQuery): Promise<Paginated<CommissionResponse & { recipientId: string }>> {
    const sortBy = safeSort(q.sortBy, SORT_COLUMNS, "createdAt");
    const qb = this.commissions.createQueryBuilder("c");
    if (q.recipientId) qb.andWhere("c.recipientId = :recipientId", { recipientId: q.recipientId });
    if (q.downlineUserId) qb.andWhere("c.downlineUserId = :downlineUserId", { downlineUserId: q.downlineUserId });
    if (q.status) qb.andWhere("c.status = :status", { status: q.status });
    if (q.level) qb.andWhere("c.level = :level", { level: q.level });
    if (q.monthKey) qb.andWhere("c.monthKey = :monthKey", { monthKey: q.monthKey });
    if (q.from) qb.andWhere("c.createdAt >= :from", { from: q.from });
    if (q.to) qb.andWhere("c.createdAt <= :to", { to: q.to });

    const [rows, total] = await qb
      .orderBy(`c.${sortBy}`, q.sortDir)
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();

    /* Staff see the real downline id; the anonymised label is a member-facing
     * privacy rule (FRD R-02), not a compliance one. */
    return paginate(
      rows.map((r) => ({ ...toCommissionView(r, r.downlineUserId), recipientId: r.recipientId })),
      total,
      q,
    );
  }

  /* ------------------------------------------------------------------ */

  private async sumRecipientMtt(userId: string, statuses: CommissionStatus[]): Promise<string> {
    const raw = await this.commissions
      .createQueryBuilder("c")
      .select("COALESCE(SUM(c.amountMtt), 0)", "sum")
      .where("c.recipientId = :userId", { userId })
      .andWhere("c.status IN (:...statuses)", { statuses })
      .getRawOne<{ sum: string | null }>();
    return toDbAmount(raw?.sum ?? 0);
  }

  /** Anonymised labels for a set of downline ids (FRD R-02). */
  private async anonLabels(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.users.find({ where: { id: In(unique) } });
    return new Map(rows.map((u) => [u.id, anonLabel(u.ref)]));
  }

  /** Fiat → MTT at the admin-managed reference price, truncated down. */
  private toMtt(amountFiat: string, fiatPerMtt: string): string {
    return toDbAmount(dec(amountFiat).div(dec(fiatPerMtt)));
  }

  private async referencePrice(): Promise<string> {
    const { fiatPerMtt } = await this.config.treasuryAllocation();
    if (dec(fiatPerMtt).lte(0)) {
      throw new ConflictException({
        code: "REFERENCE_PRICE_UNSET",
        message: "No MTT reference price is configured — commission cannot be priced",
      });
    }
    return fiatPerMtt;
  }

  /** Credits the bucket that matches the status. */
  private creditBucket(balance: UserBalance, status: CommissionStatus, amountMtt: string): void {
    if (status === "released") {
      balance.commissionAvailable = add(balance.commissionAvailable, amountMtt);
      balance.commissionLifetime = add(balance.commissionLifetime, amountMtt);
    } else {
      /* pending_kyc and queued: accrued but not claimable. Kept visible so the
       * member can see what is owed and why it has not been released. */
      balance.commissionPending = add(balance.commissionPending, amountMtt);
    }
    balance.lastLedgerAt = new Date();
  }
}

/* --------------------------------- helpers -------------------------------- */

function nonNegative(v: string): string {
  return dec(v).isNegative() ? toDbAmount(0) : toDbAmount(v);
}

function nonNegativeFiat(v: string): string {
  return dec(v).isNegative() ? fiat(0) : fiat(v);
}

export function toCommissionView(c: Commission, fromMember: string): CommissionResponse {
  return {
    ref: c.ref,
    createdAt: c.createdAt.toISOString(),
    level: c.level,
    fromMember,
    triggerType: c.triggerType,
    eligibleSpend: fiat(c.eligibleSpend),
    rateBps: c.rateBps,
    grossAmount: fiat(c.grossAmount),
    amount: fiat(c.amount),
    cappedAmount: fiat(c.cappedAmount),
    amountMtt: toDbAmount(c.amountMtt),
    status: c.status,
    monthKey: c.monthKey,
    treasuryInflowRef: c.treasuryInflowRef ?? null,
    releasedAt: c.releasedAt ? c.releasedAt.toISOString() : null,
    claimedAt: c.claimedAt ? c.claimedAt.toISOString() : null,
    clawbackReason: c.clawbackReason ?? null,
  };
}
