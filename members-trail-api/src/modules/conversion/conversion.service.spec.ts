import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import { Conversion, ConversionRate } from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { EventBusService } from "@/events";
import { RedisService } from "@/common/redis/redis.service";
import { AuditService } from "@/modules/audit/audit.service";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import { ConversionService } from "./conversion.service";

/* ============================================================================
 * These tests guard the conversion boundary — the one place where an in-game
 * score becomes a transferable asset. Three properties are non-negotiable and
 * each has a test that fails loudly if it regresses:
 *
 *   • MTT is truncated down, never rounded up. Rounding up mints unbacked supply.
 *   • A cap REFUSES; it never silently converts less than the member asked for.
 *   • A rate change cannot be made by one person, and cannot be backdated.
 *
 * A failure here is a release blocker.
 * ========================================================================== */

interface MockRepo {
  findOne: jest.Mock;
  find: jest.Mock;
  save: jest.Mock;
  create: jest.Mock;
  createQueryBuilder: jest.Mock;
}

function repo(): MockRepo {
  return {
    findOne: jest.fn(),
    find: jest.fn(async () => []),
    save: jest.fn(async (x: unknown) => x),
    create: jest.fn((x: unknown) => x),
    createQueryBuilder: jest.fn(),
  };
}

/** Query builder that resolves to a single raw row. */
function qb(raw: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  for (const m of [
    "select", "addSelect", "where", "andWhere", "orderBy", "skip", "take", "groupBy", "limit",
  ]) {
    b[m] = jest.fn(() => b);
  }
  b.getRawOne = jest.fn(async () => raw);
  b.getManyAndCount = jest.fn(async () => [[], 0]);
  b.getMany = jest.fn(async () => []);
  return b;
}

/** Fixed so nothing in these tests depends on wall-clock time. */
const FIXED_NOW = new Date("2026-02-01T00:00:00Z");

const ACTIVE_RATE = {
  id: "rate-1",
  pointsPerMtt: 1_000,
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  status: "active" as const,
  proposedById: "finance-1",
  approvedById: "finance-2",
  approvedAt: new Date("2025-12-30T00:00:00Z"),
  rationale: "launch rate",
  rejectionReason: null,
  createdAt: new Date("2025-12-29T00:00:00Z"),
};

