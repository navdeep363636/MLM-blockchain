import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { randomUUID } from "node:crypto";
import * as amqp from "amqplib";
import { queueConfig, type QueueConfig } from "@/config/configuration";
import type { DomainEvent, EventName } from "./domain-events";

/* ============================================================================
 * Event bus with a pluggable transport.
 *
 * Why both:
 *  - `memory` (default): a monolith does not need a broker to talk to itself,
 *    and an in-process emitter keeps handlers inside the publisher's transaction
 *    boundary awareness and adds no operational surface.
 *  - `rabbitmq`: the moment a module is extracted into its own service, the same
 *    publish() calls fan out over a topic exchange instead. Producers do not
 *    change, which is the whole point of putting this seam in on day one.
 *
 * Deliberately NOT used for work that must be retried or delayed — that is
 * BullMQ's job (see src/queues). Events describe facts; jobs do work.
 * ========================================================================== */

@Injectable()
export class EventBusService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(EventBusService.name);
  private connection?: amqp.ChannelModel;
  private channel?: amqp.Channel;
  private ready = false;

  constructor(
    private readonly emitter: EventEmitter2,
    @Inject(queueConfig.KEY) private readonly cfg: QueueConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.cfg.eventTransport !== "rabbitmq") {
      this.log.log("Event transport: in-process emitter");
      return;
    }
    if (!this.cfg.rabbitUrl) {
      this.log.warn("EVENT_TRANSPORT=rabbitmq but RABBITMQ_URL is unset — falling back to in-process");
      return;
    }
    await this.connectRabbit();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  /**
   * Publishes a fact. Always emits in-process so local handlers work
   * identically under both transports; additionally forwards to RabbitMQ when
   * configured.
   *
   * Never throws: a failure to announce something that already happened must
   * not roll back the thing that happened. Delivery failures are logged and,
   * for anything that must not be lost, the caller enqueues a job instead.
   */
  async publish<T extends Record<string, unknown>>(
    name: EventName,
    payload: T,
    meta: { correlationId?: string; actorId?: string } = {},
  ): Promise<DomainEvent<T>> {
    const event: DomainEvent<T> = {
      id: randomUUID(),
      name,
      occurredAt: new Date().toISOString(),
      correlationId: meta.correlationId,
      actorId: meta.actorId,
      payload,
    };

    try {
      this.emitter.emit(name, event);
    } catch (e) {
      this.log.error(`in-process handler threw for ${name}`, e instanceof Error ? e.stack : String(e));
    }

    if (this.ready && this.channel) {
      try {
        this.channel.publish(
          this.cfg.rabbitExchange,
          name,
          Buffer.from(JSON.stringify(event)),
          { persistent: true, messageId: event.id, contentType: "application/json", timestamp: Date.now() },
        );
      } catch (e) {
        this.log.error(`rabbit publish failed for ${name}`, e instanceof Error ? e.message : String(e));
      }
    }

    return event;
  }

  /** Subscribes a handler. Under RabbitMQ this also binds a durable queue. */
  async subscribe<T extends Record<string, unknown>>(
    name: EventName,
    handler: (e: DomainEvent<T>) => Promise<void> | void,
    options: { queue?: string } = {},
  ): Promise<void> {
    this.emitter.on(name, (e: DomainEvent<T>) => {
      void Promise.resolve(handler(e)).catch((err) =>
        this.log.error(`handler failed for ${name}`, err instanceof Error ? err.stack : String(err)),
      );
    });

    if (this.ready && this.channel) {
      const queue = options.queue ?? `${name}.local`;
      await this.channel.assertQueue(queue, { durable: true });
      await this.channel.bindQueue(queue, this.cfg.rabbitExchange, name);
    }
  }

  isBrokerConnected(): boolean {
    return this.ready;
  }

  private async connectRabbit(): Promise<void> {
    try {
      this.connection = await amqp.connect(this.cfg.rabbitUrl!);
      this.channel = await this.connection.createChannel();
      await this.channel.assertExchange(this.cfg.rabbitExchange, "topic", { durable: true });
      this.ready = true;
      this.log.log(`Event transport: RabbitMQ topic exchange "${this.cfg.rabbitExchange}"`);

      /* A broker outage must degrade to in-process delivery, not crash the API. */
      this.connection.on("error", (e) => this.log.error(`rabbit connection error: ${e.message}`));
      this.connection.on("close", () => {
        this.ready = false;
        this.log.warn("rabbit connection closed — retrying in 5s");
        setTimeout(() => void this.connectRabbit(), 5_000);
      });
    } catch (e) {
      this.ready = false;
      this.log.error(
        `rabbit connect failed (${e instanceof Error ? e.message : String(e)}) — using in-process delivery, retrying in 10s`,
      );
      setTimeout(() => void this.connectRabbit(), 10_000);
    }
  }
}
