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
 * USAGE
 * -----
 *   npm run dev:warm            every route
 *   npm run dev:warm -- /app    only routes under /app
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

async function warm(routes) {
  const started = Date.now();
  let done = 0;
  let slowest = { route: null, ms: 0 };

  for (const route of routes) {
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

  const total = ((Date.now() - started) / 1000).toFixed(0);
  console.log(
    `\n  warmed ${done} route(s) in ${total}s — slowest ${slowest.route} at ` +
    `${(slowest.ms / 1000).toFixed(1)}s. Navigation is now warm everywhere.\n`,
  );
}

const all = discoverRoutes().sort();
const routes = prefixes.length
  ? all.filter((r) => prefixes.some((p) => r === p || r.startsWith(p.endsWith("/") ? p : `${p}/`)))
  : all;

if (routes.length === 0) {
  console.error(`No routes matched ${prefixes.join(", ") || "(none)"} under ${APP_DIR}`);
  process.exit(1);
}

console.log(`\n  starting the dev server, then compiling ${routes.length} route(s)…\n`);

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
  await warm(routes);
} else {
  console.error("\n  dev server did not become ready in time — skipping the warm pass\n");
}
