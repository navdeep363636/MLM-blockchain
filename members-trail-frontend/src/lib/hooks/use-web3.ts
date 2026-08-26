"use client";

/* ============================================================================
 * WEB3 HOOKS — real wagmi reads/writes against the deployed MTT contracts.
 *
 * Every hook degrades safely: if the contract address is unset (see
 * CONTRACTS_CONFIGURED in lib/web3/config) or the wallet is disconnected, the
 * read hooks return `undefined` and the UI falls back to the mock layer. Write
 * hooks surface a `TxState` the transaction modal renders directly.
 * ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, keccak256, parseUnits, toHex, type Address } from "viem";
import {
  useAccount, useBalance, useReadContract, useReadContracts,
  useWaitForTransactionReceipt, useWriteContract,
} from "wagmi";
import {
  CHAIN_ID, MTT_DECIMALS, contracts, isDeployed,
  mttPayoutAbi, mttReferralDistributorAbi, mttStakingAbi, mttTokenAbi, mttVestingAbi, txUrl,
} from "@/lib/web3";

/* --------------------------------- helpers -------------------------------- */

export const toMtt = (v?: bigint) => (v == null ? undefined : Number(formatUnits(v, MTT_DECIMALS)));
export const fromMtt = (v: string | number) => parseUnits(String(v || 0), MTT_DECIMALS);

export type TxPhase = "idle" | "awaiting_signature" | "pending" | "success" | "error";

export interface TxState {
  phase: TxPhase;
  hash?: `0x${string}`;
  explorerUrl?: string;
  error?: string;
  reset: () => void;
}

/** Wraps wagmi's write + receipt into the single state the modal needs. */
function useTx() {
  const { writeContractAsync, isPending: signing, reset: resetWrite } = useWriteContract();
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<string | undefined>();

  const { isLoading: mining, isSuccess, isError: receiptFailed } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: !!hash },
  });

  const phase: TxPhase = error || receiptFailed ? "error"
    : isSuccess ? "success"
    : mining ? "pending"
    : signing ? "awaiting_signature"
    : "idle";

  const reset = useCallback(() => { setHash(undefined); setError(undefined); resetWrite(); }, [resetWrite]);

  const send = useCallback(
    async (args: Parameters<typeof writeContractAsync>[0]) => {
      setError(undefined);
      try {
        const h = await writeContractAsync(args);
        setHash(h);
        return h;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Transaction failed";
        // Strip the giant viem stack that users should never see.
        setError(msg.split("\n")[0].replace(/^.*?:\s*/, "") || "Transaction failed");
        return undefined;
      }
    },
    [writeContractAsync],
  );

  const state: TxState = useMemo(
    () => ({ phase, hash, explorerUrl: hash ? txUrl(hash) : undefined, error, reset }),
    [phase, hash, error, reset],
  );

  return { send, state };
}

/* ------------------------------- connection ------------------------------- */

export function useWallet() {
  const { address, isConnected, chain } = useAccount();
  const { data: native } = useBalance({ address, query: { enabled: !!address } });

  return {
    address,
    isConnected,
    /** True when connected but pointed at the wrong network. */
    wrongNetwork: isConnected && !!chain && chain.id !== CHAIN_ID,
    chainName: chain?.name,
    nativeBalance: native ? Number(formatUnits(native.value, native.decimals)) : undefined,
    nativeSymbol: native?.symbol,
  };
}

/* ---------------------------------- token --------------------------------- */

export function useMttBalance() {
  const { address } = useAccount();
  const enabled = !!address && isDeployed(contracts.mttToken);

  const { data, isLoading, refetch } = useReadContract({
    address: contracts.mttToken,
    abi: mttTokenAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled, refetchInterval: 15_000 },
  });

  return { balance: toMtt(data as bigint | undefined), isLoading: enabled && isLoading, refetch, onChain: enabled };
}

export function useMttAllowance(spender: Address) {
  const { address } = useAccount();
  const enabled = !!address && isDeployed(contracts.mttToken) && isDeployed(spender);

  const { data, isLoading, refetch } = useReadContract({
    address: contracts.mttToken,
    abi: mttTokenAbi,
    functionName: "allowance",
    args: address ? [address, spender] : undefined,
    query: { enabled },
  });

  return { allowance: toMtt(data as bigint | undefined), raw: data as bigint | undefined, isLoading, refetch, onChain: enabled };
}

