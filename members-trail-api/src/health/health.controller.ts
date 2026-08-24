import { Controller, Get, VERSION_NEUTRAL } from "@nestjs/common";
import {
  DiskHealthIndicator, HealthCheck, HealthCheckService, MemoryHealthIndicator,
  TypeOrmHealthIndicator,
} from "@nestjs/terminus";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "@/common/decorators";
import { RedisService } from "@/common/redis/redis.service";
import { EventBusService } from "@/events";
import { DbRoutinesService } from "@/database/routines/db-routines.service";

@ApiTags("health")
/* Version-neutral: an orchestrator's probe URL should not change when the API
 * version does, and /health must stay reachable without a version segment. */
@Controller({ path: "health", version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly redis: RedisService,
    private readonly bus: EventBusService,
    private readonly routines: DbRoutinesService,
  ) {}

  /**
   * Liveness: is the process itself healthy? Deliberately does NOT check the
   * database — a DB blip should not cause the orchestrator to kill and restart
   * every pod, which turns a recoverable outage into a thundering herd.
   */
  @Public()
  @Get("live")
  @ApiOperation({ summary: "Liveness — process only, no dependencies" })
  live() {
    return { status: "ok", uptime: Math.round(process.uptime()), pid: process.pid };
  }

  /**
   * Readiness: can this instance serve traffic? Checks the dependencies a
   * request actually needs, so a failing instance is pulled from the load
   * balancer instead of returning 500s.
   */
  @Public()
  @Get("ready")
  @HealthCheck()
  @ApiOperation({ summary: "Readiness — database, Redis, memory, disk" })
  ready() {
    return this.health.check([
      () => this.db.pingCheck("mysql", { timeout: 3_000 }),
      async () => ({ redis: { status: (await this.redis.ping()) ? "up" : "down" } }),
      () => this.memory.checkHeap("memory_heap", 1024 * 1024 * 1024),
      () => this.disk.checkStorage("disk", { path: "/", thresholdPercent: 0.92 }),
      /* The views, procedures and triggers the crons and money paths depend on.
       *
       * A database migrated to an older version answers a ping perfectly well,
       * and then the first cron tick fails on a missing procedure — in a worker
       * log nobody is watching. This makes a half-migrated database fail the
       * probe, which is when someone finds out. */
      async () => {
        const objects = await this.routines.schemaObjects();
        return {
          schema_objects: {
            status: objects.healthy ? "up" : "down",
            views: objects.views,
            routines: objects.routines,
            triggers: objects.triggers,
          },
        };
      },
    ]);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: "Aggregate health with build metadata" })
  async root() {
    const [redisUp] = await Promise.all([this.redis.ping()]);
    return {
      status: redisUp ? "ok" : "degraded",
      service: "members-trail-api",
      version: process.env.npm_package_version ?? "1.0.0",
      env: process.env.NODE_ENV,
      uptime: Math.round(process.uptime()),
      dependencies: {
        redis: redisUp ? "up" : "down",
        eventBroker: this.bus.isBrokerConnected() ? "rabbitmq" : "in-process",
      },
      timestamp: new Date().toISOString(),
    };
  }
}