describe("ConversionService", () => {
  let svc: ConversionService;
  let conversions: MockRepo;
  let rates: MockRepo;
  let ledger: { getBalance: jest.Mock; withUserLock: jest.Mock };
  let redis: { withLock: jest.Mock; get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let bus: { publish: jest.Mock };
  let config: { conversionCaps: jest.Mock; write: jest.Mock };
  let audit: { record: jest.Mock; recordOrThrow: jest.Mock };
  let queue: { add: jest.Mock };

  /** Rows written inside the ledger transaction, so a test can assert on them. */
  let written: { entity: string; row: Record<string, unknown> }[];

  beforeEach(async () => {
    conversions = repo();
    rates = repo();
    written = [];

    ledger = {
      getBalance: jest.fn(async () => ({ points: 10_000, mttAvailable: "0.000000000000000000" })),
      /* Runs the callback with a transaction whose repositories record writes,
       * mirroring the real behaviour: one commit, or nothing. */
      withUserLock: jest.fn(async (_userId: string, fn: (tx: unknown, balance: unknown) => Promise<unknown>) => {
        const balance = { points: 10_000, mttAvailable: "0.000000000000000000", lastLedgerAt: null };
        const tx = {
          getRepository: (entity: { name: string }) => ({
            create: (row: Record<string, unknown>) => row,
            save: async (row: Record<string, unknown>) => {
              written.push({ entity: entity.name, row });
              /* The real database populates id/createdAt on insert. */
              return { createdAt: FIXED_NOW, ...row, id: `${entity.name}-id` };
            },
          }),
        };
        return fn(tx, balance);
      }),
    };

    redis = {
      /* The real lock returns null on contention; here it always runs the body. */
      withLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()),
      get: jest.fn(async () => null),
      set: jest.fn(),
      del: jest.fn(),
    };
    bus = { publish: jest.fn() };
    config = {
      conversionCaps: jest.fn(async () => ({ dailyPoints: 5_000, monthlyPoints: 50_000 })),
      write: jest.fn(),
    };
    audit = { record: jest.fn(), recordOrThrow: jest.fn() };
    queue = { add: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        ConversionService,
        { provide: getRepositoryToken(Conversion), useValue: conversions },
        { provide: getRepositoryToken(ConversionRate), useValue: rates },
        { provide: LedgerService, useValue: ledger },
        { provide: EventBusService, useValue: bus },
        { provide: RedisService, useValue: redis },
        { provide: EconomyConfigService, useValue: config },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    svc = mod.get(ConversionService);
    rates.findOne.mockResolvedValue({ ...ACTIVE_RATE });
    /* Mirrors the insert: the database assigns id and createdAt. */
    rates.save.mockImplementation(async (x: unknown) => ({
      id: "rate-new",
      createdAt: FIXED_NOW,
      ...(x as Record<string, unknown>),
    }));
    conversions.findOne.mockResolvedValue(null);
    conversions.createQueryBuilder.mockImplementation(() => qb({ sum: "0" }));
  });

  /* ==================================================================== *
   * Rate
   * ==================================================================== */

  describe("activeRate", () => {
    it("REFUSES to convert when no rate has been approved — it never guesses one", async () => {
      rates.findOne.mockResolvedValue(null);
      await expect(svc.activeRate()).rejects.toMatchObject({
        response: { code: "NO_ACTIVE_RATE" },
      });
    });

    it("promotes a scheduled rate whose time has come, without waiting for a cron", async () => {
      rates.findOne.mockResolvedValue({ ...ACTIVE_RATE, status: "scheduled" });
      rates.find.mockResolvedValue([]);
      const r = await svc.activeRate();
      expect(r.status).toBe("active");
      expect(rates.save).toHaveBeenCalled();
    });

    it("supersedes the incumbent when a new rate activates — only one is ever active", async () => {
      const incumbent = { ...ACTIVE_RATE, id: "rate-0", status: "active" as const };
      rates.findOne.mockResolvedValue({ ...ACTIVE_RATE, id: "rate-2", status: "scheduled" });
      rates.find.mockResolvedValue([incumbent]);

      await svc.activeRate();

      expect(rates.save).toHaveBeenCalledWith(expect.objectContaining({ id: "rate-0", status: "superseded" }));
    });
  });

  /* ==================================================================== *
   * Quote
   * ==================================================================== */

  describe("quote", () => {
    it("truncates MTT down — 1999 Points at 1000/MTT yields 1 MTT, not 2", async () => {
      const q = await svc.quote("u1", 1_999);
      expect(q.pointsConvertible).toBe(1_000);
      expect(q.mttOut).toBe("1.000000000000000000");
      /* The 999 remainder stays in the balance rather than being burned. */
      expect(q.remainderPoints).toBe(999);
    });

    it("floors to a whole multiple of the rate, so no Points are spent for zero MTT", async () => {
      const q = await svc.quote("u1", 999);
      expect(q.pointsConvertible).toBe(0);
      expect(q.mttOut).toBe("0.000000000000000000");
      expect(q.executable).toBe(false);
      expect(q.blockedBy).toBe("BELOW_MINIMUM");
    });

    it("is limited by the daily cap, and names it as the blocker", async () => {
      conversions.createQueryBuilder.mockImplementation(() => qb({ sum: "5000" }));
      const q = await svc.quote("u1", 3_000);
      expect(q.pointsConvertible).toBe(0);
      expect(q.blockedBy).toBe("DAILY_CAP");
      expect(q.caps.find((c) => c.window === "day")?.remainingPoints).toBe(0);
    });

    it("is limited by the balance when the balance is the tightest constraint", async () => {
      ledger.getBalance.mockResolvedValue({ points: 1_500, mttAvailable: "0" });
      const q = await svc.quote("u1", 4_000);
      expect(q.pointsConvertible).toBe(1_000);
      expect(q.pointsBalance).toBe(1_500);
    });

    it("reports INSUFFICIENT_POINTS when the balance is below one MTT's worth", async () => {
      ledger.getBalance.mockResolvedValue({ points: 200, mttAvailable: "0" });
      const q = await svc.quote("u1", 200);
      expect(q.blockedBy).toBe("INSUFFICIENT_POINTS");
    });

    it("never advertises more headroom than the monthly cap allows", async () => {
      config.conversionCaps.mockResolvedValue({ dailyPoints: 50_000, monthlyPoints: 2_000 });
      const q = await svc.quote("u1", 10_000);
      expect(q.pointsConvertible).toBe(2_000);
    });
  });

  /* ==================================================================== *
   * Convert
   * ==================================================================== */

  describe("convert", () => {
    it("debits Points and credits MTT in ONE transaction, writing all three rows", async () => {
      const res = await svc.convert("u1", 2_000, "idem-key-0001");

      expect(ledger.withUserLock).toHaveBeenCalledTimes(1);
      const entities = written.map((w) => w.entity);
      expect(entities).toContain("PointsLedgerEntry");
      expect(entities).toContain("Transaction");
      expect(entities).toContain("Conversion");
      expect(res.mttCredited).toBe("2.000000000000000000");
      expect(res.pointsSpent).toBe(2_000);
    });

    it("writes the Points debit as a NEGATIVE row with the running balance", async () => {
      await svc.convert("u1", 2_000, "idem-key-0001");
      const entry = written.find((w) => w.entity === "PointsLedgerEntry")?.row;
      expect(entry?.amount).toBe(-2_000);
      expect(entry?.runningBalance).toBe(8_000);
      expect(entry?.source).toBe("conversion");
    });

    it("snapshots the rate onto the row, so a later change cannot reprice it", async () => {
      await svc.convert("u1", 2_000, "idem-key-0001");
      const row = written.find((w) => w.entity === "Conversion")?.row;
      expect(row?.rateApplied).toBe(1_000);
    });

    it("REFUSES rather than converting less than asked when a cap binds", async () => {
      conversions.createQueryBuilder.mockImplementation(() => qb({ sum: "4500" }));
      await expect(svc.convert("u1", 2_000, "idem-key-0001")).rejects.toBeInstanceOf(ConflictException);
      expect(written).toHaveLength(0);
    });

    it("surfaces the convertible amount on refusal so the client can re-quote", async () => {
      conversions.createQueryBuilder.mockImplementation(() => qb({ sum: "3000" }));
      await expect(svc.convert("u1", 5_000, "idem-key-0001")).rejects.toMatchObject({
        response: { code: "DAILY_CAP", convertible: 2_000 },
      });
    });

    it("refuses an amount below one MTT's worth instead of burning the Points", async () => {
      await expect(svc.convert("u1", 500, "idem-key-0001")).rejects.toBeInstanceOf(ConflictException);
      expect(written).toHaveLength(0);
    });

    it("rejects a fractional or non-positive Points amount", async () => {
      await expect(svc.convert("u1", 1.5, "idem-key-0001")).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.convert("u1", 0, "idem-key-0001")).rejects.toBeInstanceOf(BadRequestException);
    });

    it("is idempotent: a replayed key returns the original conversion and converts nothing", async () => {
      conversions.findOne.mockResolvedValue({
        ...ACTIVE_RATE,
        ref: "CV-ABC",
        pointsSpent: 2_000,
        rateApplied: 1_000,
        mttCredited: "2",
        status: "completed",
        txHash: null,
        createdAt: new Date("2026-02-01T00:00:00Z"),
      });

      const res = await svc.convert("u1", 2_000, "idem-key-0001");

      expect(res.replayed).toBe(true);
      expect(res.ref).toBe("CV-ABC");
      expect(ledger.withUserLock).not.toHaveBeenCalled();
    });

    it("scopes the idempotency key to the user, so two members cannot collide", async () => {
      await svc.convert("u1", 1_000, "shared-client-key");
      const row = written.find((w) => w.entity === "Conversion")?.row;
      expect(row?.idempotencyKey).toBe("conversion:u1:shared-client-key");
    });

    it("publishes the completion marked NOT commissionable — a conversion is not revenue", async () => {
      await svc.convert("u1", 1_000, "idem-key-0001");
      const [, payload] = bus.publish.mock.calls[0] as [string, Record<string, unknown>];
      expect(payload.commissionable).toBe(false);
    });

    it("does NOT queue an on-chain settlement — converted MTT is custodial", async () => {
      /* The chain movement happens at withdrawal. A per-conversion transfer
       * would have to name a recipient address, which a conversion does not
       * have. */
      await svc.convert("u1", 1_000, "idem-key-0001");
      expect(queue.add).not.toHaveBeenCalled();
    });

    it("refuses when another conversion holds the lock, rather than proceeding unserialised", async () => {
      redis.withLock.mockResolvedValue(null);
      await expect(svc.convert("u1", 1_000, "idem-key-0001")).rejects.toMatchObject({
        response: { code: "CONVERSION_IN_FLIGHT" },
      });
    });
  });

  /* ==================================================================== *
   * Rate lifecycle — four eyes
   * ==================================================================== */

  describe("proposeRate", () => {
    it("refuses a backdated rate — that would reprice conversions already settled", async () => {
      await expect(
        svc.proposeRate(
          { pointsPerMtt: 900, effectiveFrom: "2020-01-01T00:00:00Z", rationale: "cheaper rate please" },
          "finance-1",
          "1.2.3.4",
        ),
      ).rejects.toMatchObject({ response: { code: "RATE_NOT_FUTURE" } });
    });

    it("creates the proposal as pending_approval — proposing never applies it", async () => {
      const future = new Date(Date.now() + 86_400_000).toISOString();
      const r = await svc.proposeRate(
        { pointsPerMtt: 900, effectiveFrom: future, rationale: "quarterly repricing" },
        "finance-1",
        "1.2.3.4",
      );
      expect(r.status).toBe("pending_approval");
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ requiredSecondApproval: true }),
      );
    });

    it("rejects a rate outside the sane bounds", async () => {
      const future = new Date(Date.now() + 86_400_000).toISOString();
      await expect(
        svc.proposeRate({ pointsPerMtt: 0, effectiveFrom: future, rationale: "free money" }, "f1", null),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("approveRate — four eyes", () => {
    const pending = {
      ...ACTIVE_RATE,
      id: "rate-9",
      status: "pending_approval" as const,
      proposedById: "finance-1",
      approvedById: null,
      effectiveFrom: new Date(Date.now() + 86_400_000),
    };

    it("REFUSES when the approver is the proposer", async () => {
      rates.findOne.mockResolvedValue({ ...pending });
      await expect(svc.approveRate("rate-9", null, "finance-1", null))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it("surfaces FOUR_EYES_VIOLATION so the UI can explain the refusal", async () => {
      rates.findOne.mockResolvedValue({ ...pending });
      await expect(svc.approveRate("rate-9", null, "finance-1", null))
        .rejects.toMatchObject({ response: { code: "FOUR_EYES_VIOLATION" } });
    });

    it("schedules a future-dated rate rather than applying it immediately", async () => {
      rates.findOne.mockResolvedValue({ ...pending });
      const r = await svc.approveRate("rate-9", "looks right", "finance-2", null);
      expect(r.status).toBe("scheduled");
      expect(r.approvedById).toBe("finance-2");
    });

    it("activates immediately when the effective window has already opened", async () => {
      rates.findOne.mockResolvedValue({ ...pending, effectiveFrom: new Date(Date.now() - 1_000) });
      rates.find.mockResolvedValue([]);
      const r = await svc.approveRate("rate-9", null, "finance-2", null);
      expect(r.status).toBe("active");
    });

    it("busts the rate cache on approval, so no request keeps quoting the old rate", async () => {
      rates.findOne.mockResolvedValue({ ...pending });
      await svc.approveRate("rate-9", null, "finance-2", null);
      expect(redis.del).toHaveBeenCalled();
    });

    it("refuses to approve a proposal that is no longer pending", async () => {
      rates.findOne.mockResolvedValue({ ...pending, status: "active" });
      await expect(svc.approveRate("rate-9", null, "finance-2", null))
        .rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("rejectRate", () => {
    it("requires a different reviewer, exactly like approval", async () => {
      rates.findOne.mockResolvedValue({
        ...ACTIVE_RATE, status: "pending_approval", proposedById: "finance-1",
      });
      await expect(svc.rejectRate("rate-9", "not now", "finance-1", null))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it("records the rejection reason on the row", async () => {
      rates.findOne.mockResolvedValue({
        ...ACTIVE_RATE, status: "pending_approval", proposedById: "finance-1",
      });
      const r = await svc.rejectRate("rate-9", "wait for the audit", "finance-2", null);
      expect(r.status).toBe("rejected");
      expect(r.rejectionReason).toBe("wait for the audit");
    });
  });

  /* ==================================================================== *
   * Caps administration
   * ==================================================================== */

  describe("updateCaps", () => {
    it("refuses a monthly cap below the daily cap — the daily one would be unreachable", async () => {
      await expect(
        svc.updateCaps(
          { dailyPoints: 10_000, monthlyPoints: 5_000, reason: "tightening emissions" },
          "finance-1",
          null,
        ),
      ).rejects.toMatchObject({ response: { code: "CAPS_INCONSISTENT" } });
    });

    it("versions the change in platform_config and audits before/after", async () => {
      const v = await svc.updateCaps(
        { dailyPoints: 4_000, monthlyPoints: 40_000, reason: "tightening emissions" },
        "finance-1",
        "1.2.3.4",
      );
      expect(v).toEqual({ dailyPoints: 4_000, monthlyPoints: 40_000 });
      expect(config.write).toHaveBeenCalled();
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          before: { dailyPoints: 5_000, monthlyPoints: 50_000 },
          after: { dailyPoints: 4_000, monthlyPoints: 40_000 },
        }),
      );
    });
  });

  /* ==================================================================== *
   * Reversal
   * ==================================================================== */

  describe("reverse", () => {
    it("returns the Points as a NEW reversal row, never by editing the original", async () => {
      conversions.findOne.mockResolvedValue({
        id: "c1", ref: "CV-ABC", userId: "u1", pointsSpent: 2_000,
        mttCredited: "2.000000000000000000", status: "completed",
        idempotencyKey: "conversion:u1:k",
      });

      await svc.reverse("c1", "chain submission failed permanently");

      const entry = written.find((w) => w.entity === "PointsLedgerEntry")?.row;
      expect(entry?.source).toBe("reversal");
      expect(entry?.amount).toBe(2_000);
      expect(entry?.idempotencyKey).toBe("conversion:u1:k:reverse");
    });

    it("is idempotent — reversing an already-failed conversion does nothing", async () => {
      conversions.findOne.mockResolvedValue({ id: "c1", status: "failed", userId: "u1" });
      await svc.reverse("c1", "retry");
      expect(ledger.withUserLock).not.toHaveBeenCalled();
    });
  });
});