/** BEP-20 approve — step one of the stake flow (FRD 6.4). */
export function useApproveMtt() {
  const { send, state } = useTx();
  const approve = useCallback(
    (spender: Address, amount: string | number) =>
      send({
        address: contracts.mttToken,
        abi: mttTokenAbi,
        functionName: "approve",
        args: [spender, fromMtt(amount)],
      }),
    [send],
  );
  return { approve, ...state };
}

/** Token supply + allocation constants — powers the public Tokenomics page. */
export function useTokenStats() {
  const enabled = isDeployed(contracts.mttToken);
  const { data } = useReadContracts({
    contracts: [
      { address: contracts.mttToken, abi: mttTokenAbi, functionName: "totalSupply" },
      { address: contracts.mttToken, abi: mttTokenAbi, functionName: "symbol" },
      { address: contracts.mttToken, abi: mttTokenAbi, functionName: "paused" },
    ],
    query: { enabled },
  });
  return {
    totalSupply: toMtt(data?.[0]?.result as bigint | undefined),
    symbol: data?.[1]?.result as string | undefined,
    paused: data?.[2]?.result as boolean | undefined,
    onChain: enabled,
  };
}

/* --------------------------------- staking -------------------------------- */

export interface OnChainPool {
  poolId: number;
  active: boolean;
  lockDuration: number;
  rewardsDuration: number;
  earlyUnstakePenaltyBps: number;
  totalStaked: number;
  totalRewardsFunded: number;
  totalRewardsPaid: number;
}

export function usePoolCount() {
  const enabled = isDeployed(contracts.staking);
  const { data } = useReadContract({
    address: contracts.staking,
    abi: mttStakingAbi,
    functionName: "poolCount",
    query: { enabled },
  });
  return { count: data == null ? undefined : Number(data as bigint), onChain: enabled };
}

export function useOnChainPools(_count?: number) {
  const enabled = isDeployed(contracts.staking);

  /*
   * ONE call, `getPools()`, decoded by field name.
   *
   * This used to fire N separate `pools(i)` reads and index the auto-generated
   * getter's positional 11-tuple by number — `p[8]` for the penalty, `p[7]` for
   * the total staked. That is a decoding scheme that silently reassigns meaning
   * the moment anyone inserts a field in the struct, and it fails in the worst
   * possible way: every number still renders, just as the wrong number.
   *
   * `getPools()` was added to the contract for this. `_count` is accepted and
   * ignored so existing call sites keep working.
   */
  const { data, isLoading, refetch } = useReadContract({
    address: contracts.staking,
    abi: mttStakingAbi,
    functionName: "getPools",
    query: { enabled, refetchInterval: 30_000 },
  });

  const pools = useMemo<OnChainPool[] | undefined>(() => {
    if (!data) return undefined;
    const rows = data as unknown as readonly {
      active: boolean;
      lockDuration: bigint;
      rewardsDuration: bigint;
      earlyUnstakePenaltyBps: number;
      totalStaked: bigint;
      totalRewardsFunded: bigint;
      totalRewardsPaid: bigint;
    }[];

    return rows.map((p, poolId) => ({
      poolId,
      active: p.active,
      lockDuration: Number(p.lockDuration),
      rewardsDuration: Number(p.rewardsDuration),
      earlyUnstakePenaltyBps: Number(p.earlyUnstakePenaltyBps),
      totalStaked: toMtt(p.totalStaked) ?? 0,
      totalRewardsFunded: toMtt(p.totalRewardsFunded) ?? 0,
      totalRewardsPaid: toMtt(p.totalRewardsPaid) ?? 0,
    }));
  }, [data]);

  return { pools, isLoading: enabled && isLoading, refetch, onChain: enabled };
}

