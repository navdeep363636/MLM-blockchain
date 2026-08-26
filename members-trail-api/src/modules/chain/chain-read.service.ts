import { Injectable, Logger } from "@nestjs/common";
import type { Address, Hex } from "viem";
import { keccak256, toHex } from "viem";
import { fromWei } from "@/common/utils";
import { RpcService } from "./rpc.service";
import {
  Contracts, READ_CACHE_SECONDS, READ_CACHE_SECONDS_SLOW, specFor, type ContractName,
} from "./chain.constants";

/* ============================================================================
 * Contract reads.
 *
 * Every view function on every deployed contract, in one place, behind typed
 * methods. Before this the chain layer could only WRITE — it had an indexer, a
 * relayer and a curated write ABI, and no way at all to ask a contract what it
 * currently thinks. Anything that needed a live figure (a staker's pending
 * rewards, the commission pool's funded balance, whether the payout float can
 * cover today's queue) either used the database's mirror of it or did without.
 *
 * Two rules:
 *
 *  1. MTT AMOUNTS COME BACK AS DECIMAL STRINGS, never numbers. An 18-decimal
 *     balance routinely exceeds 2^53, so `Number(balance)` is lossy for ordinary
 *     values, not just extreme ones. `fromWei` is the only conversion.
 *
 *  2. READS ARE CACHED BRIEFLY, and the TTL says what kind of value it is.
 *     A balance is `READ_CACHE_SECONDS`; an allocation constant that can only
 *     change by redeploying is `READ_CACHE_SECONDS_SLOW`. A dashboard opening
 *     forty tiles must not become forty RPC calls per viewer.
 *
 * `null` is returned for an unconfigured contract rather than throwing, so a
 * partially-deployed environment renders instead of erroring — the same "honest
 * nulls" posture the rest of the platform uses for figures it cannot know.
 * ========================================================================== */

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  paused: boolean;
}

export interface StakingPoolView {
  poolId: number;
  active: boolean;
  lockDurationSeconds: number;
  rewardsDurationSeconds: number;
  periodFinish: number;
  lastUpdateTime: number;
  rewardRate: string;
  totalStaked: string;
  earlyUnstakePenaltyBps: number;
  totalRewardsFunded: string;
  totalRewardsPaid: string;
}

export interface StakingPositionView {
  poolId: number;
  amount: string;
  lockEnd: number;
  pendingRewards: string;
  locked: boolean;
}

export interface StakingSolvency {
  totalStakedAllPools: string;
  rewardFloat: string;
  solvent: boolean;
  contractBalance: string;
}

export interface DistributorState {
  totalDeposited: string;
  totalRecorded: string;
  totalClaimed: string;
  availablePoolBalance: string;
  outstanding: string;
  solvent: boolean;
}

export interface DistributorAccount {
  address: string;
  claimable: string;
  kycApproved: boolean;
  claimableNow: boolean;
}

export interface PayoutState {
  float: string;
  dailyLimit: string;
  spentInWindow: string;
  remainingAllowance: string;
  windowResetsAt: number;
  totalFunded: string;
  totalPaid: string;
  payoutCount: number;
  paused: boolean;
}

export interface VestingSchedule {
  address: string;
  beneficiary: string;
  start: number;
  cliffEnd: number;
  vestingEnd: number;
  total: string;
  released: string;
  releasable: string;
}

@Injectable()
export class ChainReadService {
  private readonly log = new Logger(ChainReadService.name);

  constructor(private readonly rpc: RpcService) {}

  /* ==================================================================== *
   * Plumbing
   * ==================================================================== */

  private available(name: ContractName): boolean {
    return this.rpc.hasAddress(specFor(name).configKey);
  }

  private addressOf(name: ContractName): Address {
    return this.rpc.address(specFor(name).configKey);
  }

