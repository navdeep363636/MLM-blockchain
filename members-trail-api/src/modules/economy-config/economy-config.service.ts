import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { PlatformConfig } from "@/database/entities";
import { economyConfig, type EconomyConfig } from "@/config/configuration";
import { RedisService } from "@/common/redis/redis.service";
import { CacheKeys, Ttl } from "@/common/redis/cache.keys";
import { toDbAmount } from "@/common/utils";
import {
  ConfigKeys,
  type ConversionCapsConfig,
  type MarketplacePolicyConfig,
  type PointsCapsConfig,
  type TreasuryAllocationConfig,
  type WithdrawalPolicyConfig,
} from "./economy-config.constants";

/* ============================================================================
 * Reader/writer for the economy's policy numbers.
 *
 * Three properties matter here:
 *
 *  1. VERSIONED, NEVER OVERWRITTEN. A write inserts a new `platform_config` row
 *     with `version + 1` and deactivates the previous one. The old value stays
 *     readable, so "what was the cap on the 3rd?" is answerable — which is the
 *     whole point of auditing a cap change.
 *
 *  2. CACHED BRIEFLY. Policy is read on every money request; 60s of staleness is
 *     acceptable for a cap and is invalidated explicitly on write. Balances are
 *     never cached like this (see Ttl.balances).
 *
 *  3. DEFAULTS ARE MERGED, NOT REPLACED. A stored value missing a field falls
 *     back to the env default for that field only, so adding a new policy field
 *     cannot produce `undefined` in a cap comparison.
 * ========================================================================== */

@Injectable()
export class EconomyConfigService {
  private readonly log = new Logger(EconomyConfigService.name);

  constructor(
    @InjectRepository(PlatformConfig) private readonly repo: Repository<PlatformConfig>,
    private readonly redis: RedisService,
    @Inject(economyConfig.KEY) private readonly env: EconomyConfig,
  ) {}

  /* ------------------------------------------------------------------ *
   * Typed accessors
   * ------------------------------------------------------------------ */

  async pointsCaps(): Promise<PointsCapsConfig> {
    return this.read<PointsCapsConfig>(ConfigKeys.pointsCaps, {
      /* Derived from the conversion daily cap: issuing more Points per day than
       * a user could ever convert would only inflate a dead balance. */
      dailyGlobal: this.env.conversionDailyCapPoints,
      perGameDailyDefault: 3_000,
      perSessionDefault: 1_000,
    });
  }

  async conversionCaps(): Promise<ConversionCapsConfig> {
    return this.read<ConversionCapsConfig>(ConfigKeys.conversionCaps, {
      dailyPoints: this.env.conversionDailyCapPoints,
      monthlyPoints: this.env.conversionMonthlyCapPoints,
    });
  }

  async withdrawalPolicy(): Promise<WithdrawalPolicyConfig> {
    return this.read<WithdrawalPolicyConfig>(ConfigKeys.withdrawalPolicy, {
      autoApproveMtt: toDbAmount(this.env.withdrawal.autoApproveMtt),
      coolingOffHours: this.env.withdrawal.coolingOffHours,
      tierLimitsMtt: {
        /* Tier 0 is deliberately zero rather than absent: an unverified identity
         * has no withdrawal allowance at all (conventions §10). */
        "0": toDbAmount(0),
        "1": toDbAmount(this.env.kycLimits.tier1Mtt),
        "2": toDbAmount(this.env.kycLimits.tier2Mtt),
      },
      rollingWindowDays: 30,
    });
  }

  async treasuryAllocation(): Promise<TreasuryAllocationConfig> {
    return this.read<TreasuryAllocationConfig>(ConfigKeys.treasuryAllocation, {
      allocationBps: {
        iap: 3_000,
        tournament: 3_000,
        subscription: 3_000,
        marketplace: 5_000,
        advertising: 5_000,
      },
      fiatPerMtt: toDbAmount(1),
      reserveBps: 1_500,
    });
  }

  async marketplacePolicy(): Promise<MarketplacePolicyConfig> {
    return this.read<MarketplacePolicyConfig>(ConfigKeys.marketplacePolicy, {
      /* 5%: enough to fund the Treasury's share of a trade without making
       * resale pointless, which would push trading off-platform. */
      feeBps: 500,
      minAskMtt: toDbAmount(1),
      maxAskMtt: toDbAmount(1_000_000),
      listingTtlDays: 30,
    });
  }

  /* ------------------------------------------------------------------ *
   * Generic read / write
   * ------------------------------------------------------------------ */

  /**
   * Reads the active value for `key`, shallow-merged over `fallback`.
   *
   * A Redis or database problem must not take the money paths down, so a read
   * failure degrades to the fallback and is logged loudly rather than thrown.
   */
  async read<T extends object>(key: string, fallback: T): Promise<T> {
    const cacheKey = CacheKeys.platformConfig(key);
    try {
      const cached = await this.redis.get<T>(cacheKey);
      if (cached) return { ...fallback, ...cached };

      const row = await this.repo.findOne({
        where: { key, active: true },
        order: { version: "DESC" },
      });
      const value = (row?.value ?? null) as Partial<T> | null;
      const merged = { ...fallback, ...(value ?? {}) };
      await this.redis.set(cacheKey, merged, Ttl.platformConfig);
      return merged;
    } catch (e) {
      this.log.error(
        `config read failed for ${key} — using defaults`,
        e instanceof Error ? e.stack : String(e),
      );
      return fallback;
    }
  }

  /** Currently active raw row, if any. Used to snapshot `before` for the audit log. */
  activeRow(key: string): Promise<PlatformConfig | null> {
    return this.repo.findOne({ where: { key, active: true }, order: { version: "DESC" } });
  }

  /**
   * Writes a new version of `key` and retires the previous one. Returns the new
   * row; the caller is responsible for the AuditLog entry (it owns the actor,
   * IP and reason).
   */
  async write<T extends object>(
    key: string,
    value: T,
    actorId: string,
    note?: string | null,
  ): Promise<PlatformConfig> {
    const current = await this.activeRow(key);
    if (current) {
      current.active = false;
      await this.repo.save(current);
    }

    const row = await this.repo.save(
      this.repo.create({
        key,
        value,
        version: (current?.version ?? 0) + 1,
        active: true,
        effectiveFrom: new Date(),
        updatedById: actorId,
        note: note ?? null,
      }),
    );

    await this.redis.del(CacheKeys.platformConfig(key));
    this.log.log(`config ${key} → v${row.version} by ${actorId}`);
    return row;
  }
}
