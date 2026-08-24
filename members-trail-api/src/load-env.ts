/* ============================================================================
 * Loads .env before anything else is imported.
 *
 * Must be the FIRST import in main.ts. config/configuration.ts validates the
 * environment at module-load time (fail fast, so a missing secret is a boot
 * error rather than a 500 on the first request), which means process.env has to
 * be populated before that module is evaluated. ConfigModule.forRoot() runs too
 * late for that.
 * ========================================================================== */
import { config } from "dotenv";
import { existsSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) config({ path: file, override: false });
}
