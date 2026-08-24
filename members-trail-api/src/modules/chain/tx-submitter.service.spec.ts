import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import { OutboundTransaction } from "@/database/entities";
import { EventBusService } from "@/events";
import { RedisService } from "@/common/redis/redis.service";
import { RpcService } from "./rpc.service";
import { TxSubmitterService } from "./tx-submitter.service";

/* ============================================================================
 * The failure this file exists to prevent: TWO SENDS ON THE SAME NONCE, where
 * one silently replaces the other. The replaced transaction does not error — it
 * disappears. If it was a payout, someone is simply never paid.
 *
 * So: nonces are assigned under a lock from max(node, local + 1); a stuck
 * transaction is repriced ON THE SAME NONCE; a failed submission releases its
 * nonce rather than leaving a gap; and a revert is a failure even though it was
 * mined.
 * ========================================================================== */

function repo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
    save: jest.fn(async (x: unknown) => x),
    create: jest.fn((x: unknown) => x),
    count: jest.fn(async (..._a: unknown[]) => 0),
    createQueryBuilder: jest.fn(),
  };
}

function qb(raw: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "where", "andWhere"]) b[m] = jest.fn(() => b);
  b.getRawOne = jest.fn(async () => raw);
  return b;
}

const SIGNER = "0x1111111111111111111111111111111111111111";

const QUEUED = {
  id: "tx-1",
  ref: "OTX-ABC",
  kind: "record_commission" as const,
  fromAddress: SIGNER,
  toAddress: "0x2222222222222222222222222222222222222222",
  functionName: "recordCommission",
  args: ["0xrecipient", "0xsource", 1, "1000"],
  nonce: null as number | null,
  status: "queued" as const,
  txHash: null as string | null,
  attempts: 0,
  lastError: null as string | null,
  relatedType: "commission",
  relatedId: "cm-1",
  idempotencyKey: "commission:cm-1",
  submittedAt: null as Date | null,
  blockNumber: null as number | null,
  gasUsed: null as string | null,
  confirmedAt: null as Date | null,
};

