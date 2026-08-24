import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  Commission, Conversion, KycSubmission, PointsLedgerEntry, RevenueEvent, TreasuryOutflow,
  User, Withdrawal,
} from "@/database/entities";
import { Decimal, add, dec, monthKey, toDbAmount, trailingMonths, fiat } from "@/common/utils";
import { AuditService } from "@/modules/audit/audit.service";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import type {
  ReportRequest, ReportResponse, ReportRow, ReportType,
} from "./dto/reports.dto";

/* ============================================================================
 * Regulatory and operational reporting (FRD AD-12).
 *
 * Three properties every report here has, because a report that lacks them
 * cannot be used for the thing reports are used for:
 *
 *  1. IT STATES ITS OWN BASIS. Every report carries the filter it applied and
 *     the row count. "Revenue was 400,000" is not a report; "reconciled `iap`
 *     and `tournament` revenue occurring in 2026-02, 1,284 events" is.
 *
 *  2. IT NEVER MIXES RECONCILED AND UNRECONCILED MONEY SILENTLY. Reconciliation
 *     status is a column, not a hidden filter, so a reader can see how much of a
 *     total is money that actually arrived.
 *
 *  3. IT IS BOUNDED. Every query has a row cap and the response says whether it
 *     was hit. A report that silently truncated is worse than one that failed:
 *     the reader has no idea a number is incomplete.
 *
 * Exports are generated as rows-plus-columns rather than a file blob so the same
 * payload serves a CSV download, a PDF renderer and an on-screen table without
 * three code paths producing three slightly different totals.
 * ========================================================================== */

/** Hard cap per report. Beyond this the reader needs a narrower window. */
const MAX_ROWS = 50_000;

@Injectable()
export class ReportsService {
  private readonly log = new Logger(ReportsService.name);

  constructor(
    @InjectRepository(RevenueEvent) private readonly revenue: Repository<RevenueEvent>,
    @InjectRepository(Commission) private readonly commissions: Repository<Commission>,
    @InjectRepository(Withdrawal) private readonly withdrawals: Repository<Withdrawal>,
    @InjectRepository(Conversion) private readonly conversions: Repository<Conversion>,
    @InjectRepository(TreasuryOutflow) private readonly outflows: Repository<TreasuryOutflow>,
    @InjectRepository(KycSubmission) private readonly kyc: Repository<KycSubmission>,
    @InjectRepository(PointsLedgerEntry) private readonly points: Repository<PointsLedgerEntry>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly audit: AuditService,
    private readonly routines: DbRoutinesService,
  ) {}

  /* ==================================================================== *
   * Entry point
   * ==================================================================== */

  async generate(dto: ReportRequest, actorId: string): Promise<ReportResponse> {
    const { from, to } = this.window(dto);

    const report = await this.build(dto.type, from, to);

    /* A report is a disclosure: who ran it, over what window, is itself worth
     * recording — particularly for the ones containing member financial data. */
    await this.audit.record({
      actorId,
      action: `report.generate.${dto.type}`,
      targetType: "report",
      after: { type: dto.type, from: from.toISOString(), to: to.toISOString(), rows: report.rowCount },
    });

    return report;
  }

  private window(dto: ReportRequest): { from: Date; to: Date } {
    if (dto.from && dto.to) {
      const from = new Date(dto.from);
      const to = new Date(dto.to);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new BadRequestException("from and to must be valid instants");
      }
      if (to.getTime() < from.getTime()) {
        throw new BadRequestException({
          code: "WINDOW_INVERTED",
          message: "`to` must be after `from`",
        });
      }
      return { from, to };
    }

