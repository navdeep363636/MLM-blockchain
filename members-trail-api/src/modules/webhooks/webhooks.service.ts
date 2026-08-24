import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { Repository } from "typeorm";
import { OutboundWebhook, WebhookEvent } from "@/database/entities";
import { Jobs, Queues, jobKey } from "@/queues/queue.constants";
import { CryptoService } from "@/common/crypto/crypto.service";
import { RedisService } from "@/common/redis/redis.service";
import { CacheKeys, Ttl } from "@/common/redis/cache.keys";
import { webhookConfig, type WebhookConfig } from "@/config/configuration";
import { addHours } from "@/common/utils";

/* ============================================================================
 * Webhooks, inbound and outbound.
 *
 * The inbound path is the one that matters, because a payment webhook is an
 * instruction to credit real money to an account. Four rules:
 *
 *  1. THE SIGNATURE IS VERIFIED BEFORE ANYTHING ELSE, against the raw body. Not
 *     the parsed body — re-serialising JSON changes the bytes and invalidates the
 *     comparison, which teams then "fix" by skipping verification.
 *
 *  2. AN INVALID SIGNATURE IS STORED AND REFUSED, not silently dropped. A burst
 *     of invalid signatures is either a misconfiguration or someone probing, and
 *     both are worth being able to see.
 *
 *  3. DEDUPED ON THE PROVIDER'S OWN EVENT ID. Providers retry; a replayed
 *     delivery must resolve to the stored event rather than credit twice. The
 *     UNIQUE(provider, eventId) index is the durable half, Redis the fast half.
 *
 *  4. ACKNOWLEDGED FAST, PROCESSED ON A QUEUE. A provider that times out retries,
 *     which multiplies the load exactly when the system is already slow. The
 *     handler stores, enqueues and returns.
 *
 * Outbound deliveries are signed the same way, so a partner can verify us with
 * the same discipline we demand of our providers.
 * ========================================================================== */

/** Providers we accept, with the secret each is verified against. */
export type WebhookProvider = "payment" | "kyc";

/** Delivery attempts before an outbound webhook is abandoned. */
const MAX_OUTBOUND_ATTEMPTS = 8;

export interface InboundResult {
  accepted: boolean;
  eventId: string;
  duplicate: boolean;
  queued: boolean;
  reason?: string;
}

