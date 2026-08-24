import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { RedisService } from "@/common/redis/redis.service";
import { monthKey } from "@/common/utils";
import { CommissionService } from "@/modules/referral/commission.service";
import { TreasuryService } from "@/modules/treasury/treasury.service";
import { WithdrawalService } from "@/modules/wallet/withdrawal.service";
import { DepositService } from "@/modules/wallet/deposit.service";
import { StakingService } from "@/modules/staking/staking.service";
import { LedgerService } from "@/database/ledger/ledger.service";
import { DbRoutinesService } from "@/database/routines/db-routines.service";

/* ============================================================================
 * Economy crons.
 *
 * Every job body runs under a Redis lock. That is not defensive coding — it is
 * what makes it safe to run several instances with SCHEDULER_ENABLED=true, and
 * more importantly it is what stops a slow run from overlapping itself. A payout
 * ratio rollup running twice concurrently would double-count.
 *
 * The lock TTL on each job is longer than the job's worst realistic runtime and
 * shorter than its interval. Too short and a long run loses its lock mid-flight;
 * too long and a crashed instance blocks the next run.
 * ========================================================================== */

@Injectable()
export class EconomyJobs {
  private readonly log = new Logger(EconomyJobs.name);

  constructor(
    private readonly redis: RedisService,
    private readonly commission: CommissionService,
    private readonly treasury: TreasuryService,
    private readonly withdrawals: WithdrawalService,
    private readonly deposits: DepositService,
    private readonly staking: StakingService,
    private readonly ledger: LedgerService,
    private readonly routines: DbRoutinesService,
  ) {}

