import { z } from "zod";

/* ============================================================================
 * Environment schema.
 *
 * The app refuses to boot on invalid config rather than failing later at the
 * first request. Secrets have minimum lengths because a short JWT secret is a
 * real vulnerability, not a style preference.
 * ========================================================================== */

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const port = z.coerce.number().int().min(0).max(65535);

/**
 * A contract address, or nothing.
 *
 * Format-checked rather than left as a free string, because a wrong contract
 * address is the one piece of misconfiguration in this app that produces no
 * error anywhere: `getLogs` against a non-contract matches nothing (so the
 * indexer reports healthy and indexes zero events) and every read reverts into
 * the read layer's honest nulls (so dashboards show dashes). Refusing to boot on
 * a malformed one costs nothing and removes the whole class of typo.
 *
 * Case is normalised to lowercase here and re-checksummed where viem needs it,
 * so a hand-typed all-lowercase address is accepted while a MIS-checksummed
 * mixed-case one — a real symptom of a corrupted paste — still is.
 *
 * The address being well-formed says nothing about it being the RIGHT contract.
 * That is checked against the chain at boot; see
 * modules/chain/deployment-verifier.service.ts.
 */
const evmAddress = z
  .string()
  .trim()
  .refine((v) => v === "" || /^0x[0-9a-fA-F]{40}$/.test(v), {
    message: "must be a 20-byte hex address (0x + 40 hex chars), or empty",
  })
  .transform((v) => (v === "" ? undefined : v))
  .optional();

