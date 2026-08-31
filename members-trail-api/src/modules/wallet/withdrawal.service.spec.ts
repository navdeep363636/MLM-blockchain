import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import { User, WalletAddress, Withdrawal } from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { EventBusService } from "@/events";
import { Queues } from "@/queues/queue.constants";
import { AuditService } from "@/modules/audit/audit.service";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import { WithdrawalService } from "./withdrawal.service";

/* ============================================================================
 * A payout is the only irreversible operation in the platform. These tests are
 * the specification of the four controls that stand between a compromised
 * session and a drained account:
 *
 *   tier limits over a ROLLING window · review threshold · destination
 *   cooling-off · funds locked in the same commit as the request row
 *
 * Every "REFUSES" test below corresponds to a way real money is lost when the
 * check is missing. A failure here is a release blocker.
 * ========================================================================== */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface MockRepo {
  findOne: jest.Mock;
  find: jest.Mock;
  save: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  count: jest.Mock;
  delete: jest.Mock;
  createQueryBuilder: jest.Mock;
}

function repo(): MockRepo {
  return {
    findOne: jest.fn(),
    find: jest.fn(async () => []),
    save: jest.fn(async (x: unknown) => x),
    create: jest.fn((x: unknown) => x),
    update: jest.fn(),
    count: jest.fn(async () => 0),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

function qb(raw: Record<string, unknown>) {
  const b: Record<string, unknown> = { calls: [] as unknown[] };
  for (const m of ["select", "where", "andWhere", "orderBy", "skip", "take"]) {
    b[m] = jest.fn((...args: unknown[]) => {
      (b.calls as unknown[]).push(args);
      return b;
    });
  }
  b.getRawOne = jest.fn(async () => raw);
  b.getManyAndCount = jest.fn(async () => [[], 0]);
  b.getMany = jest.fn(async () => []);
  return b;
}

const POLICY = {
  autoApproveMtt: "500.000000000000000000",
  coolingOffHours: 24,
  tierLimitsMtt: {
    "0": "0.000000000000000000",
    "1": "1000.000000000000000000",
    "2": "10000.000000000000000000",
  },
  rollingWindowDays: 30,
};

const VERIFIED_ADDRESS = {
  id: "addr-1",
  userId: "u1",
  address: "0x1111111111111111111111111111111111111111",
  type: "external" as const,
  isPrimary: true,
  verifiedAt: new Date(Date.now() - 10 * DAY),
  /* Linked well outside the cooling-off window by default. */
  whitelistedAt: new Date(Date.now() - 10 * DAY),
};

function activeUser(over: Partial<User> = {}): User {
  return {
    id: "u1", status: "active", kycTier: 1, riskScore: 0,
    ...over,
  } as User;
}

const BASE_REQUEST = {
  kind: "mtt" as const,
  amountMtt: "100",
  destinationAddress: VERIFIED_ADDRESS.address,
  sourceTag: "gameplay" as const,
};

describe("WithdrawalService", () => {
  let svc: WithdrawalService;
  let withdrawals: MockRepo;
  let addresses: MockRepo;
  let users: MockRepo;
  let ledger: { getBalance: jest.Mock; withUserLock: jest.Mock };
  let bus: { publish: jest.Mock };
  let config: { withdrawalPolicy: jest.Mock; write: jest.Mock };
  let audit: { record: jest.Mock; recordOrThrow: jest.Mock };
  let queue: { add: jest.Mock };

  /** Balance the mocked lock hands to the service, so a test can assert on it. */
  let balance: Record<string, unknown>;
  let written: { entity: string; row: Record<string, unknown> }[];
  let windowSum: string;

  beforeEach(async () => {
    withdrawals = repo();
    addresses = repo();
    users = repo();
    written = [];
    windowSum = "0";
    balance = {
      mttAvailable: "1000.000000000000000000",
      mttLockedForWithdrawal: "0.000000000000000000",
      lastLedgerAt: null,
    };

    ledger = {
      getBalance: jest.fn(async () => balance),
      withUserLock: jest.fn(async (_u: string, fn: (tx: unknown, b: unknown) => Promise<unknown>) => {
        const tx = {
          getRepository: (entity: { name: string }) => ({
            create: (row: Record<string, unknown>) => row,
            save: async (row: Record<string, unknown>) => {
              written.push({ entity: entity.name, row });
              return { createdAt: new Date("2026-02-01T00:00:00Z"), ...row, id: `${entity.name}-id` };
            },
          }),
        };
        return fn(tx, balance);
      }),
    };
    bus = { publish: jest.fn() };
    config = { withdrawalPolicy: jest.fn(async () => POLICY), write: jest.fn() };
    audit = { record: jest.fn(), recordOrThrow: jest.fn() };
    queue = { add: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        WithdrawalService,
        { provide: getRepositoryToken(Withdrawal), useValue: withdrawals },
        { provide: getRepositoryToken(WalletAddress), useValue: addresses },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: LedgerService, useValue: ledger },
        { provide: EventBusService, useValue: bus },
        { provide: EconomyConfigService, useValue: config },
        { provide: AuditService, useValue: audit },
        { provide: getQueueToken(Queues.Withdrawal), useValue: queue },
      ],
    }).compile();

    svc = mod.get(WithdrawalService);

    withdrawals.findOne.mockResolvedValue(null);
    withdrawals.createQueryBuilder.mockImplementation(() => qb({ sum: windowSum }));
    addresses.findOne.mockResolvedValue({ ...VERIFIED_ADDRESS });
    users.findOne.mockResolvedValue(activeUser());
  });

  const setWindowUsage = (sum: string) => {
    windowSum = sum;
    withdrawals.createQueryBuilder.mockImplementation(() => qb({ sum }));
  };

  const lastRow = () => written.find((w) => w.entity === "Withdrawal")?.row;

  /* ==================================================================== *
   * Limits
   * ==================================================================== */

  describe("limits", () => {
    it("reports tier 0 as ineligible — an unverified identity has no allowance, not a small one", async () => {
      users.findOne.mockResolvedValue(activeUser({ kycTier: 0 }));
      const l = await svc.limits("u1");
      expect(l.tierLimitMtt).toBe("0.000000000000000000");
      expect(l.eligible).toBe(false);
      expect(l.blockedBy).toBe("KYC_REQUIRED");
    });

    it("subtracts rolling-window usage from the tier ceiling", async () => {
      setWindowUsage("400");
      const l = await svc.limits("u1");
      expect(l.usedMtt).toBe("400.000000000000000000");
      expect(l.remainingMtt).toBe("600.000000000000000000");
    });

    it("never floors the remainder below zero, even if usage exceeds a lowered limit", async () => {
      setWindowUsage("5000");
      const l = await svc.limits("u1");
      expect(l.remainingMtt).toBe("0.000000000000000000");
      expect(l.blockedBy).toBe("TIER_LIMIT_REACHED");
    });

    it("caps the requestable amount at the balance when the balance is tighter", async () => {
      balance.mttAvailable = "250.000000000000000000";
      const l = await svc.limits("u1");
      expect(l.maxRequestableMtt).toBe("250.000000000000000000");
    });

    it("caps the requestable amount at the remaining allowance when the limit is tighter", async () => {
      setWindowUsage("900");
      const l = await svc.limits("u1");
      expect(l.maxRequestableMtt).toBe("100.000000000000000000");
    });

    it("reports a frozen account as ineligible — a compliance hold must hold", async () => {
      users.findOne.mockResolvedValue(activeUser({ status: "frozen" }));
      const l = await svc.limits("u1");
      expect(l.blockedBy).toBe("ACCOUNT_FROZEN");
      expect(l.eligible).toBe(false);
    });
  });

  /* ==================================================================== *
   * Eligibility
   * ==================================================================== */

  describe("request — eligibility", () => {
    it("REFUSES a frozen account", async () => {
      users.findOne.mockResolvedValue(activeUser({ status: "frozen" }));
      await expect(svc.request("u1", BASE_REQUEST, "idem-0001", null))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(written).toHaveLength(0);
    });

    it("REFUSES a suspended account", async () => {
      users.findOne.mockResolvedValue(activeUser({ status: "suspended" }));
      await expect(svc.request("u1", BASE_REQUEST, "idem-0001", null))
        .rejects.toMatchObject({ response: { code: "ACCOUNT_SUSPENDED" } });
    });

    it("REFUSES KYC tier 0", async () => {
      users.findOne.mockResolvedValue(activeUser({ kycTier: 0 }));
      await expect(svc.request("u1", BASE_REQUEST, "idem-0001", null))
        .rejects.toMatchObject({ response: { code: "KYC_REQUIRED" } });
    });

    it("REFUSES a dust amount below the network-fee floor", async () => {
      await expect(svc.request("u1", { ...BASE_REQUEST, amountMtt: "0.0001" }, "idem-0001", null))
        .rejects.toMatchObject({ response: { code: "BELOW_MINIMUM" } });
    });

    it("REFUSES a non-positive amount", async () => {
      await expect(svc.request("u1", { ...BASE_REQUEST, amountMtt: "0" }, "idem-0001", null))
        .rejects.toBeInstanceOf(BadRequestException);
    });
  });

  /* ==================================================================== *
   * Tier limits
   * ==================================================================== */

  describe("request — rolling-window tier limit", () => {
    it("REFUSES an amount over the remaining allowance, and reports what is left", async () => {
      setWindowUsage("950");
      await expect(svc.request("u1", { ...BASE_REQUEST, amountMtt: "100" }, "idem-0001", null))
        .rejects.toMatchObject({
          response: {
            code: "TIER_LIMIT_EXCEEDED",
            remaining: "50.000000000000000000",
            windowDays: 30,
          },
        });
      expect(written).toHaveLength(0);
    });

    it("permits the exact remaining allowance — the boundary is inclusive", async () => {
      setWindowUsage("900");
      const r = await svc.request("u1", { ...BASE_REQUEST, amountMtt: "100" }, "idem-0001", null);
      expect(r.amountMtt).toBe("100.000000000000000000");
    });

    it("measures the window from the withdrawals table, excluding refused requests", async () => {
      const builder = qb({ sum: "0" });
      withdrawals.createQueryBuilder.mockReturnValue(builder);

      await svc.limits("u1");

      const statusFilter = (builder.calls as unknown[][]).find(
        (c) => typeof c[0] === "string" && (c[0]).includes("w.status IN"),
      );
      expect(statusFilter).toBeDefined();
      const statuses = (statusFilter?.[1] as { statuses: string[] }).statuses;
      /* Cancelled, rejected and failed requests return their allowance — no
       * value left the platform, so they must not consume the window. */
      expect(statuses).not.toContain("rejected");
      expect(statuses).not.toContain("cancelled");
      expect(statuses).not.toContain("failed");
      expect(statuses).toContain("completed");
      expect(statuses).toContain("review");
    });

    it("uses tier 2's higher ceiling for a tier 2 member", async () => {
      users.findOne.mockResolvedValue(activeUser({ kycTier: 2 }));
      balance.mttAvailable = "9000.000000000000000000";
      const r = await svc.request("u1", { ...BASE_REQUEST, amountMtt: "5000" }, "idem-0001", null);
      expect(r.kycTierAtRequest).toBe(2);
    });

    it("snapshots the KYC tier onto the row, so a later change cannot re-justify it", async () => {
      await svc.request("u1", BASE_REQUEST, "idem-0001", null);
      expect(lastRow()?.kycTierAtRequest).toBe(1);
    });
  });

  /* ==================================================================== *
   * Destination
   * ==================================================================== */

  describe("request — destination", () => {
    it("REFUSES an address that is not linked and verified on THIS account", async () => {
      addresses.findOne.mockResolvedValue(null);
      await expect(svc.request("u1", BASE_REQUEST, "idem-0001", null))
        .rejects.toMatchObject({ response: { code: "DESTINATION_NOT_VERIFIED" } });
    });

    it("REFUSES a linked address whose signature was never verified", async () => {
      addresses.findOne.mockResolvedValue({ ...VERIFIED_ADDRESS, verifiedAt: null });
      await expect(svc.request("u1", BASE_REQUEST, "idem-0001", null))
        .rejects.toMatchObject({ response: { code: "DESTINATION_NOT_VERIFIED" } });
    });

    it("requires a destination address for an MTT withdrawal", async () => {
      await expect(
        svc.request("u1", { ...BASE_REQUEST, destinationAddress: undefined }, "idem-0001", null),
      ).rejects.toMatchObject({ response: { code: "DESTINATION_REQUIRED" } });
    });

    it("requires a payout method for a fiat withdrawal", async () => {
      await expect(
        svc.request("u1", { kind: "fiat", amountMtt: "100", sourceTag: "gameplay" }, "idem-0001", null),
      ).rejects.toMatchObject({ response: { code: "PAYOUT_METHOD_REQUIRED" } });
    });

    it("normalises the destination address to lower case for matching", async () => {
      await svc.request(
        "u1",
        { ...BASE_REQUEST, destinationAddress: VERIFIED_ADDRESS.address.toUpperCase().replace("0X", "0x") },
        "idem-0001",
        null,
      );
      expect(lastRow()?.destinationAddress).toBe(VERIFIED_ADDRESS.address);
    });
  });

  /* ==================================================================== *
   * Routing
   * ==================================================================== */

  describe("request — routing", () => {
    it("holds a payout to a newly linked address in cooling_off, and schedules the release", async () => {
      addresses.findOne.mockResolvedValue({ ...VERIFIED_ADDRESS, whitelistedAt: new Date() });

      const r = await svc.request("u1", BASE_REQUEST, "idem-0001", null);

      expect(r.status).toBe("cooling_off");
      expect(r.coolingOffUntil).not.toBeNull();
      expect(queue.add).toHaveBeenCalledWith(
        "release-cooling-off",
        { withdrawalId: expect.any(String) },
        expect.objectContaining({ delay: expect.any(Number) }),
      );
    });

    it("routes an amount above the review threshold to a human", async () => {
      users.findOne.mockResolvedValue(activeUser({ kycTier: 2 }));
      balance.mttAvailable = "5000.000000000000000000";
      const r = await svc.request("u1", { ...BASE_REQUEST, amountMtt: "600" }, "idem-0001", null);
      expect(r.status).toBe("review");
      expect(r.reviewRequired).toBe(true);
    });

    it("routes EVERY fiat payout to a human, whatever the amount", async () => {
      const r = await svc.request(
        "u1",
        { kind: "fiat", amountMtt: "10", sourceTag: "gameplay", payoutMethodRef: "pm_123456" },
        "idem-0001",
        null,
      );
      expect(r.status).toBe("review");
    });

    it("routes an elevated risk score to a human even for a small amount", async () => {
      users.findOne.mockResolvedValue(activeUser({ riskScore: 70 }));
      const r = await svc.request("u1", { ...BASE_REQUEST, amountMtt: "5" }, "idem-0001", null);
      expect(r.status).toBe("review");
    });

    it("auto-approves a small payout to a settled address and queues it once", async () => {
      const r = await svc.request("u1", BASE_REQUEST, "idem-0001", null);
      expect(r.status).toBe("approved");
      expect(queue.add).toHaveBeenCalledWith(
        "process-withdrawal",
        { withdrawalId: expect.any(String) },
        expect.objectContaining({ jobId: expect.stringContaining("payout-") }),
      );
    });

    it("cooling-off takes precedence over review — the window is not skippable", async () => {
      addresses.findOne.mockResolvedValue({ ...VERIFIED_ADDRESS, whitelistedAt: new Date() });
      const r = await svc.request("u1", { ...BASE_REQUEST, amountMtt: "900" }, "idem-0001", null);
      expect(r.status).toBe("cooling_off");
      /* The review decision is remembered for when the window closes. */
      expect(r.reviewRequired).toBe(true);
    });
  });

  /* ==================================================================== *
   * Funds
   * ==================================================================== */

  describe("request — funds", () => {
    it("locks the amount out of the spendable balance in the SAME commit as the row", async () => {
      await svc.request("u1", BASE_REQUEST, "idem-0001", null);

      expect(ledger.withUserLock).toHaveBeenCalledTimes(1);
      expect(balance.mttAvailable).toBe("900.000000000000000000");
      expect(balance.mttLockedForWithdrawal).toBe("100.000000000000000000");
      expect(lastRow()).toBeDefined();
    });

    it("REFUSES when the spendable balance is short, writing nothing", async () => {
      balance.mttAvailable = "50.000000000000000000";
      await expect(svc.request("u1", BASE_REQUEST, "idem-0001", null))
        .rejects.toMatchObject({ response: { code: "INSUFFICIENT_BALANCE" } });
      expect(written).toHaveLength(0);
    });

    it("records the source tag for AML — a payout must be traceable to how it was earned", async () => {
      await svc.request("u1", { ...BASE_REQUEST, sourceTag: "referral" }, "idem-0001", null);
      expect(lastRow()?.sourceTag).toBe("referral");
    });

    it("is idempotent: a replayed key returns the original request and locks nothing more", async () => {
      withdrawals.findOne.mockResolvedValue({
        ref: "WD-ABC", createdAt: new Date("2026-02-01T00:00:00Z"), kind: "mtt",
        amountMtt: "100", destinationAddress: VERIFIED_ADDRESS.address, sourceTag: "gameplay",
        status: "approved", kycTierAtRequest: 1, reviewRequired: false,
      });

      const r = await svc.request("u1", BASE_REQUEST, "idem-0001", null);

      expect(r.ref).toBe("WD-ABC");
      expect(ledger.withUserLock).not.toHaveBeenCalled();
    });

    it("scopes the idempotency key to the user", async () => {
      await svc.request("u1", BASE_REQUEST, "shared-key", null);
      expect(lastRow()?.idempotencyKey).toBe("withdrawal:u1:shared-key");
    });
  });

  /* ==================================================================== *
   * Cancel
   * ==================================================================== */

  describe("cancel", () => {
    it("returns the held funds to the spendable balance", async () => {
      balance.mttAvailable = "900.000000000000000000";
      balance.mttLockedForWithdrawal = "100.000000000000000000";
      withdrawals.findOne.mockResolvedValue({
        id: "w1", ref: "WD-ABC", userId: "u1", amountMtt: "100", status: "review",
        createdAt: new Date(), kind: "mtt", sourceTag: "gameplay", kycTierAtRequest: 1,
        reviewRequired: true,
      });

      await svc.cancel("u1", "WD-ABC", null);

      expect(balance.mttAvailable).toBe("1000.000000000000000000");
      expect(balance.mttLockedForWithdrawal).toBe("0.000000000000000000");
    });

    it("REFUSES to cancel once the payout is being processed", async () => {
      withdrawals.findOne.mockResolvedValue({ id: "w1", ref: "WD-ABC", userId: "u1", status: "processing" });
      await expect(svc.cancel("u1", "WD-ABC", null))
        .rejects.toMatchObject({ response: { code: "NOT_CANCELLABLE" } });
    });

    it("REFUSES to cancel a completed payout — the money is gone", async () => {
      withdrawals.findOne.mockResolvedValue({ id: "w1", ref: "WD-ABC", userId: "u1", status: "completed" });
      await expect(svc.cancel("u1", "WD-ABC", null)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  /* ==================================================================== *
   * Compliance review
   * ==================================================================== */

  describe("approve", () => {
    const underReview = {
      id: "w1", ref: "WD-ABC", userId: "u1", amountMtt: "600", status: "review" as const,
      createdAt: new Date(), kind: "mtt" as const, sourceTag: "gameplay" as const,
      kycTierAtRequest: 1, reviewRequired: true, coolingOffUntil: null,
    };

    it("REFUSES when the reviewer is the account that requested the payout", async () => {
      withdrawals.findOne.mockResolvedValue({ ...underReview });
      await expect(svc.approve("w1", "looks fine", "u1", null))
        .rejects.toMatchObject({ response: { code: "FOUR_EYES_VIOLATION" } });
    });

    it("REFUSES to release before the cooling-off window closes", async () => {
      withdrawals.findOne.mockResolvedValue({
        ...underReview, status: "cooling_off", coolingOffUntil: new Date(Date.now() + HOUR),
      });
      await expect(svc.approve("w1", "urgent", "staff-1", null))
        .rejects.toMatchObject({ response: { code: "COOLING_OFF_ACTIVE" } });
    });

    it("approves and queues the payout, recording the reviewer and reason", async () => {
      withdrawals.findOne.mockResolvedValue({ ...underReview });
      const r = await svc.approve("w1", "verified against KYC file", "staff-1", "1.2.3.4");

      expect(r.status).toBe("approved");
      expect(queue.add).toHaveBeenCalledWith(
        "process-withdrawal", { withdrawalId: "w1" }, { jobId: "payout-w1" },
      );
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "wallet.withdrawal.approve",
          reason: "verified against KYC file",
          approvedById: "staff-1",
        }),
      );
    });

    it("refuses to approve something that is not awaiting review", async () => {
      withdrawals.findOne.mockResolvedValue({ ...underReview, status: "completed" });
      await expect(svc.approve("w1", "again", "staff-1", null))
        .rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("reject", () => {
    it("returns the held funds and records the reason shown to the member", async () => {
      balance.mttAvailable = "400.000000000000000000";
      balance.mttLockedForWithdrawal = "600.000000000000000000";
      withdrawals.findOne.mockResolvedValue({
        id: "w1", ref: "WD-ABC", userId: "u1", amountMtt: "600", status: "review",
        createdAt: new Date(), kind: "mtt", sourceTag: "gameplay", kycTierAtRequest: 1,
        reviewRequired: true,
      });

      const r = await svc.reject("w1", "source of funds unclear", "staff-1", null);

      expect(r.status).toBe("rejected");
      expect(r.rejectionReason).toBe("source of funds unclear");
      expect(balance.mttAvailable).toBe("1000.000000000000000000");
      expect(balance.mttLockedForWithdrawal).toBe("0.000000000000000000");
    });
  });

  /* ==================================================================== *
   * Lifecycle
   * ==================================================================== */

  describe("releaseCoolingOff", () => {
    it("routes to review when the stored decision said review — policy drift cannot downgrade it", async () => {
      withdrawals.findOne.mockResolvedValue({
        id: "w1", status: "cooling_off", reviewRequired: true,
        coolingOffUntil: new Date(Date.now() - HOUR), userId: "u1",
      });
      await svc.releaseCoolingOff("w1");
      expect(withdrawals.save).toHaveBeenCalledWith(expect.objectContaining({ status: "review" }));
      expect(queue.add).not.toHaveBeenCalled();
    });

    it("approves and queues when no review was required", async () => {
      withdrawals.findOne.mockResolvedValue({
        id: "w1", status: "cooling_off", reviewRequired: false,
        coolingOffUntil: new Date(Date.now() - HOUR), userId: "u1",
      });
      await svc.releaseCoolingOff("w1");
      expect(queue.add).toHaveBeenCalled();
    });

    it("leaves the hold in place if the job fires before the window actually closed", async () => {
      withdrawals.findOne.mockResolvedValue({
        id: "w1", status: "cooling_off", reviewRequired: false,
        coolingOffUntil: new Date(Date.now() + HOUR), userId: "u1",
      });
      await svc.releaseCoolingOff("w1");
      expect(withdrawals.save).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe("sweepExpiredCoolingOff", () => {
    /* The delayed release job lives in Redis for the length of the window — 48
       hours by default. Redis is not the system of record, and losing that job
       used to leave the request in cooling_off forever with the member's funds
       locked and nothing looking at it. */
    it("releases a window that closed while its scheduled job went missing", async () => {
      const stuck = {
        id: "w1", ref: "WD-STUCK", status: "cooling_off", reviewRequired: false,
        coolingOffUntil: new Date(Date.now() - HOUR), userId: "u1",
      };
      withdrawals.find.mockResolvedValue([stuck]);
      withdrawals.findOne.mockResolvedValue(stuck);

      const result = await svc.sweepExpiredCoolingOff();

      expect(result.released).toBe(1);
      expect(withdrawals.save).toHaveBeenCalledWith(expect.objectContaining({ status: "approved" }));
      expect(queue.add).toHaveBeenCalled();
    });

    it("finds nothing on a healthy instance", async () => {
      withdrawals.find.mockResolvedValue([]);
      const result = await svc.sweepExpiredCoolingOff();
      expect(result.released).toBe(0);
      expect(withdrawals.save).not.toHaveBeenCalled();
    });

    it("keeps going when one row cannot be released", async () => {
      /* A single wedged withdrawal must not stop the sweep clearing the rest —
         clearing them is the entire purpose. */
      const rows = [
        { id: "bad", ref: "WD-BAD", status: "cooling_off", reviewRequired: false,
          coolingOffUntil: new Date(Date.now() - HOUR), userId: "u1" },
        { id: "good", ref: "WD-GOOD", status: "cooling_off", reviewRequired: false,
          coolingOffUntil: new Date(Date.now() - HOUR), userId: "u2" },
      ];
      withdrawals.find.mockResolvedValue(rows);
      withdrawals.findOne.mockImplementation(async (opts: { where: { id: string } }) =>
        rows.find((r) => r.id === opts.where.id) ?? null,
      );
      withdrawals.save.mockImplementation(async (row: { id: string }) => {
        if (row.id === "bad") throw new Error("deadlock");
        return row;
      });

      const result = await svc.sweepExpiredCoolingOff();
      expect(result.released).toBe(1);
    });
  });

  describe("markCompleted", () => {
    const approved = {
      id: "w1", ref: "WD-ABC", userId: "u1", amountMtt: "100.000000000000000000",
      status: "approved" as const, sourceTag: "gameplay" as const,
      destinationAddress: VERIFIED_ADDRESS.address, idempotencyKey: "withdrawal:u1:k",
      createdAt: new Date(), kind: "mtt" as const, kycTierAtRequest: 1, reviewRequired: false,
    };

    it("writes a NEGATIVE transaction and clears the hold in one commit", async () => {
      balance.mttLockedForWithdrawal = "100.000000000000000000";
      withdrawals.findOne.mockResolvedValue({ ...approved });

      await svc.markCompleted("w1", "0xabc");

      const tx = written.find((w) => w.entity === "Transaction")?.row;
      expect(tx?.amountMtt).toBe("-100.000000000000000000");
      expect(tx?.type).toBe("withdrawal");
      expect(balance.mttLockedForWithdrawal).toBe("0.000000000000000000");
      /* The funds must NOT come back to available — they left the platform. */
      expect(balance.mttAvailable).toBe("1000.000000000000000000");
    });

    it("derives the settlement ledger key from the request, so a re-delivered confirmation cannot debit twice", async () => {
      withdrawals.findOne.mockResolvedValue({ ...approved });
      await svc.markCompleted("w1", "0xabc");
      const tx = written.find((w) => w.entity === "Transaction")?.row;
      expect(tx?.idempotencyKey).toBe("withdrawal:u1:k:settle");
    });

    it("is idempotent — a second confirmation for a completed payout does nothing", async () => {
      withdrawals.findOne.mockResolvedValue({ ...approved, status: "completed" });
      await svc.markCompleted("w1", "0xabc");
      expect(ledger.withUserLock).not.toHaveBeenCalled();
    });

    it("stamps first use on the destination only when it was never used before", async () => {
      withdrawals.findOne.mockResolvedValue({ ...approved });
      await svc.markCompleted("w1", "0xabc");
      const [where] = addresses.update.mock.calls[0] as [Record<string, unknown>];
      /* An undefined filter would be dropped by TypeORM and overwrite the
       * original timestamp on every payout. */
      expect(where.firstUsedAt).toBeDefined();
    });
  });

  describe("markFailed", () => {
    it("returns the funds to the member — a failed payout is not a loss", async () => {
      balance.mttAvailable = "900.000000000000000000";
      balance.mttLockedForWithdrawal = "100.000000000000000000";
      withdrawals.findOne.mockResolvedValue({
        id: "w1", ref: "WD-ABC", userId: "u1", amountMtt: "100", status: "processing",
      });

      await svc.markFailed("w1", "chain submission reverted");

      expect(balance.mttAvailable).toBe("1000.000000000000000000");
      expect(balance.mttLockedForWithdrawal).toBe("0.000000000000000000");
    });

    it("does not double-release a payout that already completed", async () => {
      withdrawals.findOne.mockResolvedValue({ id: "w1", status: "completed", userId: "u1" });
      await svc.markFailed("w1", "late failure report");
      expect(ledger.withUserLock).not.toHaveBeenCalled();
    });
  });

  /* ==================================================================== *
   * Policy
   * ==================================================================== */

  describe("updatePolicy", () => {
    it("REFUSES to give tier 1 a higher ceiling than tier 2", async () => {
      await expect(
        svc.updatePolicy(
          {
            autoApproveMtt: "500", tier1Mtt: "9000", tier2Mtt: "1000",
            coolingOffHours: "24", reason: "raising tier 1 for the promo",
          },
          "finance-1",
          null,
        ),
      ).rejects.toMatchObject({ response: { code: "TIERS_INVERTED" } });
    });

    it("keeps tier 0 at zero — that is a rule, not a configurable number", async () => {
      const v = await svc.updatePolicy(
        {
          autoApproveMtt: "750", tier1Mtt: "2000", tier2Mtt: "20000",
          coolingOffHours: "48", reason: "annual limit review",
        },
        "finance-1",
        "1.2.3.4",
      );
      expect(v.tierLimitsMtt["0"]).toBe("0.000000000000000000");
      expect(v.coolingOffHours).toBe(48);
      expect(config.write).toHaveBeenCalled();
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ action: "wallet.withdrawal.policy.update" }),
      );
    });

    it("rejects an absurd cooling-off window", async () => {
      await expect(
        svc.updatePolicy(
          {
            autoApproveMtt: "500", tier1Mtt: "1000", tier2Mtt: "10000",
            coolingOffHours: "10000", reason: "lock everything down",
          },
          "finance-1",
          null,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