  /**
   * Releases queued commission, in case a pool funding was confirmed while no
   * chain event fired — a funding transfer made outside the platform, for
   * instance.
   *
   * The solvency invariant is checked inside the service, so this cannot release
   * more than the pool holds however often it runs.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: "commission-release" })
  async releaseQueuedCommission(): Promise<void> {
    await this.locked("commission-release", 540, async () => {
      const result = await this.commission.releaseQueued();
      if (result.released > 0) {
        this.log.log(
          `released ${result.released} queued commissions (${result.releasedMtt} MTT), ` +
          `${result.remaining} still waiting on funding`,
        );
      }
    });
  }

  /**
   * Recomputes the current period's treasury totals and payout ratio.
   *
   * Hourly rather than nightly because the payout ratio is the platform's
   * compliance tripwire: discovering at 2am that it breached at noon is twelve
   * hours of payouts too late.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: "treasury-rollup" })
  async rollupTreasury(): Promise<void> {
    await this.locked("treasury-rollup", 3_000, async () => {
      const period = await this.treasury.rollupPeriod(monthKey());
      this.log.log(
        `treasury ${period.periodKey}: payout ratio ${period.payoutRatioBps} bps ` +
        `(reconciled inflow ${period.reconciledInflow})`,
      );
    });
  }

  /**
   * Also rolls up the PREVIOUS month for the first few days of a new one.
   *
   * Late reconciliations land after the month closes, and a period whose totals
   * stopped being recomputed on the 1st would silently under-report them.
   */
  @Cron("0 30 * * * *", { name: "treasury-rollup-previous" })
  async rollupPreviousPeriod(): Promise<void> {
    const now = new Date();
    if (now.getUTCDate() > 5) return;

    await this.locked("treasury-rollup-previous", 3_000, async () => {
      const previous = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)));
      const period = await this.treasury.rollupPeriod(previous);
      this.log.log(`re-rolled ${previous}: payout ratio ${period.payoutRatioBps} bps`);
    });
  }

  /**
   * Flags deposits that have been pending too long.
   *
   * A stuck deposit is either a processor problem or a member owed their money;
   * either way somebody has to look, and nobody looks at a table nobody reports on.
   */
  @Cron(CronExpression.EVERY_30_MINUTES, { name: "stale-deposits" })
  async flagStaleDeposits(): Promise<void> {
    await this.locked("stale-deposits", 1_500, async () => {
      const stale = await this.deposits.stale(60);
      if (stale.length > 0) {
        this.log.warn(
          `${stale.length} deposits unreconciled for over an hour — ` +
          `oldest ${stale[0]?.ref} from ${stale[0]?.createdAt.toISOString()}`,
        );
      }
    });
  }

  /**
   * Recomputes each staking pool's realised APR.
   *
   * Daily, because APR here is a trailing observation of what the pool actually
   * paid — not a rate being offered, which would need no recomputation at all.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM, { name: "staking-apr" })
  async recomputeStakingApr(): Promise<void> {
    await this.locked("staking-apr", 900, async () => {
      const pools = await this.staking.listPools(true);
      let recorded = 0;
      for (const pool of pools) {
        const observation = await this.staking.recomputeApr(pool.poolId);
        if (observation) recorded += 1;
      }
      this.log.log(`recomputed APR for ${recorded} of ${pools.length} pools`);
    });
  }

  /**
   * Audits a sample of Points balances against the ledger.
   *
   * The balance is a cached projection of an immutable ledger; if they ever
   * disagree, something wrote a balance outside LedgerService, which is a bug
   * worth waking someone for. Sampling rather than scanning keeps this cheap
   * enough to run nightly — a drift bug affects many accounts, so a sample finds
   * it.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: "ledger-audit" })
  async auditLedger(): Promise<void> {
    await this.locked("ledger-audit", 3_000, async () => {
      const solvency = await this.commission.fundingAvailable();
      if (!solvency.solvent) {
        /* The invariant that matters most: released commission must never exceed
         * confirmed pool funding. */
        this.log.error(
          `COMMISSION POOL INSOLVENT: committed ${solvency.committedMtt} against funded ` +
          `${solvency.poolFundedMtt} — releases must stop until funding catches up`,
        );
      }
      /* The drift check, which until now did not run for anybody.
       *
       * A balance is a cached projection of an immutable ledger. The per-user
       * audit existed, but sweeping every account meant one query per member, so
       * this cron deliberately skipped the walk — and the check silently never
       * happened. v_points_drift is one query that returns ONLY the accounts
       * whose balance disagrees with their ledger, so an empty result is the
       * healthy answer and any row is a bug worth waking someone for. */
      const drift = await this.routines.pointsDrift(50);
      if (drift.length > 0) {
        this.log.error(
          `LEDGER DRIFT on ${drift.length} account(s) — something wrote a balance outside ` +
          `LedgerService. Worst: ${drift
            .slice(0, 3)
            .map((d) => `${d.userId} balance ${d.balancePoints} vs ledger ${d.ledgerPoints}`)
            .join("; ")}`,
        );
      }

      /* The MTT side of the same question: what the platform owes members, which
       * an operator reconciles against the custody wallet's on-chain balance. */
      const liability = await this.routines.mttLiability();
      this.log.log(
        `custodial liability across ${liability.accounts} accounts: ` +
        `${liability.totalLiabilityMtt} MTT and ${liability.totalPoints} Points`,
      );
      void this.ledger;
    });
  }

  /**
   * Runs a job body under a Redis lock, swallowing nothing.
   *
   * A cron that throws into the void is a cron that has silently stopped working,
   * so failures are logged at error level with the job name — the thing an
   * operator greps for.
   */
  private async locked(name: string, ttlSeconds: number, fn: () => Promise<void>): Promise<void> {
    const result = await this.redis.withLock(`cron:${name}`, ttlSeconds, async () => {
      const started = Date.now();
      try {
        await fn();
      } catch (e) {
        this.log.error(
          `cron ${name} failed after ${Date.now() - started}ms: ` +
          `${e instanceof Error ? e.message : String(e)}`,
          e instanceof Error ? e.stack : undefined,
        );
      }
      return true;
    });

    if (result === null) {
      /* Another instance holds it, or the previous run has not finished. Both are
       * normal; overlapping would not be. */
      this.log.debug(`cron ${name} skipped — lock held`);
    }
  }
}