export const envSchema = z.object({
  /* ------------------------------- runtime ------------------------------- */
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  APP_NAME: z.string().default("members-trail-api"),
  APP_PORT: port.default(4000),
  APP_URL: z.string().url().default("http://localhost:4000"),
  WEB_URL: z.string().url().default("http://localhost:3000"),
  API_PREFIX: z.string().default("api"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  TRUST_PROXY: bool.default("false"),
  /** Comma-separated allowlist. Never `*` in production — enforced below. */
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  /* ------------------------------- database ------------------------------ */
  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: port.default(3306),
  DB_USER: z.string().default("root"),
  DB_PASSWORD: z.string().default(""),
  DB_NAME: z.string().default("members_trail"),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(200).default(20),
  DB_LOGGING: bool.default("false"),
  /** Never true outside local development — migrations are the source of truth. */
  DB_SYNCHRONIZE: bool.default("false"),
  DB_SSL: bool.default("false"),

  /* -------------------------------- redis -------------------------------- */
  REDIS_HOST: z.string().default("127.0.0.1"),
  REDIS_PORT: port.default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),
  REDIS_KEY_PREFIX: z.string().default("mtt:"),
  REDIS_TLS: bool.default("false"),

  /* -------------------------------- queues ------------------------------- */
  /** Workers can be disabled so the API and the worker fleet scale separately. */
  QUEUE_WORKERS_ENABLED: bool.default("true"),
  QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  SCHEDULER_ENABLED: bool.default("true"),

  /* ----------------------------- event transport ------------------------- */
  /** in-process (monolith default) or rabbitmq (when services are split out) */
  EVENT_TRANSPORT: z.enum(["memory", "rabbitmq"]).default("memory"),
  RABBITMQ_URL: z.string().optional(),
  RABBITMQ_EXCHANGE: z.string().default("members_trail.events"),

  /* --------------------------------- auth -------------------------------- */
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  /** AES-256-GCM key for encrypting KYC document references and TOTP secrets. */
  ENCRYPTION_KEY: z.string().length(64, "ENCRYPTION_KEY must be 64 hex characters (32 bytes)"),
  OTP_TTL_SECONDS: z.coerce.number().int().default(600),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().default(60),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().default(5),
  LOGIN_LOCKOUT_SECONDS: z.coerce.number().int().default(900),
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().default(1800),

  /* ----------------------------- rate limiting --------------------------- */
  THROTTLE_TTL_SECONDS: z.coerce.number().int().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().default(120),

  /* --------------------------------- chain ------------------------------- */
  CHAIN_ID: z.coerce.number().int().refine((v) => v === 56 || v === 97, {
    message: "CHAIN_ID must be 56 (BSC mainnet) or 97 (BSC testnet)",
  }).default(97),
  /**
   * Comma-separated. The RPC transport rotates on failure and prefers the
   * fastest responder, so more than one is worth having: the first testnet
   * deploy attempt was lost to a single provider timing out.
   */
  BSC_RPC_URLS: z
    .string()
    .default(
      "https://data-seed-prebsc-1-s1.binance.org:8545,https://bsc-testnet-rpc.publicnode.com",
    )
    .refine((v) => v.split(",").some((u) => u.trim().length > 0), {
      message: "BSC_RPC_URLS must contain at least one URL",
    }),
  MTT_TOKEN_ADDRESS: evmAddress,
  STAKING_ADDRESS: evmAddress,
  REFERRAL_DISTRIBUTOR_ADDRESS: evmAddress,
  TEAM_VESTING_ADDRESS: evmAddress,
  ADVISORS_VESTING_ADDRESS: evmAddress,
  /** MTTPayout — the withdrawal settlement rail. See MTTPayout.sol. */
  PAYOUT_ADDRESS: evmAddress,

  /** Indexer tuning. Confirmations guard against reorgs. */
  INDEXER_ENABLED: bool.default("true"),
  INDEXER_CONFIRMATIONS: z.coerce.number().int().min(1).default(12),
  INDEXER_BATCH_BLOCKS: z.coerce.number().int().min(1).max(5000).default(500),
  INDEXER_POLL_MS: z.coerce.number().int().min(500).default(4000),
  INDEXER_START_BLOCK: z.coerce.number().int().min(0).default(0),

  /**
   * Oracle relayer key. Narrow permission by design: it may only call
   * recordCommission within the already-funded cap. It can never move funds.
   * In production this must be an HSM/MPC reference, not a raw key.
   */
  ORACLE_PRIVATE_KEY: z.string().optional(),
  ORACLE_KMS_KEY_ID: z.string().optional(),
  TX_MAX_GAS_GWEI: z.coerce.number().default(10),
  TX_CONFIRMATIONS: z.coerce.number().int().min(1).default(3),

  /* ------------------------------- webhooks ------------------------------ */
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  KYC_WEBHOOK_SECRET: z.string().optional(),
  OUTBOUND_WEBHOOK_SECRET: z.string().optional(),

  /* ------------------------------ economy -------------------------------- */
  /** Defaults mirror FRD §7. All are overridable at runtime via platform config. */
  POINTS_PER_MTT_DEFAULT: z.coerce.number().int().default(1000),
  CONVERSION_DAILY_CAP_POINTS: z.coerce.number().int().default(25000),
  CONVERSION_MONTHLY_CAP_POINTS: z.coerce.number().int().default(400000),
  COMMISSION_L1_BPS: z.coerce.number().int().default(800),
  COMMISSION_L2_BPS: z.coerce.number().int().default(300),
  COMMISSION_L3_BPS: z.coerce.number().int().default(100),
  COMMISSION_MAX_DEPTH: z.coerce.number().int().min(1).max(3).default(3),
  COMMISSION_MONTHLY_CAP_ABSOLUTE: z.coerce.number().default(50000),
  COMMISSION_CAP_MULTIPLIER: z.coerce.number().default(5),
  COMMISSION_CAP_BASE: z.coerce.number().default(5000),
  COMMISSION_MIN_ACCOUNT_AGE_DAYS: z.coerce.number().int().default(7),
  COMMISSION_MIN_SESSIONS: z.coerce.number().int().default(5),
  WITHDRAWAL_AUTO_APPROVE_MTT: z.coerce.number().default(5000),
  WITHDRAWAL_COOLING_OFF_HOURS: z.coerce.number().int().default(48),
  KYC_TIER1_LIMIT_MTT: z.coerce.number().default(25000),
  KYC_TIER2_LIMIT_MTT: z.coerce.number().default(500000),
});

export type Env = z.infer<typeof envSchema>;

/** Parses and hard-fails with a readable report. Called once, at bootstrap. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;

  /* Production guardrails. These are the mistakes that cause incidents. */
  if (env.NODE_ENV === "production") {
    const fatal: string[] = [];
    if (env.DB_SYNCHRONIZE) fatal.push("DB_SYNCHRONIZE must be false in production — it can drop columns");
    if (env.CORS_ORIGINS.includes("*")) fatal.push("CORS_ORIGINS must not contain '*' in production");
    if (env.CORS_ORIGINS.includes("localhost")) fatal.push("CORS_ORIGINS must not contain localhost in production");
    if (env.ORACLE_PRIVATE_KEY && !env.ORACLE_KMS_KEY_ID) {
      fatal.push("ORACLE_PRIVATE_KEY must not be a plaintext key in production — use ORACLE_KMS_KEY_ID");
    }
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      fatal.push("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ");
    }
    if (fatal.length) {
      throw new Error(`Refusing to boot in production:\n${fatal.map((f) => `  • ${f}`).join("\n")}`);
    }
  }

  return env;
}