export function useStakePosition(poolId: number) {
  const { address } = useAccount();
  const enabled = !!address && isDeployed(contracts.staking);

  /*
   * `getPosition` replaces `userInfo` + `earned`.
   *
   * Two reads fired in parallel can resolve at different block heights, so the
   * amount and the pending rewards beside it could describe different moments —
   * and pending rewards accrue every second, so they usually did. One call reads
   * both at one height.
   */
  const { data, refetch, isLoading } = useReadContract({
    address: contracts.staking,
    abi: mttStakingAbi,
    functionName: "getPosition",
    args: [BigInt(poolId), address!],
    query: { enabled, refetchInterval: 20_000 },
  });

  const pos = data as unknown as {
    amount: bigint; lockEnd: bigint; pendingRewards: bigint; locked: boolean;
  } | undefined;

  return {
    amount: toMtt(pos?.amount),
    lockEnd: pos?.lockEnd != null ? Number(pos.lockEnd) : undefined,
    pendingRewards: toMtt(pos?.pendingRewards),
    locked: pos?.locked,
    isLoading: enabled && isLoading,
    refetch,
    onChain: enabled,
  };
}

/**
 * Every position for the connected wallet, in ONE call.
 *
 * What the staking dashboard should use: four pools previously meant eight reads
 * (`userInfo` and `earned` per pool) and eight chances for one to lag.
 */
export function useAllStakePositions() {
  const { address } = useAccount();
  const enabled = !!address && isDeployed(contracts.staking);

  const { data, refetch, isLoading } = useReadContract({
    address: contracts.staking,
    abi: mttStakingAbi,
    functionName: "getPositions",
    args: [address!],
    query: { enabled, refetchInterval: 20_000 },
  });

  const positions = useMemo(() => {
    if (!data) return undefined;
    const rows = data as unknown as readonly {
      amount: bigint; lockEnd: bigint; pendingRewards: bigint; locked: boolean;
    }[];
    return rows.map((p, poolId) => ({
      poolId,
      amount: toMtt(p.amount) ?? 0,
      lockEnd: Number(p.lockEnd),
      pendingRewards: toMtt(p.pendingRewards) ?? 0,
      locked: p.locked,
    }));
  }, [data]);

  return { positions, isLoading: enabled && isLoading, refetch, onChain: enabled };
}

/**
 * Whether the staking contract may pull the member's MTT, and how much.
 *
 * `stake()` uses `safeTransferFrom`, so a member who has not approved gets a
 * revert with no explanation. Reading the allowance first is what lets the UI
 * ask for approval instead of showing a failed transaction.
 */
export function useStakeAllowance() {
  const { address } = useAccount();
  const enabled = !!address && isDeployed(contracts.staking) && isDeployed(contracts.mttToken);

  const { data, refetch, isLoading } = useReadContract({
    address: contracts.mttToken,
    abi: mttTokenAbi,
    functionName: "allowance",
    args: [address!, contracts.staking],
    query: { enabled, refetchInterval: 15_000 },
  });

  const allowance = toMtt(data as bigint | undefined);

  return {
    allowance,
    /** True when this amount can be staked without an approval step first. */
    isApprovedFor: (amount: string | number) =>
      allowance != null && allowance >= Number(amount || 0),
    isLoading: enabled && isLoading,
    refetch,
    onChain: enabled,
  };
}

/**
 * Staking solvency, read from the contract rather than from the platform.
 *
 * The question a sceptical member actually wants answered — "is my principal
 * still there" — now has an on-chain answer, because MTTStaking tracks staked
 * principal across pools. Reward float is whatever the contract holds above it.
 */
export function useStakingSolvency() {
  const enabled = isDeployed(contracts.staking);

  const { data, isLoading } = useReadContracts({
    contracts: [
      { address: contracts.staking, abi: mttStakingAbi, functionName: "totalStakedAllPools" },
      { address: contracts.staking, abi: mttStakingAbi, functionName: "rewardFloat" },
      { address: contracts.staking, abi: mttStakingAbi, functionName: "isSolvent" },
    ],
    query: { enabled, refetchInterval: 60_000 },
  });

  return {
    totalStaked: toMtt(data?.[0]?.result as bigint | undefined),
    rewardFloat: toMtt(data?.[1]?.result as bigint | undefined),
    solvent: data?.[2]?.result as boolean | undefined,
    isLoading: enabled && isLoading,
    onChain: enabled,
  };
}

