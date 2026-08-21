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
import { formatUnits, parseUnits, type Address } from "viem";
import {
  useAccount, useBalance, useReadContract, useReadContracts,
  useWaitForTransactionReceipt, useWriteContract,
} from "wagmi";
import {
  CHAIN_ID, MTT_DECIMALS, contracts, isDeployed,
  mttReferralDistributorAbi, mttStakingAbi, mttTokenAbi, txUrl,
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

export function useOnChainPools(count?: number) {
  const enabled = isDeployed(contracts.staking) && !!count;
  const { data, isLoading } = useReadContracts({
    contracts: Array.from({ length: count ?? 0 }, (_, i) => ({
      address: contracts.staking,
      abi: mttStakingAbi,
      functionName: "pools" as const,
      args: [BigInt(i)] as const,
    })),
    query: { enabled },
  });

  const pools = useMemo<OnChainPool[] | undefined>(() => {
    if (!data) return undefined;
    return data.flatMap((r, i) => {
      if (r.status !== "success" || !r.result) return [];
      const p = r.result as unknown as readonly [boolean, bigint, bigint, bigint, bigint, bigint, bigint, bigint, number, bigint, bigint];
      return [{
        poolId: i,
        active: p[0],
        lockDuration: Number(p[1]),
        rewardsDuration: Number(p[2]),
        earlyUnstakePenaltyBps: Number(p[8]),
        totalStaked: toMtt(p[7]) ?? 0,
        totalRewardsFunded: toMtt(p[9]) ?? 0,
        totalRewardsPaid: toMtt(p[10]) ?? 0,
      }];
    });
  }, [data]);

  return { pools, isLoading: enabled && isLoading, onChain: enabled };
}

export function useStakePosition(poolId: number) {
  const { address } = useAccount();
  const enabled = !!address && isDeployed(contracts.staking);

  const { data, refetch, isLoading } = useReadContracts({
    contracts: [
      { address: contracts.staking, abi: mttStakingAbi, functionName: "userInfo", args: [BigInt(poolId), address!] },
      { address: contracts.staking, abi: mttStakingAbi, functionName: "earned", args: [BigInt(poolId), address!] },
    ],
    query: { enabled, refetchInterval: 20_000 },
  });

  const info = data?.[0]?.result as unknown as readonly [bigint, bigint, bigint, bigint] | undefined;

  return {
    amount: toMtt(info?.[0]),
    lockEnd: info?.[1] != null ? Number(info[1]) : undefined,
    pendingRewards: toMtt(data?.[1]?.result as bigint | undefined),
    isLoading: enabled && isLoading,
    refetch,
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
      { address: contracts.referralDistributor, abi: mttReferralDistributorAbi, functionName: "commissionBalance", args: [address!] },
      { address: contracts.referralDistributor, abi: mttReferralDistributorAbi, functionName: "kycApproved", args: [address!] },
      { address: contracts.referralDistributor, abi: mttReferralDistributorAbi, functionName: "availablePoolBalance" },
      { address: contracts.referralDistributor, abi: mttReferralDistributorAbi, functionName: "totalDeposited" },
      { address: contracts.referralDistributor, abi: mttReferralDistributorAbi, functionName: "totalRecorded" },
      { address: contracts.referralDistributor, abi: mttReferralDistributorAbi, functionName: "totalClaimed" },
    ],
    query: { enabled, refetchInterval: 30_000 },
  });

  const deposited = toMtt(data?.[3]?.result as bigint | undefined);
  const recorded = toMtt(data?.[4]?.result as bigint | undefined);

  return {
    balance: toMtt(data?.[0]?.result as bigint | undefined),
    kycApproved: data?.[1]?.result as boolean | undefined,
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
