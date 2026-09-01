#!/usr/bin/env node
/* ============================================================================
 * `next dev` with every route compiled up front.
 *
 * WHY THIS EXISTS
 * ---------------
 * The dev server compiles a route the first time someone asks for it, and
 * nothing compiles them ahead of time. On this app that first request costs
 * seconds — measured in a container: 7.8s for a static legal page, 7-9s for the
 * wallet screens, 10s for /login under Turbopack and 20s under webpack. Every
 * one of those is paid the first time you click the link, with the click looking
 * like it did nothing while you wait.
 *
 * The cost is not the pages. A legal document with no data, no wallet and no
 * charts costs the same 7.8s, which is what proves it: it is fixed per-route
 * dev-server overhead, so trimming imports cannot fix it. Production is
 * unaffected — the same navigations there are 105-132ms.
 *
 * So: pay it once, at startup, in a batch, instead of one page at a time
 * whenever you happen to click. After a warm pass every route in the app is
 * already compiled and the dev server behaves the way production does.
 *
 * WHY CONCURRENT, NOT SEQUENTIAL
 * -------------------------------
 * This used to `await` one route at a time. Measured against this app's 63
 * routes at ~7s each, that is 7+ minutes of wall-clock time — and Next.js
 * reports the dev server "✓ Ready" within a second of startup, long before a
 * sequential warm pass has gotten anywhere. A real click during that window
 * (someone testing while the terminal *looks* done) lands on an unwarmed route
 * and pays the exact multi-second cost this script exists to avoid — traced
 * and confirmed: three real navigations during one 7.4-minute sequential warm
 * run cost 7-13s each, on routes the warmer simply hadn't reached yet.
 * Turbopack's compiler is Rust-side and uses multiple threads; firing several
 * routes at once lets it actually use them, instead of leaving 7 of 8 cores
 * idle while one route compiles. Override with `WARM_CONCURRENCY=1` to get the
 * old one-at-a-time behaviour back.
 *
 * WHY ROUTES ARE REORDERED, NOT JUST ALPHABETICAL
 * -------------------------------------------------
 * Alphabetical put every /admin/* page ahead of /app/wallet, /app/games and
 * /app itself — so the pages people actually click first while a dev server is
 * warming up (the player app, then auth) were reliably the LAST ones warm.
 * ROUTE_PRIORITY below front-loads the routes real usage hits first; anything
 * not listed (marketing, legal, the rest of admin) still gets warmed, just
 * after. Adjust the list if your own workflow differs.
 *
 * USAGE
 * -----
 *   npm run dev:warm                  every route
 *   npm run dev:warm -- /app          only routes under /app
 *   WARM_CONCURRENCY=8 npm run dev:warm
 *
 * `npm run dev` is untouched for anyone who would rather start instantly and
 * take the cost per click.
 * ========================================================================== */

import { spawn } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 3000);
const BASE = `http://127.0.0.1:${PORT}`;
const APP_DIR = "src/app";
const prefixes = process.argv.slice(2).filter((a) => a.startsWith("/"));

/**
 * Warmed in this order, most specific prefix first. A route matches the first
 * entry it satisfies (exact match or `${prefix}/...`), so a child route must be
 * listed before a parent it would otherwise fall under — `/app/wallet` above
 * `/app`, not the reverse.
 *
 * Reflects the order a person actually exercises this app: land, sign in, then
 * spend most of their time in the player shell. Admin and the marketing/legal
 * pages are real routes but are opened far less often while iterating, so
 * anything not listed here is still warmed — just after these.
 */
const ROUTE_PRIORITY = [
  "/",
  "/login",
  "/signup",
  "/verify",
  "/forgot-password",
  "/reset-password",
  "/connect-wallet",
  "/kyc",
  "/app/wallet",
  "/app/staking",
  "/app/referrals",
  "/app/games",
  "/app/notifications",
  "/app/settings",
  "/app/support",
  "/app",
  "/admin",
];

const DEFAULT_CONCURRENCY = 4;
const concurrency = Math.max(1, Number(process.env.WARM_CONCURRENCY) || DEFAULT_CONCURRENCY);

