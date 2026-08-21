"use client";

/* ActivityFeed — the D-01 "last 10 events" list. Merges the on-chain / wallet
 * transaction ledger with the off-chain Points ledger and sorts by date, so a
 * player sees one honest timeline instead of two partial ones. */

import Link from "next/link";
import {
  ArrowDownLeft, ArrowLeftRight, Banknote, Coins, Gift, History,
  Megaphone, ShoppingBag, Sparkles, Store, Ticket, Trophy, Users,
} from "lucide-react";
import { EmptyState, Skeleton, StatusPill } from "@/components/ui";
import { usePointsHistory, useTransactions } from "@/lib/hooks/use-data";
import type { PointsEntry, StatusKind, Transaction } from "@/types";
import { cn, formatNumber, formatToken } from "@/lib/utils";
import { POINTS_SOURCE_LABEL } from "./derive";
import { RelativeTime } from "./time";

const TX_LABEL: Record<Transaction["type"], string> = {
  conversion: "Points converted to MTT",
  stake: "Staked MTT",
  unstake: "Unstaked MTT",
  reward_claim: "Staking rewards claimed",
  commission_claim: "Referral commission claimed",
  deposit: "Deposit settled",
  withdrawal: "Withdrawal requested",
  store_purchase: "Store purchase",
  marketplace_sale: "Marketplace sale",
  tournament_entry: "Tournament entry fee",
};

const TX_ICON: Record<Transaction["type"], React.ReactNode> = {
  conversion: <ArrowLeftRight />,
  stake: <Coins />,
  unstake: <Coins />,
  reward_claim: <Gift />,
  commission_claim: <Users />,
  deposit: <ArrowDownLeft />,
  withdrawal: <Banknote />,
  store_purchase: <ShoppingBag />,
  marketplace_sale: <Store />,
  tournament_entry: <Ticket />,
};

const POINTS_ICON: Record<PointsEntry["source"], React.ReactNode> = {
  gameplay: <Sparkles />,
  quest: <Trophy />,
  ad: <Megaphone />,
  purchase: <ShoppingBag />,
  tournament: <Ticket />,
  referral_bonus: <Users />,
  conversion: <ArrowLeftRight />,
};

interface FeedItem {
  id: string;
  date: string;
  title: string;
  detail: string;
  icon: React.ReactNode;
  amount: string;
  positive: boolean;
  status?: StatusKind;
  href: string;
}

function toFeed(txs: Transaction[], points: PointsEntry[]): FeedItem[] {
  const items: FeedItem[] = [
    ...txs.map<FeedItem>((t) => ({
      id: t.id,
      date: t.date,
      title: TX_LABEL[t.type],
      detail: t.sourceTag
        ? `${t.id} · source tagged ${t.sourceTag} for AML monitoring`
        : t.txHash
          ? `${t.id} · on-chain, provable on BscScan`
          : `${t.id} · off-chain ledger entry`,
      icon: TX_ICON[t.type],
      amount: `${t.amountMtt > 0 ? "+" : "−"}${formatToken(Math.abs(t.amountMtt))} MTT`,
      positive: t.amountMtt > 0,
      status: t.status,
      href: "/app/wallet/history",
    })),
    ...points.map<FeedItem>((p) => ({
      id: p.id,
      date: p.date,
      title: POINTS_SOURCE_LABEL[p.source],
      detail: [p.gameTitle, p.note, `balance ${formatNumber(p.runningBalance)} Points`]
        .filter(Boolean)
        .join(" · "),
      icon: POINTS_ICON[p.source],
      amount: `${p.amount > 0 ? "+" : "−"}${formatNumber(Math.abs(p.amount))} Points`,
      positive: p.amount > 0,
      href: "/app/games/points-history",
    })),
  ];

  return items.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

export function ActivityFeed({ limit = 10, className }: { limit?: number; className?: string }) {
  const { data: txs, isLoading: txLoading } = useTransactions();
  const { data: points, isLoading: pointsLoading } = usePointsHistory();
  const isLoading = txLoading || pointsLoading;

  if (isLoading) {
    return (
      <ul className={cn("space-y-3", className)}>
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-xl" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <Skeleton className="h-4 w-20" />
          </li>
        ))}
      </ul>
    );
  }

  const items = toFeed(txs, points).slice(0, limit);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<History />}
        title="No activity yet"
        description="Play a free session and your first Points credit will show up here."
        action={{ label: "Open the game lobby", href: "/app/games" }}
      />
    );
  }

  return (
    <ul className={cn("divide-y divide-border-subtle", className)}>
      {items.map((item) => (
        <li key={`${item.id}-${item.date}`}>
          <Link
            href={item.href}
            className="flex items-start gap-3 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:rounded-lg sm:px-2"
          >
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-surface-3 text-text-secondary [&>svg]:size-4">
              {item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{item.title}</span>
                {item.status && item.status !== "completed" && <StatusPill status={item.status} />}
              </span>
              <span className="mt-0.5 block truncate text-xs text-text-muted">{item.detail}</span>
            </span>
            <span className="shrink-0 text-right">
              <span
                className={cn(
                  "tnum block text-sm font-semibold",
                  item.positive ? "text-good-400" : "text-text-secondary",
                )}
              >
                {item.amount}
              </span>
              <RelativeTime date={item.date} className="mt-0.5 block text-xs text-text-muted" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
