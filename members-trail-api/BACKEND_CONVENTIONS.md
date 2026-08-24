# Members Trail API — build conventions

Read fully before writing a module. The foundation is built, migrated and
verified running against real MySQL + Redis. **Reuse it; do not re-create it.**

## Hard rules

1. **Treat the foundation as shared, not frozen.** `src/config/*`,
   `src/common/*`, `src/database/entities/*`, `src/database/ledger/*`,
   `src/events/*`, `src/queues/queue.constants.ts`, `src/main.ts` and
   `package.json` are used by every module, so a change there is a change to
   everything. Change them only to fix something that is actually wrong, and say
   so in your report. An entity change needs a migration in the same commit —
   never a `synchronize` run.

   *(This rule used to read "never modify". It was written while several agents
   built modules in parallel, and it outlived that. Verification against a real
   database then found genuine defects in those files — a decimal transformer
   that made registration impossible, an exception filter that turned a 413 into
   a 500, a 2FA code sharing a namespace with phone verification — and none of
   them could be fixed from a feature module. Files listed here are still where
   a mistake is most expensive, which is the reason for the caution, not a
   prohibition.)*
2. **Adding a dependency needs a reason in the commit message.** The runtime set
   is deliberately small. Dev tooling (eslint and its plugins) was added after
   the fact and is fine to extend.
3. **`npx tsc --noEmit` must exit 0** before you finish. Run it.
4. No `any`, no `@ts-ignore`, no `!` non-null assertions on external input.
5. Never use `float`/`number` for money. Use the helpers in `@/common/utils`.

## Where things go

```
src/modules/<name>/
  <name>.module.ts
  <name>.controller.ts          player-facing routes
  <name>.admin.controller.ts    staff routes (if any)
  <name>.service.ts
  dto/                          request/response DTOs
  <name>.service.spec.ts        unit tests — REQUIRED for money/logic paths
```

Queue processors go in `src/queues/processors/<queue>.processor.ts`.
Cron jobs go in `src/scheduler/jobs/<name>.job.ts`.
Neither may live inside a feature module.

## The money contract — read this twice

**All balance changes go through `LedgerService`.** Nothing else may write
`user_balances`. It is the only place that holds the row lock, and it is what
makes concurrent spends safe.

```ts
import { LedgerService } from "@/database/ledger/ledger.service";

// Points
await this.ledger.mutatePoints({
  userId, amount: 250, source: "gameplay",
  idempotencyKey: `session:${sessionId}`,     // MUST be deterministic
  gameSessionId: sessionId,
});

// MTT
await this.ledger.mutateMtt({
  userId, type: "reward_claim", amountMtt: "12.5",
  idempotencyKey: `reward:${rewardId}`, bucket: "available",
});

// Bucket move (stake, commission release) — atomic, never two calls
await this.ledger.transferBucket({
  userId, from: "commissionPending", to: "commissionAvailable",
  amount, type: "commission_claim", idempotencyKey: `release:${commissionId}`,
});

// Multi-row operation that must be consistent with the balance
await this.ledger.withUserLock(userId, async (tx, balance) => { /* … */ });
```

Idempotency keys must be **derived from the domain**, never random — a random
key defeats the whole mechanism on retry.

## Money & period helpers

```ts
import {
  dec, add, sub, mul, gt, gte, lt, lte, isZero, toDbAmount, toDisplay,
  applyBps, pointsToMtt, clampToHeadroom, toWei, fromWei,
  dayKey, monthKey, weekKey, secondsUntilUtcMidnight, trailingMonths,
  Ref, anonLabel, maskEmail, maskPhone,
} from "@/common/utils";
```

All periods are **UTC**. A cap that rolls over at server-local midnight is both
a bug and exploitable.

## Route conventions

Global guard is deny-by-default. Decorators from `@/common/decorators`:

