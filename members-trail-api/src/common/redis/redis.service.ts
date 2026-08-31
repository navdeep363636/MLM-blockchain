import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import Redis, { type RedisOptions } from "ioredis";
import { redisConfig, type RedisConfig } from "@/config/configuration";

export const REDIS_CLIENT = Symbol("REDIS_CLIENT");
export const REDIS_SUBSCRIBER = Symbol("REDIS_SUBSCRIBER");

export function buildRedisOptions(cfg: RedisConfig): RedisOptions {
  return {
    host: cfg.host,
    port: cfg.port,
    password: cfg.password,
    db: cfg.db,
    keyPrefix: cfg.keyPrefix,
    ...(cfg.tls ? { tls: {} } : {}),
    /* BullMQ requires this to be null; keeping it uniform avoids two clients
     * with divergent retry semantics. */
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  };
}

/**
 * Thin wrapper over ioredis with the primitives the app actually needs:
 * counters with TTL, distributed locks, idempotency keys and leaderboards.
 * Modules use these instead of hand-rolling Lua or forgetting to set a TTL.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger(RedisService.name);

  constructor(
    @Inject(REDIS_CLIENT) public readonly client: Redis,
    @Inject(redisConfig.KEY) private readonly cfg: RedisConfig,
  ) {}

  async onModuleDestroy() {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  /* --------------------------------- basics ------------------------------ */

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) await this.client.set(key, raw, "EX", ttlSeconds);
    else await this.client.set(key, raw);
  }

  del(...keys: string[]): Promise<number> {
    return keys.length ? this.client.del(...keys) : Promise.resolve(0);
  }

  /** Deletes by pattern using SCAN — never KEYS, which blocks the server. */
  async delByPattern(pattern: string): Promise<number> {
    const prefixed = `${this.cfg.keyPrefix}${pattern}`;
    let cursor = "0";
    let removed = 0;
    do {
      const [next, found] = await this.client.scan(cursor, "MATCH", prefixed, "COUNT", 200);
      cursor = next;
      if (found.length) {
        // SCAN returns fully-prefixed keys but del() re-applies keyPrefix, so strip it.
        const bare = found.map((k) => k.slice(this.cfg.keyPrefix.length));
        removed += await this.client.del(...bare);
      }
    } while (cursor !== "0");
    return removed;
  }

  /* -------------------------- counters & throttles ----------------------- */

  /** Atomic increment that sets the TTL only on first write. */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const n = await this.client.incr(key);
    if (n === 1) await this.client.expire(key, ttlSeconds);
    return n;
  }

  ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /* ------------------------------ idempotency ---------------------------- */

  /**
   * Reserves an idempotency key. Returns false when the key already exists,
   * which the caller must treat as "this request was already handled".
   */
  async reserve(key: string, ttlSeconds: number): Promise<boolean> {
    const res = await this.client.set(key, "1", "EX", ttlSeconds, "NX");
    return res === "OK";
  }

  /* -------------------------------- locking ------------------------------ */

  /**
   * Single-instance mutex (SET NX + fencing token). Adequate for guarding
   * cron overlap and per-user critical sections inside one Redis. Money paths
   * additionally use database row locks, so this is defence in depth rather
   * than the sole guarantee — see the note in LedgerService.
   */
  async acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
    const token = `${process.pid}-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ok = await this.client.set(`lock:${key}`, token, "EX", ttlSeconds, "NX");
    return ok === "OK" ? token : null;
  }

  /** Releases only if we still hold it — prevents releasing someone else's lock. */
  async releaseLock(key: string, token: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end`;
    const res = (await this.client.eval(script, 1, `${this.cfg.keyPrefix}lock:${key}`, token)) as number;
    return res === 1;
  }

  /** Runs `fn` under a lock, or returns null if the lock is held elsewhere. */
  /**
   * Runs `fn` while holding `key`, or returns null if the lock is held.
   *
   * `waitMs` is the important option. With the default of 0 this is a single
   * non-blocking attempt, which is right when a busy lock means "someone else is
   * already doing this, so I should not" — a scheduled rollup, say.
   *
   * It is wrong when a busy lock means "someone else is doing this FIRST, and I
   * still need my turn". A member finishing several game rounds in a minute
   * produces exactly that: each validation credits Points under a per-account
   * lock, and with no wait the second job failed instantly, burned a retry, and
   * after three attempts gave up — leaving sessions the server had validated with
   * their Points never credited. Waiting a few seconds for a lock whose holder
   * finishes in milliseconds turns a lost credit into a brief delay.
   *
   * Polls with jitter so a burst of waiters does not retry in lockstep.
   */
  async withLock<T>(
    key: string,
    ttlSeconds: number,
    fn: () => Promise<T>,
    opts: { waitMs?: number; pollMs?: number } = {},
  ): Promise<T | null> {
    const waitMs = Math.max(0, opts.waitMs ?? 0);
    const pollMs = Math.max(10, opts.pollMs ?? 120);
    const deadline = Date.now() + waitMs;

    let token = await this.acquireLock(key, ttlSeconds);
    while (!token && Date.now() < deadline) {
      const jitter = Math.round(Math.random() * pollMs);
      await new Promise((r) => setTimeout(r, pollMs + jitter));
      token = await this.acquireLock(key, ttlSeconds);
    }

    if (!token) {
      this.log.debug(`lock busy after ${waitMs}ms: ${key}`);
      return null;
    }
    try {
      return await fn();
    } finally {
      await this.releaseLock(key, token).catch(() => undefined);
    }
  }

  /* ------------------------------ leaderboards --------------------------- */

  async zAdd(key: string, score: number, member: string): Promise<void> {
    await this.client.zadd(key, score, member);
  }

  async zIncr(key: string, delta: number, member: string): Promise<number> {
    return Number(await this.client.zincrby(key, delta, member));
  }

  /** Descending page of a sorted set with scores, 0-indexed. */
  async zTop(key: string, offset: number, count: number): Promise<{ member: string; score: number }[]> {
    const flat = await this.client.zrevrange(key, offset, offset + count - 1, "WITHSCORES");
    const out: { member: string; score: number }[] = [];
    for (let i = 0; i < flat.length; i += 2) out.push({ member: flat[i], score: Number(flat[i + 1]) });
    return out;
  }

  /** 1-based rank, or null when the member is absent. */
  async zRank(key: string, member: string): Promise<number | null> {
    const r = await this.client.zrevrank(key, member);
    return r === null ? null : r + 1;
  }

  zCard(key: string): Promise<number> {
    return this.client.zcard(key);
  }

  async zScore(key: string, member: string): Promise<number | null> {
    const s = await this.client.zscore(key, member);
    return s === null ? null : Number(s);
  }

  /* --------------------------------- pubsub ------------------------------ */

  async publish(channel: string, payload: unknown): Promise<void> {
    await this.client.publish(channel, JSON.stringify(payload));
  }

  /** A dedicated connection is required: a subscribed client can't run commands. */
  duplicate(): Redis {
    return this.client.duplicate();
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === "PONG";
    } catch {
      return false;
    }
  }
}