describe("TxSubmitterService", () => {
  let svc: TxSubmitterService;
  let txs: ReturnType<typeof repo>;
  let rpc: {
    canSign: boolean; signer: string; pendingNonce: jest.Mock; gasPrice: jest.Mock;
    send: jest.Mock; receipt: jest.Mock; blockNumber: jest.Mock; explorerTx: jest.Mock;
  };
  let redis: { withLock: jest.Mock };
  let bus: { publish: jest.Mock };

  beforeEach(async () => {
    txs = repo();
    rpc = {
      canSign: true,
      signer: SIGNER,
      pendingNonce: jest.fn(async () => 7),
      gasPrice: jest.fn(async () => 5_000_000_000n),
      send: jest.fn(async () => "0xnewhash"),
      receipt: jest.fn(async () => null),
      blockNumber: jest.fn(async () => 1_000),
      explorerTx: jest.fn((h: string) => `https://testnet.bscscan.com/tx/${h}`),
    };
    redis = { withLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()) };
    bus = { publish: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        TxSubmitterService,
        { provide: getRepositoryToken(OutboundTransaction), useValue: txs },
        { provide: RpcService, useValue: rpc },
        { provide: RedisService, useValue: redis },
        { provide: EventBusService, useValue: bus },
      ],
    }).compile();

    svc = mod.get(TxSubmitterService);
    txs.findOne.mockResolvedValue({ ...QUEUED });
    txs.createQueryBuilder.mockImplementation(() => qb({ max: "-1" }));
  });

  /* ==================================================================== *
   * Enqueue
   * ==================================================================== */

  describe("enqueue", () => {
    it("records the intent without signing anything", async () => {
      txs.findOne.mockResolvedValue(null);

      const row = await svc.enqueue({
        kind: "record_commission",
        functionName: "recordCommission",
        args: [],
        toAddress: "0x2222222222222222222222222222222222222222",
        idempotencyKey: "commission:cm-1",
      });

      expect(row.status).toBe("queued");
      expect(row.nonce).toBeUndefined();
      expect(rpc.send).not.toHaveBeenCalled();
    });

    it("is idempotent on the domain key — a retried job never queues a second send", async () => {
      txs.findOne.mockResolvedValue({ ...QUEUED });

      const row = await svc.enqueue({
        kind: "record_commission",
        functionName: "recordCommission",
        args: [],
        toAddress: "0x2222222222222222222222222222222222222222",
        idempotencyKey: "commission:cm-1",
      });

      expect(row.id).toBe("tx-1");
      expect(txs.save).not.toHaveBeenCalled();
    });
  });

  /* ==================================================================== *
   * Nonce discipline
   * ==================================================================== */

  describe("nonce assignment", () => {
    it("takes the node's pending nonce when we have assigned nothing yet", async () => {
      await svc.submit("tx-1");
      const [args] = rpc.send.mock.calls[0] as [{ nonce: number }];
      expect(args.nonce).toBe(7);
    });

    it("takes local+1 when we have already assigned past the node's view", async () => {
      /* The node has not yet seen nonces 7–11 that we submitted a moment ago. */
      txs.createQueryBuilder.mockImplementation(() => qb({ max: "11" }));

      await svc.submit("tx-1");

      const [args] = rpc.send.mock.calls[0] as [{ nonce: number }];
      expect(args.nonce).toBe(12);
    });

    it("serialises assignment under a per-signer lock", async () => {
      await svc.submit("tx-1");
      expect(redis.withLock).toHaveBeenCalledWith(
        `chain:nonce:${SIGNER.toLowerCase()}`, expect.any(Number), expect.any(Function),
      );
    });

    it("leaves the row queued when another worker holds the nonce lock", async () => {
      redis.withLock.mockResolvedValue(null);
      const r = await svc.submit("tx-1");
      expect(r.reason).toBe("NONCE_LOCK_HELD");
      expect(rpc.send).not.toHaveBeenCalled();
    });

    it("RELEASES the nonce on a failed submission, so it leaves no gap", async () => {
      rpc.send.mockRejectedValue(new Error("insufficient funds for gas"));

      await expect(svc.submit("tx-1")).rejects.toThrow("insufficient funds");

      const saved = txs.save.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(saved.status).toBe("queued");
      /* A gap in the sequence would stall every later transaction from this
       * address until it was filled. */
      expect(saved.nonce).toBeNull();
    });

    it("reuses an already-assigned nonce rather than taking a new one", async () => {
      txs.findOne.mockResolvedValue({ ...QUEUED, nonce: 3 });
      await svc.submit("tx-1");
      const [args] = rpc.send.mock.calls[0] as [{ nonce: number }];
      expect(args.nonce).toBe(3);
    });
  });

  /* ==================================================================== *
   * Submit guards
   * ==================================================================== */

  describe("submit", () => {
    it("marks the row submitted with its hash", async () => {
      const r = await svc.submit("tx-1");
      expect(r.status).toBe("submitted");
      expect(r.txHash).toBe("0xnewhash");
      expect(r.explorerUrl).toContain("0xnewhash");
    });

    it("REFUSES to submit again something already in flight", async () => {
      txs.findOne.mockResolvedValue({ ...QUEUED, status: "submitted", txHash: "0xold" });
      const r = await svc.submit("tx-1");
      expect(r.reason).toBe("ALREADY_SUBMITTED");
      expect(rpc.send).not.toHaveBeenCalled();
    });

    it("REFUSES to re-submit a confirmed transaction", async () => {
      txs.findOne.mockResolvedValue({ ...QUEUED, status: "confirmed", txHash: "0xold" });
      const r = await svc.submit("tx-1");
      expect(r.reason).toBe("ALREADY_CONFIRMED");
      expect(rpc.send).not.toHaveBeenCalled();
    });

    it("REFUSES to sign when no signer is configured, rather than using a default", async () => {
      rpc.canSign = false;
      const r = await svc.submit("tx-1");
      expect(r.reason).toBe("NO_SIGNER");
      expect(rpc.send).not.toHaveBeenCalled();
    });

    it("abandons after the attempt ceiling instead of retrying forever", async () => {
      txs.findOne.mockResolvedValue({ ...QUEUED, attempts: 4 });
      rpc.send.mockRejectedValue(new Error("still failing"));

      const r = await svc.submit("tx-1");

      expect(r.reason).toBe("ABANDONED");
      const failed = (bus.publish.mock.calls as [string, Record<string, unknown>][])
        .find(([n]) => n === "chain.tx_failed");
      expect(failed?.[1].reason).toContain("abandoned");
    });
  });

  /* ==================================================================== *
   * Watch
   * ==================================================================== */

  describe("watch", () => {
    const submitted = (over: Record<string, unknown> = {}) => ({
      ...QUEUED, status: "submitted", txHash: "0xhash", nonce: 7,
      submittedAt: new Date(), ...over,
    });

    it("reports pending while there is no receipt", async () => {
      txs.findOne.mockResolvedValue(submitted());
      const r = await svc.watch("tx-1");
      expect(r.reason).toBe("PENDING");
    });

    it("treats a REVERT as a failure even though the transaction was mined", async () => {
      txs.findOne.mockResolvedValue(submitted());
      rpc.receipt.mockResolvedValue({ status: "reverted", blockNumber: 990n, gasUsed: 21_000n });

      const r = await svc.watch("tx-1");

      expect(r.reason).toBe("REVERTED");
      expect(r.status).toBe("failed");
      const failed = (bus.publish.mock.calls as [string, Record<string, unknown>][])
        .find(([n]) => n === "chain.tx_failed");
      expect(failed?.[1].reason).toBe("reverted");
    });

    it("waits out the confirmation depth before declaring success", async () => {
      txs.findOne.mockResolvedValue(submitted());
      rpc.receipt.mockResolvedValue({ status: "success", blockNumber: 1_000n, gasUsed: 21_000n });
      rpc.blockNumber.mockResolvedValue(1_000);

      const r = await svc.watch("tx-1");

      expect(r.reason).toBe("AWAITING_CONFIRMATIONS");
      expect(r.status).toBe("submitted");
    });

    it("confirms once the receipt is deep enough, and publishes it", async () => {
      txs.findOne.mockResolvedValue(submitted());
      rpc.receipt.mockResolvedValue({ status: "success", blockNumber: 990n, gasUsed: 21_000n });
      rpc.blockNumber.mockResolvedValue(1_000);

      const r = await svc.watch("tx-1");

      expect(r.status).toBe("confirmed");
      const confirmed = (bus.publish.mock.calls as [string, Record<string, unknown>][])
        .find(([n]) => n === "chain.tx_confirmed");
      expect(confirmed?.[1]).toMatchObject({ relatedType: "commission", relatedId: "cm-1" });
    });

    it("does nothing for a terminal transaction", async () => {
      txs.findOne.mockResolvedValue(submitted({ status: "confirmed" }));
      const r = await svc.watch("tx-1");
      expect(r.reason).toBe("TERMINAL");
      expect(rpc.receipt).not.toHaveBeenCalled();
    });
  });

  /* ==================================================================== *
   * Repricing — the same nonce, always
   * ==================================================================== */

  describe("reprice", () => {
    const stuck = (over: Record<string, unknown> = {}) => ({
      ...QUEUED,
      status: "submitted",
      txHash: "0xoldhash",
      nonce: 7,
      /* Submitted well past the stuck threshold. */
      submittedAt: new Date(Date.now() - 10 * 60_000),
      attempts: 1,
      ...over,
    });

    it("replaces a stuck transaction ON THE SAME NONCE", async () => {
      txs.findOne.mockResolvedValue(stuck());

      const r = await svc.watch("tx-1");

      expect(r.reason).toBe("REPRICED");
      const [args] = rpc.send.mock.calls[0] as [{ nonce: number; gasPriceWei: bigint }];
      /* THE critical assertion: a new nonce would leave the original live, and
       * both could land. */
      expect(args.nonce).toBe(7);
    });

    it("bumps the gas price above the node's replacement threshold", async () => {
      txs.findOne.mockResolvedValue(stuck());

      await svc.watch("tx-1");

      const [args] = rpc.send.mock.calls[0] as [{ gasPriceWei: bigint }];
      /* 5 gwei + 12.5% × 1 attempt. */
      expect(args.gasPriceWei).toBe(5_625_000_000n);
    });

    it("compounds the bump across attempts so a congested chain still clears", async () => {
      txs.findOne.mockResolvedValue(stuck({ attempts: 3 }));
      await svc.watch("tx-1");
      const [args] = rpc.send.mock.calls[0] as [{ gasPriceWei: bigint }];
      /* 5 gwei + 37.5%. */
      expect(args.gasPriceWei).toBe(6_875_000_000n);
    });

    it("records the new hash while keeping the same nonce", async () => {
      txs.findOne.mockResolvedValue(stuck());
      await svc.watch("tx-1");
      const saved = txs.save.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(saved.txHash).toBe("0xnewhash");
      expect(saved.nonce).toBe(7);
    });

    it("does NOT reprice a transaction that has not been pending long enough", async () => {
      txs.findOne.mockResolvedValue(stuck({ submittedAt: new Date() }));
      const r = await svc.watch("tx-1");
      expect(r.reason).toBe("PENDING");
      expect(rpc.send).not.toHaveBeenCalled();
    });

    it("ABANDONS rather than repricing past the attempt ceiling", async () => {
      txs.findOne.mockResolvedValue(stuck({ attempts: 5 }));

      const r = await svc.watch("tx-1");

      expect(r.reason).toBe("ABANDONED");
      expect(rpc.send).not.toHaveBeenCalled();
    });

    it("ABANDONS on a gas-ceiling refusal instead of retrying into it", async () => {
      txs.findOne.mockResolvedValue(stuck());
      rpc.send.mockRejectedValue(new Error("GAS_CEILING_EXCEEDED: refusing to submit"));

      const r = await svc.watch("tx-1");

      expect(r.reason).toBe("ABANDONED");
    });

    it("warns that an abandoned transaction MAY STILL CONFIRM", async () => {
      txs.findOne.mockResolvedValue(stuck({ attempts: 5 }));

      await svc.watch("tx-1");

      const failed = (bus.publish.mock.calls as [string, Record<string, unknown>][])
        .find(([n]) => n === "chain.tx_failed");
      /* The mempool does not care that we stopped watching. */
      expect(failed?.[1].mayStillConfirm).toBe(true);
    });
  });

  /* ==================================================================== *
   * Operations
   * ==================================================================== */

  describe("requeue", () => {
    it("clears the nonce and hash so the retry starts clean", async () => {
      txs.findOne.mockResolvedValue({ ...QUEUED, status: "abandoned", nonce: 7, txHash: "0xold", attempts: 5 });

      const r = await svc.requeue("tx-1", "raised the gas ceiling after review");

      expect(r.status).toBe("queued");
      expect(r.nonce).toBeNull();
      expect(r.txHash).toBeNull();
    });

    it("REFUSES to requeue something that already confirmed", async () => {
      txs.findOne.mockResolvedValue({ ...QUEUED, status: "confirmed" });
      await expect(svc.requeue("tx-1", "operator thought it failed"))
        .rejects.toMatchObject({ response: { code: "ALREADY_CONFIRMED" } });
    });
  });

  describe("status", () => {
    it("reports the signer, queue depth and next nonce", async () => {
      txs.count.mockResolvedValue(2);
      const s = await svc.status();

      expect(s.signer).toBe(SIGNER);
      expect(s.canSign).toBe(true);
      expect(s.nextNonce).toBe(7);
      expect(s.gasPriceGwei).toBe("5.000");
    });

    it("is UNHEALTHY whenever anything is abandoned — that always needs a human", async () => {
      txs.count.mockImplementation(async (...args: unknown[]) =>
        (args[0] as { where: { status: string } } | undefined)?.where.status === "abandoned" ? 1 : 0,
      );
      const s = await svc.status();
      expect(s.abandoned).toBe(1);
      expect(s.healthy).toBe(false);
    });

    it("is UNHEALTHY with no signer configured", async () => {
      rpc.canSign = false;
      const s = await svc.status();
      expect(s.canSign).toBe(false);
      expect(s.healthy).toBe(false);
      expect(s.nextNonce).toBeNull();
    });

    it("is unhealthy when the node cannot answer for the nonce", async () => {
      rpc.pendingNonce.mockRejectedValue(new Error("node down"));
      const s = await svc.status();
      expect(s.nextNonce).toBeNull();
      expect(s.healthy).toBe(false);
    });
  });
});