```ts
import {
  Public, Roles, RequirePermissions, RequireKyc, Idempotent,
  CurrentUser, ClientIp, UserAgent, StaffOnly, type AuthUser,
} from "@/common/decorators";

@Public()                          // opt out of auth — visible in review
@RequireKyc(1)                     // money paths
@StaffOnly("compliance")           // staff route + Swagger bearer
@RequirePermissions("treasury:approve")
@Idempotent("conversion")          // requires Idempotency-Key header
```

Controllers: `@Controller("resource")`, versioned by default at `/api/v1/...`.
Always add `@ApiTags`, `@ApiOperation({ summary })` and typed responses.

## DTO conventions

```ts
import { PaginationQuery, DateRangeQuery, paginate, safeSort, OkResponse } from "@/common/dto";
```

- `whitelist: true` + `forbidNonWhitelisted: true` is global — an unexpected
  field is a 400. Declare every field you accept.
- **Never interpolate a sort column into SQL.** Use `safeSort(q.sortBy, ALLOWED, "createdAt")`.
- Use `paginate(rows, total, query)` for every list response.

## Events vs queues

- **Event** = "this happened", fire-and-forget, may have many listeners.
  `await this.bus.publish(Events.ConversionCompleted, { … })`
- **Queue job** = "do this work", retried, may be delayed.
  `await this.queue.add(Jobs.SettleConversion, { … })`

Never use an event for something that must not be lost. Never use a queue to
notify listeners of a fact.

```ts
import { EventBusService, Events } from "@/events";
import { Queues, Jobs } from "@/queues/queue.constants";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";

constructor(@InjectQueue(Queues.Commission) private readonly q: Queue) {}
```

## Redis

```ts
import { RedisService } from "@/common/redis/redis.service";
import { CacheKeys, Ttl } from "@/common/redis/cache.keys";
```

Add new keys to `CacheKeys` only if that file is assigned to you; otherwise
derive from an existing key. **Never cache a balance for more than `Ttl.balances`
(3s)** — FRD D-01 requires live financial figures.

Use `redis.withLock(key, ttl, fn)` for anything that must not run twice
concurrently (cron bodies, per-user critical sections).

## Compliance rules you must enforce in code

These are not documentation. They are the reason the platform is lawful.

1. **Referral commission may only be calculated from a `revenue_events` row**
   that is `reconciled = true` and `commissionEligible = true`. The FK is
   non-nullable precisely so this cannot be bypassed.
2. **Commission is calculated on `netAmount`**, not gross.
3. **Never commission a Points conversion, a stake, or a deposit.** Only
   `iap`, `tournament_entry`, `subscription`.
4. **Depth caps at 3.** There is no level 4.
5. **Monthly cap per recipient**: `min(absolute, multiplier × trailing-3-month
   own spend + base)`. Excess is status `capped` and **never carried over**.
6. **A commission only releases when the pool is funded.** Otherwise status
   `queued` until the next treasury outflow.
7. **Treasury outflow may never exceed reconciled inflow for the period.**
   Assert it and refuse; do not warn.
8. **Points come from `serverScore`, never `clientScore`.**
9. **Deposits credit only after processor reconciliation**, never on a client
   confirmation.
10. **Withdrawals**: KYC tier limits, review above threshold, cooling-off for a
    new destination address, source tag recorded.
11. **Four-eyes** on rate changes, plan changes, treasury outflows and manual
    balance adjustments: create an `ApprovalRequest`; the applier must refuse
    when `approverId === requestedById`.
12. **Audit everything sensitive** via `AuditLog` — actor, action, before,
    after, reason, ip.

## Testing

Write `*.spec.ts` unit tests for every service with real logic — especially cap
arithmetic, commission calculation, and anything that refuses an action. Mock
repositories; do not hit the database in unit tests. Aim for the *decision
points*, not coverage percentage.

```ts
const repo = { findOne: jest.fn(), save: jest.fn(), create: jest.fn((x) => x) };
const module = await Test.createTestingModule({
  providers: [MyService, { provide: getRepositoryToken(Entity), useValue: repo }],
}).compile();
```

## Registering your module

**Do NOT edit `src/app.module.ts`** — it is shared and several agents are
working at once. Instead, export your module class normally and report its
class name and import path in your final message. Wiring is done centrally
afterwards.

