"use client";

/* AD-04 · Game & Points configuration — issuance rates, caps, scheduled
 * publication and rollback. Nothing here takes effect retroactively. */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CalendarClock, CheckCircle2, Download, Gamepad2, History, Info,
  RotateCcw, Save, Sparkles, Undo2,
} from "lucide-react";
import {
  Badge, Button, Callout, ConfirmDialog, DetailRow, Input, Switch, useToast, type Column,
} from "@/components/ui";
import { useAuditLog, useGames, usePointsRules } from "@/lib/hooks/use-data";
import { csvDownload, formatDate, formatNumber, timeAgo } from "@/lib/utils";
import type { PointsRule } from "@/types";
import { FourEyesModal } from "../../_components/four-eyes-modal";
import { LedgerTable } from "../../_components/ledger-table";
import { AuditNote, MiniStat, Panel } from "../../_components/panel";

interface Draft {
  points: Record<string, number>;      // `${gameId}::${action}` -> points
  dailyCap: Record<string, number>;    // gameId -> per-user daily cap
  sessionCap: Record<string, number>;  // gameId -> per-user per-session cap
  enabled: Record<string, boolean>;    // gameId -> enabled
}

const ruleKey = (r: PointsRule) => `${r.gameId}::${r.action}`;
/** A session may not award more than this share of the daily cap. */
const SESSION_SHARE = 0.25;

function NumberInput({
  value, onChange, suffix, min = 0, className,
}: {
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  className?: string;
}) {
  return (
    <Input
      type="number"
      min={min}
      value={String(value)}
      suffix={suffix}
      onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
      className={className ?? "tnum h-9 w-28"}
    />
  );
}

/* ------------------------------- header action ---------------------------- */

export function GamesActions() {
  const { data: rules } = usePointsRules();
  return (
    <Button
      variant="outline"
      size="sm"
      icon={<Download className="size-4" />}
      onClick={() =>
        csvDownload(
          "members-trail-points-rules.csv",
          rules.map((r) => ({
            game_id: r.gameId,
            game: r.gameTitle,
            action: r.action,
            points: r.points,
            daily_cap_per_user: r.dailyCapPerUser,
            enabled: r.enabled,
          })),
        )
      }
    >
      Export current rules
    </Button>
  );
}

/* ---------------------------------- view --------------------------------- */

