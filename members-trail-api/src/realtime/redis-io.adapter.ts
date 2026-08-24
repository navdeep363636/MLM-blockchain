import { IoAdapter } from "@nestjs/platform-socket.io";
import type { INestApplicationContext } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { createAdapter } from "@socket.io/redis-adapter";
import type { ServerOptions } from "socket.io";
import Redis from "ioredis";
import { appConfig, redisConfig } from "@/config/configuration";
import { buildRedisOptions } from "@/common/redis/redis.service";

/**
 * Socket.IO over a Redis pub/sub adapter.
 *
 * Without this, a balance update emitted by API instance A never reaches a
 * client connected to instance B — so the app appears to work with one pod and
 * silently breaks the moment it is scaled. Wiring it in from the start is the
 * cheapest time to do it.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly log = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    const cfg = this.app.get(appConfig.KEY);
    const redis = this.app.get(redisConfig.KEY);

    if (!this.adapterConstructor) {
      const pub = new Redis(buildRedisOptions(redis));
      const sub = pub.duplicate();
      this.adapterConstructor = createAdapter(pub, sub);
      this.log.log("Socket.IO Redis adapter attached");
    }

    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: cfg.corsOrigins, credentials: true },
      /* Long-poll fallback stays enabled — corporate proxies still block WS. */
      transports: ["websocket", "polling"],
      pingInterval: 25_000,
      pingTimeout: 20_000,
      maxHttpBufferSize: 1e6,
    }) as { adapter: (a: unknown) => void };

    server.adapter(this.adapterConstructor);
    return server;
  }
}
