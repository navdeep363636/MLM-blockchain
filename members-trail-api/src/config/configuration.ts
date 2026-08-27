import { registerAs } from "@nestjs/config";
import { validateEnv, type Env } from "./env.schema";

/* Typed, namespaced config. Modules inject the namespace they need rather than
 * reaching into process.env, so a missing key is a compile error not a runtime
 * undefined. */

const env: Env = validateEnv(process.env);

const list = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

export const appConfig = registerAs("app", () => ({
  env: env.NODE_ENV,
  name: env.APP_NAME,
  port: env.APP_PORT,
  url: env.APP_URL,
  webUrl: env.WEB_URL,
  apiPrefix: env.API_PREFIX,
  logLevel: env.LOG_LEVEL,
  trustProxy: env.TRUST_PROXY,
  corsOrigins: list(env.CORS_ORIGINS),
  isProd: env.NODE_ENV === "production",
  isTest: env.NODE_ENV === "test",
}));

export const dbConfig = registerAs("db", () => ({
  host: env.DB_HOST,
  port: env.DB_PORT,
  username: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  poolSize: env.DB_POOL_SIZE,
  logging: env.DB_LOGGING,
  synchronize: env.DB_SYNCHRONIZE,
  ssl: env.DB_SSL,
}));

export const redisConfig = registerAs("redis", () => ({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  db: env.REDIS_DB,
  keyPrefix: env.REDIS_KEY_PREFIX,
  tls: env.REDIS_TLS,
}));

export const queueConfig = registerAs("queue", () => ({
  workersEnabled: env.QUEUE_WORKERS_ENABLED,
  concurrency: env.QUEUE_CONCURRENCY,
  schedulerEnabled: env.SCHEDULER_ENABLED,
  eventTransport: env.EVENT_TRANSPORT,
  rabbitUrl: env.RABBITMQ_URL,
  rabbitExchange: env.RABBITMQ_EXCHANGE,
}));

export const authConfig = registerAs("auth", () => ({
  accessSecret: env.JWT_ACCESS_SECRET,
  refreshSecret: env.JWT_REFRESH_SECRET,
  accessTtl: env.JWT_ACCESS_TTL,
  refreshTtl: env.JWT_REFRESH_TTL,
  encryptionKey: env.ENCRYPTION_KEY,
  otpTtl: env.OTP_TTL_SECONDS,
  otpMaxAttempts: env.OTP_MAX_ATTEMPTS,
  otpResendCooldown: env.OTP_RESEND_COOLDOWN_SECONDS,
  loginMaxAttempts: env.LOGIN_MAX_ATTEMPTS,
  loginLockoutSeconds: env.LOGIN_LOCKOUT_SECONDS,
  passwordResetTtl: env.PASSWORD_RESET_TTL_SECONDS,
  throttleTtl: env.THROTTLE_TTL_SECONDS,
  throttleLimit: env.THROTTLE_LIMIT,
}));

export const chainConfig = registerAs("chain", () => ({
  chainId: env.CHAIN_ID,
  isTestnet: env.CHAIN_ID === 97,
  rpcUrls: list(env.BSC_RPC_URLS),
  contracts: {
    mttToken: env.MTT_TOKEN_ADDRESS,
    staking: env.STAKING_ADDRESS,
    referralDistributor: env.REFERRAL_DISTRIBUTOR_ADDRESS,
    teamVesting: env.TEAM_VESTING_ADDRESS,
    advisorsVesting: env.ADVISORS_VESTING_ADDRESS,
    payout: env.PAYOUT_ADDRESS,
  },
  indexer: {
    enabled: env.INDEXER_ENABLED,
    confirmations: env.INDEXER_CONFIRMATIONS,
    batchBlocks: env.INDEXER_BATCH_BLOCKS,
    pollMs: env.INDEXER_POLL_MS,
    startBlock: env.INDEXER_START_BLOCK,
  },
  oracle: {
    privateKey: env.ORACLE_PRIVATE_KEY,
    kmsKeyId: env.ORACLE_KMS_KEY_ID,
  },
  tx: {
    maxGasGwei: env.TX_MAX_GAS_GWEI,
    confirmations: env.TX_CONFIRMATIONS,
  },
  explorerBase: env.CHAIN_ID === 56 ? "https://bscscan.com" : "https://testnet.bscscan.com",
}));

export const webhookConfig = registerAs("webhook", () => ({
  paymentSecret: env.PAYMENT_WEBHOOK_SECRET,
  kycSecret: env.KYC_WEBHOOK_SECRET,
  outboundSecret: env.OUTBOUND_WEBHOOK_SECRET,
}));

/** Economy defaults. Runtime values live in the platform_config table and
 *  override these; these are the fallbacks used before an admin sets anything. */
export const economyConfig = registerAs("economy", () => ({
  pointsPerMtt: env.POINTS_PER_MTT_DEFAULT,
  conversionDailyCapPoints: env.CONVERSION_DAILY_CAP_POINTS,
  conversionMonthlyCapPoints: env.CONVERSION_MONTHLY_CAP_POINTS,
  commission: {
    l1Bps: env.COMMISSION_L1_BPS,
    l2Bps: env.COMMISSION_L2_BPS,
    l3Bps: env.COMMISSION_L3_BPS,
    maxDepth: env.COMMISSION_MAX_DEPTH,
    monthlyCapAbsolute: env.COMMISSION_MONTHLY_CAP_ABSOLUTE,
    capMultiplier: env.COMMISSION_CAP_MULTIPLIER,
    capBase: env.COMMISSION_CAP_BASE,
    minAccountAgeDays: env.COMMISSION_MIN_ACCOUNT_AGE_DAYS,
    minSessions: env.COMMISSION_MIN_SESSIONS,
  },
  withdrawal: {
    autoApproveMtt: env.WITHDRAWAL_AUTO_APPROVE_MTT,
    coolingOffHours: env.WITHDRAWAL_COOLING_OFF_HOURS,
  },
  kycLimits: {
    tier1Mtt: env.KYC_TIER1_LIMIT_MTT,
    tier2Mtt: env.KYC_TIER2_LIMIT_MTT,
  },
}));

export const allConfig = [
  appConfig, dbConfig, redisConfig, queueConfig,
  authConfig, chainConfig, webhookConfig, economyConfig,
];

export type AppConfig = ReturnType<typeof appConfig>;
export type DbConfig = ReturnType<typeof dbConfig>;
export type RedisConfig = ReturnType<typeof redisConfig>;
export type QueueConfig = ReturnType<typeof queueConfig>;
export type AuthConfig = ReturnType<typeof authConfig>;
export type ChainConfig = ReturnType<typeof chainConfig>;
export type WebhookConfig = ReturnType<typeof webhookConfig>;
export type EconomyConfig = ReturnType<typeof economyConfig>;