  /** One view call against one contract. */
  private read<T>(
    name: ContractName,
    functionName: string,
    args: unknown[] = [],
    cacheSeconds = READ_CACHE_SECONDS,
  ): Promise<T> {
    const spec = specFor(name);
    return this.rpc.read<T>({
      address: this.addressOf(name),
      abi: spec.abi,
      functionName,
      args,
      cacheSeconds,
    });
  }

  /**
   * Whether each contract is configured. Drives the "chain not wired up yet"
   * state in the admin UI, which is otherwise indistinguishable from an outage.
   */
  configured(): Record<ContractName, boolean> {
    return {
      mttToken: this.available(Contracts.MttToken),
      staking: this.available(Contracts.Staking),
      referralDistributor: this.available(Contracts.ReferralDistributor),
      payout: this.available(Contracts.Payout),
      teamVesting: this.available(Contracts.TeamVesting),
      advisorsVesting: this.available(Contracts.AdvisorsVesting),
    };
  }

  /* ==================================================================== *
   * MTTToken
   * ==================================================================== */

  async tokenInfo(): Promise<TokenInfo | null> {
    if (!this.available(Contracts.MttToken)) return null;

    const [name, symbol, decimals, totalSupply, paused] = await Promise.all([
      this.read<string>(Contracts.MttToken, "name", [], READ_CACHE_SECONDS_SLOW),
      this.read<string>(Contracts.MttToken, "symbol", [], READ_CACHE_SECONDS_SLOW),
      this.read<number>(Contracts.MttToken, "decimals", [], READ_CACHE_SECONDS_SLOW),
      this.read<bigint>(Contracts.MttToken, "totalSupply", [], READ_CACHE_SECONDS_SLOW),
      /* NOT cached slowly: a paused token is an incident, and a two-minute-stale
       * "everything is fine" is worse than one extra RPC call. */
      this.read<boolean>(Contracts.MttToken, "paused", [], 5),
    ]);

    return {
      address: this.addressOf(Contracts.MttToken),
      name,
      symbol,
      decimals: Number(decimals),
      totalSupply: fromWei(totalSupply),
      paused,
    };
  }

  async tokenBalance(holder: string): Promise<string | null> {
    if (!this.available(Contracts.MttToken)) return null;
    const raw = await this.read<bigint>(Contracts.MttToken, "balanceOf", [holder]);
    return fromWei(raw);
  }

  /** Several balances at once — for the treasury dashboard's wallet table. */
  async tokenBalances(holders: string[]): Promise<Record<string, string> | null> {
    if (!this.available(Contracts.MttToken)) return null;
    const out: Record<string, string> = {};
    await Promise.all(
      holders.map(async (h) => {
        out[h] = fromWei(await this.read<bigint>(Contracts.MttToken, "balanceOf", [h]));
      }),
    );
    return out;
  }

  /**
   * How much a spender may move on a holder's behalf.
   *
   * The frontend needs this before staking: `stake()` pulls tokens with
   * `safeTransferFrom`, so a member who has not approved the staking contract
   * gets a revert with no explanation. Reading the allowance is what lets the UI
   * ask for approval first instead.
   */
  async allowance(owner: string, spender: string): Promise<string | null> {
    if (!this.available(Contracts.MttToken)) return null;
    const raw = await this.read<bigint>(
      Contracts.MttToken, "allowance", [owner, spender],
    );
    return fromWei(raw);
  }

  /** The on-chain allocation table, for the public tokenomics page. */
  async tokenAllocation(): Promise<Record<string, number> | null> {
    if (!this.available(Contracts.MttToken)) return null;
    const keys = [
      ["rewardsPool", "ALLOC_REWARDS_POOL_BPS"],
      ["treasuryReserve", "ALLOC_TREASURY_RESERVE_BPS"],
      ["team", "ALLOC_TEAM_BPS"],
      ["liquidity", "ALLOC_LIQUIDITY_BPS"],
      ["marketing", "ALLOC_MARKETING_BPS"],
      ["advisors", "ALLOC_ADVISORS_BPS"],
    ] as const;

    const out: Record<string, number> = {};
    await Promise.all(
      keys.map(async ([label, fn]) => {
        const bps = await this.read<bigint>(Contracts.MttToken, fn, [], READ_CACHE_SECONDS_SLOW);
        out[label] = Number(bps);
      }),
    );
    return out;
  }