export function useStakeActions() {
  const { send, state } = useTx();

  const stake = useCallback(
    (poolId: number, amount: string | number) =>
      send({
        address: contracts.staking, abi: mttStakingAbi, functionName: "stake",
        args: [BigInt(poolId), fromMtt(amount)],
      }),
    [send],
  );

  const unstake = useCallback(
    (poolId: number, amount: string | number) =>
      send({
        address: contracts.staking, abi: mttStakingAbi, functionName: "unstake",
        args: [BigInt(poolId), fromMtt(amount)],
      }),
    [send],
  );

  const claimRewards = useCallback(
    (poolId: number) =>
      send({
        address: contracts.staking, abi: mttStakingAbi, functionName: "claimRewards",
        args: [BigInt(poolId)],
      }),
    [send],
  );

  return { stake, unstake, claimRewards, ...state };
}

/* ------------------------------- commissions ------------------------------ */

export function useCommissionOnChain() {
  const { address } = useAccount();
  const enabled = !!address && isDeployed(contracts.referralDistributor);

  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      /* `getAccount` returns (claimable, kyc, claimNow) in one read, so the
       * button's enabled state and the number beside it can never disagree. */
      { address: contracts.referralDistributor, abi: mttReferralDistributorAbi, functionName: "getAccount", args: [address!] },
      { address: contracts.referralDistributor, abi: mttReferralDistributorAbi, functionName: "isSolvent" },
      { address: contracts.referralDistributor, abi: mttReferralDistributorAbi, functionName: "availablePoolBalance" },
      { address: contracts.referralDistributor, abi: mttReferralDistributorAbi, functionName: "totalDeposited" },
      { address: contracts.referralDistributor, abi: mttReferralDistributorAbi, functionName: "totalRecorded" },
      { address: contracts.referralDistributor, abi: mttReferralDistributorAbi, functionName: "totalClaimed" },
    ],
    query: { enabled, refetchInterval: 30_000 },
  });

  const deposited = toMtt(data?.[3]?.result as bigint | undefined);
  const recorded = toMtt(data?.[4]?.result as bigint | undefined);

  const account = data?.[0]?.result as unknown as
    readonly [bigint, boolean, boolean] | undefined;

  return {
    balance: toMtt(account?.[0]),
    kycApproved: account?.[1],
    /** True only when there is something to claim AND KYC allows claiming it. */
    canClaimNow: account?.[2],
    /** Whether the contract holds every commission it has recorded but not paid. */
    solvent: data?.[1]?.result as boolean | undefined,
    poolAvailable: toMtt(data?.[2]?.result as bigint | undefined),
    totalDeposited: deposited,
    totalRecorded: recorded,
    totalClaimed: toMtt(data?.[5]?.result as bigint | undefined),
    /** The on-chain anti-pyramid invariant, surfaced for public display. */
    solvencyHeadroom: deposited != null && recorded != null ? deposited - recorded : undefined,
    isLoading: enabled && isLoading,
    refetch,
    onChain: enabled,
  };
}

export function useClaimCommission() {
  const { send, state } = useTx();
  const claim = useCallback(
    () => send({
      address: contracts.referralDistributor,
      abi: mttReferralDistributorAbi,
      functionName: "claimCommission",
      args: [],
    }),
    [send],
  );
  return { claim, ...state };
}

/* ----------------------------- reactive helper ---------------------------- */

/** Ticks every second — drives lock countdowns and live reward accrual. */
export function useTicker(intervalMs = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
}

/* --------------------------------- vesting -------------------------------- */

export interface VestingSchedule {
  address: Address;
  beneficiary: Address;
  start: number;
  cliffEnd: number;
  vestingEnd: number;
  total: number;
  released: number;
  releasable: number;
  /** 0-1. Derived here rather than on chain — it is a display concern. */
  progress: number;
}

/**
 * A vesting contract's whole schedule, in one call.
 *
 * `schedule()` and `releasable()` were added to MTTVesting for this. The only
 * way to ask "how much can be released right now" used to be
 * `vestedAmount(timestamp) - released()` with the CALLER supplying the
 * timestamp — and a browser clock that is a few seconds fast makes `release()`
 * revert with "nothing to release" on a figure the page just displayed as
 * available.
 */
