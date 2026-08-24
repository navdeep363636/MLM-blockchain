import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { getQueueToken } from "@nestjs/bullmq";
import { OutboundWebhook, WebhookEvent } from "@/database/entities";
import { CryptoService } from "@/common/crypto/crypto.service";
import { RedisService } from "@/common/redis/redis.service";
import { Queues } from "@/queues/queue.constants";
import { webhookConfig } from "@/config/configuration";
import { WebhooksService } from "./webhooks.service";

/* ============================================================================
 * A payment webhook is an instruction to credit real money, so the tests here
 * are mostly about what the service REFUSES:
 *
 *   - an unverifiable body (no secret, no raw bytes, bad signature);
 *   - a replayed delivery;
 *   - a plaintext outbound URL.
 *
 * And one thing it must not do: hold a dedupe reservation for a delivery it
 * failed to store. That would answer the provider's retry with "duplicate" for
 * a week while nothing was ever recorded.
 * ========================================================================== */

describe("WebhooksService", () => {
  let svc: WebhooksService;
  let events: {
    save: jest.Mock; create: jest.Mock; findOne: jest.Mock; find: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let outbound: { save: jest.Mock; create: jest.Mock; findOne: jest.Mock; count: jest.Mock; createQueryBuilder: jest.Mock };
  let crypto: { verifyWebhookSignature: jest.Mock; webhookSignature: jest.Mock; hmac: jest.Mock };
  let redis: { reserve: jest.Mock; del: jest.Mock };
  let inbound: { add: jest.Mock };
  let outboundQueue: { add: jest.Mock };

  const payload = { id: "evt_1", status: "captured", reference: "DEP-1" };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);

    events = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (x: unknown) => ({ ...(x as object), id: "we1", createdAt: new Date() })),
      findOne: jest.fn(async () => null),
      find: jest.fn(async (): Promise<unknown[]> => []),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn(async (): Promise<unknown[]> => []),
        getCount: jest.fn(async () => 0),
      })),
    };
    outbound = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (x: unknown) => ({ ...(x as object), id: "ob1" })),
      findOne: jest.fn(async () => null),
      count: jest.fn(async () => 0),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn(async (): Promise<unknown[]> => []),
      })),
    };
    crypto = {
      verifyWebhookSignature: jest.fn(() => true),
      webhookSignature: jest.fn(() => "sig"),
      hmac: jest.fn(() => "deadbeef"),
    };
    redis = { reserve: jest.fn(async () => true), del: jest.fn(async () => 1) };
    inbound = { add: jest.fn(async () => undefined) };
    outboundQueue = { add: jest.fn(async () => undefined) };

    const mod = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: getRepositoryToken(WebhookEvent), useValue: events },
        { provide: getRepositoryToken(OutboundWebhook), useValue: outbound },
        { provide: CryptoService, useValue: crypto },
        { provide: RedisService, useValue: redis },
        { provide: webhookConfig.KEY, useValue: { paymentSecret: "s3cret", kycSecret: "kyc", outboundSecret: "out" } },
        { provide: getQueueToken(Queues.Webhook), useValue: inbound },
        { provide: getQueueToken(Queues.OutboundWebhook), useValue: outboundQueue },
      ],
    }).compile();

    svc = mod.get(WebhooksService);
  });

  afterEach(() => jest.restoreAllMocks());

  const receive = (over: Record<string, unknown> = {}) => svc.receive({
    provider: "payment",
    rawBody: JSON.stringify(payload),
    signature: "sig",
    payload,
    sourceIp: "1.2.3.4",
    ...over,
  });

  describe("inbound", () => {
    it("verifies against the RAW bytes, not the parsed payload", async () => {
      const rawBody = '{"id":"evt_1", "status":"captured","reference":"DEP-1"}';
      await receive({ rawBody });
      expect(crypto.verifyWebhookSignature).toHaveBeenCalledWith("s3cret", rawBody, "sig");
    });

    it("stores AND refuses an invalid signature, so probing is visible", async () => {
      crypto.verifyWebhookSignature.mockReturnValue(false);
      await expect(receive()).rejects.toMatchObject({ response: { code: "SIGNATURE_INVALID" } });
      expect(events.save).toHaveBeenCalledWith(expect.objectContaining({ signatureValid: false }));
      expect(inbound.add).not.toHaveBeenCalled();
    });

    it("refuses when the raw body was not captured, with its own reason", async () => {
      /* Not reported as a bad signature: the cause is our deployment, and an
       * operator chasing "signature invalid" would look at the provider. */
      await expect(receive({ rawBody: null })).rejects.toMatchObject({
        response: { code: "RAW_BODY_UNAVAILABLE" },
      });
      expect(crypto.verifyWebhookSignature).not.toHaveBeenCalled();
    });

    it("refuses everything when no secret is configured, rather than trusting it", async () => {
      const mod = await Test.createTestingModule({
        providers: [
          WebhooksService,
          { provide: getRepositoryToken(WebhookEvent), useValue: events },
          { provide: getRepositoryToken(OutboundWebhook), useValue: outbound },
          { provide: CryptoService, useValue: crypto },
          { provide: RedisService, useValue: redis },
          { provide: webhookConfig.KEY, useValue: { paymentSecret: "", kycSecret: "", outboundSecret: "" } },
          { provide: getQueueToken(Queues.Webhook), useValue: inbound },
          { provide: getQueueToken(Queues.OutboundWebhook), useValue: outboundQueue },
        ],
      }).compile();

      await expect(
        mod.get(WebhooksService).receive({
          provider: "payment", rawBody: "{}", signature: "sig", payload, sourceIp: null,
        }),
      ).rejects.toMatchObject({ response: { code: "WEBHOOK_NOT_CONFIGURED" } });
    });

    it("acknowledges a replay as a duplicate without enqueueing it again", async () => {
      events.findOne.mockResolvedValue({ id: "we1" });
      await expect(receive()).resolves.toMatchObject({ duplicate: true, queued: false });
      expect(inbound.add).not.toHaveBeenCalled();
    });

    it("treats a held Redis reservation as a duplicate too", async () => {
      redis.reserve.mockResolvedValue(false);
      await expect(receive()).resolves.toMatchObject({ duplicate: true });
    });

    it("RELEASES the reservation when storing fails, so the provider's retry is not swallowed", async () => {
      /* Without this, the retry would be answered "duplicate" for a week while
       * no row exists — the dedupe inverted into data loss. */
      events.save.mockRejectedValueOnce(new Error("deadlock"));
      await expect(receive()).rejects.toThrow("deadlock");
      expect(redis.del).toHaveBeenCalledWith("wh:payment:evt_1");
    });

    it("keeps a stored event when the enqueue fails, and reports it as not queued", async () => {
      inbound.add.mockRejectedValueOnce(new Error("redis gone"));
      await expect(receive()).resolves.toMatchObject({
        accepted: true, queued: false, reason: "ENQUEUE_FAILED",
      });
      /* The reservation stays: the row exists, and the sweep re-drives it. */
      expect(redis.del).not.toHaveBeenCalled();
    });

    it("enqueues with a job id derived from the provider's event id", async () => {
      await receive();
      expect(inbound.add).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ webhookEventId: "we1" }),
        { jobId: "webhook-payment-evt_1" },
      );
    });

    it("falls back to a HASH of the payload when the provider sends no id, so retries still dedupe", async () => {
      const anonymous = { status: "captured", amount: "1" };
      await svc.receive({
        provider: "payment", rawBody: JSON.stringify(anonymous), signature: "sig",
        payload: anonymous, sourceIp: null,
      });
      /* A random id would make every retry look like a new event. */
      expect(crypto.hmac).toHaveBeenCalled();
      expect(events.save).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: expect.stringContaining("deadbeef") }),
      );
    });

    it("re-drives a stranded event with the SAME job id the original enqueue would have used", async () => {
      await svc.requeueInbound({
        id: "we1", provider: "payment", eventId: "evt_1", eventType: "payment.captured",
      } as never);
      expect(inbound.add).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ webhookEventId: "we1" }),
        { jobId: "webhook-payment-evt_1" },
      );
    });
  });

  describe("outbound", () => {
    it("refuses a plaintext URL", async () => {
      await expect(
        svc.send({ url: "http://partner.example/hook", event: "x", payload: {} }),
      ).rejects.toMatchObject({ response: { code: "HTTPS_REQUIRED" } });
    });

    it("signs the exact bytes it will send", () => {
      const row = { id: "ob1", event: "payout.completed", payload: { a: 1 }, attempts: 0 } as never;
      const { body, headers } = svc.signedRequest(row);
      expect(crypto.webhookSignature).toHaveBeenCalledWith("out", body);
      expect(headers["X-MT-Signature"]).toBe("sig");
    });

    it("backs off exponentially and abandons after the attempt ceiling", async () => {
      outbound.findOne.mockResolvedValue({ id: "ob1", url: "https://p/x", attempts: 2, status: "failed" });
      const row = await svc.markFailed("ob1", 500, "boom");
      expect(row?.status).toBe("failed");
      /* attempts 3 → 2^2 = 4 hours out. */
      expect(row?.nextRetryAt?.getTime()).toBeGreaterThan(Date.now() + 3.5 * 3_600_000);

      outbound.findOne.mockResolvedValue({ id: "ob1", url: "https://p/x", attempts: 7, status: "failed" });
      const abandoned = await svc.markFailed("ob1", 500, "boom");
      expect(abandoned?.status).toBe("abandoned");
      expect(abandoned?.nextRetryAt).toBeNull();
    });
  });

  describe("status", () => {
    it("reports unhealthy when signatures were rejected, because that needs a human", async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn(async () => 3),
      };
      events.createQueryBuilder.mockReturnValue(qb);
      const status = await svc.status();
      expect(status.healthy).toBe(false);
    });
  });
});