  /**
   * Whether an address holds a role.
   *
   * The post-deploy question that matters most — "does any EOA still have admin
   * rights over the treasury" — is this call, and the platform could not make it
   * before. `roleName` is a constant on the contract (PAUSER_ROLE, TREASURY_ROLE,
   * …) or the literal string "DEFAULT_ADMIN_ROLE".
   */
  async hasRole(contract: ContractName, roleName: string, account: string): Promise<boolean | null> {
    if (!this.available(contract)) return null;

    const role: Hex = roleName === "DEFAULT_ADMIN_ROLE"
      ? (`0x${"0".repeat(64)}`)
      : await this.read<Hex>(contract, roleName, [], READ_CACHE_SECONDS_SLOW);

    return this.read<boolean>(contract, "hasRole", [role, account], READ_CACHE_SECONDS);
  }

  /* ==================================================================== *
   * MTTStaking
   * ==================================================================== */

  async poolCount(): Promise<number | null> {
    if (!this.available(Contracts.Staking)) return null;
    return Number(await this.read<bigint>(Contracts.Staking, "poolCount"));
  }

  /**
   * Every pool, in ONE call.
   *
   * `getPools()` was added to the contract for exactly this: the alternative is
   * `poolCount()` followed by N `pools(i)` reads, and the auto-generated mapping
   * getter returns a positional 11-tuple that every caller has to index by
   * number. Inserting a struct field would silently reassign meaning here.
   */
  async pools(): Promise<StakingPoolView[] | null> {
    if (!this.available(Contracts.Staking)) return null;

    const raw = await this.read<readonly {
      active: boolean;
      lockDuration: bigint;
      rewardsDuration: bigint;
      periodFinish: bigint;
      lastUpdateTime: bigint;
      rewardRate: bigint;
      rewardPerTokenStored: bigint;
      totalStaked: bigint;
      earlyUnstakePenaltyBps: number;
      totalRewardsFunded: bigint;
      totalRewardsPaid: bigint;
    }[]>(Contracts.Staking, "getPools");

    return raw.map((p, poolId) => ({
      poolId,
      active: p.active,
      lockDurationSeconds: Number(p.lockDuration),
      rewardsDurationSeconds: Number(p.rewardsDuration),
      periodFinish: Number(p.periodFinish),
      lastUpdateTime: Number(p.lastUpdateTime),
      /* rewardRate is 1e18-scaled tokens per second — an accounting quantity,
       * not an MTT amount, so it is NOT passed through fromWei. */
      rewardRate: p.rewardRate.toString(),
      totalStaked: fromWei(p.totalStaked),
      earlyUnstakePenaltyBps: Number(p.earlyUnstakePenaltyBps),
      totalRewardsFunded: fromWei(p.totalRewardsFunded),
      totalRewardsPaid: fromWei(p.totalRewardsPaid),
    }));
  }

  /** One member's positions across every pool, in one call. */
  async positions(account: string): Promise<StakingPositionView[] | null> {
    if (!this.available(Contracts.Staking)) return null;

    const raw = await this.read<readonly {
      amount: bigint;
      lockEnd: bigint;
      pendingRewards: bigint;
      locked: boolean;
    }[]>(
      Contracts.Staking, "getPositions", [account],
      /* Pending rewards accrue every second. Caching this for long enough to
       * matter would show a member a number that is already wrong. */
      5,
    );

    return raw.map((p, poolId) => ({
      poolId,
      amount: fromWei(p.amount),
      lockEnd: Number(p.lockEnd),
      pendingRewards: fromWei(p.pendingRewards),
      locked: p.locked,
    }));
  }

