/* ============================================================================
 * Environment for the e2e suite.
 *
 * This must be a SETUP FILE rather than assignments at the top of the spec:
 * imports are hoisted, so `configuration.ts` validates the environment — and
 * caches it — before any statement in the spec body runs. An env var set in the
 * spec is set too late to be read.
 * ========================================================================== */
import "./setup";

process.env.NODE_ENV = "test";
/* Workers and crons off: this suite drives HTTP, and a worker racing the
 * assertions makes failures non-reproducible. */
process.env.QUEUE_WORKERS_ENABLED = "false";
process.env.SCHEDULER_ENABLED = "false";
process.env.INDEXER_ENABLED = "false";
process.env.EVENT_TRANSPORT = "memory";

/* Its own Redis database, not the development one.
 *
 * The suite writes rate-limit counters, webhook dedupe guards and queue jobs.
 * Sharing db 0 with a running dev instance meant its leftovers were picked up by
 * whatever started next: a dev worker booted after a run would find the suite's
 * queued game-validation jobs, fail them three times against rows the suite had
 * already deleted, and log FINAL errors that belonged to nobody. */
process.env.REDIS_DB = "1";

/* Known secrets so the suite can sign a webhook the way a provider would. */
process.env.PAYMENT_WEBHOOK_SECRET = "e2e-payment-secret";
process.env.KYC_WEBHOOK_SECRET = "e2e-kyc-secret";
process.env.OUTBOUND_WEBHOOK_SECRET = "e2e-outbound-secret";

/* Rate limiting is real and shared. A production-sized limit would fail the
 * suite instead of the code, so it is raised — not disabled, because a disabled
 * throttler would not exercise the guard at all. */
process.env.THROTTLE_LIMIT = "5000";
/* Forwarded headers are trusted so each simulated member can arrive from its own
 * IP, the way real traffic does. Per-route limits (registration is 5 per 15
 * minutes PER IP) then apply per fixture instead of exhausting after five, and
 * the throttle stays genuinely under test — one test deliberately hammers a
 * single IP and expects a 429. */
process.env.TRUST_PROXY = "true";
process.env.THROTTLE_TTL_SECONDS = "60";

/* ============================================================================
 * A note on `forceExit` in jest-e2e.json.
 *
 * The suite boots the whole application, which opens a MySQL pool, several
 * Redis clients (cache, throttler storage, the socket adapter's pub/sub pair)
 * and one BullMQ producer per queue. `app.close()` shuts the application down,
 * but a few of those clients keep the event loop alive long enough that Jest
 * reports "did not exit one second after the test run has completed" and hangs
 * the CI job.
 *
 * Force-exiting after the run is the right trade here: the assertions have all
 * completed by then, and the alternative — reaching into the adapter and the
 * queue registry to close connections the framework owns — is test code that
 * breaks whenever a queue is added.
 * ========================================================================== */
