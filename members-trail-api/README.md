# Members Trail API

NestJS monolith for the Members Trail play-to-earn platform on BNB Smart Chain.
MySQL for state, Redis for locks, caches and rate limits, BullMQ for work that
must not happen on the request path, Socket.IO for pushes, viem for the chain.

**The rule the whole backend enforces:** every payout — staking yield and
referral commission alike — traces to reconciled platform revenue, never to
another member's deposit. Anything that could break that invariant is refused
rather than approximated.

---

## Running it

```bash
cp .env.example .env          # then fill in the secrets it lists
npm install
npm run migration:run         # schema
npm run seed                  # staff accounts, policy, catalogue (idempotent)
npm run start:dev             # http://localhost:4000, Swagger at /api/docs
```

The seed prints a generated staff password **once** unless `SEED_ADMIN_PASSWORD`
is set. Nothing else stores it.

### Checks

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # unit suite (mocked repositories)
npm run test:e2e     # real app against real MySQL + Redis
```

The e2e suite truncates member-created tables in the database named by `DB_NAME`
in `test/setup.ts`. Point it at a throwaway database.

---

## One deployable, three workloads

The monolith is deliberate: a commission calculation and the ledger row it writes
share a transaction, with no network hop in between. What makes it scalable is
that the workloads separate by configuration rather than by rewrite.

| Instance role | `QUEUE_WORKERS_ENABLED` | `SCHEDULER_ENABLED` |
| --- | --- | --- |
| API | `false` | `false` |
| Workers (scale out freely) | `true` | `false` |
| Scheduler (**exactly one**) | `false` | `true` |

Queue *producers* are always registered, so any module can enqueue regardless of
what the instance runs. Processors and crons are **imported or not** — never
"registered but disabled" — because a BullMQ worker opens connections the moment
it exists and an `@Cron` fires whether or not anyone wants it to.

Running several schedulers is safe but pointless: every cron body takes a Redis
lock first, so the extras log `skipped — lock held` and do nothing.

```
src/modules/**        feature modules — know nothing about queues, crons or sockets
src/queues/**         producers, processors, the queue registry
src/scheduler/**      every @Cron in the system, in one reviewable place
src/realtime/**       the gateway and the Redis socket adapter
src/database/**       entities, migrations, seeds, LedgerService
```

The module graph runs one way, which is what would let queues, crons or sockets
be lifted into their own service later without touching a feature file.

---

## The parts worth knowing before changing anything

**The ledger owns balances.** Every balance change goes through
`LedgerService`; nothing else writes `user_balances`. It holds the row lock, and
that lock is what makes concurrent spends safe. `withUserLock` /
`withTwoUserLock` for multi-row atomicity.

**Money is `DECIMAL(36,18)`, carried as strings.** Never a JS number. Use the
helpers in `@/common/utils` — `toDbAmount` (18dp), `fiat` (2dp), `add`/`sub`/
`dec`. A `float` anywhere near money is a bug.

**The server decides, the client reports.** A game session is credited from the
replayed *server* score, never the submitted one. Fatal anti-cheat flags reject;
non-fatal ones credit and record.

**Commission pays only from reconciled, eligible revenue.** No approved plan
means it pays nothing — deliberately, so an unconfigured platform cannot accrue
liability. Depth is three, the monthly cap does not carry over, and released
commission can never exceed confirmed pool funding
(`CommissionService.fundingAvailable`).

**Idempotency is domain-derived.** Money-moving routes require an
`Idempotency-Key` header; queue jobs carry a deterministic job id built with
`jobKey()` — which exists because BullMQ refuses a custom id containing `:`,
and every key in this codebase is colon-delimited.

**The chain is polled, not subscribed.** `getLogs` from a persisted cursor,
`MIN_CONFIRMATIONS` deep, reorgs detected by block hash and rewound by marking
events orphaned (never deleting). Outbound transactions take a nonce under a
Redis lock, and a stuck one is repriced **on the same nonce** — a new nonce would
leave both live.

**Untrusted payloads go through `asScalar`/`asAmount`/`asIndex`.**
`String(payload.amount)` on a provider that sends `{"amount":{"value":"100"}}`
records `"[object Object]"` as money that arrived.

---

## The database

MySQL 8 (or MariaDB 10.11+). Three migrations build it; nothing is created by
`synchronize`, which is off everywhere including tests.

```
60 tables · 54 foreign keys · 250 indexes · 8 views · 11 routines · 14 triggers
```

**Foreign keys carry meaning.** The delete rule on each one is chosen from what
the row *is*, not from convenience:

| | rule | why |
| --- | --- | --- |
| `points_ledger`, `transactions`, `withdrawals`, `commissions`, `revenue_events`, `wallet_addresses`, `kyc_submissions`, `audit_logs`, … | `RESTRICT` | Financial and compliance records. You must not be able to delete the parent while they exist — deliberately inconvenient. |
| `user_balances`, `user_sessions`, `notifications`, `user_quests`, `login_history`, … | `CASCADE` | Meaningless without their parent, with no audit value of their own. |
| `referral_edges.ancestorId` | `RESTRICT` | An upline is load-bearing for other people's commission. Removing one is refused, not silently absorbed. |

`kyc_access_log` deliberately has **no** foreign key: the record of who viewed an
identity document has to survive that document's retention purge.

**Views** are read-only aggregation. None of them decides policy — no cap, no
rate, no payable amount:

| view | replaces |
| --- | --- |
| `v_commission_solvency` | four sequential scans per call, and it is called once per commission row during a fan-out |
| `v_treasury_period` | six aggregates per rollup, which ran on every dashboard read |
| `v_payout_ratio` | two divergent implementations of the same compliance number |
| `v_points_drift` | a per-member walk, so the nightly audit skipped it and it never ran |
| `v_mtt_liability` | nothing — new; the custodial figure to reconcile against the wallet |
| `v_admin_kpis` | thirteen statements per dashboard load |
| `v_member_signup_cohort`, `v_conversion_monthly` | derived-month `GROUP BY` in two reports |

**Routines** do set-based work. They contain no money math — a procedure that
computed a commission would be a second implementation of a rule that already
has one, and the two would diverge the first time it changed. Examples:
`sp_leaderboard_snapshot_upsert` replaced up to 500 single-row writes per metric
(the cron does four metrics across three periods); `sp_quest_progress` replaced a
read-modify-write with a lost-update window between the read and the write.

**Triggers only ever refuse.** They make the invariants true for every client,
not just the code paths that remember to check: the Points ledger is append-only,
audit rows cannot be deleted, no balance bucket may go negative, lifetime
commission cannot decrease, commission depth is 1–3, a member cannot earn
commission on their own spend, a published legal document cannot be edited, and a
conversion needs a positive rate.

A refusal surfaces as HTTP **409** with the trigger's own code (for example
`LEDGER_IMMUTABLE`), not a 500.

**The maintenance flag.** Retention and lawful erasure genuinely need to delete
history, so the destructive guards yield to one declared session variable:

```sql
SET @mt_maintenance = 1;   -- audited, deliberate, one session only
-- … the deletion …
SET @mt_maintenance = 0;
```

It is a guard against accidents and application bugs, not a security boundary —
anyone who can set a session variable could drop the trigger instead. The
application never sets it.

### What the indexes bought

Measured on MySQL 8.0.46 with 4 000 members, 60 000 sessions, 25 000 withdrawals,
30 000 revenue events and 40 000 commissions; median of five runs, same queries
with the new indexes dropped and restored.

| query (the code path that runs it) | before | after |
| --- | --- | --- |
| fraud: structuring sweep | 44.7 ms | **1.0 ms** |
| fraud: bot-farming sweep | 117.9 ms | **5.8 ms** |
| fraud: withdrawal velocity | 6.1 ms | **1.5 ms** |
| payout ratio for a month | 18.2 ms | **5.4 ms** |
| dashboard: active members (30 d) | 1.9 ms | **0.9 ms** |
| fraud: cap-hugging sweep | 17.9 ms | **11.1 ms** |
| report: withdrawals over a quarter | 29.8 ms | 32.4 ms |
| report: revenue over a quarter | 52.7 ms | 55.9 ms |
| solvency totals by status | 78.4 ms | 76.4 ms |

The last three are honest: at 90-day selectivity the optimiser correctly prefers
a scan, and the solvency total is a whole-table `GROUP BY` that no index helps.
Those indexes are still there because the same columns serve the narrow ranges —
a one-day revenue window uses `idx_revenue_occurred` and reads 164 rows instead of
30 000 — and `EXPLAIN` confirms every new index is chosen by at least one real
plan. The sweeps are where the win is, and they run on every cron tick.

---

## Operating it

Health: `GET /health` (shallow), `/health/live`, `/health/ready` (MySQL, Redis,
memory, disk).

Log lines an operator greps for:

| Line | Meaning |
| --- | --- |
| `COMMISSION POOL INSOLVENT` | Committed commission exceeds confirmed funding. Releases must stop. |
| `cron <name> failed` | A scheduled job threw. It did not retry; the next tick will. |
| `chain unreachable` | No RPC endpoint answered. Indexer lag is unknown; relayer state is still reported. |
| `indexer unhealthy` | Cursor lag beyond `HEALTHY_LAG_BLOCKS`, or a stored error. |
| `ABANDONED <kind> <ref>` | An outbound transaction gave up. Needs a human. |
| `REJECTED <provider> webhook` | Signature verification failed. Misconfiguration or probing. |
| `re-drove N stored-but-unprocessed inbound webhooks` | A queue write was lost and the sweep recovered it. |

### Seams that are deliberately unfinished

These record what happened instead of pretending to have succeeded. Each is one
adapter away from working:

- **Notification delivery** — no email/SMS provider. Deliveries are recorded
  `suppressed` with a reason, never "sent".
- **Outbound webhooks** — no HTTP client. Attempts are recorded `failed` with the
  reason and stay on their backoff schedule.
- **Fiat payouts** — no payment-provider rail. A fiat withdrawal stays
  `processing` and appears in the ops queue; it is never sent on chain.

---

## Environment

`.env.example` is the authoritative list; `src/config/env.schema.ts` validates it
at boot and **refuses to start** on a missing secret rather than failing on the
first request. The ones with teeth:

| Variable | Why it matters |
| --- | --- |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ≥32 chars. Rotating them invalidates every session. |
| `ENCRYPTION_KEY` | 64 hex chars. Losing it makes encrypted columns unreadable. |
| `PAYMENT_WEBHOOK_SECRET`, `KYC_WEBHOOK_SECRET` | Absent means every delivery from that provider is refused, not trusted. |
| `ORACLE_PRIVATE_KEY` / `ORACLE_KMS_KEY_ID` | Absent means outbound transactions refuse to sign. Prefer KMS. |
| `TRUST_PROXY` | Only `true` behind a proxy. Trusting `X-Forwarded-For` unconditionally lets a client spoof its IP and defeat rate limiting. |
| `MTT_TOKEN_ADDRESS` | Absent means payouts refuse rather than sending to nowhere. |
