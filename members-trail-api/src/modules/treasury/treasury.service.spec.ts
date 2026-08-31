import { Test } from "@nestjs/testing";
import { ForbiddenException, BadRequestException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import {
  RevenueEvent, TreasuryInflow, TreasuryOutflow, TreasuryPeriod, User,
} from "@/database/entities";
import { EventBusService } from "@/events";
import { AuditService } from "@/modules/audit/audit.service";
import { DbRoutinesService } from "@/database/routines/db-routines.service";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import { TreasuryService } from "./treasury.service";

/* ============================================================================
 * These tests exist to protect the platform's defining invariant:
 *
 *     outflow <= reconciled inflow, per period
 *
 * plus the dual-control rules around it. If any of these ever go green when
 * they should be red, the platform can pay members from money it has not
 * verifiably earned — which is the exact failure this codebase is built to
 * prevent. Treat a failure here as a release blocker.
 * ========================================================================== */

const repo = () => ({
  find: jest.fn(), findOne: jest.fn(), save: jest.fn(async (x: unknown) => x),
  create: jest.fn((x: unknown) => x), update: jest.fn(), count: jest.fn(async () => 0),
  createQueryBuilder: jest.fn(),
});

/** Builds a query-builder stub whose getRawOne resolves to a sum. */
function sumQb(sum: string) {
  const qb: Record<string, unknown> = {};
  for (const m of ["select", "addSelect", "where", "andWhere", "groupBy", "orderBy", "skip", "take"]) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getRawOne = jest.fn(async () => ({ sum }));
  qb.getRawMany = jest.fn(async () => []);
  qb.getCount = jest.fn(async () => 0);
  qb.getManyAndCount = jest.fn(async () => [[], 0]);
  return qb;
}

describe("TreasuryService", () => {
  let svc: TreasuryService;
  let inflows: ReturnType<typeof repo>;
  let outflows: ReturnType<typeof repo>;
  let revenue: ReturnType<typeof repo>;
  let periods: ReturnType<typeof repo>;
  let bus: { publish: jest.Mock };
  let audit: { record: jest.Mock };
  /* The period aggregates now come from v_treasury_period. The view is asserted
   * against a real database in the e2e suite; here it is a fixture, so these
   * tests stay about the thresholds this service decides. */
  let routines: { treasuryPeriod: jest.Mock };

  beforeEach(async () => {
    revenue = repo(); inflows = repo(); outflows = repo(); periods = repo();
    bus = { publish: jest.fn(async () => undefined) };
    audit = { record: jest.fn(async () => undefined) };
    routines = {
      treasuryPeriod: jest.fn(async (periodKey: string) => ({
        periodKey,
        reconciledInflow: "0",
        unreconciledInflow: "0",
        grossRevenue: "0",
        commissionPoolOut: "0",
        stakingPoolOut: "0",
        reserveOut: "0",
        inflowCount: 0,
        outflowCount: 0,
      })),
    };

    const mod = await Test.createTestingModule({
      providers: [
        TreasuryService,
        { provide: getRepositoryToken(RevenueEvent), useValue: revenue },
        { provide: getRepositoryToken(TreasuryInflow), useValue: inflows },
        { provide: getRepositoryToken(TreasuryOutflow), useValue: outflows },
        { provide: getRepositoryToken(TreasuryPeriod), useValue: periods },
        { provide: getRepositoryToken(User), useValue: repo() },
        { provide: EventBusService, useValue: bus },
        { provide: AuditService, useValue: audit },
        { provide: DbRoutinesService, useValue: routines },
        {
          provide: EconomyConfigService,
          useValue: {
            treasuryAllocation: jest.fn(async () => ({
              allocationBps: { iap: 3000, tournament: 2000, marketplace: 2500, advertising: 4000, subscription: 3000 },
              fiatPerMtt: "1",
              reserveBps: 1500,
            })),
          },
        },
      ],
    }).compile();

    svc = mod.get(TreasuryService);
  });

  /** Wires the two sum queries headroom() performs: inflow then outflow. */
  function withHeadroom(reconciledInflow: string, priorOutflow: string) {
    inflows.createQueryBuilder.mockReturnValue(sumQb(reconciledInflow));
    outflows.createQueryBuilder.mockReturnValue(sumQb(priorOutflow));
  }

  describe("assertHeadroom — the ceiling", () => {
    it("permits an outflow inside the reconciled inflow", async () => {
      withHeadroom("100000", "40000");
      const h = await svc.assertHeadroom("2026-08", "50000");
      expect(h.headroom).toBe("60000.000000000000000000");
      expect(h.withinBudget).toBe(true);
    });

    it("permits an outflow exactly at the ceiling", async () => {
      withHeadroom("100000", "40000");
      await expect(svc.assertHeadroom("2026-08", "60000")).resolves.toBeDefined();
    });

    it("REFUSES an outflow one unit over the ceiling", async () => {
      withHeadroom("100000", "40000");
      await expect(svc.assertHeadroom("2026-08", "60000.000000000000000001"))
        .rejects.toThrow(ForbiddenException);
    });

    it("refuses with a machine-readable code and the figures", async () => {
      withHeadroom("100000", "40000");
      await expect(svc.assertHeadroom("2026-08", "70000")).rejects.toMatchObject({
        response: {
          code: "TREASURY_HEADROOM_EXCEEDED",
          headroom: "60000.000000000000000000",
          requested: "70000.000000000000000000",
        },
      });
    });

    it("refuses ANY outflow when nothing has been reconciled", async () => {
      withHeadroom("0", "0");
      await expect(svc.assertHeadroom("2026-08", "1")).rejects.toThrow(ForbiddenException);
    });

    it("refuses when prior outflow has already consumed the inflow", async () => {
      withHeadroom("50000", "50000");
      await expect(svc.assertHeadroom("2026-08", "0.000000000000000001"))
        .rejects.toThrow(ForbiddenException);
    });

    it("does not count unreconciled inflow toward headroom", async () => {
      /* sumInflow is called with reconciled=true; a stub that ignores the flag
       * would let unreconciled money raise the ceiling. Assert the filter. */
      const qb = sumQb("100000");
      inflows.createQueryBuilder.mockReturnValue(qb);
      outflows.createQueryBuilder.mockReturnValue(sumQb("0"));
      await svc.headroom("2026-08");
      expect(qb.andWhere).toHaveBeenCalledWith("i.reconciled = :reconciled", { reconciled: true });
    });
  });

  describe("proposeOutflow", () => {
    it("refuses a proposal that exceeds headroom", async () => {
      withHeadroom("10000", "0");
      await expect(
        svc.proposeOutflow(
          { destination: "commission_pool", amount: "20000", periodKey: "2026-08", rationale: "weekly funding run" },
          "finance-1",
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(outflows.save).not.toHaveBeenCalled();
    });

    it("permits a reserve draw that exceeds revenue headroom, and marks it fromReserve", async () => {
      withHeadroom("1000", "0");
      const row = await svc.proposeOutflow(
        {
          destination: "commission_pool", amount: "20000", periodKey: "2026-08",
          /* A real boolean: this is a JSON body, not a query string. */
          rationale: "bootstrap draw, pre-revenue period", fromReserve: true,
        },
        "finance-1",
      );
      expect(row.fromReserve).toBe(true);
      expect(outflows.save).toHaveBeenCalled();
    });

    it("requires a poolId when funding a staking pool", async () => {
      withHeadroom("100000", "0");
      await expect(
        svc.proposeOutflow(
          { destination: "staking_pool", amount: "100", periodKey: "2026-08", rationale: "fund pool 2 rewards" },
          "finance-1",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects a non-positive amount", async () => {
      withHeadroom("100000", "0");
      await expect(
        svc.proposeOutflow(
          { destination: "commission_pool", amount: "0", periodKey: "2026-08", rationale: "should not happen" },
          "finance-1",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("records the headroom snapshot at proposal time", async () => {
      withHeadroom("100000", "25000");
      const row = await svc.proposeOutflow(
        { destination: "commission_pool", amount: "1000", periodKey: "2026-08", rationale: "weekly commission funding" },
        "finance-1",
      );
      expect(row.headroomAtApproval).toBe("75000.000000000000000000");
    });
  });

  describe("approveOutflow — four eyes", () => {
    const base = {
      id: "o1", status: "proposed" as const, proposedById: "finance-1",
      approvedByIds: null as string[] | null, amount: "1000", periodKey: "2026-08",
      fromReserve: false, ref: "TO-1", destination: "commission_pool" as const, poolId: null,
      headroomAtApproval: "0",
    };

    it("REFUSES when the approver is the proposer", async () => {
      outflows.findOne.mockResolvedValue({ ...base });
      await expect(svc.approveOutflow("o1", { note: "looks fine to me" }, "finance-1"))
        .rejects.toThrow(ForbiddenException);
    });

    it("surfaces FOUR_EYES_VIOLATION so the UI can explain it", async () => {
      outflows.findOne.mockResolvedValue({ ...base });
      await expect(svc.approveOutflow("o1", { note: "looks fine to me" }, "finance-1"))
        .rejects.toMatchObject({ response: { code: "FOUR_EYES_VIOLATION" } });
    });

    it("stays proposed after a single approval — two are required", async () => {
      withHeadroom("100000", "0");
      outflows.findOne.mockResolvedValue({ ...base });
      const r = await svc.approveOutflow("o1", { note: "checked the settlement batch" }, "finance-2");
      expect(r.status).toBe("proposed");
      expect(r.approvedByIds).toEqual(["finance-2"]);
      expect(bus.publish).not.toHaveBeenCalled();
    });

    it("approves on the second distinct approver and publishes", async () => {
      withHeadroom("100000", "0");
      outflows.findOne.mockResolvedValue({ ...base, approvedByIds: ["finance-2"] });
      const r = await svc.approveOutflow("o1", { note: "second review complete" }, "finance-3");
      expect(r.status).toBe("approved");
      expect(bus.publish).toHaveBeenCalled();
    });

    it("rejects a duplicate approval from the same person", async () => {
      outflows.findOne.mockResolvedValue({ ...base, approvedByIds: ["finance-2"] });
      await expect(svc.approveOutflow("o1", { note: "approving again" }, "finance-2"))
        .rejects.toThrow(BadRequestException);
    });

    it("re-checks headroom at approval time, so a refund since proposal blocks it", async () => {
      withHeadroom("500", "0");                     // inflow shrank after the refund
      outflows.findOne.mockResolvedValue({ ...base, amount: "1000", approvedByIds: ["finance-2"] });
      await expect(svc.approveOutflow("o1", { note: "final approval" }, "finance-3"))
        .rejects.toThrow(ForbiddenException);
    });

    it("refuses to approve an outflow that is no longer proposed", async () => {
      outflows.findOne.mockResolvedValue({ ...base, status: "confirmed" });
      await expect(svc.approveOutflow("o1", { note: "too late" }, "finance-2"))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe("recognise — commission eligibility", () => {
    beforeEach(() => {
      revenue.findOne.mockResolvedValue(null);
      revenue.save.mockImplementation(async (x: unknown) => ({ ...(x as RevenueEvent), id: "re1" }));
    });

    it.each([
      ["iap", true],
      ["tournament", true],
      ["subscription", true],
      ["marketplace", false],
      ["advertising", false],
    ] as const)("marks %s as commissionEligible=%s", async (stream, expected) => {
      const e = await svc.recognise({
        userId: "u1", stream, grossAmount: "1000", processorFee: "20",
      });
      expect(e.commissionEligible).toBe(expected);
    });

    it("computes net as gross minus processor fee — commission is never on gross", async () => {
      const e = await svc.recognise({ userId: "u1", stream: "iap", grossAmount: "1000", processorFee: "23.50" });
      expect(e.netAmount).toBe("976.500000000000000000");
    });

    it("creates the event unreconciled, so it cannot yet fund a payout", async () => {
      const e = await svc.recognise({ userId: "u1", stream: "iap", grossAmount: "100", processorFee: "0" });
      expect(e.reconciled).toBe(false);
    });

    it("is idempotent on (processor, processorRef) — a replayed webhook does not double-count", async () => {
      revenue.findOne.mockResolvedValue({ id: "existing", ref: "RE-1" });
      const e = await svc.recognise({
        userId: "u1", stream: "iap", grossAmount: "100", processorFee: "0",
        processor: "razorpay", processorRef: "pay_123",
      });
      expect(e.id).toBe("existing");
      expect(revenue.save).not.toHaveBeenCalled();
    });

    it("rejects a fee greater than the gross amount", async () => {
      await expect(
        svc.recognise({ userId: "u1", stream: "iap", grossAmount: "10", processorFee: "20" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects a non-positive gross amount", async () => {
      await expect(
        svc.recognise({ userId: "u1", stream: "iap", grossAmount: "0", processorFee: "0" }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("reconcileBatch", () => {
    it("REFUSES to reconcile when the processor settlement disagrees", async () => {
      inflows.find.mockResolvedValue([
        { id: "i1", amountToTreasury: "300", reconciled: false, periodKey: "2026-08", ref: "TD-1", revenueEventId: "re1", stream: "iap" },
      ]);
      await expect(
        svc.reconcileBatch({ inflowIds: ["i1"], settlementTotal: "250", reason: "weekly settlement match" }, "fin-1"),
      ).rejects.toMatchObject({ response: { code: "SETTLEMENT_MISMATCH" } });
      expect(inflows.update).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reconciled: true }));
    });

    it("reconciles and flips the revenue events when totals match", async () => {
      inflows.find.mockResolvedValue([
        { id: "i1", amountToTreasury: "300", reconciled: false, periodKey: "2026-08", ref: "TD-1", revenueEventId: "re1", stream: "iap" },
      ]);
      inflows.createQueryBuilder.mockReturnValue(sumQb("300"));
      outflows.createQueryBuilder.mockReturnValue(sumQb("0"));
      periods.findOne.mockResolvedValue(null);

      const r = await svc.reconcileBatch(
        { inflowIds: ["i1"], settlementTotal: "300", reason: "weekly settlement match" },
        "fin-1",
      );
      expect(r.matched).toBe(true);
      expect(revenue.update).toHaveBeenCalledWith({ id: expect.anything() }, expect.objectContaining({ reconciled: true }));
    });

    it("refuses to re-reconcile an already reconciled inflow", async () => {
      inflows.find.mockResolvedValue([{ id: "i1", amountToTreasury: "300", reconciled: true }]);
      await expect(
        svc.reconcileBatch({ inflowIds: ["i1"], settlementTotal: "300", reason: "duplicate attempt" }, "fin-1"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("rollupPeriod", () => {
    it("computes the payout ratio and raises an alert at the escalation threshold", async () => {
      /* 9500 out against 10000 reconciled in = 9500 bps, above the 9000 alert
       * threshold. */
      routines.treasuryPeriod.mockResolvedValue({
        periodKey: "2026-08",
        reconciledInflow: "10000",
        unreconciledInflow: "0",
        grossRevenue: "10000",
        commissionPoolOut: "4750",
        stakingPoolOut: "4750",
        reserveOut: "0",
        inflowCount: 1,
        outflowCount: 2,
      });
      periods.findOne.mockResolvedValue(null);

      const p = await svc.rollupPeriod("2026-08");
      expect(p.payoutRatioBps).toBe(9500);
      expect(bus.publish).toHaveBeenCalledWith(
        "treasury.payout_ratio_breach",
        expect.objectContaining({ payoutRatioBps: 9500 }),
      );
    });

    it("reports a zero ratio when no revenue has been reconciled", async () => {
      periods.findOne.mockResolvedValue(null);
      const p = await svc.rollupPeriod("2026-08");
      expect(p.payoutRatioBps).toBe(0);
    });
  });
});
