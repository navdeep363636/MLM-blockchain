/* Deterministic environment for unit tests. Nothing here touches a real
 * database or Redis — those are exercised in the e2e suite instead. */
process.env.NODE_ENV = "test";
process.env.APP_PORT = "0";
process.env.JWT_ACCESS_SECRET = "test-access-secret-at-least-32-characters-long";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-at-least-32-characters-long";
process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_HOST = "127.0.0.1";
process.env.DB_PORT = "8084";
process.env.DB_USER = "root";
process.env.DB_PASSWORD = "admin123";
process.env.DB_NAME = "members_trail_test";
process.env.REDIS_HOST = "127.0.0.1";
process.env.REDIS_PORT = "6379";
process.env.CHAIN_ID = "97";
