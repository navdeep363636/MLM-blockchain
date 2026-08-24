import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { Jobs } from "@/queues/queue.constants";
import {
  ChainIndexProcessor, ChainTxProcessor, GameValidationProcessor,
  NotificationProcessor, OutboundWebhookProcessor, WebhookProcessor, isSettled,
} from "./platform.processor";

/* ============================================================================
 * Two things in this file are load-bearing beyond the wiring:
 *
 *  - `isSettled` decides whether a payment callback credits real money. It is a
 *    whitelist, and it has to stay one.
 *  - game validation must not let a quest counter or a leaderboard write undo
 *    Points a member has already earned.
 * ========================================================================== */

function job(name: string, data: unknown = {}, queueName = "q"): Job {
  return { id: "j1", name, data, queueName, attemptsMade: 0, opts: { attempts: 3 } } as unknown as Job;
}

describe("isSettled", () => {
  it("accepts the statuses that mean the money arrived", () => {
    for (const status of ["captured", "succeeded", "settled", "paid", "payment.captured", "PAID"]) {
      expect(isSettled({ status })).toBe(true);
    }
  });

  it("refuses statuses where the money has NOT arrived yet", () => {
    /* Crediting on `authorized` or `pending` pays out before capture, while a
     * cancellation is still possible. */
    for (const status of ["pending", "authorized", "created", "processing", "requires_action"]) {
      expect(isSettled({ status })).toBe(false);
    }
  });

  it("refuses a REFUND that contains a success word — the substring trap", () => {
    /* `refund.settled` contains "settled". Substring matching here would credit
     * the deposit a second time on the refund notification. */
    expect(isSettled({ event: "refund.settled" })).toBe(false);
    expect(isSettled({ type: "charge.refunded", status: "succeeded" })).toBe(false);
    expect(isSettled({ status: "paid", event: "chargeback.created" })).toBe(false);
  });

  it("refuses an unknown status rather than guessing", () => {
    expect(isSettled({ status: "quantum_superposition" })).toBe(false);
    expect(isSettled({})).toBe(false);
  });
});

describe("GameValidationProcessor", () => {
  const outcome = {
    status: "validated" as const,
    userId: "u1",
    gameId: "g1",
    serverScore: 4_200,
    pointsAwarded: 42,
  };
  let games: { validateSession: jest.Mock };
  let quests: { onSessionValidated: jest.Mock };
  let leaderboard: { onSessionValidated: jest.Mock };
  let processor: GameValidationProcessor;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    games = { validateSession: jest.fn(async () => outcome) };
    quests = { onSessionValidated: jest.fn(async () => undefined) };
    leaderboard = { onSessionValidated: jest.fn(async () => undefined) };
    processor = new GameValidationProcessor(games as never, quests as never, leaderboard as never);
  });

  afterEach(() => jest.restoreAllMocks());

  const payload = { sessionId: "s1", telemetry: [], clientScore: 9_999, durationMs: 30_000 };

  it("advances quests and the leaderboard from the SERVER score, not the client's", async () => {
    await processor.process(job(Jobs.ValidateSession, payload));

    const signal = { userId: "u1", gameId: "g1", serverScore: 4_200, pointsAwarded: 42 };
    expect(quests.onSessionValidated).toHaveBeenCalledWith(signal);
    expect(leaderboard.onSessionValidated).toHaveBeenCalledWith(signal);
  });

  it("does not touch quests or the leaderboard when the session was rejected", async () => {
    games.validateSession.mockResolvedValue({ status: "rejected", userId: "u1", gameId: "g1", pointsAwarded: 0 });

    await processor.process(job(Jobs.ValidateSession, payload));

    expect(quests.onSessionValidated).not.toHaveBeenCalled();
    expect(leaderboard.onSessionValidated).not.toHaveBeenCalled();
  });

  it("keeps the credit when quest tracking fails — the member earned the Points", async () => {
    /* Rethrowing here would retry the whole job, and the Points credit is
     * idempotent but the member's balance is already correct. A quest counter is
     * not worth risking that. */
    quests.onSessionValidated.mockRejectedValue(new Error("quest table locked"));

    await expect(processor.process(job(Jobs.ValidateSession, payload))).resolves.toMatchObject({
      status: "validated",
    });
    expect(leaderboard.onSessionValidated).toHaveBeenCalled();
  });

  it("keeps the credit when the leaderboard write fails", async () => {
    leaderboard.onSessionValidated.mockRejectedValue(new Error("redis down"));
    await expect(processor.process(job(Jobs.ValidateSession, payload))).resolves.toMatchObject({
      status: "validated",
    });
  });
});

