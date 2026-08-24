import "../../load-env";
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DataSource, In } from "typeorm";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { allConfig } from "@/config/configuration";
import { DatabaseModule } from "@/database/database.module";
import { RedisModule } from "@/common/redis/redis.module";
import { CryptoModule } from "@/common/crypto/crypto.module";
import { CryptoService } from "@/common/crypto/crypto.service";
import { RedisService } from "@/common/redis/redis.service";
import { EconomyConfigModule } from "@/modules/economy-config/economy-config.module";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import { COMMISSION_ELIGIBLE_STREAMS, ConfigKeys } from "@/modules/economy-config/economy-config.constants";
import { streamToTrigger } from "@/modules/referral/commission-plan.service";
import { defaultNotificationMatrix } from "@/modules/auth/auth.service";
import { Ref, toDbAmount } from "@/common/utils";
import type { CommissionTrigger } from "@/database/entities";
import {
  Achievement, CommissionPlan, ConversionRate, FraudRule, Game, LegalDocument,
  NotificationPreference, Quest, RolePermission, StakingPool, StoreItem, User,
  UserBalance,
} from "@/database/entities";
import {
  ACHIEVEMENTS, FRAUD_RULES, GAMES, POOLS, QUESTS, ROLE_PERMISSIONS, STORE_ITEMS,
} from "./seed.data";

/* ============================================================================
 * Seed.
 *
 * Run once against a migrated database:  npm run seed
 *
 * Three properties this script is built around:
 *
 *  1. IDEMPOTENT. Every step upserts on a natural key, so running it twice does
 *     not produce two catalogues, two rate rows or two admins. A seed you are
 *     afraid to re-run is a seed nobody runs.
 *
 *  2. NO INVENTED MONEY. It creates policy and catalogue rows only — no
 *     balances, no commissions, no sessions. Every balance in this system is
 *     supposed to be derivable from the ledger; a seeded balance is a balance
 *     with no entries behind it, which is exactly the drift the nightly audit
 *     exists to catch.
 *
 *  3. FOUR-EYES IS REAL, NOT SIMULATED. The conversion rate and the commission
 *     plan are seeded as approved, and the proposer and approver are DIFFERENT
 *     accounts — because the services enforce that separation and a seed that
 *     wrote the same id into both columns would leave the platform in a state
 *     the API itself would refuse to create.
 *
 * On the admin password: there is no default. Either SEED_ADMIN_PASSWORD is
 * supplied, or a strong one is generated and printed ONCE. A seeded credential
 * that ships in a repository is how a staging environment becomes an incident.
 * ========================================================================== */

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, load: allConfig }),
    CryptoModule,
    RedisModule,
    DatabaseModule,
    EconomyConfigModule,
  ],
})
class SeedModule {}

const log = new Logger("Seed");