  /** Live pending rewards for one pool. The number a member is about to claim. */
  async earned(poolId: number, account: string): Promise<string | null> {
    if (!this.available(Contracts.Staking)) return null;
    const raw = await this.read<bigint>(
      Contracts.Staking, "earned", [BigInt(poolId), account], 5,
    );
    return fromWei(raw);
  }

  /**
   * Staking solvency: is every staker's principal still there?
   *
   * The check the treasury dashboard should lead with, and it is now answerable
   * on chain because MTTStaking tracks principal across pools. Reward float is
   * the balance above principal — funded-but-unstreamed rewards, plus the slice
   * that streamed while a pool had no stakers.
   */
  async stakingSolvency(): Promise<StakingSolvency | null> {
    if (!this.available(Contracts.Staking)) return null;

    const stakingAddress = this.addressOf(Contracts.Staking);
    const [principal, float, solvent, balance] = await Promise.all([
      this.read<bigint>(Contracts.Staking, "totalStakedAllPools"),
      this.read<bigint>(Contracts.Staking, "rewardFloat"),
      this.read<boolean>(Contracts.Staking, "isSolvent"),
      this.available(Contracts.MttToken)
        ? this.read<bigint>(Contracts.MttToken, "balanceOf", [stakingAddress])
        : Promise.resolve(0n),
    ]);

    return {
      totalStakedAllPools: fromWei(principal),
      rewardFloat: fromWei(float),
      solvent,
      contractBalance: fromWei(balance),
    };
  }

  async penaltyReceiver(): Promise<string | null> {
    if (!this.available(Contracts.Staking)) return null;
    return this.read<string>(Contracts.Staking, "penaltyReceiver", [], READ_CACHE_SECONDS_SLOW);
  }

  /* ==================================================================== *
   * MTTReferralDistributor
   * ==================================================================== */

  /**
   * The commission pool's state, including the invariant that makes the whole
   * anti-pyramid claim checkable: recorded can never exceed deposited.
   */
  async distributorState(): Promise<DistributorState | null> {
    if (!this.available(Contracts.ReferralDistributor)) return null;

    const [deposited, recorded, claimed, available, solvent] = await Promise.all([
      this.read<bigint>(Contracts.ReferralDistributor, "totalDeposited"),
      this.read<bigint>(Contracts.ReferralDistributor, "totalRecorded"),
      this.read<bigint>(Contracts.ReferralDistributor, "totalClaimed"),
      this.read<bigint>(Contracts.ReferralDistributor, "availablePoolBalance"),
      this.read<boolean>(Contracts.ReferralDistributor, "isSolvent"),
    ]);

    return {
      totalDeposited: fromWei(deposited),
      totalRecorded: fromWei(recorded),
      totalClaimed: fromWei(claimed),
      availablePoolBalance: fromWei(available),
      /* What the contract owes but has not paid. */
      outstanding: fromWei(recorded - claimed),
      solvent,
    };
  }

  async distributorAccount(address: string): Promise<DistributorAccount | null> {
    if (!this.available(Contracts.ReferralDistributor)) return null;

    const raw = await this.read<readonly [bigint, boolean, boolean]>(
      Contracts.ReferralDistributor, "getAccount", [address],
    );

    return {
      address,
      claimable: fromWei(raw[0]),
      kycApproved: raw[1],
      claimableNow: raw[2],
    };
  }

  /** Many claimable balances at once, for reconciliation against the ledger. */
  async commissionBalances(addresses: string[]): Promise<Record<string, string> | null> {
    if (!this.available(Contracts.ReferralDistributor) || addresses.length === 0) return null;

    const raw = await this.read<readonly bigint[]>(
      Contracts.ReferralDistributor, "commissionBalances", [addresses],
    );

    const out: Record<string, string> = {};
    addresses.forEach((a, i) => { out[a] = fromWei(raw[i] ?? 0n); });
    return out;
  }