export function GamesView() {
  const { data: rules, isLoading } = usePointsRules();
  const { data: games } = useGames();
  const { data: audit } = useAuditLog();
  const toast = useToast();

  const [draft, setDraft] = useState<Draft>({ points: {}, dailyCap: {}, sessionCap: {}, enabled: {} });
  const [publish, setPublish] = useState(false);
  const [effectiveAt, setEffectiveAt] = useState("");
  const [rollback, setRollback] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, { gameId: string; gameTitle: string; rules: PointsRule[] }>();
    for (const r of rules) {
      const g = map.get(r.gameId) ?? { gameId: r.gameId, gameTitle: r.gameTitle, rules: [] };
      g.rules.push(r);
      map.set(r.gameId, g);
    }
    return [...map.values()];
  }, [rules]);

  const pointsOf = (r: PointsRule) => draft.points[ruleKey(r)] ?? r.points;
  const dailyCapOf = (gameId: string, fallback: number) => draft.dailyCap[gameId] ?? fallback;
  const sessionCapOf = (gameId: string, dailyCap: number) =>
    draft.sessionCap[gameId] ?? Math.round(dailyCap * SESSION_SHARE);
  const enabledOf = (gameId: string, fallback: boolean) => draft.enabled[gameId] ?? fallback;

  const dirtyCount =
    Object.keys(draft.points).length +
    Object.keys(draft.dailyCap).length +
    Object.keys(draft.sessionCap).length +
    Object.keys(draft.enabled).length;

  const versions = useMemo(() => {
    const entries = audit.filter((a) => a.action === "Points rule updated").slice(0, 5);
    return entries.map((a, i) => ({
      id: `v${4 - i}.${entries.length - i}`,
      publishedAt: a.timestamp,
      actor: a.actor,
      change: `${a.target}: ${a.before ?? "—"} → ${a.after ?? "—"}`,
      current: i === 0,
    }));
  }, [audit]);

  const totalDailyIssuance = grouped.reduce((sum, g) => {
    const game = games.find((x) => x.id === g.gameId);
    return sum + dailyCapOf(g.gameId, game?.dailyPointsCap ?? 0);
  }, 0);

  const effectiveDate = effectiveAt ? new Date(effectiveAt) : null;
  /* Gated behind mount: reading the clock during the server pass would
   * produce a different result from the client pass and break hydration. */
  // Clock is read only on the client, after the first paint.
  const [mountedNow, setMountedNow] = useState<number | null>(null);
  useEffect(() => {
    setMountedNow(Date.now());
    const t = window.setInterval(() => setMountedNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const dateInPast = mountedNow != null && !!effectiveDate && effectiveDate.getTime() <= mountedNow;

  const versionColumns: Column<(typeof versions)[number]>[] = [
    {
      key: "version",
      header: "Version",
      cell: (v) => (
        <span className="flex items-center gap-2">
          <span className="font-mono-num text-sm text-text-primary">{v.id}</span>
          {v.current && <Badge tone="good" dot>Live</Badge>}
        </span>
      ),
    },
    {
      key: "published",
      header: "Published",
      sortValue: (v) => v.publishedAt,
      cell: (v) => (
        <span className="text-xs text-text-secondary">
          {timeAgo(v.publishedAt)}
          <span className="tnum block text-[11px] text-text-muted">{formatDate(v.publishedAt, true)}</span>
        </span>
      ),
    },
    { key: "actor", header: "Published by", hideBelow: "md", cell: (v) => <span className="text-sm text-text-secondary">{v.actor}</span> },
    { key: "change", header: "Change", hideBelow: "lg", cell: (v) => <span className="text-xs text-text-muted">{v.change}</span> },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (v) =>
        v.current ? (
          <span className="text-xs text-text-muted">current</span>
        ) : (
          <Button variant="ghost" size="xs" icon={<Undo2 className="size-3.5" />} onClick={() => setRollback(v.id)}>
            Roll back
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat label="Games configured" value={formatNumber(grouped.length)} sub="issuance rules per game" />
        <MiniStat
          label="Active games"
          value={formatNumber(grouped.filter((g) => enabledOf(g.gameId, games.find((x) => x.id === g.gameId)?.active ?? true)).length)}
          sub="issuing Points right now"
          tone="good"
        />
        <MiniStat label="Rules" value={formatNumber(rules.length)} sub="game × action combinations" />
        <MiniStat
          label="Max daily issuance"
          value={formatNumber(totalDailyIssuance)}
          sub="Points per user across all games"
          tone="warning"
        />
      </div>

      <Callout tone="warning" title="Issuance changes are never silently retroactive" icon={<CalendarClock />}>
        <p className="mt-1">
          Every change published here carries an explicit future effective date and time. Sessions
          already played are settled against the rule version that was live when they were played, so
          a member&apos;s past Points can never be revalued downward after the fact. The full version
          history below is retained, and any version can be rolled back to.
        </p>
      </Callout>

      {/* -------------------------- per-game editors ---------------------- */}
      {isLoading ? (
        <Panel title="Loading issuance rules…"><div className="h-40" /></Panel>
      ) : (
        <div className="space-y-4">
          {grouped.map((g) => {
            const game = games.find((x) => x.id === g.gameId);
            const enabled = enabledOf(g.gameId, game?.active ?? true);
            const dailyCap = dailyCapOf(g.gameId, game?.dailyPointsCap ?? 0);
            const sessionCap = sessionCapOf(g.gameId, dailyCap);
            const maxPerSession = Math.round(dailyCap * SESSION_SHARE);

            return (
              <Panel
                key={g.gameId}
                icon={<Gamepad2 />}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {g.gameTitle}
                    <span className="font-mono-num text-xs text-text-muted">{g.gameId}</span>
                    {!enabled && <Badge tone="neutral">Disabled</Badge>}
                  </span>
                }
                description={game ? `${game.genre} · ${formatNumber(game.players30d)} players in the last 30 days` : undefined}
                action={
                  <Switch
                    checked={enabled}
                    onCheckedChange={(v) => setDraft((d) => ({ ...d, enabled: { ...d.enabled, [g.gameId]: v } }))}
                    label="Issuing Points"
                  />
                }
                footnote={
                  enabled
                    ? "Disabling a game stops future issuance only. Points already awarded are unaffected and remain convertible."
                    : "This game is disabled: sessions can still be played but award no Points until it is re-enabled and the change is published."
                }
              >
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-xl border border-border-subtle">
                    <table className="w-full text-sm">
                      <caption className="sr-only">Points awarded per action for {g.gameTitle}</caption>
                      <thead className="bg-surface-inset">
                        <tr>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Action</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-text-muted">Points awarded</th>
                          <th className="hidden px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-text-muted sm:table-cell">Current</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-subtle">
                        {g.rules.map((r) => {
                          const v = pointsOf(r);
                          const changed = v !== r.points;
                          return (
                            <tr key={ruleKey(r)} className="bg-surface-1">
                              <td className="px-4 py-2.5">
                                <span className="text-sm text-text-primary">{r.action}</span>
                                {changed && <Badge tone="warning" className="ml-2">edited</Badge>}
                              </td>
                              <td className="px-4 py-2 text-right">
                                <div className="flex justify-end">
                                  <NumberInput
                                    value={v}
                                    suffix="pts"
                                    onChange={(n) =>
                                      setDraft((d) => ({ ...d, points: { ...d.points, [ruleKey(r)]: n } }))
                                    }
                                  />
                                </div>
                              </td>
                              <td className="tnum hidden px-4 py-2.5 text-right text-xs text-text-muted sm:table-cell">
                                {formatNumber(r.points)} pts
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-border-subtle bg-surface-inset p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Daily cap per user</p>
                      <div className="mt-2 flex items-center gap-3">
                        <NumberInput
                          value={dailyCap}
                          suffix="pts"
                          className="tnum h-9 w-32"
                          onChange={(n) => setDraft((d) => ({ ...d, dailyCap: { ...d.dailyCap, [g.gameId]: n } }))}
                        />
                        <span className="text-xs text-text-muted">resets 00:00 UTC</span>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border-subtle bg-surface-inset p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Session cap per user</p>
                      <div className="mt-2 flex items-center gap-3">
                        <NumberInput
                          value={sessionCap}
                          suffix="pts"
                          className="tnum h-9 w-32"
                          onChange={(n) => setDraft((d) => ({ ...d, sessionCap: { ...d.sessionCap, [g.gameId]: n } }))}
                        />
                        <span className="text-xs text-text-muted">
                          policy max {formatNumber(maxPerSession)} pts
                        </span>
                      </div>
                      {sessionCap > maxPerSession && (
                        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-warning-400">
                          <AlertTriangle className="size-3.5" />
                          Above {Math.round(SESSION_SHARE * 100)}% of the daily cap — farming risk, and it will be
                          queried at publication.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {/* --------------------------- publish bar -------------------------- */}
      <Panel
        tone={dirtyCount > 0 ? "warning" : "default"}
        icon={<Save />}
        title={dirtyCount > 0 ? `${dirtyCount} unpublished change${dirtyCount > 1 ? "s" : ""}` : "No pending changes"}
        description={
          dirtyCount > 0
            ? "Changes are held in a draft version. They do not affect any member until you publish them with a future effective date."
            : "Edit an issuance rate, cap or game toggle above to create a draft version."
        }
        action={
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw className="size-4" />}
              disabled={dirtyCount === 0}
              onClick={() => setDraft({ points: {}, dailyCap: {}, sessionCap: {}, enabled: {} })}
            >
              Discard draft
            </Button>
            <Button
              size="sm"
              icon={<CalendarClock className="size-4" />}
              disabled={dirtyCount === 0}
              onClick={() => setPublish(true)}
            >
              Publish changes
            </Button>
          </>
        }
      >
        <AuditNote>
          Publication writes a new version record containing the full rule set, the effective
          timestamp, your identity and the approver&apos;s. The previous version stays queryable
          forever so any historical Points award can be re-derived from the rules that were live at
          the time.
        </AuditNote>
      </Panel>

      {/* -------------------------- version history ----------------------- */}
      <LedgerTable
        title="Version history"
        description="Every published rule set, newest first. Rolling back publishes the older set as a new version — history is never rewritten."
        icon={<History />}
        columns={versionColumns}
        rows={versions}
        keyOf={(v) => v.id}
        caption="Published versions of the Points issuance configuration"
        pageSize={0}
        empty={{ title: "No published versions yet", description: "The first publication will appear here." }}
        footnote="A rollback is itself a publication: it needs an effective date and a second approver, and it appears as a new version above the one it reverts to."
      />

      <Panel
        icon={<Sparkles />}
        title="Why Points issuance is capped at all"
        description="The caps here are the first line of defence against the two failure modes that break the economy."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border-subtle bg-surface-inset p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <AlertTriangle className="size-4 text-warning-400" />
              Farming
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
              Automated or repetitive play that produces Points without producing revenue. Session and
              daily caps bound the damage; the fraud engine catches the velocity pattern.
            </p>
          </div>
          <div className="rounded-xl border border-border-subtle bg-surface-inset p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Info className="size-4 text-info-400" />
              Dilution
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
              Points are claims on a conversion rate, not on the Treasury. Issuing more Points without
              more revenue moves the rate, not the payout — which is why issuance and the conversion
              rate are governed together.
            </p>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
          <DetailRow label="Cap reset" value="00:00 UTC daily" />
          <DetailRow label="Session ceiling policy" value={`${Math.round(SESSION_SHARE * 100)}% of the daily cap`} />
          <DetailRow label="Server-side validation" value="Every session result is signed and re-verified" />
          <DetailRow label="Retroactive revaluation" value="Not possible by design" />
        </div>
      </Panel>

      {/* ---------------------------- publish flow ------------------------ */}
      <FourEyesModal
        open={publish}
        onClose={() => setPublish(false)}
        onSubmit={(s) => {
          setPublish(false);
          setDraft({ points: {}, dailyCap: {}, sessionCap: {}, enabled: {} });
          toast.success(
            "Draft submitted for approval",
            `Routed to ${s.secondApprover}. It goes live at the scheduled time only after they approve.`,
          );
        }}
        title="Publish Points configuration"
        description={`${dirtyCount} change${dirtyCount > 1 ? "s" : ""} in this draft version`}
        submitLabel="Schedule publication"
        icon={<CalendarClock className="size-5" />}
        blocked={!effectiveAt || dateInPast}
        blockedTitle={!effectiveAt ? "A scheduled effective date is required" : "Effective date must be in the future"}
        blockedMessage={
          !effectiveAt
            ? "Issuance rules cannot be applied immediately or retroactively. Choose a future date and time so members can be told before their earning rate changes."
            : "Pick a time at least a few hours ahead. Applying a rate change to sessions already played is not permitted."
        }
        reasonLabel="Reason for this configuration change"
        reasonHint="Recorded on the version. Explain what economic problem this rate or cap change solves."
        acknowledgement={
          <span>
            I confirm this version takes effect only from the scheduled time, that sessions played
            before then settle at the previous rates, and that members whose earning rate decreases
            will be notified in advance.
          </span>
        }
      >
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium text-text-secondary">
              Effective from <span className="text-[var(--accent)]">*</span>
            </span>
            <input
              type="datetime-local"
              value={effectiveAt}
              onChange={(e) => setEffectiveAt(e.target.value)}
              className="tnum h-11 w-full rounded-xl border border-border-default bg-surface-3 px-3.5 text-sm text-text-primary focus:border-[var(--accent)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-soft)]"
            />
            <span className="block text-xs text-text-muted">
              Stored and evaluated in UTC. The version is inert until this moment passes.
            </span>
          </label>

          <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
            <DetailRow label="Changes in this version" value={<span className="tnum">{dirtyCount}</span>} />
            <DetailRow
              label="Games affected"
              value={
                <span className="tnum">
                  {new Set([
                    ...Object.keys(draft.points).map((k) => k.split("::")[0]),
                    ...Object.keys(draft.dailyCap),
                    ...Object.keys(draft.sessionCap),
                    ...Object.keys(draft.enabled),
                  ]).size}
                </span>
              }
            />
            <DetailRow label="Rollback target" value={versions[0]?.id ?? "—"} />
          </div>
        </div>
      </FourEyesModal>

      <ConfirmDialog
        open={!!rollback}
        onClose={() => setRollback(null)}
        onConfirm={() => {
          const v = rollback;
          setRollback(null);
          toast.toast({
            tone: "info",
            title: `Rollback to ${v} prepared`,
            description: "Set an effective date and route it for approval to complete the rollback.",
          });
        }}
        title={`Roll back to ${rollback ?? ""}?`}
        confirmLabel="Prepare rollback"
        requireAcknowledge={
          <Callout tone="info" title="A rollback is a forward publication" icon={<CheckCircle2 />}>
            <p className="mt-1">
              The older rule set is re-published as a new version with its own effective date and
              approver. Nothing is deleted, and sessions played under the intervening version keep the
              Points they were awarded.
            </p>
          </Callout>
        }
      >
        <p>
          This loads the {rollback} rule set into the draft editor so you can review it before
          scheduling. It does not change live issuance on its own.
        </p>
      </ConfirmDialog>
    </div>
  );
}