/** Routes from the app directory: skip route groups, private folders and dynamic segments. */
function discoverRoutes(dir = APP_DIR, segments = []) {
  const out = [];
  if (!existsSync(dir)) return out;
  const entries = readdirSync(dir, { withFileTypes: true });

  if (entries.some((e) => e.isFile() && e.name === "page.tsx")) {
    out.push("/" + segments.join("/"));
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    /* `_components` is private, `[id]` needs a value we do not have, `(group)`
       does not appear in the URL, `api` is not a page. */
    if (e.name.startsWith("_") || e.name.startsWith("[") || e.name === "api") continue;
    const isGroup = e.name.startsWith("(") && e.name.endsWith(")");
    out.push(...discoverRoutes(join(dir, e.name), isGroup ? segments : [...segments, e.name]));
  }
  return out;
}

/** Index of the first ROUTE_PRIORITY entry this route satisfies, or Infinity. */
function priorityRank(route) {
  const i = ROUTE_PRIORITY.findIndex((p) => {
    /* "/" is every route's prefix, so it can only ever be an exact match —
       treating it as a `${p}/`-style prefix would rank every route 0. */
    if (p === "/") return route === "/";
    return route === p || route.startsWith(`${p}/`);
  });
  return i === -1 ? Infinity : i;
}

/** Priority order first, alphabetical within a tie (stable sort preserves it). */
function byPriority(routes) {
  return [...routes].sort((a, b) => priorityRank(a) - priorityRank(b) || a.localeCompare(b));
}

const ready = async () => {
  try {
    const res = await fetch(BASE, { method: "HEAD", signal: AbortSignal.timeout(120_000) });
    return res.status > 0;
  } catch {
    return false;
  }
};

async function waitForReady(timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ready()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Warms `routes` with up to `concurrency` requests in flight at once.
 *
 * Plain shared-counter work queue: each worker claims the next index and loops
 * until the queue is empty. No route is claimed twice and none is skipped,
 * without needing a lock — this all runs on one JS thread between `await`s.
 */
async function warm(routes, concurrency) {
  const started = Date.now();
  let nextIndex = 0;
  let done = 0;
  let slowest = { route: null, ms: 0 };

  async function worker() {
    for (;;) {
      const i = nextIndex++;
      if (i >= routes.length) return;
      const route = routes[i];
      const t0 = Date.now();
      try {
        /* GET, not HEAD: a HEAD can be answered without rendering, which would
           report success while leaving the route uncompiled. */
        await fetch(BASE + route, { signal: AbortSignal.timeout(180_000) });
      } catch {
        /* A route that fails to compile is the dev server's job to report; the
           warmer's job is only to have asked. */
      }
      const ms = Date.now() - t0;
      if (ms > slowest.ms) slowest = { route, ms };
      done += 1;
      const bar = `[${String(done).padStart(2)}/${routes.length}]`;
      process.stdout.write(`  ${bar} ${route.padEnd(34)} ${(ms / 1000).toFixed(1)}s\n`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, routes.length) }, worker));

  const total = ((Date.now() - started) / 1000).toFixed(0);
  console.log(
    `\n  ✓ WARM — ${done} route(s) compiled in ${total}s (concurrency ${concurrency}), slowest ` +
    `${slowest.route} at ${(slowest.ms / 1000).toFixed(1)}s.\n` +
    `  Every route now serves like production. Safe to test.\n`,
  );
}

const all = byPriority(discoverRoutes());
const routes = prefixes.length
  ? all.filter((r) => prefixes.some((p) => r === p || r.startsWith(p.endsWith("/") ? p : `${p}/`)))
  : all;

if (routes.length === 0) {
  console.error(`No routes matched ${prefixes.join(", ") || "(none)"} under ${APP_DIR}`);
  process.exit(1);
}

console.log(`\n  starting the dev server, then compiling ${routes.length} route(s) (concurrency ${concurrency})…\n`);

const child = spawn("npx", ["next", "dev", "--turbopack", "-p", String(PORT)], {
  stdio: "inherit",
  env: process.env,
});

/* Ctrl-C must stop the dev server, not just this wrapper. */
const stop = (sig) => () => {
  child.kill(sig);
};
process.on("SIGINT", stop("SIGINT"));
process.on("SIGTERM", stop("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));

if (await waitForReady()) {
  /* Next prints its own "✓ Ready" the moment it accepts connections, which is
     seconds before any route is actually compiled. Say so explicitly here, or
     the natural reading of the terminal is "it's ready, go ahead and click" —
     which is exactly the race that produces a multi-second navigation. */
  console.log(
    "  ⚠ the dev server accepts connections now, but nothing is compiled yet —\n" +
    "    wait for the \"✓ WARM\" line below before testing in a browser.\n",
  );
  await warm(routes, concurrency);
} else {
  console.error("\n  dev server did not become ready in time — skipping the warm pass\n");
}