  /**
   * Whether a commission was already recorded on chain.
   *
   * Checked BEFORE submitting, so a duplicate costs a read instead of a reverted
   * transaction and a burnt nonce. The contract computes the dedupe key itself
   * (`dedupeKeyFor`) precisely so this check cannot disagree with the storage it
   * is checking — two implementations of `abi.encodePacked`, one in Solidity and
   * one in viem, are one refactor away from packing a `uint8` differently, and
   * the failure is silent: a key that matches nothing reads as "not yet
   * recorded" and invites a double payment.
   */
  async isCommissionRecorded(
    recipient: string, level: number, sourceEventId: Hex,
  ): Promise<boolean | null> {
    if (!this.available(Contracts.ReferralDistributor)) return null;
    return this.read<boolean>(
      Contracts.ReferralDistributor, "isRecorded",
      [recipient, level, sourceEventId],
      /* Never cached: this gates a payment. */
      0,
    );
  }

  /** The contract's own dedupe key, for logging and reconciliation. */
  async dedupeKeyFor(recipient: string, level: number, sourceEventId: Hex): Promise<Hex | null> {
    if (!this.available(Contracts.ReferralDistributor)) return null;
    return this.read<Hex>(
      Contracts.ReferralDistributor, "dedupeKeyFor",
      [recipient, level, sourceEventId], READ_CACHE_SECONDS_SLOW,
    );
  }

  /* ==================================================================== *
   * MTTPayout
   * ==================================================================== */

  async payoutState(): Promise<PayoutState | null> {
    if (!this.available(Contracts.Payout)) return null;

    const [float, dailyLimit, spent, remaining, resetsAt, funded, paid, count, paused] =
      await Promise.all([
        this.read<bigint>(Contracts.Payout, "float", [], 5),
        this.read<bigint>(Contracts.Payout, "dailyLimit", [], READ_CACHE_SECONDS),
        this.read<bigint>(Contracts.Payout, "spentInWindow", [], 5),
        this.read<bigint>(Contracts.Payout, "remainingAllowance", [], 5),
        this.read<bigint>(Contracts.Payout, "windowResetsAt", [], 5),
        this.read<bigint>(Contracts.Payout, "totalFunded", [], READ_CACHE_SECONDS),
        this.read<bigint>(Contracts.Payout, "totalPaid", [], READ_CACHE_SECONDS),
        this.read<bigint>(Contracts.Payout, "payoutCount", [], READ_CACHE_SECONDS),
        this.read<boolean>(Contracts.Payout, "paused", [], 5),
      ]);

    return {
      float: fromWei(float),
      dailyLimit: fromWei(dailyLimit),
      spentInWindow: fromWei(spent),
      remainingAllowance: fromWei(remaining),
      windowResetsAt: Number(resetsAt),
      totalFunded: fromWei(funded),
      totalPaid: fromWei(paid),
      payoutCount: Number(count),
      paused,
    };
  }

  /**
   * Whether a withdrawal has already been settled on chain, and for how much.
   *
   * The amount matters as much as the flag: it lets a reconciler prove the
   * settlement matches the ledger, not merely that *something* was sent.
   */
  async settlement(withdrawalRef: string): Promise<{ settled: boolean; amount: string } | null> {
    if (!this.available(Contracts.Payout)) return null;
    const raw = await this.read<readonly [boolean, bigint]>(
      Contracts.Payout, "settlement", [this.withdrawalRefHash(withdrawalRef)], 0,
    );
    return { settled: raw[0], amount: fromWei(raw[1]) };
  }

