"use client";

import { useMemo, useState } from "react";
import {
  Award, CalendarDays, CheckCircle2, Gift, Info, Lock, Sparkles, Target, Trophy,
} from "lucide-react";
import {
  Badge, Button, Callout, CapMeter, DetailRow, EmptyState, Modal, PillTabs,
  ProgressBar, RingProgress, SkeletonCard, StatTile, useToast,
} from "@/components/ui";
import { RevealGroup, RevealItem, SpotlightCard } from "@/components/fx";
import { useAchievements, useBalances, useGames, useQuests } from "@/lib/hooks/use-data";
import { useClaimQuest } from "@/lib/hooks/use-mutations";
import { humanMessage, isApiError } from "@/lib/api/errors";
import { cn, formatNumber } from "@/lib/utils";
import type { Achievement, Quest } from "@/types";
import { Countdown } from "../../../_components/time";
import { issuanceCap } from "../../../_components/derive";

const TIER_STYLE: Record<Achievement["tier"], { ring: string; text: string; label: string }> = {
  bronze: { ring: "ring-[var(--series-1)]/40", text: "text-[var(--series-1)]", label: "Bronze" },
  silver: { ring: "ring-border-strong", text: "text-text-secondary", label: "Silver" },
  gold: { ring: "ring-[var(--series-4)]/50", text: "text-[var(--series-4)]", label: "Gold" },
  platinum: { ring: "ring-[var(--series-7)]/50", text: "text-[var(--series-7)]", label: "Platinum" },
};