/** Staff accounts the platform needs before anyone can approve anything. */
const STAFF: { key: string; email: string; name: string; role: "super_admin" | "compliance" | "finance_admin" | "support" }[] = [
  { key: "SEED_ADMIN_EMAIL", email: "ops@memberstrail.local", name: "Platform Operations", role: "super_admin" },
  { key: "SEED_COMPLIANCE_EMAIL", email: "compliance@memberstrail.local", name: "Compliance Desk", role: "compliance" },
  { key: "SEED_FINANCE_EMAIL", email: "finance@memberstrail.local", name: "Finance Desk", role: "finance_admin" },
  { key: "SEED_SUPPORT_EMAIL", email: "support@memberstrail.local", name: "Support Desk", role: "support" },
];

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(SeedModule, {
    logger: ["error", "warn", "log"],
  });

  const ds = app.get(DataSource);
  const crypto = app.get(CryptoService);
  const config = app.get(EconomyConfigService);
  const redis = app.get(RedisService);

  /* Fail fast if Redis is not reachable.
   *
   * The seed writes platform configuration, and writing it invalidates the cache
   * — so Redis has to be up. Without this check the seed simply HANGS: the Redis
   * client retries a refused connection forever by design (which is right for a
   * long-running API and wrong for a command), so an operator sees a prompt that
   * never returns and no explanation. */
  const reachable = await Promise.race([
    redis.ping(),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!reachable) {
    throw new Error(
      `Redis is not reachable at ${process.env.REDIS_HOST ?? "127.0.0.1"}:` +
      `${process.env.REDIS_PORT ?? 6379}. The seed writes platform configuration, which ` +
      "invalidates cached values, so it needs Redis running. Start it and re-run.",
    );
  }

  const created: string[] = [];
  const skipped: string[] = [];
  const note = (label: string, isNew: boolean): void => {
    (isNew ? created : skipped).push(label);
  };

  /* ==================================================================== *
   * 1. Staff accounts
   * ==================================================================== */

  const password = process.env.SEED_ADMIN_PASSWORD ?? `${randomBytes(12).toString("base64url")}Aa1!`;
  const generated = !process.env.SEED_ADMIN_PASSWORD;

  const staffIds: Record<string, string> = {};

  for (const person of STAFF) {
    const email = (process.env[person.key] ?? person.email).trim().toLowerCase();
    const emailHash = crypto.hmac(email);
    const users = ds.getRepository(User);

    const existing = await users.findOne({ where: { emailHash } });
    if (existing) {
      staffIds[person.role] = existing.id;
      /* The role is corrected on re-run — an operator who demoted an account by
       * hand should not have it silently re-promoted, so only the missing bits
       * are filled in. */
      if (!existing.isStaff) {
        existing.isStaff = true;
        await users.save(existing);
      }
      note(`staff ${email} (${person.role})`, false);
      continue;
    }

    const user = await users.save(
      users.create({
        ref: Ref.user(),
        email,
        emailHash,
        emailVerifiedAt: new Date(),
        passwordHash: await crypto.hashPassword(password),
        passwordChangedAt: new Date(),
        fullName: person.name,
        displayName: person.name.split(" ")[0] ?? person.name,
        country: "IN",
        locale: "en",
        timezone: "UTC",
        status: "active",
        /* Staff do not withdraw, so no KYC tier is granted here. If an operator
         * ever needs to, they go through the same KYC flow a member does. */
        kycTier: 0,
        role: person.role,
        isStaff: true,
        referralCode: crypto.referralCode("OPS"),
        referralDepth: 0,
        riskScore: 0,
        acceptedLegalVersions: { seededAt: new Date().toISOString() },
      }),
    );

    /* The balance row exists so any later read has a row to lock, exactly as it
     * does for a member. Its values stay zero — only LedgerService moves them. */
    await ds.getRepository(UserBalance).insert(
      ds.getRepository(UserBalance).create({ userId: user.id }),
    );
    await ds.getRepository(NotificationPreference).insert(
      ds.getRepository(NotificationPreference).create({
        userId: user.id,
        channels: defaultNotificationMatrix(),
        marketingOptIn: false,
      }),
    );

    staffIds[person.role] = user.id;
    note(`staff ${email} (${person.role})`, true);
  }

  const adminId = staffIds.super_admin;
  const financeId = staffIds.finance_admin;
  if (!adminId || !financeId) throw new Error("staff seeding failed — no admin or finance account");

  /* ==================================================================== *
   * 2. Role permissions
   * ==================================================================== */

  const perms = ds.getRepository(RolePermission);
  for (const p of ROLE_PERMISSIONS) {
    const existing = await perms.findOne({ where: { role: p.role, module: p.module } });
    if (existing) {
      note(`permission ${p.role}/${p.module}`, false);
      continue;
    }
    await perms.save(perms.create(p));
    note(`permission ${p.role}/${p.module}`, true);
  }

  /* ==================================================================== *
   * 3. Economy policy, materialised
   *
   * Read through the typed accessors and written straight back. That way the
   * stored values are exactly the effective defaults — an admin opening the
   * config screen sees the numbers the engine is already using, instead of an
   * empty table and a fallback they cannot see.
   * ==================================================================== */

  const configWrites: [string, object][] = [
    [ConfigKeys.pointsCaps, await config.pointsCaps()],
    [ConfigKeys.conversionCaps, await config.conversionCaps()],
    [ConfigKeys.withdrawalPolicy, await config.withdrawalPolicy()],
    [ConfigKeys.treasuryAllocation, await config.treasuryAllocation()],
    [ConfigKeys.marketplacePolicy, await config.marketplacePolicy()],
  ];

  for (const [key, value] of configWrites) {
    const active = await config.activeRow(key);
    if (active) {
      note(`config ${key}`, false);
      continue;
    }
    await config.write(key, value, adminId, "Seeded from the env defaults");
    note(`config ${key}`, true);
  }

  /* ==================================================================== *
   * 4. Conversion rate v1
   * ==================================================================== */

  const rates = ds.getRepository(ConversionRate);
  const activeRate = await rates.findOne({ where: { status: "active" } });
  if (activeRate) {
    note(`conversion rate ${activeRate.pointsPerMtt} points/MTT`, false);
  } else {
    const pointsPerMtt = Number(process.env.POINTS_PER_MTT_DEFAULT ?? 1_000);
    await rates.save(
      rates.create({
        pointsPerMtt,
        effectiveFrom: new Date(),
        status: "active",
        /* Proposed by Finance, approved by Operations. Two accounts, because the
         * service refuses one. */
        proposedById: financeId,
        approvedById: adminId,
        approvedAt: new Date(),
        rationale: "Launch rate, seeded. Any change goes through propose → approve.",
      }),
    );
    note(`conversion rate ${pointsPerMtt} points/MTT`, true);
  }

  /* ==================================================================== *
   * 5. Commission plan v1
   *
   * Without an approved plan the engine pays NOTHING — deliberately, so an
   * unconfigured platform cannot accrue liability. This is the row that turns
   * the referral programme on, which is why it is seeded explicitly rather than
   * defaulted somewhere in code.
   * ==================================================================== */

  const plans = ds.getRepository(CommissionPlan);
  const activePlan = await plans.findOne({ where: { status: In(["active", "scheduled"]) } });
  if (activePlan) {
    note(`commission plan v${activePlan.version}`, false);
  } else {
    await plans.save(
      plans.create({
        version: 1,
        l1Bps: Number(process.env.COMMISSION_L1_BPS ?? 800),
        l2Bps: Number(process.env.COMMISSION_L2_BPS ?? 300),
        l3Bps: Number(process.env.COMMISSION_L3_BPS ?? 100),
        /* Three levels. There is no level four anywhere in this system — not in
         * the plan, not in the edge table, not in the payout query. */
        maxDepth: 3,
        /* Derived from the single list of commission-eligible streams rather
         * than retyped: marketplace fees and ad revenue fund the Treasury but
         * are not attributable to a member's spend, so they never pay
         * commission, and that rule must have exactly one home. */
        eligibleTriggers: COMMISSION_ELIGIBLE_STREAMS
          .map(streamToTrigger)
          .filter((t): t is CommissionTrigger => t !== null),
        monthlyCapAbsolute: process.env.COMMISSION_MONTHLY_CAP_ABSOLUTE ?? "50000.00",
        capMultiplier: process.env.COMMISSION_CAP_MULTIPLIER ?? "5.00",
        capBase: process.env.COMMISSION_CAP_BASE ?? "1000.00",
        minAccountAgeDays: 7,
        minGameplaySessions: 5,
        status: "active",
        effectiveFrom: new Date(),
        proposedById: financeId,
        approvedById: adminId,
        approvedAt: new Date(),
        simulationSnapshot: {
          seeded: true,
          basis: "No historical revenue at seed time, so no projection was possible",
          note: "Re-simulate before the first plan change; approval will refuse an insolvent plan",
        },
        rationale: "Launch plan: 8/3/1 to three levels, capped monthly with no carry-over.",
      }),
    );
    note("commission plan v1", true);
  }

  /* ==================================================================== *
   * 6. Staking pools
   * ==================================================================== */

  const pools = ds.getRepository(StakingPool);
  for (const p of POOLS) {
    const existing = await pools.findOne({ where: { poolId: p.poolId } });
    if (existing) {
      note(`pool ${p.poolId} ${p.name}`, false);
      continue;
    }
    await pools.save(
      pools.create({
        ...p,
        /* Totals start at zero and are only ever moved by indexed chain events.
         * Seeding a TVL would make the first APR observation a fiction. */
        totalStaked: toDbAmount(0),
        totalRewardsFunded: toDbAmount(0),
        totalRewardsPaid: toDbAmount(0),
        currentApr: "0.00",
      }),
    );
    note(`pool ${p.poolId} ${p.name}`, true);
  }

  /* ==================================================================== *
   * 7. Games
   * ==================================================================== */

  const games = ds.getRepository(Game);
  const gameIdBySlug: Record<string, string> = {};
  for (const g of GAMES) {
    const existing = await games.findOne({ where: { slug: g.slug } });
    if (existing) {
      gameIdBySlug[g.slug] = existing.id;
      note(`game ${g.slug}`, false);
      continue;
    }
    const saved = await games.save(games.create({ ...g, entryFee: toDbAmount(g.entryFee) }));
    gameIdBySlug[g.slug] = saved.id;
    note(`game ${g.slug}`, true);
  }

  /* ==================================================================== *
   * 8. Quests and achievements
   * ==================================================================== */

  const quests = ds.getRepository(Quest);
  for (const q of QUESTS) {
    const existing = await quests.findOne({ where: { title: q.title, kind: q.kind } });
    if (existing) {
      note(`quest ${q.code}`, false);
      continue;
    }
    const gameId = q.gameSlug ? gameIdBySlug[q.gameSlug] ?? null : null;
    await quests.save(
      quests.create({
        title: q.title,
        description: q.description,
        kind: q.kind,
        gameId,
        /* The metric has to be one the tracker understands, or the quest can
         * never progress — a silent dead end for the member. */
        objective: { metric: q.metric, value: q.target, gameId },
        target: q.target,
        rewardPoints: q.rewardPoints,
        active: true,
      }),
    );
    note(`quest ${q.code}`, true);
  }

  const achievements = ds.getRepository(Achievement);
  for (const a of ACHIEVEMENTS) {
    const existing = await achievements.findOne({ where: { code: a.code } });
    if (existing) {
      note(`achievement ${a.code}`, false);
      continue;
    }
    await achievements.save(achievements.create({ ...a, active: true }));
    note(`achievement ${a.code}`, true);
  }

  /* ==================================================================== *
   * 9. Store catalogue
   * ==================================================================== */

  const items = ds.getRepository(StoreItem);
  for (const item of STORE_ITEMS) {
    const existing = await items.findOne({ where: { sku: item.sku } });
    if (existing) {
      note(`item ${item.sku}`, false);
      continue;
    }
    await items.save(items.create({ ...item, priceMtt: toDbAmount(item.priceMtt), active: true }));
    note(`item ${item.sku}`, true);
  }

  /* ==================================================================== *
   * 10. Fraud rules — enabled, but advisory
   * ==================================================================== */

  const rules = ds.getRepository(FraudRule);
  for (const r of FRAUD_RULES) {
    const existing = await rules.findOne({ where: { code: r.code } });
    if (existing) {
      note(`fraud rule ${r.code}`, false);
      continue;
    }
    await rules.save(
      rules.create({
        ...r,
        enabled: true,
        /* Never seeded true. Freezing funds without a human decision is a policy
         * choice Compliance makes in the admin UI, where it is audited. */
        autoFreeze: false,
      }),
    );
    note(`fraud rule ${r.code}`, true);
  }

  /* ==================================================================== *
   * 11. Legal documents — loaded as DRAFTS IN REVIEW, never published
   *
   * The drafts define the required sections so Legal reviews real prose rather
   * than an outline. They are seeded at `legal_review` and NOT published,
   * because publishing is an attorney's decision in each jurisdiction and the
   * platform asks members to accept whatever is published.
   * ==================================================================== */

  interface LegalSeed {
    slug: string;
    title: string;
    version: string;
    summary: string;
    materialChange: boolean;
    effectiveFrom: string;
    sections: { heading: string; body: string[] }[];
  }

  const legalPath = join(__dirname, "legal.seed.json");
  const legalDocs = JSON.parse(readFileSync(legalPath, "utf8")) as LegalSeed[];
  const legal = ds.getRepository(LegalDocument);

  for (const doc of legalDocs) {
    const existing = await legal.findOne({ where: { slug: doc.slug, version: doc.version } });
    if (existing) {
      note(`legal ${doc.slug} v${doc.version}`, false);
      continue;
    }
    await legal.save(
      legal.create({
        slug: doc.slug,
        title: doc.title,
        version: doc.version,
        status: "legal_review",
        summary: doc.summary,
        sections: doc.sections,
        materialChange: doc.materialChange,
        effectiveFrom: doc.effectiveFrom ? new Date(`${doc.effectiveFrom}T00:00:00Z`) : null,
        publishedAt: null,
        authoredById: adminId,
        approvedById: null,
      }),
    );
    note(`legal ${doc.slug} v${doc.version}`, true);
  }

  /* ==================================================================== *
   * Summary
   * ==================================================================== */

  log.log(`seed complete — ${created.length} rows created, ${skipped.length} already present`);
  if (created.length > 0) {
    for (const row of created) log.log(`  + ${row}`);
  }

  if (generated && created.some((c) => c.startsWith("staff "))) {
    /* Printed once, to stdout, and never stored anywhere by this script. */
    log.warn("=".repeat(72));
    log.warn(`Staff password (all seeded accounts): ${password}`);
    log.warn("Change it on first sign-in. It is not stored anywhere else.");
    log.warn("=".repeat(72));
  }

  const warnings: string[] = [];
  if (legalDocs.length > 0) {
    warnings.push(
      "Legal documents are seeded as DRAFTS IN REVIEW. Nothing is published: an " +
      "attorney in each operating jurisdiction must approve the language first.",
    );
  }
  warnings.push(
    "Fraud rules are advisory — no rule auto-freezes an account until Compliance " +
    "turns that on deliberately.",
  );
  for (const w of warnings) log.warn(w);

  await app.close();
}

void main().catch((e) => {
   
  console.error("Seed failed:", e);
  process.exit(1);
});
