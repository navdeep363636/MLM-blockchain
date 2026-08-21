"use client";

import { useMemo, useState } from "react";
import {
  CalendarClock, Coins, Info, Landmark, ListOrdered, Ticket, Trophy, Users,
} from "lucide-react";
import {
  Badge, Button, Callout, Checkbox, DataTable, EmptyState, Modal, PillTabs,
  ProgressBar, SkeletonCard, StatusPill, DetailRow, useToast, type Column,
} from "@/components/ui";
import { RevealGroup, RevealItem, SpotlightCard } from "@/components/fx";
import { useGames, useLeaderboard, useTournaments } from "@/lib/hooks/use-data";
import { formatDate, formatNumber, formatToken } from "@/lib/utils";
import type { LeaderboardEntry, Tournament } from "@/types";
import { GameArt } from "@/app/(public)/_components/game-art";
import { Countdown, RelativeTime } from "../../../_components/time";

type Filter = "live" | "scheduled" | "completed";

export function TournamentsView() {
  const { data: tournaments, isLoading } = useTournaments();
  const { data: games } = useGames();
  const { data: leaderboard } = useLeaderboard();
  const toast = useToast();

  const [filter, setFilter] = useState<Filter>("live");
  const [entering, setEntering] = useState<Tournament | null>(null);
  const [standings, setStandings] = useState<Tournament | null>(null);
  const [ack, setAck] = useState({ rules: false, revenue: false });
  const [busy, setBusy] = useState(false);
  const [registered, setRegistered] = useState<Record<string, boolean>>({});

  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  const counts = useMemo(
    () => ({
      live: tournaments.filter((t) => t.status === "live").length,
      scheduled: tournaments.filter((t) => t.status === "scheduled").length,
      completed: tournaments.filter((t) => t.status === "completed").length,
    }),
    [tournaments],
  );

  const shown = tournaments.filter((t) => t.status === filter);

  const isRegistered = (t: Tournament) => registered[t.id] ?? t.registered ?? false;

  const confirmEntry = async () => {
    if (!entering) return;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 900));
    setBusy(false);
    setRegistered((m) => ({ ...m, [entering.id]: true }));
    toast.success(
      "Entry confirmed",
      entering.entryFee > 0
        ? `${formatToken(entering.entryFee)} MTT paid. Your entry fee flows to the Revenue Treasury.`
        : "You're registered for this free-entry event.",
    );
    setEntering(null);
    setAck({ rules: false, revenue: false });
  };

  const standingsColumns: Column<LeaderboardEntry>[] = [
    {
      key: "rank",
      header: "#",
      cell: (r) => (
        <span className={r.isCurrentUser ? "tnum font-semibold text-[var(--accent-hover)]" : "tnum text-text-secondary"}>
          {r.rank}
        </span>
      ),
      sortValue: (r) => r.rank,
    },
    {
      key: "player",
      header: "Player",
      cell: (r) => (
        <span className={r.isCurrentUser ? "font-semibold text-text-primary" : "text-text-secondary"}>
          {r.displayName}
          {r.isCurrentUser && <Badge tone="brand" className="ml-2">You</Badge>}
        </span>
      ),
    },
    {
      key: "score",
      header: "Score",
      align: "right",
      cell: (r) => <span className="tnum font-medium text-text-primary">{formatNumber(r.metric)}</span>,
      sortValue: (r) => r.metric,
    },
  ];

  return (
    <>
      <Callout tone="info" title="Entry fees are a real revenue event" icon={<Landmark />} className="mb-6">
        <p className="mt-1">
          A published share of net tournament rake flows into the Revenue Treasury, which is what funds
          staking rewards and referral commissions. Free-entry events run alongside paid ones — paid
          entry is never required to earn Points.
        </p>
      </Callout>

      <PillTabs
        value={filter}
        onValueChange={(v) => setFilter(v as Filter)}
        items={[
          { value: "live", label: "Live now", count: counts.live },
          { value: "scheduled", label: "Upcoming", count: counts.scheduled },
          { value: "completed", label: "Completed", count: counts.completed },
        ]}
      />

      {isLoading ? (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} className="h-72" />)}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          className="mt-6 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1"
          icon={<Trophy />}
          title={`No ${filter} tournaments`}
          description={
            filter === "live"
              ? "Nothing is running right now. Check the upcoming tab for the schedule."
              : "Check back soon — the schedule refreshes weekly."
          }
          action={{ label: "Browse games", href: "/app/games" }}
        />
      ) : (
        <RevealGroup className="mt-6 grid gap-5 lg:grid-cols-2">
          {shown.map((t) => {
            const game = gameById.get(t.gameId);
            const full = t.participants >= t.maxParticipants;
            const mine = isRegistered(t);
            return (
              <RevealItem key={t.id}>
                <SpotlightCard className="flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1">
                  <div className="relative">
                    <GameArt hue={game?.thumbnailHue ?? 24} title={t.name} ratio="aspect-[21/8]" />
                    <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                      {t.status === "live" && <Badge tone="good" dot>Live now</Badge>}
                      {t.entryFee === 0 && <Badge tone="brand">Free entry</Badge>}
                      {mine && <Badge tone="info">Registered</Badge>}
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-display text-base font-semibold leading-snug text-text-primary">
                          {t.name}
                        </h3>
                        <p className="mt-0.5 text-xs text-text-muted">{game?.title ?? "—"} · {t.format}</p>
                      </div>
                      <StatusPill status={t.status === "live" ? "active" : t.status === "scheduled" ? "pending" : "completed"} />
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-border-subtle py-4 text-sm sm:grid-cols-4">
                      <div>
                        <dt className="text-xs text-text-muted">Prize pool</dt>
                        <dd className="tnum mt-0.5 font-semibold text-text-primary">{formatNumber(t.prizePool)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-text-muted">Entry</dt>
                        <dd className="tnum mt-0.5 font-semibold text-text-primary">
                          {t.entryFee === 0 ? "Free" : `${formatToken(t.entryFee)} MTT`}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-text-muted">Entrants</dt>
                        <dd className="tnum mt-0.5 font-semibold text-text-primary">
                          {formatNumber(t.participants)}
                          <span className="font-normal text-text-muted"> / {formatNumber(t.maxParticipants)}</span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-text-muted">
                          {t.status === "completed" ? "Ended" : t.status === "live" ? "Ends in" : "Starts in"}
                        </dt>
                        <dd className="tnum mt-0.5 font-semibold text-text-primary">
                          {t.status === "completed"
                            ? <RelativeTime date={t.endsAt} />
                            : <Countdown to={t.status === "live" ? t.endsAt : t.startsAt} elapsedLabel="Starting" />}
                        </dd>
                      </div>
                    </dl>

                    <ProgressBar
                      className="mt-4"
                      value={t.participants}
                      max={t.maxParticipants}
                      tone={full ? "warning" : "brand"}
                      label={full ? "Field is full" : "Field filling"}
                      showLabel
                      height="h-1.5"
                    />

                    <p className="mt-3 text-xs text-text-muted">
                      {t.status === "completed"
                        ? `Ran ${formatDate(t.startsAt)} – ${formatDate(t.endsAt)}.`
                        : `Window: ${formatDate(t.startsAt, true)} → ${formatDate(t.endsAt, true)}.`}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2 pt-1">
                      {t.status !== "completed" && (
                        mine ? (
                          <Button size="sm" variant="outline" disabled icon={<Ticket className="size-3.5" />}>
                            Registered
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={full}
                            onClick={() => setEntering(t)}
                            icon={<Ticket className="size-3.5" />}
                          >
                            {t.entryFee === 0 ? "Register free" : `Enter for ${formatToken(t.entryFee)} MTT`}
                          </Button>
                        )
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setStandings(t)}
                        icon={<ListOrdered className="size-3.5" />}
                      >
                        {t.status === "live" ? "Live standings" : t.status === "completed" ? "Final results" : "Rules & prizes"}
                      </Button>
                    </div>
                  </div>
                </SpotlightCard>
              </RevealItem>
            );
          })}
        </RevealGroup>
      )}

      {/* Entry — full disclosure BEFORE payment (FRD G-03 business rule) */}
      <Modal
        open={!!entering}
        onClose={() => { setEntering(null); setAck({ rules: false, revenue: false }); }}
        title="Confirm tournament entry"
        description="Format, scoring and the full prize split are shown before you pay."
        icon={<Trophy className="size-5" />}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setEntering(null); setAck({ rules: false, revenue: false }); }}>
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={!ack.rules || !ack.revenue}
              onClick={confirmEntry}
            >
              {entering?.entryFee === 0 ? "Register" : `Pay ${formatToken(entering?.entryFee ?? 0)} MTT`}
            </Button>
          </>
        }
      >
        {entering && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
              <DetailRow label="Tournament" value={entering.name} />
              <DetailRow label="Game" value={gameById.get(entering.gameId)?.title ?? "—"} />
              <DetailRow label="Format" value={entering.format} />
              <DetailRow label="Starts" value={formatDate(entering.startsAt, true)} />
              <DetailRow
                label="Entry fee"
                value={entering.entryFee === 0 ? "Free" : `${formatToken(entering.entryFee)} MTT`}
              />
              <DetailRow label="Prize pool" value={`${formatNumber(entering.prizePool)} MTT`} />
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Prize distribution
              </p>
              <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle">
                {entering.prizeSplit.map((p, i) => (
                  <li key={p.place} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                    <span className="flex items-center gap-2 text-text-secondary">
                      <span className="size-2 rounded-full" style={{ background: `var(--series-${Math.min(i + 1, 8)})` }} />
                      {p.place}
                    </span>
                    <span className="tnum font-medium text-text-primary">
                      {p.share}%
                      <span className="ml-2 font-normal text-text-muted">
                        {formatNumber((entering.prizePool * p.share) / 100)} MTT
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {entering.entryFee > 0 && (
              <Callout tone="info" title="Where your entry fee goes" icon={<Landmark />}>
                <p className="mt-1">
                  A published share of net rake is allocated to the Revenue Treasury, which funds
                  staking rewards and referral commissions. The remainder funds the prize pool and
                  platform operations.
                </p>
              </Callout>
            )}

            <div className="space-y-2.5 border-t border-border-subtle pt-4">
              <Checkbox
                checked={ack.rules}
                onCheckedChange={(v) => setAck((a) => ({ ...a, rules: v }))}
                label="I've read the format, scoring and prize distribution above."
              />
              <Checkbox
                checked={ack.revenue}
                onCheckedChange={(v) => setAck((a) => ({ ...a, revenue: v }))}
                label={
                  entering.entryFee === 0
                    ? "I understand placement is decided by skill under identical conditions for every entrant."
                    : "I understand the entry fee is non-refundable once the tournament begins, and that placement is decided by skill."
                }
              />
            </div>
          </div>
        )}
      </Modal>

      {/* Standings / rules */}
      <Modal
        open={!!standings}
        onClose={() => setStandings(null)}
        title={standings?.status === "scheduled" ? "Rules & prize split" : standings?.status === "live" ? "Live standings" : "Final results"}
        description={standings?.name}
        icon={<ListOrdered className="size-5" />}
        size="lg"
        footer={<Button variant="ghost" onClick={() => setStandings(null)}>Close</Button>}
      >
        {standings && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: "Format", value: standings.format, icon: <Info /> },
                { label: "Prize pool", value: `${formatNumber(standings.prizePool)} MTT`, icon: <Coins /> },
                { label: "Entrants", value: formatNumber(standings.participants), icon: <Users /> },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-border-subtle bg-surface-inset p-3.5">
                  <p className="flex items-center gap-1.5 text-xs text-text-muted [&>svg]:size-3.5">
                    {s.icon} {s.label}
                  </p>
                  <p className="tnum mt-1 text-sm font-semibold text-text-primary">{s.value}</p>
                </div>
              ))}
            </div>

            {standings.status === "scheduled" ? (
              <>
                <Callout tone="info" title="Disclosed before entry" icon={<CalendarClock />}>
                  <p className="mt-1">
                    Rules, scoring and the prize split are published before registration opens and
                    can&apos;t change once the field starts filling.
                  </p>
                </Callout>
                <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle">
                  {standings.prizeSplit.map((p) => (
                    <li key={p.place} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <span className="text-text-secondary">{p.place}</span>
                      <span className="tnum font-medium text-text-primary">
                        {p.share}% · {formatNumber((standings.prizePool * p.share) / 100)} MTT
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border-subtle">
                <DataTable
                  columns={standingsColumns}
                  rows={leaderboard.slice(0, 12)}
                  keyOf={(r) => r.userId}
                  caption={`${standings.status === "live" ? "Live standings" : "Final results"} for ${standings.name}`}
                  dense
                />
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