export function QuestsView() {
  const { data: questBoard, isLoading } = useQuests();
  const { quests, readyToClaim, claimablePoints } = questBoard;
  const claimQuest = useClaimQuest();
  const { data: achievements } = useAchievements();
  const { data: balances } = useBalances();
  const { data: games } = useGames();
  const toast = useToast();

  const [tab, setTab] = useState<Quest["kind"] | "achievements">("daily");
  const [claiming, setClaiming] = useState<Quest | null>(null);
  const [claimed, setClaimed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const dailyCap = useMemo(() => issuanceCap(games), [games]);

  const isClaimed = (q: Quest) => claimed[q.id] ?? q.claimed;
  const byKind = (k: Quest["kind"]) => quests.filter((q) => q.kind === k);
  /* Trust the server's verdict, not a recompute against the CURRENT target —
   * see the doc comment on Quest.completed. */
  const complete = (q: Quest) => q.completed;

  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  const confirmClaim = async () => {
    if (!claiming) return;
    setBusy(true);
    try {
      await claimQuest.mutateAsync({ id: claiming.id });
    } catch (err) {
      /* The daily cap is the interesting failure: the reward is not lost, it is
       * simply not creditable today, and saying so is the difference between a
       * bug report and an understood limit. */
      toast.error(
        isApiError(err) && err.code === "POINTS_CAP_REACHED"
          ? "Daily Points cap reached"
          : "Couldn't claim that reward",
        humanMessage(err),
      );
      setBusy(false);
      return;
    }
    setBusy(false);
    /* Local flag purely to stop the button flickering back to "Claim" for the one
     * refetch the mutation triggers; the server's answer is what decides. */
    setClaimed((m) => ({ ...m, [claiming.id]: true }));
    toast.success(
      "Reward claimed",
      `${formatNumber(claiming.rewardPoints)} Points credited, inside today's issuance cap.`,
    );
    setClaiming(null);
  };

  const questCard = (q: Quest) => {
    const done = complete(q);
    const already = isClaimed(q);
    return (
      <RevealItem key={q.id}>
        <SpotlightCard
          className={cn(
            "flex h-full flex-col rounded-[var(--radius-card)] border bg-surface-1 p-5",
            done && !already ? "border-[var(--accent-ring)]" : "border-border-subtle",
          )}
        >
          <div className="flex items-start gap-3.5">
            <RingProgress value={Math.min(q.progress, q.target)} max={q.target} size={52} stroke={4}>
              {already ? (
                <CheckCircle2 className="size-4 text-good-400" />
              ) : (
                <span className="tnum text-[10px] font-semibold text-text-primary">
                  {Math.round((Math.min(q.progress, q.target) / q.target) * 100)}%
                </span>
              )}
            </RingProgress>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-text-primary">{q.title}</h3>
                {already && <Badge tone="good" icon={<CheckCircle2 className="size-3" />}>Claimed</Badge>}
                {done && !already && <Badge tone="brand" dot>Ready</Badge>}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">{q.description}</p>
            </div>
          </div>

          <div className="mt-4">
            <ProgressBar
              value={Math.min(q.progress, q.target)}
              max={q.target}
              tone={already ? "good" : done ? "brand" : "brand"}
              label={
                <span className="tnum">
                  {formatNumber(Math.min(q.progress, q.target))} / {formatNumber(q.target)}
                </span>
              }
              height="h-1.5"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-4">
            <span className="inline-flex items-center gap-1.5 text-sm">
              <Gift className="size-3.5 text-[var(--accent)]" />
              <span className="tnum font-semibold text-text-primary">{formatNumber(q.rewardPoints)}</span>
              <span className="text-xs text-text-muted">Points</span>
            </span>
            {q.expiresAt && !already && (
              <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                <CalendarDays className="size-3" />
                <Countdown to={q.expiresAt} elapsedLabel="Expired" />
              </span>
            )}
          </div>

          {done && !already && (
            <Button size="sm" fullWidth className="mt-3" onClick={() => setClaiming(q)}>
              Claim {formatNumber(q.rewardPoints)} Points
            </Button>
          )}
        </SpotlightCard>
      </RevealItem>
    );
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Ready to claim"
          value={readyToClaim}
          icon={<Gift />}
          tone={readyToClaim > 0 ? "brand" : "default"}
          deltaLabel={readyToClaim > 0 ? `${formatNumber(claimablePoints)} Points waiting` : "Nothing pending"}
          compact
        />
        <StatTile
          label="Points today"
          value={balances.pointsToday}
          icon={<Sparkles />}
          deltaLabel="Credited across all sources"
          compact
        />
        <StatTile
          label="Achievements"
          value={`${unlockedCount} / ${achievements.length}`}
          icon={<Award />}
          deltaLabel="Lifetime milestones unlocked"
          compact
        />
        <StatTile
          label="Active quests"
          value={quests.filter((q) => !isClaimed(q)).length}
          icon={<Target />}
          deltaLabel="Daily, weekly and milestone"
          compact
        />
      </div>

      <div className="mt-5 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
        <CapMeter
          used={balances.pointsToday}
          cap={dailyCap}
          label="Today's Points issuance against your daily cap"
        />
        <p className="mt-2.5 text-xs leading-relaxed text-text-muted">
          Quest rewards draw on the same daily Points issuance cap as gameplay — completing every
          quest doesn&apos;t let you exceed it. The cap protects the value of what everyone else has
          earned and makes automated farming unprofitable.
        </p>
      </div>

      <PillTabs
        className="mt-6"
        value={tab}
        onValueChange={(v) => setTab(v as typeof tab)}
        items={[
          { value: "daily", label: "Daily", count: byKind("daily").length },
          { value: "weekly", label: "Weekly", count: byKind("weekly").length },
          { value: "milestone", label: "Milestones", count: byKind("milestone").length },
          { value: "achievements", label: "Achievements", count: achievements.length },
        ]}
      />

      {isLoading ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} className="h-44" />)}
        </div>
      ) : tab === "achievements" ? (
        <RevealGroup className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {achievements.map((a) => {
            const st = TIER_STYLE[a.tier];
            return (
              <RevealItem key={a.id}>
                <div
                  className={cn(
                    "flex h-full flex-col items-center rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5 text-center",
                    !a.unlocked && "opacity-70",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-14 place-items-center rounded-2xl ring-2",
                      st.ring,
                      a.unlocked ? "bg-surface-2" : "bg-surface-inset",
                    )}
                  >
                    {a.unlocked ? (
                      <Trophy className={cn("size-6", st.text)} />
                    ) : (
                      <Lock className="size-5 text-text-muted" />
                    )}
                  </span>
                  <Badge tone="neutral" className="mt-3">{st.label}</Badge>
                  <h3 className="mt-2.5 text-sm font-semibold text-text-primary">{a.title}</h3>
                  <p className="mt-1 flex-1 text-xs leading-relaxed text-text-muted">{a.description}</p>
                  <p className="tnum mt-3 border-t border-border-subtle pt-3 text-xs font-medium text-text-secondary">
                    {formatNumber(a.rewardPoints)} Points
                  </p>
                  {a.unlocked && a.unlockedAt && (
                    <p className="mt-1 text-[11px] text-good-400">Unlocked</p>
                  )}
                </div>
              </RevealItem>
            );
          })}
        </RevealGroup>
      ) : byKind(tab).length === 0 ? (
        <EmptyState
          className="mt-6 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1"
          icon={<Target />}
          title={`No ${tab} quests right now`}
          description="Daily quests refresh at 00:00 UTC and weekly quests every Monday."
          action={{ label: "Go play", href: "/app/games" }}
        />
      ) : (
        <RevealGroup className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {byKind(tab).map(questCard)}
        </RevealGroup>
      )}

      <Modal
        open={!!claiming}
        onClose={() => setClaiming(null)}
        title="Claim quest reward"
        icon={<Gift className="size-5" />}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setClaiming(null)}>Cancel</Button>
            <Button loading={busy} onClick={confirmClaim}>Claim reward</Button>
          </>
        }
      >
        {claiming && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
              <DetailRow label="Quest" value={claiming.title} />
              <DetailRow label="Type" value={claiming.kind === "milestone" ? "Milestone" : claiming.kind === "weekly" ? "Weekly" : "Daily"} />
              <DetailRow
                label="Reward"
                value={<span className="text-[var(--accent-hover)]">{formatNumber(claiming.rewardPoints)} Points</span>}
              />
            </div>
            <Callout tone="info" title="Subject to your daily cap" icon={<Info />}>
              <p className="mt-1">
                Quest rewards count toward the same daily Points issuance cap as gameplay. If the
                reward would take you past today&apos;s cap, only the remaining allowance is credited —
                the rest is not carried over.
              </p>
            </Callout>
          </div>
        )}
      </Modal>
    </>
  );
}
