import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import { verifyMessage } from "viem";
import { Transaction, User, WalletAddress, Withdrawal } from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { RedisService } from "@/common/redis/redis.service";
import { AuditService } from "@/modules/audit/audit.service";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import { WalletService, buildLinkMessage } from "./wallet.service";

jest.mock("viem", () => ({ verifyMessage: jest.fn() }));
const mockVerify = verifyMessage as unknown as jest.Mock;

/* ============================================================================
 * The control under test: an address becomes a payout destination only after a
 * signature proves control of it. Without that, a phished or mistyped address
 * is an irreversible loss — and an attacker with session access needs nothing
 * else to redirect a balance.
 * ========================================================================== */

const HOUR = 3_600_000;
const ADDRESS = "0x1111111111111111111111111111111111111111";
const SIGNATURE = `0x${"ab".repeat(65)}`;

function repo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(async (): Promise<unknown[]> => []),
    save: jest.fn(async (x: unknown) => ({
      id: "addr-1", createdAt: new Date("2026-02-01T00:00:00Z"), ...(x as object),
    })),
    create: jest.fn((x: unknown) => x),
    update: jest.fn(),
    count: jest.fn(async () => 0),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

describe("WalletService", () => {
  let svc: WalletService;
  let transactions: ReturnType<typeof repo>;
  let addresses: ReturnType<typeof repo>;
  let withdrawals: ReturnType<typeof repo>;
  let users: ReturnType<typeof repo>;
  let ledger: { getBalance: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let config: { withdrawalPolicy: jest.Mock };
  let audit: { record: jest.Mock; recordOrThrow: jest.Mock };

  beforeEach(async () => {
    transactions = repo();
    addresses = repo();
    withdrawals = repo();
    users = repo();

    ledger = {
      getBalance: jest.fn(async () => ({
        points: 1_234,
        mttAvailable: "100.000000000000000000",
        mttStaked: "50.000000000000000000",
        mttPendingRewards: "5.000000000000000000",
        commissionPending: "2.000000000000000000",
        commissionAvailable: "3.000000000000000000",
        commissionLifetime: "80.000000000000000000",
        mttLockedForWithdrawal: "10.000000000000000000",
        lastLedgerAt: new Date("2026-02-01T00:00:00Z"),
      })),
    };
    redis = {
      get: jest.fn(async () => ({ nonce: "nonce-1", issuedAt: "2026-02-01T00:00:00Z" })),
      set: jest.fn(),
      del: jest.fn(),
    };
    config = { withdrawalPolicy: jest.fn(async () => ({ coolingOffHours: 24 })) };
    audit = { record: jest.fn(), recordOrThrow: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: getRepositoryToken(Transaction), useValue: transactions },
        { provide: getRepositoryToken(WalletAddress), useValue: addresses },
        { provide: getRepositoryToken(Withdrawal), useValue: withdrawals },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: LedgerService, useValue: ledger },
        { provide: RedisService, useValue: redis },
        { provide: EconomyConfigService, useValue: config },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    svc = mod.get(WalletService);
    mockVerify.mockReset();
    mockVerify.mockResolvedValue(true);
    addresses.findOne.mockResolvedValue(null);
  });

  /* ==================================================================== *
   * Balance
   * ==================================================================== */

  describe("balance", () => {
    it("includes funds held for withdrawal in the total — they are still the member's money", async () => {
      const b = await svc.balance("u1");
      /* 100 available + 50 staked + 5 rewards + 3 commission + 10 locked */
      expect(b.totalMtt).toBe("168.000000000000000000");
      expect(b.mttLockedForWithdrawal).toBe("10.000000000000000000");
    });

    it("excludes pending commission from the total — it is not yet the member's to spend", async () => {
      const b = await svc.balance("u1");
      expect(b.commissionPending).toBe("2.000000000000000000");
      /* 2 pending is reported but deliberately not summed into totalMtt. */
      expect(b.totalMtt).not.toContain("170");
    });

    it("stamps the read instant, because balances are never served from a cache", async () => {
      const b = await svc.balance("u1");
      expect(b.readAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(ledger.getBalance).toHaveBeenCalledWith("u1");
    });
  });

  /* ==================================================================== *
   * Address linking
   * ==================================================================== */

  describe("linkChallenge", () => {
    it("issues a short-lived challenge naming the platform, the account and a nonce", async () => {
      const c = await svc.linkChallenge("u1");
      expect(c.message).toContain("Members Trail");
      expect(c.message).toContain("u1");
      expect(c.expiresInSeconds).toBe(300);
      expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(Object), 300);
    });

    it("states in the signed text that it authorises no transfer", async () => {
      const c = await svc.linkChallenge("u1");
      expect(c.message).toContain("authorises no transfer");
    });
  });

  describe("linkAddress", () => {
    it("verifies the signature against the exact challenge message", async () => {
      await svc.linkAddress("u1", { address: ADDRESS, signature: SIGNATURE }, null);
      expect(mockVerify).toHaveBeenCalledWith({
        address: ADDRESS,
        message: buildLinkMessage("u1", "nonce-1"),
        signature: SIGNATURE,
      });
    });

    it("REFUSES an address whose signature does not verify", async () => {
      mockVerify.mockResolvedValue(false);
      await expect(svc.linkAddress("u1", { address: ADDRESS, signature: SIGNATURE }, null))
        .rejects.toMatchObject({ response: { code: "SIGNATURE_INVALID" } });
      expect(addresses.save).not.toHaveBeenCalled();
    });

    it("treats a malformed signature as a failed proof, not a server error", async () => {
      mockVerify.mockRejectedValue(new Error("invalid signature length"));
      await expect(svc.linkAddress("u1", { address: ADDRESS, signature: SIGNATURE }, null))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it("REFUSES when no challenge is outstanding — a signature alone is not enough", async () => {
      redis.get.mockResolvedValue(null);
      await expect(svc.linkAddress("u1", { address: ADDRESS, signature: SIGNATURE }, null))
        .rejects.toMatchObject({ response: { code: "CHALLENGE_EXPIRED" } });
      expect(mockVerify).not.toHaveBeenCalled();
    });

    it("consumes the challenge, so a captured signature cannot be replayed", async () => {
      await svc.linkAddress("u1", { address: ADDRESS, signature: SIGNATURE }, null);
      expect(redis.del).toHaveBeenCalled();
    });

    it("REFUSES an address already linked to another account — the shape of payout laundering", async () => {
      addresses.findOne.mockImplementation(async (opts: { where: Record<string, unknown> }) =>
        "userId" in opts.where && typeof opts.where.userId === "object"
          ? { id: "other", userId: "u2", address: ADDRESS }
          : null,
      );
      await expect(svc.linkAddress("u1", { address: ADDRESS, signature: SIGNATURE }, null))
        .rejects.toMatchObject({ response: { code: "ADDRESS_ALREADY_LINKED" } });
    });

    it("starts the cooling-off clock at link time, not at first withdrawal", async () => {
      const r = await svc.linkAddress("u1", { address: ADDRESS, signature: SIGNATURE }, null);
      expect(r.whitelistedAt).not.toBeNull();
      /* Freshly linked: still inside the 24h window, so not yet withdrawable. */
      expect(r.withdrawable).toBe(false);
      expect(r.withdrawableAt).not.toBeNull();
    });

    it("reports an address as withdrawable once the window has closed", async () => {
      addresses.findOne.mockImplementation(async (opts: { where: Record<string, unknown> }) =>
        opts.where.userId === "u1"
          ? {
              id: "addr-1", userId: "u1", address: ADDRESS, type: "external", isPrimary: true,
              verifiedAt: new Date(Date.now() - 48 * HOUR),
              whitelistedAt: new Date(Date.now() - 48 * HOUR),
            }
          : null,
      );
      const r = await svc.linkAddress("u1", { address: ADDRESS, signature: SIGNATURE }, null);
      expect(r.withdrawable).toBe(true);
    });

    it("lower-cases the stored address so matching is not case-sensitive", async () => {
      await svc.linkAddress(
        "u1",
        { address: ADDRESS.toUpperCase().replace("0X", "0x"), signature: SIGNATURE },
        null,
      );
      expect(addresses.save).toHaveBeenCalledWith(expect.objectContaining({ address: ADDRESS }));
    });

    it("makes the first linked address primary and mirrors it onto the account", async () => {
      const r = await svc.linkAddress("u1", { address: ADDRESS, signature: SIGNATURE }, null);
      expect(r.isPrimary).toBe(true);
      expect(users.update).toHaveBeenCalledWith(
        { id: "u1" }, { walletAddress: ADDRESS, walletType: "external" },
      );
    });

    it("does not make a second address primary automatically", async () => {
      addresses.count.mockResolvedValue(1);
      const r = await svc.linkAddress("u1", { address: ADDRESS, signature: SIGNATURE }, null);
      expect(r.isPrimary).toBe(false);
    });

    it("audits the link with the actor and the address", async () => {
      await svc.linkAddress("u1", { address: ADDRESS, signature: SIGNATURE }, "1.2.3.4");
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ action: "wallet.address.link", ip: "1.2.3.4" }),
      );
    });
  });

  describe("setPrimary", () => {
    it("refuses to promote an unverified address", async () => {
      addresses.findOne.mockResolvedValue({ id: "addr-1", userId: "u1", address: ADDRESS, verifiedAt: null });
      await expect(svc.setPrimary("u1", "addr-1", null))
        .rejects.toMatchObject({ response: { code: "ADDRESS_UNVERIFIED" } });
    });

    it("demotes the previous primary, so exactly one is ever primary", async () => {
      addresses.findOne.mockResolvedValue({
        id: "addr-2", userId: "u1", address: ADDRESS, type: "external",
        verifiedAt: new Date(), whitelistedAt: new Date(), isPrimary: false,
      });
      addresses.find.mockResolvedValue([{ id: "addr-1", isPrimary: true }]);

      await svc.setPrimary("u1", "addr-2", null);

      expect(addresses.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: "addr-1", isPrimary: false }),
      );
    });

    it("404s on an address that is not the member's", async () => {
      addresses.findOne.mockResolvedValue(null);
      await expect(svc.setPrimary("u1", "addr-9", null)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("removeAddress", () => {
    it("REFUSES to unlink a destination with a withdrawal still in flight", async () => {
      addresses.findOne.mockResolvedValue({ id: "addr-1", userId: "u1", address: ADDRESS, isPrimary: true });
      withdrawals.count.mockResolvedValue(1);

      await expect(svc.removeAddress("u1", "addr-1", null))
        .rejects.toBeInstanceOf(ConflictException);
      expect(addresses.delete).not.toHaveBeenCalled();
    });

    it("unlinks and audits when nothing is pending", async () => {
      addresses.findOne.mockResolvedValue({ id: "addr-1", userId: "u1", address: ADDRESS, isPrimary: false });
      withdrawals.count.mockResolvedValue(0);

      await svc.removeAddress("u1", "addr-1", "1.2.3.4");

      expect(addresses.delete).toHaveBeenCalledWith({ id: "addr-1" });
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ action: "wallet.address.unlink" }),
      );
    });
  });
});