  /** Batched replay check for a queue about to be submitted. */
  async settledRefs(withdrawalRefs: string[]): Promise<Record<string, boolean> | null> {
    if (!this.available(Contracts.Payout) || withdrawalRefs.length === 0) return null;
    const hashes = withdrawalRefs.map((r) => this.withdrawalRefHash(r));
    const flags = await this.read<readonly boolean[]>(
      Contracts.Payout, "settled", [hashes], 0,
    );
    const out: Record<string, boolean> = {};
    withdrawalRefs.forEach((r, i) => { out[r] = flags[i] ?? false; });
    return out;
  }

  /** Can the rail pay this amount right now — float, ceiling and pause together. */
  async canPay(amountMttWei: bigint): Promise<boolean | null> {
    if (!this.available(Contracts.Payout)) return null;
    return this.read<boolean>(Contracts.Payout, "canPay", [amountMttWei], 0);
  }

  /**
   * The on-chain reference for a withdrawal.
   *
   * ONE definition, used by both the submitter and every read here. The payout
   * contract dedupes on this value, so if the writer and the reader ever derived
   * it differently the replay guard would silently stop guarding.
   */
  withdrawalRefHash(ref: string): Hex {
    return keccak256(toHex(ref));
  }

  /* ==================================================================== *
   * MTTVesting
   * ==================================================================== */

  async vestingSchedule(
    which: typeof Contracts.TeamVesting | typeof Contracts.AdvisorsVesting,
  ): Promise<VestingSchedule | null> {
    if (!this.available(which)) return null;

    const raw = await this.read<{
      beneficiary: string;
      start: bigint;
      cliffEnd: bigint;
      vestingEnd: bigint;
      total: bigint;
      released: bigint;
      releasable: bigint;
    }>(which, "schedule", [], READ_CACHE_SECONDS);

    return {
      address: this.addressOf(which),
      beneficiary: raw.beneficiary,
      start: Number(raw.start),
      cliffEnd: Number(raw.cliffEnd),
      vestingEnd: Number(raw.vestingEnd),
      total: fromWei(raw.total),
      released: fromWei(raw.released),
      releasable: fromWei(raw.releasable),
    };
  }

  /** Both vesting schedules, for the public tokenomics page. */
  async vestingSchedules(): Promise<{ team: VestingSchedule | null; advisors: VestingSchedule | null }> {
    const [team, advisors] = await Promise.all([
      this.vestingSchedule(Contracts.TeamVesting).catch(() => null),
      this.vestingSchedule(Contracts.AdvisorsVesting).catch(() => null),
    ]);
    return { team, advisors };
  }

  /* ==================================================================== *
   * Composite
   * ==================================================================== */

  /**
   * Everything the treasury dashboard needs about chain state, in one call.
   *
   * Each section is independently fault-tolerant: one unreachable contract
   * returns null for its own section instead of failing the whole response. An
   * operator looking at this screen during an incident needs the parts that
   * still answer.
   */
  async overview(): Promise<{
    chainId: number;
    configured: Record<ContractName, boolean>;
    token: TokenInfo | null;
    staking: StakingSolvency | null;
    pools: StakingPoolView[] | null;
    distributor: DistributorState | null;
    payout: PayoutState | null;
    vesting: { team: VestingSchedule | null; advisors: VestingSchedule | null };
  }> {
    const settle = async <T>(label: string, p: Promise<T | null>): Promise<T | null> => {
      try {
        return await p;
      } catch (e) {
        this.log.warn(`chain overview: ${label} unavailable — ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    };

    const [token, staking, pools, distributor, payout, vesting] = await Promise.all([
      settle("token", this.tokenInfo()),
      settle("staking", this.stakingSolvency()),
      settle("pools", this.pools()),
      settle("distributor", this.distributorState()),
      settle("payout", this.payoutState()),
      this.vestingSchedules(),
    ]);

    return {
      chainId: this.rpc.chainId,
      configured: this.configured(),
      token,
      staking,
      pools,
      distributor,
      payout,
      vesting,
    };
  }
}
