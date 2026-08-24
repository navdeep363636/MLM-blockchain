import "./load-env";        // MUST be first — see the note in that file
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    /* rawBody is what the webhook signature check verifies against; the parsed
     * body is a different string. Body size limits are set in configureApp. */
    bodyParser: true,
    rawBody: true,
  });

  const cfg = configureApp(app);
  const log = new Logger("Bootstrap");

  /* --------------------------------- swagger ----------------------------- */

  if (!cfg.isProd) {
    const doc = new DocumentBuilder()
      .setTitle("Members Trail API")
      .setDescription(
        [
          "Backend for the Members Trail play-to-earn platform on BNB Smart Chain.",
          "",
          "**The rule this API enforces:** every payout — staking yield and referral",
          "commission alike — must trace to reconciled platform revenue, never to",
          "another member's deposit. Endpoints that move money are annotated with the",
          "invariant they uphold.",
          "",
          "Auth: `Authorization: Bearer <access token>`. Mutating money endpoints",
          "additionally require an `Idempotency-Key` header.",
        ].join("\n"),
      )
      .setVersion("1.0")
      .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" }, "bearer")
      .addTag("auth", "Registration, login, 2FA, sessions")
      .addTag("users", "Profile, settings, security")
      .addTag("kyc", "Identity verification tiers")
      .addTag("games", "Catalog, sessions, anti-cheat")
      .addTag("tournaments", "Paid and free events")
      .addTag("points", "Points ledger and caps")
      .addTag("wallet", "Balances, deposits, withdrawals")
      .addTag("conversion", "Points to MTT")
      .addTag("staking", "Pools, positions, rewards")
      .addTag("referrals", "Tree, commissions, payouts")
      .addTag("store", "Store and P2P marketplace")
      .addTag("support", "Tickets and SLA")
      .addTag("notifications", "In-app inbox and preferences")
      .addTag("admin", "Back-office: AD-01 … AD-14")
      .addTag("treasury", "Revenue reconciliation and funding")
      .addTag("webhooks", "Inbound provider callbacks")
      .addTag("health", "Liveness and readiness")
      .build();

    const document = SwaggerModule.createDocument(app, doc, { deepScanRoutes: true });
    SwaggerModule.setup(`${cfg.apiPrefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true, tagsSorter: "alpha", operationsSorter: "method" },
      customSiteTitle: "Members Trail API",
    });
    log.log(`Swagger UI → ${cfg.url}/${cfg.apiPrefix}/docs`);
  }

  await app.listen(cfg.port, "0.0.0.0");
  /* Both, deliberately: cfg.url is the PUBLIC address behind the proxy, and
   * printing only that hides which port the process actually bound — which is
   * the one thing an operator debugging a health check needs. */
  log.log(`${cfg.name} listening on port ${cfg.port} (public ${cfg.url}) [${cfg.env}]`);
}

void bootstrap().catch((e) => {
   
  console.error("Fatal bootstrap error:", e);
  process.exit(1);
});