describe("WebhookProcessor", () => {
  let webhooks: { find: jest.Mock; markProcessed: jest.Mock };
  let deposits: { creditReconciled: jest.Mock };
  let processor: WebhookProcessor;

  const event = (over: Record<string, unknown> = {}) => ({
    id: "we1",
    provider: "payment",
    eventId: "evt_1",
    signatureValid: true,
    processedAt: null,
    payload: { status: "captured", reference: "DEP-1", amount: "100.00", currency: "INR", id: "pay_1" },
    ...over,
  });

  beforeEach(() => {
    webhooks = { find: jest.fn(async () => event()), markProcessed: jest.fn(async () => undefined) };
    deposits = { creditReconciled: jest.fn(async () => ({ ref: "DEP-1", status: "reconciled" })) };
    processor = new WebhookProcessor(webhooks as never, deposits as never);
  });

  const run = () => processor.process(job(Jobs.ProcessWebhook, {
    webhookEventId: "we1", provider: "payment", eventType: "payment.captured",
  }));

  it("credits a settled payment through the deposit service, on the SETTLED amount", async () => {
    const result = await run();
    expect(deposits.creditReconciled).toHaveBeenCalledWith(expect.objectContaining({
      ref: "DEP-1", processorRef: "pay_1", settledAmountFiat: "100.00", currency: "INR",
    }));
    expect(result).toMatchObject({ credited: true });
  });

  it("does not credit twice when the event was already processed", async () => {
    webhooks.find.mockResolvedValue(event({ processedAt: new Date() }));
    await expect(run()).resolves.toEqual({ skipped: "ALREADY_PROCESSED" });
    expect(deposits.creditReconciled).not.toHaveBeenCalled();
  });

  it("refuses to credit from an unverified payload even if one reaches the queue", async () => {
    webhooks.find.mockResolvedValue(event({ signatureValid: false }));
    await expect(run()).resolves.toEqual({ skipped: "SIGNATURE_INVALID" });
    expect(deposits.creditReconciled).not.toHaveBeenCalled();
    expect(webhooks.markProcessed).toHaveBeenCalledWith("we1", expect.stringContaining("refused"));
  });

  it("acknowledges an unrecognised event type without crediting anything", async () => {
    webhooks.find.mockResolvedValue(event({ payload: { status: "pending", reference: "DEP-1" } }));
    await expect(run()).resolves.toMatchObject({ handled: false });
    expect(deposits.creditReconciled).not.toHaveBeenCalled();
    expect(webhooks.markProcessed).toHaveBeenCalledWith("we1", null);
  });

  it("refuses a settled payment with no deposit reference rather than guessing one", async () => {
    webhooks.find.mockResolvedValue(event({ payload: { status: "captured", amount: "100.00" } }));
    await expect(run()).resolves.toEqual({ skipped: "NO_REFERENCE" });
    expect(deposits.creditReconciled).not.toHaveBeenCalled();
  });
});

describe("delivery seams", () => {
  it("records a notification as SUPPRESSED rather than claiming it was sent", async () => {
    const notifications = { recordDelivery: jest.fn(async () => undefined) };
    const processor = new NotificationProcessor(notifications as never);

    const result = await processor.process(job(Jobs.SendNotification, { deliveryId: "d1", notificationId: "n1" }));

    expect(notifications.recordDelivery).toHaveBeenCalledWith(expect.objectContaining({ status: "suppressed" }));
    expect(result).toMatchObject({ delivered: false, reason: "NO_PROVIDER" });
  });

  it("records an outbound webhook as failed with the reason, so retries stay scheduled", async () => {
    const webhooks = {
      markFailed: jest.fn(async () => ({ status: "failed", nextRetryAt: new Date("2026-01-01T00:00:00Z") })),
    };
    const processor = new OutboundWebhookProcessor(webhooks as never);

    const result = await processor.process(job(Jobs.DeliverWebhook, { outboundId: "o1" }));

    expect(webhooks.markFailed).toHaveBeenCalledWith("o1", null, expect.stringContaining("no outbound HTTP client"));
    expect(result).toMatchObject({ status: "failed", nextRetryAt: "2026-01-01T00:00:00.000Z" });
  });
});

describe("chain processors", () => {
  it("indexes and then dispatches in the same job, in that order", async () => {
    const order: string[] = [];
    const indexer = { runAll: jest.fn(async () => { order.push("index"); return 4; }) };
    const dispatcher = { dispatch: jest.fn(async () => { order.push("dispatch"); return 4; }) };
    const processor = new ChainIndexProcessor(indexer as never, dispatcher as never, {} as never);

    const result = await processor.process(job(Jobs.IndexRange));

    expect(order).toEqual(["index", "dispatch"]);
    expect(result).toEqual({ indexed: 4, dispatched: 4 });
  });

  it("skips a submit job with no outbound row instead of throwing at the submitter", async () => {
    const submitter = { submit: jest.fn(), watch: jest.fn() };
    const processor = new ChainTxProcessor(submitter as never, {} as never);

    await expect(processor.process(job(Jobs.SubmitTx, { intentRef: "TX-1" }))).resolves.toEqual({
      skipped: "NO_OUTBOUND_ID", intentRef: "TX-1",
    });
    expect(submitter.submit).not.toHaveBeenCalled();
  });
});
