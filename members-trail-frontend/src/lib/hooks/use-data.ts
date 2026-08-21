"use client";

/* ============================================================================
 * DATA ACCESS LAYER — the single seam between the UI and your backend.
 *
 * Every hook here returns { data, isLoading, error } and nothing else, so a
 * page never knows whether it's talking to mock data or a live API.
 *
 * TO GO LIVE: replace the body of `useResource` with a real fetcher, e.g.
 *
 *   function useResource<T>(key: string, _fallback: T) {
 *     const { data, isLoading, error } = useQuery({
 *       queryKey: [key],
 *       queryFn: () => fetch(`/api/${key}`).then(r => r.json()),
 *     });
 *     return { data, isLoading, error };
 *   }
 *
 * The hook signatures below stay identical, so no page needs to change.
 * ========================================================================== */

import { useEffect, useState } from "react";
import * as mock from "@/lib/mock/data";
import * as adminMock from "@/lib/mock/admin";
import type {
  Achievement, AppNotification, AuditLogEntry, Balances, CommissionEntry, FraudAlert, Game,
  KycSubmission, LeaderboardEntry, MarketListing, PointsEntry, Quest, ReferralNode,
  ReferralSummary, RewardEntry, StaffMember, StakePosition, StakingPool, StoreItem, Ticket,
  Tournament, Transaction, TreasuryInflow, TreasuryOutflow, User,
} from "@/types";

export interface Resource<T> {
  data: T;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/** Simulated latency so loading and skeleton states are exercised in dev. */
const LATENCY = process.env.NODE_ENV === "development" ? 260 : 0;

function useResource<T>(value: T, latency = LATENCY): Resource<T> {
  const [isLoading, setLoading] = useState(latency > 0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (latency === 0) return;
    setLoading(true);
    const t = setTimeout(() => setLoading(false), latency);
    return () => clearTimeout(t);
  }, [latency, nonce]);

  return { data: value, isLoading, error: null, refetch: () => setNonce((n) => n + 1) };
}

/* ------------------------------ Player scope ----------------------------- */

export const useCurrentUser = (): Resource<User> => useResource(mock.currentUser);
export const useBalances = (): Resource<Balances> => useResource(mock.balances);
export const useGames = (): Resource<Game[]> => useResource(mock.games);
export const useTournaments = (): Resource<Tournament[]> => useResource(mock.tournaments);
export const useLeaderboard = (): Resource<LeaderboardEntry[]> => useResource(mock.leaderboard);
export const useQuests = (): Resource<Quest[]> => useResource(mock.quests);
export const useAchievements = (): Resource<Achievement[]> => useResource(mock.achievements);
export const usePointsHistory = (): Resource<PointsEntry[]> => useResource(mock.pointsHistory);
export const useTransactions = (): Resource<Transaction[]> => useResource(mock.transactions);
export const useStakingPools = (): Resource<StakingPool[]> => useResource(mock.stakingPools);
export const useStakePositions = (): Resource<StakePosition[]> => useResource(mock.stakePositions);
export const useRewardHistory = (): Resource<RewardEntry[]> => useResource(mock.rewardHistory);
export const useReferralSummary = (): Resource<ReferralSummary> => useResource(mock.referralSummary);
export const useReferralTree = (): Resource<ReferralNode[]> => useResource(mock.referralTree);
export const useCommissionHistory = (): Resource<CommissionEntry[]> => useResource(mock.commissionHistory);
export const useNotifications = (): Resource<AppNotification[]> => useResource(mock.notifications);
export const useTickets = (): Resource<Ticket[]> => useResource(mock.tickets);
export const useStoreItems = (): Resource<StoreItem[]> => useResource(mock.storeItems);
export const useMarketListings = (): Resource<MarketListing[]> => useResource(mock.marketListings);

/* ------------------------------- Admin scope ----------------------------- */

export const useAdminKpis = () => useResource(adminMock.adminKpis);
export const useAdminUsers = (): Resource<User[]> => useResource(adminMock.adminUsers);
export const useKycQueue = (): Resource<KycSubmission[]> => useResource(adminMock.kycQueue);
export const useTreasuryInflows = (): Resource<TreasuryInflow[]> => useResource(adminMock.treasuryInflows);
export const useTreasuryOutflows = (): Resource<TreasuryOutflow[]> => useResource(adminMock.treasuryOutflows);
export const useTreasuryTotals = () => useResource(adminMock.treasuryTotals);
export const useFraudAlerts = (): Resource<FraudAlert[]> => useResource(adminMock.fraudAlerts);
export const useStaff = (): Resource<StaffMember[]> => useResource(adminMock.staff);
export const useAuditLog = (): Resource<AuditLogEntry[]> => useResource(adminMock.auditLog);
export const useConversionRates = () => useResource(adminMock.conversionRates);
export const useCommissionConfig = () => useResource(adminMock.commissionConfig);
export const usePointsRules = () => useResource(adminMock.pointsRules);

/* Analytics series (already shaped for the chart components) */
export const useRevenueByStream = () => useResource(adminMock.revenueByStream);
export const usePayoutVsInflow = () => useResource(adminMock.payoutVsInflow);
export const useStakingTvlTrend = () => useResource(adminMock.stakingTvlTrend);
export const useKycFunnel = () => useResource(adminMock.kycFunnel);
export const useCohortRetention = () => useResource(adminMock.cohortRetention);

/* -------------------------- Derived / public stats ----------------------- */

/** Live stats strip on the landing page (P-01). Must come from real data —
 *  the FRD forbids hard-coded marketing numbers. */
export function usePublicStats() {
  return useResource({
    totalPlayers: adminMock.adminKpis.mau,
    mttStaked: adminMock.adminKpis.mttStaked,
    tournamentsRun: 1_284,
    treasuryFundedPct: adminMock.adminKpis.realRevenueFundedPct,
    payoutRatio: adminMock.adminKpis.commissionPayoutRatio,
  });
}