Your module must be self-contained: import `TypeOrmModule.forFeature([...])`
for the entities you use, and nothing else global (Crypto, Redis, Database and
Events are already `@Global`).

## Added during verification

Three helpers exist because verification against a real database and a real
Redis found the gaps they close. Use them rather than re-deriving:

- **`jobKey(key)`** (`@/queues/queue.constants`) — turns a colon-delimited
  domain key into a BullMQ custom job id. BullMQ *refuses* an id containing
  `:`, and every idempotency key in this codebase is colon-delimited, so every
  deduplicated enqueue was failing silently at the producer.
- **`asScalar` / `firstScalar` / `asAmount` / `asIndex`** (`@/common/utils`) —
  read values out of untrusted payloads (provider webhooks, decoded chain args).
  `String(payload.amount)` records `"[object Object]"` as money when a provider
  wraps the amount in an object. A value that is not a scalar is *absent*, and
  the caller decides what to do about the absence.
- **`configureApp(app)`** (`@/bootstrap`) — the whole HTTP pipeline: helmet,
  CORS, body limits, the validation pipe, the exception filter, versioning. Both
  `main.ts` and the e2e suite go through it, so the pipeline under test is the
  pipeline that ships.

## Tests

- Unit specs mock repositories. They test rules.
- `test/api.e2e-spec.ts` boots the real application against real MySQL and
  Redis. It tests the things a mock cannot catch — a NOT NULL column the entity
  thought had a default, a guard that lets a request through, a validation pipe
  that rejects a documented payload.

Both matter, and neither substitutes for the other. The bug that made
registration impossible passed 777 unit tests.

## SQL: where it lives and what it may do

**Every view read and every `CALL` goes through `DbRoutinesService`**
(`src/database/routines/`). No service embeds raw SQL for a view or a procedure.
Raw SQL scattered across twenty services is SQL nobody can audit, and a renamed
column becomes a 3am runtime error in a cron instead of a compile error.

**The division of labour:**

- **Views and procedures** do set-based work — aggregate a period, upsert five
  hundred leaderboard rows, expire a thousand approvals in one statement.
- **Services decide.** Caps, rates, plan depth, whether a payout may proceed.
- **Triggers only refuse.** They never write a balance or derive an amount.

**There is deliberately no money math in SQL.** No procedure computes a
commission, applies a cap or converts Points. Those rules live in TypeScript
where they are unit-tested; a second implementation in SQL would be a second
answer, and the two would diverge the first time a rule changed. The one stored
function, `fn_month_key`, is calendar arithmetic with no policy in it.

### Adding a view or a procedure

1. Write it in the migration, with a comment saying **what it replaced and why** —
   a round-trip count, a race, a duplicated definition. An object that cannot
   answer that question does not need to exist.
2. Add a typed method to `DbRoutinesService`. Procedures **return a result set**;
   they never use `OUT` parameters — reading one takes two statements, and with a
   connection pool those can land on different connections, so the caller
   silently reads NULL.
3. Bump `EXPECTED_OBJECTS`. The readiness probe counts the objects, so a
   half-migrated database fails the probe instead of failing on the first cron
   tick.
4. Assert it in `test/database.e2e-spec.ts` against a real database. A mocked
   repository will happily agree with whatever you believe a view computes.

### Two traps worth knowing

**Session variables and pooling.** `SET @x = …`, `SET FOREIGN_KEY_CHECKS = 0` and
`SET @mt_maintenance = 1` are per-connection. Setting one with `ds.query` and
using it with a second `ds.query` may hit two different pooled connections. Pin a
`QueryRunner` for the whole sequence — the e2e teardown does exactly this, after
breaking for exactly this reason.

**`JSON_TABLE` collations.** Its columns take the *server's* default character
set, not the schema's, so joining one against an id column raises "illegal mix of
collations" on any server installed with a different default. Two procedures loop
over the JSON array with a routine variable instead; it is still one round trip
from the application, and it survives a move between machines.
