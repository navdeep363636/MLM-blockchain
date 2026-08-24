import { BadRequestException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import { Deposit, User } from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { EventBusService } from "@/events";
import { AuditService } from "@/modules/audit/audit.service";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import { DepositService } from "./deposit.service";

/* ============================================================================
 * One rule under test: a deposit credits NOTHING until the processor's own
 * settlement is reconciled (conventions §9). Crediting on a client callback
 * means anyone who can call the API can mint a balance with no card and no
 * chargeback trail.
 * ========================================================================== */

function repo() {
  return {
    findOne: jest.fn(),
    save: jest.fn(async (x: unknown) => ({
      id: "dep-1", createdAt: new Date("2026-02-01T00:00:00Z"), ...(x as object),
    })),
    create: jest.fn((x: unknown) => x),
    createQueryBuilder: jest.fn(),
  };
}

const PENDING = {
  id: "dep-1",
  ref: "DP-ABC",
  userId: "u1",
  method: "card" as const,
  amountFiat: "1000.00",
  currency: "INR",
  status: "pending" as const,
  amountMtt: null,
  createdAt: new Date("2026-02-01T00:00:00Z"),
  reconciledAt: null,
  settledAt: null,
  txHash: null,
  processorPayload: null,
};

describe("DepositService", () => {
  let svc: DepositService;
  let deposits: ReturnType<typeof repo>;
  let users: ReturnType<typeof repo>;
  let ledger: { mutateMtt: jest.Mock };
  let bus: { publish: jest.Mock };
  let config: { treasuryAllocation: jest.Mock };
  let audit: { record: jest.Mock; recordOrThrow: jest.Mock };

  beforeEach(async () => {
    deposits = repo();
    users = repo();
    ledger = { mutateMtt: jest.fn(async () => ({ row: { id: "tx1" }, replayed: false })) };
    bus = { publish: jest.fn() };
    /* 100 fiat per MTT — chosen so the arithmetic in these tests is obvious. */
    config = { treasuryAllocation: jest.fn(async () => ({ fiatPerMtt: "100.000000000000000000" })) };
    audit = { record: jest.fn(), recordOrThrow: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        DepositService,
        { provide: getRepositoryToken(Deposit), useValue: deposits },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: LedgerService, useValue: ledger },
        { provide: EventBusService, useValue: bus },
        { provide: EconomyConfigService, useValue: config },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    svc = mod.get(DepositService);
    users.findOne.mockResolvedValue({ id: "u1", status: "active" });
    deposits.findOne.mockResolvedValue(null);
  });

  describe("initiate", () => {
    it("credits NOTHING — it records an intent and returns a reference", async () => {
      const r = await svc.initiate("u1", { method: "card", amountFiat: "1000", currency: "INR" }, null);

      expect(ledger.mutateMtt).not.toHaveBeenCalled();
      expect(r.status).toBe("initiated");
      expect(r.amountMtt).toBeNull();
      expect(r.creditsOnReconciliationOnly).toBe(true);
    });

    it("labels the quoted MTT as indicative — the rate at reconciliation is what counts", async () => {
      const r = await svc.initiate("u1", { method: "upi", amountFiat: "1000", currency: "INR" }, null);
      expect(r.indicativeMtt).toBe("10.000000000000000000");
    });

    it("refuses a currency the platform cannot price", async () => {
      await expect(
        svc.initiate("u1", { method: "card", amountFiat: "100", currency: "XYZ" }, null),
      ).rejects.toMatchObject({ response: { code: "CURRENCY_UNSUPPORTED" } });
    });

    it("refuses a frozen account", async () => {
      users.findOne.mockResolvedValue({ id: "u1", status: "frozen" });
      await expect(
        svc.initiate("u1", { method: "card", amountFiat: "100", currency: "INR" }, null),
      ).rejects.toMatchObject({ response: { code: "ACCOUNT_FROZEN" } });
    });

    it("refuses a non-positive amount", async () => {
      await expect(
        svc.initiate("u1", { method: "card", amountFiat: "0", currency: "INR" }, null),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("creditReconciled", () => {
    const settlement = {
      ref: "DP-ABC",
      processor: "razorpay",
      processorRef: "pay_ABC123",
      settledAmountFiat: "1000.00",
      currency: "INR",
    };

    it("credits the SETTLED amount, not the amount the member asked to deposit", async () => {
      deposits.findOne.mockResolvedValue({ ...PENDING });

      /* The processor captured 950 after a currency conversion. Crediting 1000
       * would credit money the platform never received. */
      const r = await svc.creditReconciled({ ...settlement, settledAmountFiat: "950.00" });

      expect(ledger.mutateMtt).toHaveBeenCalledWith(
        expect.objectContaining({ amountMtt: "9.500000000000000000", sourceTag: "deposit" }),
      );
      expect(r.amountFiat).toBe("950.00");
    });

    it("derives the ledger key from the deposit id, so a retried job cannot credit twice", async () => {
      deposits.findOne.mockResolvedValue({ ...PENDING });
      await svc.creditReconciled(settlement);
      expect(ledger.mutateMtt).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: "deposit:dep-1" }),
      );
    });

    it("ignores a re-delivered webhook for an already completed deposit", async () => {
      deposits.findOne.mockResolvedValue({ ...PENDING, status: "completed", amountMtt: "10" });
      const r = await svc.creditReconciled(settlement);
      expect(ledger.mutateMtt).not.toHaveBeenCalled();
      expect(r.status).toBe("completed");
    });

    it("refuses to credit a refunded deposit", async () => {
      deposits.findOne.mockResolvedValue({ ...PENDING, status: "refunded" });
      await expect(svc.creditReconciled(settlement))
        .rejects.toMatchObject({ response: { code: "DEPOSIT_REFUNDED" } });
    });

    it("refuses a settlement in a different currency than the deposit", async () => {
      deposits.findOne.mockResolvedValue({ ...PENDING });
      await expect(svc.creditReconciled({ ...settlement, currency: "USD" }))
        .rejects.toMatchObject({ response: { code: "CURRENCY_MISMATCH" } });
    });

    it("refuses an amount too small to convert to any MTT, rather than crediting zero", async () => {
      deposits.findOne.mockResolvedValue({ ...PENDING });
      /* Truncating to 2dp makes this a zero settlement — refusing is correct;
       * crediting zero MTT would mark the deposit complete for no money. */
      await expect(svc.creditReconciled({ ...settlement, settledAmountFiat: "0.001" }))
        .rejects.toMatchObject({ response: { code: "AMOUNT_TOO_SMALL" } });
    });

    it("refuses to price a deposit when no reference price is configured", async () => {
      config.treasuryAllocation.mockResolvedValue({ fiatPerMtt: "0" });
      deposits.findOne.mockResolvedValue({ ...PENDING });
      await expect(svc.creditReconciled(settlement))
        .rejects.toMatchObject({ response: { code: "REFERENCE_PRICE_UNSET" } });
    });

    it("publishes the credit marked NOT commissionable — a deposit is not revenue", async () => {
      deposits.findOne.mockResolvedValue({ ...PENDING });
      await svc.creditReconciled(settlement);
      const [, payload] = bus.publish.mock.calls[0] as [string, Record<string, unknown>];
      expect(payload.commissionable).toBe(false);
    });

    it("stamps the reconciliation and processor reference onto the row", async () => {
      const row = { ...PENDING };
      deposits.findOne.mockResolvedValue(row);
      await svc.creditReconciled(settlement);
      expect(row.status).toBe("completed");
      expect(deposits.save).toHaveBeenCalledWith(
        expect.objectContaining({ processorRef: "pay_ABC123", processor: "razorpay" }),
      );
    });
  });

  describe("markUnsuccessful", () => {
    it("REFUSES to quietly fail a deposit that was already credited", async () => {
      deposits.findOne.mockResolvedValue({ ...PENDING, status: "completed" });
      await expect(svc.markUnsuccessful("DP-ABC", "failed", "processor timeout"))
        .rejects.toMatchObject({ response: { code: "DEPOSIT_ALREADY_CREDITED" } });
    });

    it("permits an explicit refund of a credited deposit", async () => {
      const row = { ...PENDING, status: "completed" as const };
      deposits.findOne.mockResolvedValue(row);
      await svc.markUnsuccessful("DP-ABC", "refunded", "chargeback");
      expect(row.status).toBe("refunded");
    });

    it("marks an uncredited deposit expired without touching the ledger", async () => {
      deposits.findOne.mockResolvedValue({ ...PENDING });
      await svc.markUnsuccessful("DP-ABC", "expired", "payment window closed");
      expect(ledger.mutateMtt).not.toHaveBeenCalled();
    });

    it("is a no-op for an unknown reference rather than throwing at a webhook", async () => {
      deposits.findOne.mockResolvedValue(null);
      await expect(svc.markUnsuccessful("DP-NOPE", "failed", "unknown")).resolves.toBeUndefined();
    });
  });

});