    /* Default to the trailing month rather than all time: an unbounded default
     * is how a reporting endpoint becomes a way to read the whole database. */
    const { start, end } = trailingMonths(1);
    return { from: start, to: end };
  }

  private build(type: ReportType, from: Date, to: Date): Promise<ReportResponse> {
    if (type === "revenue") return this.revenueReport(from, to);
    if (type === "commission") return this.commissionReport(from, to);
    if (type === "withdrawals") return this.withdrawalReport(from, to);
    if (type === "conversions") return this.conversionReport(from, to);
    if (type === "treasury") return this.treasuryReport(from, to);
    if (type === "kyc") return this.kycReport(from, to);
    if (type === "points") return this.pointsReport(from, to);
    return this.memberReport(from, to);
  }

  /* ==================================================================== *
   * Revenue
   * ==================================================================== */

  /**
   * Revenue by stream, split by reconciliation status.
   *
   * Property 2 in practice: reconciled and unreconciled are separate columns, so
   * a reader can see that a headline total includes money the processor has not
   * yet confirmed arrived.
   */
  private async revenueReport(from: Date, to: Date): Promise<ReportResponse> {
    const rows = await this.revenue
      .createQueryBuilder("e")
      .select("e.stream", "stream")
      .addSelect("COUNT(*)", "events")
      .addSelect("COALESCE(SUM(e.grossAmount), 0)", "gross")
      .addSelect("COALESCE(SUM(e.netAmount), 0)", "net")
      .addSelect("COALESCE(SUM(e.processorFee), 0)", "fees")
      .addSelect("COALESCE(SUM(CASE WHEN e.reconciled THEN e.netAmount ELSE 0 END), 0)", "reconciledNet")
      .addSelect("COALESCE(SUM(CASE WHEN NOT e.reconciled THEN e.netAmount ELSE 0 END), 0)", "unreconciledNet")
      .addSelect("SUM(CASE WHEN e.commissionEligible THEN 1 ELSE 0 END)", "commissionable")
      .addSelect("SUM(CASE WHEN e.reversedAt IS NOT NULL THEN 1 ELSE 0 END)", "reversed")
      .where("e.occurredAt >= :from", { from })
      .andWhere("e.occurredAt <= :to", { to })
      .groupBy("e.stream")
      .orderBy("net", "DESC")
      .getRawMany<Record<string, string>>();

    return this.wrap({
      type: "revenue",
      title: "Revenue by stream",
      from,
      to,
      basis:
        "Revenue events by occurrence date. Reconciled and unreconciled net are reported " +
        "separately: only reconciled revenue may fund a payout.",
      columns: [
        "Stream", "Events", "Gross", "Processor fees", "Net",
        "Reconciled net", "Unreconciled net", "Commissionable events", "Reversed",
      ],
      rows: rows.map((r) => [
        r.stream,
        r.events,
        fiat(r.gross),
        fiat(r.fees),
        fiat(r.net),
        fiat(r.reconciledNet),
        fiat(r.unreconciledNet),
        r.commissionable,
        r.reversed,
      ]),
    });
  }

  /* ==================================================================== *
   * Commission
   * ==================================================================== */

  /**
   * Commission by status and level — the payout picture a regulator asks for.
   *
   * `capped` and `rejected` are included deliberately: a report of only what was
   * paid hides the platform's controls working, which is exactly what proves they
   * exist.
   */
  private async commissionReport(from: Date, to: Date): Promise<ReportResponse> {
    const rows = await this.commissions
      .createQueryBuilder("c")
      .select("c.status", "status")
      .addSelect("c.level", "level")
      .addSelect("COUNT(*)", "entries")
      .addSelect("COUNT(DISTINCT c.recipientId)", "recipients")
      .addSelect("COALESCE(SUM(c.grossAmount), 0)", "gross")
      .addSelect("COALESCE(SUM(c.amount), 0)", "payable")
      .addSelect("COALESCE(SUM(c.cappedAmount), 0)", "capped")
      .addSelect("COALESCE(SUM(c.amountMtt), 0)", "mtt")
      .where("c.createdAt >= :from", { from })
      .andWhere("c.createdAt <= :to", { to })
      .groupBy("c.status")
      .addGroupBy("c.level")
      .orderBy("c.status", "ASC")
      .addOrderBy("c.level", "ASC")
      .getRawMany<Record<string, string>>();

    return this.wrap({
      type: "commission",
      title: "Commission by status and level",
      from,
      to,
      basis:
        "All commission rows created in the window, including capped and rejected ones — a report " +
        "of only what was paid would hide the controls that refused the rest.",
      columns: [
        "Status", "Level", "Entries", "Recipients", "Gross (fiat)",
        "Payable (fiat)", "Refused by cap (fiat)", "MTT",
      ],
      rows: rows.map((r) => [
        r.status,
        r.level,
        r.entries,
        r.recipients,
        fiat(r.gross),
        fiat(r.payable),
        fiat(r.capped),
        toDbAmount(r.mtt ?? 0),
      ]),
    });
  }

  /* ==================================================================== *
   * Withdrawals
   * ==================================================================== */

  /** Withdrawals by status and source tag — the AML view. */
  private async withdrawalReport(from: Date, to: Date): Promise<ReportResponse> {
    const rows = await this.withdrawals
      .createQueryBuilder("w")
      .select("w.status", "status")
      .addSelect("w.sourceTag", "sourceTag")
      .addSelect("w.kycTierAtRequest", "kycTier")
      .addSelect("COUNT(*)", "requests")
      .addSelect("COUNT(DISTINCT w.userId)", "members")
      .addSelect("COALESCE(SUM(w.amountMtt), 0)", "mtt")
      .addSelect("SUM(CASE WHEN w.reviewRequired THEN 1 ELSE 0 END)", "reviewed")
      .where("w.createdAt >= :from", { from })
      .andWhere("w.createdAt <= :to", { to })
      .groupBy("w.status")
      .addGroupBy("w.sourceTag")
      .addGroupBy("w.kycTierAtRequest")
      .orderBy("mtt", "DESC")
      .getRawMany<Record<string, string>>();

    return this.wrap({
      type: "withdrawals",
      title: "Withdrawals by status, source and KYC tier",
      from,
      to,
      basis:
        "Requests by creation date. The KYC tier is the one recorded AT REQUEST TIME, so a later " +
        "tier change does not rewrite the assessment that was actually made.",
      columns: ["Status", "Source of funds", "KYC tier at request", "Requests", "Members", "MTT", "Sent to review"],
      rows: rows.map((r) => [
        r.status,
        r.sourceTag,
        r.kycTier,
        r.requests,
        r.members,
        toDbAmount(r.mtt ?? 0),
        r.reviewed,
      ]),
    });
  }

  /* ==================================================================== *
   * Conversions and Points
   * ==================================================================== */

  /** Points → MTT conversion volume, by month and rate. */
  private async conversionReport(from: Date, to: Date): Promise<ReportResponse> {
    const rows = await this.conversions
      .createQueryBuilder("c")
      .select("DATE_FORMAT(c.createdAt, '%Y-%m')", "month")
      .addSelect("c.rateApplied", "rate")
      .addSelect("COUNT(*)", "conversions")
      .addSelect("COUNT(DISTINCT c.userId)", "members")
      .addSelect("COALESCE(SUM(c.pointsSpent), 0)", "points")
      .addSelect("COALESCE(SUM(c.mttCredited), 0)", "mtt")
      .where("c.createdAt >= :from", { from })
      .andWhere("c.createdAt <= :to", { to })
      .andWhere("c.status = 'completed'")
      .groupBy("month")
      .addGroupBy("c.rateApplied")
      .orderBy("month", "DESC")
      .getRawMany<Record<string, string>>();

    return this.wrap({
      type: "conversions",
      title: "Points converted to MTT",
      from,
      to,
      basis:
        "Completed conversions only. The rate is the one snapshotted onto each conversion, so a " +
        "later rate change cannot reprice history.",
      columns: ["Month", "Points per MTT", "Conversions", "Members", "Points spent", "MTT credited"],
      rows: rows.map((r) => [r.month, r.rate, r.conversions, r.members, r.points, toDbAmount(r.mtt ?? 0)]),
    });
  }

  /**
   * Points issuance by source — the emission report.
   *
   * Positive rows only: netting conversions out against issuance would hide how
   * many Points were created, which is the number the caps exist to control.
   */
  private async pointsReport(from: Date, to: Date): Promise<ReportResponse> {
    const rows = await this.points
      .createQueryBuilder("e")
      .select("e.source", "source")
      .addSelect("COUNT(*)", "entries")
      .addSelect("COUNT(DISTINCT e.userId)", "members")
      .addSelect("COALESCE(SUM(CASE WHEN e.amount > 0 THEN e.amount ELSE 0 END), 0)", "issued")
      .addSelect("COALESCE(SUM(CASE WHEN e.amount < 0 THEN -e.amount ELSE 0 END), 0)", "spent")
      .where("e.createdAt >= :from", { from })
      .andWhere("e.createdAt <= :to", { to })
      .groupBy("e.source")
      .orderBy("issued", "DESC")
      .getRawMany<Record<string, string>>();

    return this.wrap({
      type: "points",
      title: "Points issuance and spend by source",
      from,
      to,
      basis:
        "Issued and spent are reported separately rather than netted: the amount CREATED is what " +
        "the daily caps exist to control.",
      columns: ["Source", "Ledger entries", "Members", "Points issued", "Points spent"],
      rows: rows.map((r) => [r.source, r.entries, r.members, r.issued, r.spent]),
    });
  }

  /* ==================================================================== *
   * Treasury
   * ==================================================================== */

  /**
   * Treasury outflows by destination and status.
   *
   * `confirmed` is separated from `approved` because only confirmed money is in
   * the pool — an approved-but-unsubmitted transfer that a report counts as
   * funding is how a pool goes overdrawn on paper.
   */
  private async treasuryReport(from: Date, to: Date): Promise<ReportResponse> {
    const rows = await this.outflows
      .createQueryBuilder("o")
      .select("o.periodKey", "period")
      .addSelect("o.destination", "destination")
      .addSelect("o.status", "status")
      .addSelect("COUNT(*)", "transfers")
      .addSelect("COALESCE(SUM(o.amount), 0)", "mtt")
      .addSelect("SUM(CASE WHEN o.fromReserve THEN 1 ELSE 0 END)", "fromReserve")
      .where("o.createdAt >= :from", { from })
      .andWhere("o.createdAt <= :to", { to })
      .groupBy("o.periodKey")
      .addGroupBy("o.destination")
      .addGroupBy("o.status")
      .orderBy("o.periodKey", "DESC")
      .getRawMany<Record<string, string>>();

    return this.wrap({
      type: "treasury",
      title: "Treasury outflows",
      from,
      to,
      basis:
        "Only CONFIRMED transfers are money in a pool. An approved but unsubmitted transfer is a " +
        "decision, not funding, and is reported on its own row.",
      columns: ["Period", "Destination", "Status", "Transfers", "MTT", "From reserve"],
      rows: rows.map((r) => [
        r.period, r.destination, r.status, r.transfers, toDbAmount(r.mtt ?? 0), r.fromReserve,
      ]),
    });
  }

  /* ==================================================================== *
   * Compliance
   * ==================================================================== */

  /** KYC funnel by tier and outcome. */
  private async kycReport(from: Date, to: Date): Promise<ReportResponse> {
    const rows = await this.kyc
      .createQueryBuilder("k")
      .select("k.tier", "tier")
      .addSelect("k.status", "status")
      .addSelect("k.country", "country")
      .addSelect("COUNT(*)", "submissions")
      .addSelect("AVG(k.providerConfidence)", "avgConfidence")
      .addSelect("SUM(CASE WHEN k.sarFiledAt IS NOT NULL THEN 1 ELSE 0 END)", "sarsFiled")
      .where("k.createdAt >= :from", { from })
      .andWhere("k.createdAt <= :to", { to })
      .groupBy("k.tier")
      .addGroupBy("k.status")
      .addGroupBy("k.country")
      .orderBy("submissions", "DESC")
      .getRawMany<Record<string, string>>();

    return this.wrap({
      type: "kyc",
      title: "KYC submissions by tier, outcome and country",
      from,
      to,
      basis: "Submissions by creation date. SARs filed are counted per group.",
      columns: ["Tier", "Status", "Country", "Submissions", "Mean provider confidence", "SARs filed"],
      rows: rows.map((r) => [
        r.tier,
        r.status,
        r.country ?? "—",
        r.submissions,
        r.avgConfidence ? Number(r.avgConfidence).toFixed(1) : "—",
        r.sarsFiled,
      ]),
    });
  }

  /** Member growth and verification state by signup month. */
  private async memberReport(from: Date, to: Date): Promise<ReportResponse> {
    const rows = await this.users
      .createQueryBuilder("u")
      .select("DATE_FORMAT(u.createdAt, '%Y-%m')", "month")
      .addSelect("COUNT(*)", "signups")
      .addSelect("SUM(CASE WHEN u.kycTier >= 1 THEN 1 ELSE 0 END)", "verified")
      .addSelect("SUM(CASE WHEN u.referredById IS NOT NULL THEN 1 ELSE 0 END)", "referred")
      .addSelect("SUM(CASE WHEN u.status = 'frozen' THEN 1 ELSE 0 END)", "frozen")
      .addSelect("SUM(CASE WHEN u.status = 'closed' THEN 1 ELSE 0 END)", "closed")
      .where("u.createdAt >= :from", { from })
      .andWhere("u.createdAt <= :to", { to })
      .groupBy("month")
      .orderBy("month", "DESC")
      .getRawMany<Record<string, string>>();

    return this.wrap({
      type: "members",
      title: "Member growth by signup month",
      from,
      to,
      basis: "Accounts by creation date, with their CURRENT verification and status.",
      columns: ["Month", "Signups", "KYC verified", "Referred", "Frozen", "Closed"],
      rows: rows.map((r) => [r.month, r.signups, r.verified, r.referred, r.frozen, r.closed]),
    });
  }

  /* ==================================================================== *
   * Shape
   * ==================================================================== */

  /**
   * Wraps rows into the standard envelope.
   *
   * Property 1 and 3 are enforced here rather than left to each report: every
   * response states its basis, its window and whether it hit the row cap.
   */
  private wrap(input: {
    type: ReportType;
    title: string;
    from: Date;
    to: Date;
    basis: string;
    columns: string[];
    rows: ReportRow[];
  }): ReportResponse {
    const truncated = input.rows.length >= MAX_ROWS;
    if (truncated) {
      this.log.warn(
        `report ${input.type} hit the ${MAX_ROWS}-row cap — the reader is told, not silently misled`,
      );
    }

    return {
      type: input.type,
      title: input.title,
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      basis: input.basis,
      columns: input.columns,
      rows: input.rows.slice(0, MAX_ROWS).map((r) => r.map((c) => String(c ?? ""))),
      rowCount: Math.min(input.rows.length, MAX_ROWS),
      truncated,
      generatedAt: new Date().toISOString(),
      filename: `${input.type}-${monthKey(input.from)}-to-${monthKey(input.to)}.csv`,
    };
  }

  /* ==================================================================== *
   * Summary
   * ==================================================================== */

  /**
   * The payout-ratio summary: what came in against what went out.
   *
   * The single most important compliance figure, so it is computed in one place
   * from reconciled revenue only, and it reports the ratio rather than leaving a
   * reader to divide two numbers and possibly pick the wrong pair.
   */
  async payoutRatio(period = monthKey()): Promise<{
    period: string;
    reconciledNetRevenue: string;
    commissionPaid: string;
    treasuryOutflowConfirmed: string;
    payoutRatioBps: number;
    withinPolicy: boolean;
    basis: string;
  }> {
    /* One read of v_payout_ratio, where the three aggregates this used to run
     * separately now live. The Treasury service reads the same view for its own
     * ratio, so the two screens can no longer disagree about what the platform
     * earned in a month. */
    const row = await this.routines.payoutRatio(period);

    const net = fiat(row.reconciledNetRevenue);
    const paid = fiat(row.releasedCommission);

    const ratioBps = dec(net).lte(0)
      ? dec(paid).lte(0)
        ? 0
        : /* Payouts with no reconciled revenue behind them: unbounded, not a
           * large percentage. */
          Number.MAX_SAFE_INTEGER
      : Number(dec(paid).div(dec(net)).mul(10_000).toFixed(0, Decimal.ROUND_HALF_UP));

    return {
      period,
      reconciledNetRevenue: net,
      commissionPaid: paid,
      treasuryOutflowConfirmed: toDbAmount(row.confirmedOutflow),
      payoutRatioBps: ratioBps,
      /* Below 100% of reconciled revenue. Anything else means the platform paid
       * out money it did not take in. */
      withinPolicy: ratioBps < 10_000,
      basis:
        "Commission released or claimed for the period, against RECONCILED net revenue occurring " +
        "in it. Unreconciled revenue is excluded — it cannot fund a payout.",
    };
  }
}

/** Kept for the CSV writer in the report processor. */
export function toCsv(columns: string[], rows: string[][]): string {
  const escape = (cell: string): string =>
    /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
  return [columns.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\r\n");
}

/** Re-exported so the queue processor can total a column without re-deriving it. */
export function sumColumn(rows: string[][], index: number): string {
  return rows.reduce((acc, row) => add(acc, dec(row[index] || 0).toString()), toDbAmount(0));
}
