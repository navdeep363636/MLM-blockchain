import { ValidationPipe, VersioningType } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import { appConfig } from "./config/configuration";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { RequestIdInterceptor, TimingInterceptor } from "./common/interceptors";
import { RedisIoAdapter } from "./realtime/redis-io.adapter";

/* ============================================================================
 * Everything that turns a Nest application into THIS API.
 *
 * It lives here rather than inline in main.ts for one reason: the end-to-end
 * tests must exercise the same pipeline the process serves. An e2e suite that
 * builds its own app — with its own validation pipe, its own prefix, its own
 * exception filter — passes while production 400s, and that has happened to
 * everyone at least once.
 *
 * So: main.ts adds the listener and Swagger, the e2e suite adds nothing, and
 * both go through this function.
 * ========================================================================== */

export function configureApp(app: NestExpressApplication): ReturnType<typeof appConfig> {
  const cfg = app.get(appConfig.KEY);

  /* --------------------------------- security ---------------------------- */

  app.use(
    helmet({
      contentSecurityPolicy: cfg.isProd
        ? { directives: { defaultSrc: ["'self'"], frameAncestors: ["'none'"] } }
        : false,                       // Swagger UI needs inline styles in dev
      crossOriginEmbedderPolicy: false,
      hsts: cfg.isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );

  /* Only trust X-Forwarded-* when we are actually behind a proxy. Trusting it
   * unconditionally lets a client spoof its IP and defeat rate limiting. */
  if (cfg.trustProxy) app.set("trust proxy", 1);

  app.use(compression());
  app.use(cookieParser());

  /**
   * Explicit body limits.
   *
   * Express defaults to 100kb, which is a cap by accident rather than a decision.
   * Stating it makes it reviewable, and `useBodyParser` re-registers the parser
   * WITHOUT losing the raw-body capture the webhook signature check depends on —
   * which a hand-rolled `app.use(json())` would.
   *
   * 256kb is generous for the largest legitimate payload here (a game session's
   * telemetry) and small enough that a request body is never a memory-pressure
   * vector. Media never comes through this API.
   */
  app.useBodyParser("json", { limit: "256kb" });
  app.useBodyParser("urlencoded", { limit: "32kb", extended: true });

  app.enableCors({
    origin: cfg.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type", "Authorization", "X-Request-Id", "Idempotency-Key",
      "X-Device-Fingerprint", "X-Two-Fa-Code",
    ],
    exposedHeaders: ["X-Request-Id", "X-RateLimit-Remaining", "Retry-After"],
    maxAge: 86_400,
  });

  /* --------------------------------- pipeline ---------------------------- */

  app.setGlobalPrefix(cfg.apiPrefix, { exclude: ["health", "health/live", "health/ready", "metrics"] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });

  app.useGlobalPipes(
    new ValidationPipe({
      /* whitelist + forbidNonWhitelisted together mean an unexpected field is
       * a 400, not silently ignored — which is how mass-assignment bugs start. */
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validateCustomDecorators: true,
      stopAtFirstError: false,
      disableErrorMessages: false,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor(), new TimingInterceptor());
  app.useWebSocketAdapter(new RedisIoAdapter(app));

  app.enableShutdownHooks();

  return cfg;
}