export function useVestingSchedule(which: "team" | "advisors") {
  const target = which === "team" ? contracts.teamVesting : contracts.advisorsVesting;
  const enabled = isDeployed(target);

  const { data, isLoading, refetch } = useReadContract({
    address: target,
    abi: mttVestingAbi,
    functionName: "schedule",
    query: { enabled, refetchInterval: 60_000 },
  });

  const schedule = useMemo<VestingSchedule | undefined>(() => {
    if (!data) return undefined;
    const s = data as unknown as {
      beneficiary: Address; start: bigint; cliffEnd: bigint; vestingEnd: bigint;
      total: bigint; released: bigint; releasable: bigint;
    };
    const total = toMtt(s.total) ?? 0;
    const released = toMtt(s.released) ?? 0;
    return {
      address: target,
      beneficiary: s.beneficiary,
      start: Number(s.start),
      cliffEnd: Number(s.cliffEnd),
      vestingEnd: Number(s.vestingEnd),
      total,
      released,
      releasable: toMtt(s.releasable) ?? 0,
      progress: total > 0 ? released / total : 0,
    };
  }, [data, target]);

  return { schedule, isLoading: enabled && isLoading, refetch, onChain: enabled };
}

/**
 * Releases vested tokens to the beneficiary.
 *
 * Callable by anyone — the contract always pays the beneficiary regardless of
 * who sends the transaction — so the button can be shown to an operator without
 * any risk of misdirecting the tokens.
 */
export function useReleaseVesting(which: "team" | "advisors") {
  const target = which === "team" ? contracts.teamVesting : contracts.advisorsVesting;
  const { send, state } = useTx();

  const release = useCallback(
    () => send({ address: target, abi: mttVestingAbi, functionName: "release", args: [] }),
    [send, target],
  );

  return { release, ...state };
}

/* --------------------------------- payouts -------------------------------- */

/**
 * Whether a withdrawal has settled on chain, and for how much.
 *
 * Read straight from MTTPayout rather than from the platform's own record, so a
 * member's withdrawal history can show the settlement as verified by the chain
 * instead of asserted by us. `withdrawalRef` is the human reference
 * (`WD-2026-000123`); the contract keys on its keccak hash.
 */
export function useWithdrawalSettlement(withdrawalRef?: string) {
  const enabled = isDeployed(contracts.payout) && !!withdrawalRef;

  const { data, isLoading, refetch } = useReadContract({
    address: contracts.payout,
    abi: mttPayoutAbi,
    functionName: "settlement",
    args: [withdrawalRef ? keccak256(toHex(withdrawalRef)) : "0x"],
    query: { enabled, refetchInterval: 20_000 },
  });

  const result = data as unknown as readonly [boolean, bigint] | undefined;

  return {
    settled: result?.[0],
    amount: toMtt(result?.[1]),
    isLoading: enabled && isLoading,
    refetch,
    onChain: enabled,
  };
}

/**
 * The payout rail's operating state.
 *
 * Surfaced so an operator can see why a withdrawal is not settling — an
 * exhausted daily allowance, an empty float and a paused rail all look identical
 * from the withdrawal queue, and they need three different responses.
 */
export function usePayoutRail() {
  const enabled = isDeployed(contracts.payout);

  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      { address: contracts.payout, abi: mttPayoutAbi, functionName: "float" },
      { address: contracts.payout, abi: mttPayoutAbi, functionName: "dailyLimit" },
      { address: contracts.payout, abi: mttPayoutAbi, functionName: "remainingAllowance" },
      { address: contracts.payout, abi: mttPayoutAbi, functionName: "windowResetsAt" },
      { address: contracts.payout, abi: mttPayoutAbi, functionName: "paused" },
      { address: contracts.payout, abi: mttPayoutAbi, functionName: "totalPaid" },
    ],
    query: { enabled, refetchInterval: 30_000 },
  });

  return {
    float: toMtt(data?.[0]?.result as bigint | undefined),
    dailyLimit: toMtt(data?.[1]?.result as bigint | undefined),
    remainingAllowance: toMtt(data?.[2]?.result as bigint | undefined),
    windowResetsAt: data?.[3]?.result != null ? Number(data[3].result as bigint) : undefined,
    paused: data?.[4]?.result as boolean | undefined,
    totalPaid: toMtt(data?.[5]?.result as bigint | undefined),
    isLoading: enabled && isLoading,
    refetch,
    onChain: enabled,
  };
}