@Injectable()
export class WebhooksService {
  private readonly log = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(WebhookEvent) private readonly events: Repository<WebhookEvent>,
    @InjectRepository(OutboundWebhook) private readonly outbound: Repository<OutboundWebhook>,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    @Inject(webhookConfig.KEY) private readonly cfg: WebhookConfig,
    @InjectQueue(Queues.Webhook) private readonly inboundQueue: Queue,
    @InjectQueue(Queues.OutboundWebhook) private readonly outboundQueue: Queue,
  ) {}

  /* ==================================================================== *
   * Inbound
   * ==================================================================== */

  /**
   * Accepts a provider callback.
   *
   * `rawBody` is the exact bytes received. Passing the parsed-and-re-serialised
   * body here would compare a different string to the one the provider signed —
   * the single most common reason webhook verification gets disabled "because it
   * never works".
   */
  async receive(params: {
    provider: WebhookProvider;
    /** Null when the platform did not capture the raw body — see below. */
    rawBody: string | null;
    signature: string | undefined;
    payload: Record<string, unknown>;
    sourceIp: string | null;
  }): Promise<InboundResult> {
    const secret = this.secretFor(params.provider);
    if (!secret) {
      /* No secret configured means we cannot verify anything, so we refuse
       * everything rather than accept unverified instructions about money. */
      this.log.error(`no webhook secret configured for ${params.provider} — refusing the delivery`);
      throw new BadRequestException({
        code: "WEBHOOK_NOT_CONFIGURED",
        message: "This webhook endpoint is not configured",
      });
    }

    const eventId = this.extractEventId(params.provider, params.payload);
    const eventType = this.extractEventType(params.payload);

    if (params.rawBody === null) {
      /* A deployment misconfiguration, not a provider error: without the raw
       * bytes there is nothing trustworthy to verify against. Reported as its
       * own code so an operator sees the cause instead of a wall of
       * "signature invalid". */
      this.log.error(
        `raw body unavailable for ${params.provider} webhook ${eventId} — ` +
        "verification is impossible; check that rawBody capture is enabled",
      );
      await this.store({
        provider: params.provider,
        eventId: `unverifiable-${eventId}-${Date.now()}`,
        eventType,
        payload: params.payload,
        signatureValid: false,
        sourceIp: params.sourceIp,
        error: "raw body unavailable — signature could not be verified",
      });
      throw new BadRequestException({
        code: "RAW_BODY_UNAVAILABLE",
        message: "The request body could not be verified",
      });
    }

    /* Rule 1: verified against the raw bytes, before anything is trusted. */
    const signatureValid = Boolean(
      params.signature &&
      this.crypto.verifyWebhookSignature(secret, params.rawBody, params.signature),
    );

    if (!signatureValid) {
      /* Rule 2: recorded, then refused. */
      await this.store({
        provider: params.provider,
        eventId: `invalid:${eventId}:${Date.now()}`,
        eventType,
        payload: params.payload,
        signatureValid: false,
        sourceIp: params.sourceIp,
        error: "signature verification failed",
      });

      this.log.warn(
        `REJECTED ${params.provider} webhook ${eventId} from ${params.sourceIp ?? "unknown"}: ` +
        "signature verification failed",
      );

      throw new BadRequestException({
        code: "SIGNATURE_INVALID",
        message: "The webhook signature could not be verified",
      });
    }

    /* Rule 3: dedupe. The stored row is the durable answer; Redis only covers
     * the gap the row cannot — two copies of one delivery arriving before either
     * has committed. Hence the short reservation and the long-lived index. */
    const seenKey = CacheKeys.webhookInflight(params.provider, eventId);
    const fresh = await this.redis.reserve(seenKey, Ttl.webhookInflight);

    const existing = await this.events.findOne({
      where: { provider: params.provider, eventId },
    });

    if (existing || !fresh) {
      this.log.debug(`duplicate ${params.provider} webhook ${eventId} ignored`);
      return { accepted: true, eventId, duplicate: true, queued: false, reason: "DUPLICATE" };
    }

    /* The Redis reservation is now held. If storing or enqueueing fails, it has
     * to be released — otherwise the provider's retry would be answered with
     * "duplicate" for the next hour while nothing was ever recorded, which is
     * the failure mode this dedupe is supposed to prevent, inverted. */
    let row: WebhookEvent;
    try {
      row = await this.store({
        provider: params.provider,
        eventId,
        eventType,
        payload: params.payload,
        signatureValid: true,
        sourceIp: params.sourceIp,
        error: null,
      });
    } catch (e) {
      await this.redis.del(seenKey);
      throw e;
    }

    /* Rule 4: acknowledge now, process on the queue. */
    try {
      await this.inboundQueue.add(
        Jobs.ProcessWebhook,
        { webhookEventId: row.id, provider: params.provider, eventType },
        { jobId: jobKey(`webhook:${params.provider}:${eventId}`) },
      );
    } catch (e) {
      /* The event IS stored, so this is recoverable without the provider: the
       * stale-inbound cron picks up verified events with no processedAt. We
       * still report it as unqueued rather than pretending it is in flight. */
      this.log.error(
        `stored ${params.provider} webhook ${eventId} but could not enqueue it: ` +
        `${e instanceof Error ? e.message : String(e)} — the retry sweep will pick it up`,
      );
      return { accepted: true, eventId, duplicate: false, queued: false, reason: "ENQUEUE_FAILED" };
    }

    return { accepted: true, eventId, duplicate: false, queued: true };
  }

  private async store(params: {
    provider: string;
    eventId: string;
    eventType: string | null;
    payload: Record<string, unknown>;
    signatureValid: boolean;
    sourceIp: string | null;
    error: string | null;
  }): Promise<WebhookEvent> {
    return this.events.save(
      this.events.create({
        provider: params.provider,
        eventId: params.eventId,
        eventType: params.eventType,
        payload: params.payload,
        signatureValid: params.signatureValid,
        sourceIp: params.sourceIp,
        error: params.error,
        attempts: 0,
        processedAt: null,
      }),
    );
  }

  private secretFor(provider: WebhookProvider): string | null {
    const secret = provider === "payment" ? this.cfg.paymentSecret : this.cfg.kycSecret;
    return secret && secret.trim().length > 0 ? secret : null;
  }

  /**
   * Pulls the provider's event id out of the payload.
   *
   * Falls back to a hash of the whole payload rather than a random value: a
   * random id would make every retry look like a new event, which is exactly the
   * double-credit this is meant to prevent.
   */
  private extractEventId(provider: WebhookProvider, payload: Record<string, unknown>): string {
    const candidates = ["id", "event_id", "eventId", "reference", "notification_id"];
    for (const key of candidates) {
      const value = payload[key];
      if (typeof value === "string" && value.length > 0) return value.slice(0, 180);
    }
    return `${provider}:${this.crypto.hmac(JSON.stringify(payload)).slice(0, 40)}`;
  }

  private extractEventType(payload: Record<string, unknown>): string | null {
    for (const key of ["type", "event", "event_type", "eventType", "status"]) {
      const value = payload[key];
      if (typeof value === "string" && value.length > 0) return value.slice(0, 110);
    }
    return null;
  }

  /* ==================================================================== *
   * Inbound processing — called by the queue processor
   * ==================================================================== */

  async markProcessed(id: string, error?: string | null): Promise<void> {
    const row = await this.events.findOne({ where: { id } });
    if (!row) return;

    row.attempts += 1;
    row.error = error ? error.slice(0, 1_000) : null;
    /* Stamped even on a terminal failure: an event that can never succeed must
     * leave the queue, with the reason preserved. */
    row.processedAt = new Date();
    await this.events.save(row);
  }

  async recordFailure(id: string, error: string): Promise<number> {
    const row = await this.events.findOne({ where: { id } });
    if (!row) return 0;

    row.attempts += 1;
    row.error = error.slice(0, 1_000);
    await this.events.save(row);
    return row.attempts;
  }

  async find(id: string): Promise<WebhookEvent | null> {
    return this.events.findOne({ where: { id } });
  }

  /**
   * Unprocessed inbound events, for the ops dashboard and the retry sweep.
   *
   * `minAgeMinutes` exists for the sweep: an event stored two seconds ago is
   * almost certainly sitting in the queue right now, and requeueing it would add
   * contention rather than recovery. Only events old enough that the queue would
   * have got to them are worth re-driving.
   */
  async unprocessed(limit = 100, minAgeMinutes = 0): Promise<WebhookEvent[]> {
    const query = this.events
      .createQueryBuilder("w")
      .where("w.processedAt IS NULL")
      .andWhere("w.signatureValid = true");

    if (minAgeMinutes > 0) {
      query.andWhere("w.createdAt <= :before", { before: new Date(Date.now() - minAgeMinutes * 60_000) });
    }

    return query.orderBy("w.createdAt", "ASC").take(Math.min(limit, 500)).getMany();
  }

  /**
   * Re-enqueues a stored inbound event that never reached the queue.
   *
   * Needed because storing the event and enqueueing it are two operations: a
   * crash between them leaves a verified, unprocessed event that no provider
   * will send again (their retry sees the stored row and is answered as a
   * duplicate). Without this sweep the money it represents waits for a human to
   * read a warning log.
   *
   * The job id is the same one `receive` would have used, so if the original
   * enqueue did in fact land, this is a no-op rather than a double credit.
   */
  async requeueInbound(row: WebhookEvent): Promise<void> {
    await this.inboundQueue.add(
      Jobs.ProcessWebhook,
      { webhookEventId: row.id, provider: row.provider, eventType: row.eventType },
      { jobId: jobKey(`webhook:${row.provider}:${row.eventId}`) },
    );
  }

  /** Rejected deliveries — a burst here is a misconfiguration or a probe. */
  async rejected(limit = 100): Promise<WebhookEvent[]> {
    return this.events.find({
      where: { signatureValid: false },
      order: { createdAt: "DESC" },
      take: Math.min(limit, 500),
    });
  }

  /* ==================================================================== *
   * Outbound
   * ==================================================================== */

  /**
   * Queues a signed outbound delivery to a partner.
   *
   * Signed with the same scheme we verify inbound, so a partner can hold us to
   * the same standard. The signature is over the exact body we will send.
   */
  async send(params: {
    url: string;
    event: string;
    payload: Record<string, unknown>;
  }): Promise<OutboundWebhook> {
    if (!/^https:\/\//.test(params.url)) {
      /* Plaintext HTTP would put a signed payload about a member's money on the
       * wire in the clear. */
      throw new BadRequestException({
        code: "HTTPS_REQUIRED",
        message: "Outbound webhooks must use HTTPS",
      });
    }

    const row = await this.outbound.save(
      this.outbound.create({
        url: params.url,
        event: params.event,
        payload: params.payload,
        status: "queued",
        attempts: 0,
      }),
    );

    await this.outboundQueue.add(
      Jobs.DeliverWebhook,
      { outboundId: row.id },
      { jobId: jobKey(`outbound-webhook:${row.id}`) },
    );

    return row;
  }

  /** The body and headers the processor should send. */
  signedRequest(row: OutboundWebhook): {
    body: string;
    headers: Record<string, string>;
  } {
    const body = JSON.stringify({
      event: row.event,
      payload: row.payload,
      deliveredAt: new Date().toISOString(),
      attempt: row.attempts + 1,
    });

    const secret = this.cfg.outboundSecret ?? "";
    return {
      body,
      headers: {
        "Content-Type": "application/json",
        "X-MT-Event": row.event,
        "X-MT-Delivery": row.id,
        /* Over the exact bytes being sent. */
        "X-MT-Signature": secret ? this.crypto.webhookSignature(secret, body) : "",
      },
    };
  }

  async markDelivered(id: string, statusCode: number): Promise<void> {
    const row = await this.outbound.findOne({ where: { id } });
    if (!row) return;

    row.status = "sent";
    row.attempts += 1;
    row.lastStatusCode = statusCode;
    row.lastError = null;
    row.deliveredAt = new Date();
    row.nextRetryAt = null;
    await this.outbound.save(row);
  }

  /**
   * Records a failed delivery and schedules the retry.
   *
   * Exponential backoff, and abandoned after a bounded number of attempts — a
   * partner endpoint that has been down for a week does not need us retrying it
   * every minute, and the queue should not be full of it.
   */
  async markFailed(id: string, statusCode: number | null, error: string): Promise<OutboundWebhook | null> {
    const row = await this.outbound.findOne({ where: { id } });
    if (!row) return null;

    row.attempts += 1;
    row.lastStatusCode = statusCode;
    row.lastError = error.slice(0, 1_000);

    if (row.attempts >= MAX_OUTBOUND_ATTEMPTS) {
      row.status = "abandoned";
      row.nextRetryAt = null;
      this.log.error(
        `abandoned outbound webhook ${row.id} to ${row.url} after ${row.attempts} attempts`,
      );
    } else {
      row.status = "failed";
      /* 1h, 2h, 4h… bounded by the attempt ceiling above. */
      row.nextRetryAt = addHours(new Date(), 2 ** (row.attempts - 1));
    }

    await this.outbound.save(row);
    return row;
  }

  /** Failed deliveries whose retry is due. Run by the cron. */
  async dueForRetry(limit = 100): Promise<OutboundWebhook[]> {
    return this.outbound
      .createQueryBuilder("o")
      .where("o.status = :status", { status: "failed" })
      .andWhere("o.nextRetryAt IS NOT NULL")
      .andWhere("o.nextRetryAt <= :now", { now: new Date() })
      .orderBy("o.nextRetryAt", "ASC")
      .take(Math.min(limit, 500))
      .getMany();
  }

  async requeueOutbound(id: string): Promise<void> {
    await this.outboundQueue.add(
      Jobs.DeliverWebhook,
      { outboundId: id },
      /* The attempt count is part of the id so a retry is a distinct job. */
      { jobId: jobKey(`outbound-webhook:${id}:retry:${Date.now()}`) },
    );
  }

  /** Delivery health for the ops dashboard. */
  async status(): Promise<{
    inboundUnprocessed: number;
    inboundRejected24h: number;
    outboundQueued: number;
    outboundFailed: number;
    outboundAbandoned: number;
    healthy: boolean;
  }> {
    const since = new Date(Date.now() - 86_400_000);

    const [inboundUnprocessed, outboundQueued, outboundFailed, outboundAbandoned] = await Promise.all([
      this.events
        .createQueryBuilder("w")
        .where("w.processedAt IS NULL")
        .andWhere("w.signatureValid = true")
        .getCount(),
      this.outbound.count({ where: { status: "queued" } }),
      this.outbound.count({ where: { status: "failed" } }),
      this.outbound.count({ where: { status: "abandoned" } }),
    ]);

    const inboundRejected24h = await this.events
      .createQueryBuilder("w")
      .where("w.signatureValid = false")
      .andWhere("w.createdAt >= :since", { since })
      .getCount();

    return {
      inboundUnprocessed,
      inboundRejected24h,
      outboundQueued,
      outboundFailed,
      outboundAbandoned,
      /* Rejected signatures make this unhealthy on purpose: it is either our
       * misconfiguration or someone probing, and both need looking at. */
      healthy: inboundRejected24h === 0 && outboundAbandoned === 0,
    };
  }
}
