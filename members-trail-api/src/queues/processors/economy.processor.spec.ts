import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { Jobs } from "@/queues/queue.constants";
import { CommissionProcessor, TreasuryProcessor, WithdrawalProcessor } from "./economy.processor";
import type { PayoutInstruction } from "@/modules/wallet/withdrawal.service";

/* ============================================================================
 * The payout processor is the only place in the codebase that turns a queue
 * message into money leaving the platform, so what it may and may not decide is
 * the whole subject of this file:
 *
 *   - the destination address and the amount come from the SERVICE, never from
 *     the job payload;
 *   - a fiat payout is never sent on chain;
 *   - a request that is no longer approved is skipped, not paid.
 * ========================================================================== */

const TOKEN = "0x1111111111111111111111111111111111111111";

function job(name: string, data: unknown): Job {
  return { id: "j1", name, data, queueName: "withdrawal", attemptsMade: 0, opts: { attempts: 3 } } as unknown as Job;
}

describe("WithdrawalProcessor", () => {
  let withdrawal: { beginPayout: jest.Mock; markProcessing: jest.Mock; releaseCoolingOff: jest.Mock };
  let submitter: { enqueue: jest.Mock };
  let processor: WithdrawalProcessor;

  const chainInstruction: PayoutInstruction = {
    rail: "chain",
    withdrawalId: "w1",
    ref: "WD-1",
    toAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    amountWei: "25000000000000000000",
    idempotencyKey: "withdrawal:w1",
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    withdrawal = {
      beginPayout: jest.fn(async () => chainInstruction),
      markProcessing: jest.fn(async () => undefined),
      releaseCoolingOff: jest.fn(async () => undefined),
    };
    submitter = { enqueue: jest.fn(async () => ({ ref: "OTX-1" })) };
    processor = new WithdrawalProcessor(
      withdrawal as never,
      submitter as never,
      { contracts: { mttToken: TOKEN } } as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it("submits an ERC-20 transfer to the TOKEN contract with the whitelisted address as the argument", async () => {
    const result = await processor.process(job(Jobs.ProcessWithdrawal, { withdrawalId: "w1" }));

    expect(submitter.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "transfer",
        /* The callee is the token, not the member — sending to the member's
         * address as `to` would be a plain BNB transfer of nothing. */
        toAddress: TOKEN,
        args: [chainInstruction.toAddress, chainInstruction.amountWei],
        idempotencyKey: "withdrawal:w1",
        relatedType: "withdrawal",
        relatedId: "w1",
      }),
    );
    expect(result).toMatchObject({ rail: "chain", outboundTxRef: "OTX-1" });
  });

  it("takes the destination from the service, IGNORING any address in the job payload", async () => {
    /* A job payload is not a trustworthy source for "where the money goes": it
     * survives in Redis, can be replayed, and is not signed. */
    await processor.process(
      job(Jobs.ProcessWithdrawal, { withdrawalId: "w1", toAddress: "0xattacker", amountWei: "999" }),
    );

    const [args] = submitter.enqueue.mock.calls[0] as [{ args: string[] }];
    expect(args.args).toEqual([chainInstruction.toAddress, chainInstruction.amountWei]);
    expect(withdrawal.beginPayout).toHaveBeenCalledWith("w1");
  });

  it("never puts a FIAT payout on chain", async () => {
    withdrawal.beginPayout.mockResolvedValue({
      rail: "fiat", withdrawalId: "w1", ref: "WD-1", amountFiat: "5000.00",
    } satisfies PayoutInstruction);

    const result = await processor.process(job(Jobs.ProcessWithdrawal, { withdrawalId: "w1" }));

    expect(submitter.enqueue).not.toHaveBeenCalled();
    expect(result).toMatchObject({ rail: "fiat", pendingProvider: true });
  });

  it("skips without paying when the request is no longer approved", async () => {
    withdrawal.beginPayout.mockResolvedValue({
      rail: "none", withdrawalId: "w1", reason: "STATUS_REJECTED",
    } satisfies PayoutInstruction);

    const result = await processor.process(job(Jobs.ProcessWithdrawal, { withdrawalId: "w1" }));

    expect(submitter.enqueue).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: "STATUS_REJECTED" });
  });

  it("refuses to pay when the token address is unconfigured, rather than sending to nowhere", async () => {
    processor = new WithdrawalProcessor(
      withdrawal as never,
      submitter as never,
      { contracts: { mttToken: undefined } } as never,
    );
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    await expect(
      processor.process(job(Jobs.ProcessWithdrawal, { withdrawalId: "w1" })),
    ).rejects.toThrow(/MTT_TOKEN_ADDRESS is not configured/);
    expect(submitter.enqueue).not.toHaveBeenCalled();
  });

  it("closes a cooling-off window through the service, which decides what happens next", async () => {
    const result = await processor.process(job(Jobs.ReleaseCoolingOff, { withdrawalId: "w1" }));
    expect(withdrawal.releaseCoolingOff).toHaveBeenCalledWith("w1");
    expect(result).toEqual({ withdrawalId: "w1" });
  });
});

describe("CommissionProcessor", () => {
  let commission: { processRevenueEvent: jest.Mock; releaseQueued: jest.Mock; clawbackForRevenueEvent: jest.Mock };
  let treasury: { reverse: jest.Mock };
  let processor: CommissionProcessor;

  beforeEach(() => {
    commission = {
      processRevenueEvent: jest.fn(async () => ({ skipped: "NOT_RECONCILED" })),
      releaseQueued: jest.fn(async () => ({ released: 2 })),
      clawbackForRevenueEvent: jest.fn(async () => ({ reclaimed: "10" })),
    };
    treasury = { reverse: jest.fn(async () => undefined) };
    processor = new CommissionProcessor(commission as never, treasury as never);
  });

  it("returns the engine's skip reason without throwing, so an unreconciled event does not burn retries", async () => {
    const result = await processor.process(
      job(Jobs.ProcessRevenueEvent, { revenueEventId: "rev-1" }),
    );
    expect(result).toEqual({ skipped: "NOT_RECONCILED" });
  });

  it("reverses the revenue event BEFORE clawing back, so a partial failure cannot pay twice", async () => {
    const order: string[] = [];
    treasury.reverse.mockImplementation(async () => void order.push("reverse"));
    commission.clawbackForRevenueEvent.mockImplementation(async () => {
      order.push("clawback");
      return { reclaimed: "10" };
    });

    await processor.process(job(Jobs.ClawbackCommission, { revenueEventId: "rev-1", reason: "chargeback" }));

    expect(order).toEqual(["reverse", "clawback"]);
  });
});

describe("TreasuryProcessor", () => {
  it("reports the payout ratio it recomputed, which is the compliance tripwire", async () => {
    const treasury = { rollupPeriod: jest.fn(async () => ({ payoutRatioBps: 4_200 })) };
    const processor = new TreasuryProcessor(treasury as never);

    const result = await processor.process(job(Jobs.RollupTreasuryPeriod, { periodKey: "2026-08" }));

    expect(treasury.rollupPeriod).toHaveBeenCalledWith("2026-08");
    expect(result).toEqual({ periodKey: "2026-08", payoutRatioBps: 4_200 });
  });
});
