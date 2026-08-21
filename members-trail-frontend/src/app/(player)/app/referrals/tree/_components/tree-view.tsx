"use client";

import { useMemo, useState } from "react";
import {
  ChevronRight, EyeOff, Info, Minus, Plus, ShieldCheck, UserCheck, UserX, Users,
} from "lucide-react";
import {
  Badge, Button, Callout, LevelBadge, SegmentedControl, StatTile, EmptyState,
} from "@/components/ui";
import { useReferralSummary, useReferralTree } from "@/lib/hooks/use-data";
import { cn, formatToken, timeAgo } from "@/lib/utils";
import type { ReferralNode } from "@/types";

type LevelFilter = "all" | "1" | "2" | "3";

function flatten(nodes: ReferralNode[]): ReferralNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

function NodeRow({
  node, depth, levelFilter,
}: {
  node: ReferralNode;
  depth: number;
  levelFilter: LevelFilter;
}) {
  const [open, setOpen] = useState(depth === 0);
  const hasKids = node.children.length > 0;
  const visible = levelFilter === "all" || String(node.level) === levelFilter;

  // When filtering to a deeper level, keep ancestors rendered as pass-throughs
  // so the hierarchy still reads correctly.
  const showSelf = visible;

  return (
    <li>
      {showSelf && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-3 rounded-xl border border-border-subtle bg-surface-1 p-3.5 transition-colors hover:border-border-strong",
            depth > 0 && "ml-0",
          )}
        >
          <button
            onClick={() => setOpen((o) => !o)}
            disabled={!hasKids}
            aria-label={open ? "Collapse" : "Expand"}
            aria-expanded={open}
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-lg transition-colors",
              hasKids
                ? "bg-surface-3 text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                : "text-text-muted opacity-30",
            )}
          >
            {hasKids ? (open ? <Minus className="size-3.5" /> : <Plus className="size-3.5" />) : <ChevronRight className="size-3.5" />}
          </button>

          <span
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold",
              node.active ? "bg-accent-soft text-[var(--accent)]" : "bg-surface-3 text-text-muted",
            )}
          >
            {node.active ? <UserCheck className="size-4" /> : <UserX className="size-4" />}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-text-primary">{node.label}</p>
            <p className="mt-0.5 text-xs text-text-muted">
              Joined {timeAgo(node.joinedAt)} · {node.active ? "active" : "inactive"}
              {hasKids && ` · ${node.children.length} direct`}
            </p>
          </div>

          <LevelBadge level={node.level} />

          <span className="tnum shrink-0 text-right text-sm">
            <span className="block font-medium text-text-primary">
              ₹{formatToken(node.contributedCommission)}
            </span>
            <span className="block text-xs text-text-muted">contributed</span>
          </span>
        </div>
      )}

      {hasKids && open && (
        <ul className={cn("mt-2 space-y-2 border-l border-border-subtle pl-4", showSelf ? "ml-3.5" : "ml-0 border-l-0 pl-0")}>
          {node.children.map((c) => (
            <NodeRow key={c.id} node={c} depth={depth + 1} levelFilter={levelFilter} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TreeView() {
  const { data: tree, isLoading } = useReferralTree();
  const { data: summary } = useReferralSummary();
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");

  const all = useMemo(() => flatten(tree), [tree]);
  const activeCount = all.filter((n) => n.active).length;
  const contributed = all.reduce((s, n) => s + n.contributedCommission, 0);

  const levelStats = useMemo(
    () =>
      ([1, 2, 3] as const).map((lvl) => {
        const nodes = all.filter((n) => n.level === lvl);
        return {
          level: lvl,
          count: nodes.length,
          active: nodes.filter((n) => n.active).length,
          contributed: nodes.reduce((s, n) => s + n.contributedCommission, 0),
        };
      }),
    [all],
  );

  return (
    <>
      <Callout tone="info" title="You see aggregates, never another member's details" icon={<EyeOff />} className="mb-5">
        <p className="mt-1">
          Every node below is anonymised — a member reference, a join date, an activity flag and the
          aggregate commission their spending has generated for you. You never see anyone&apos;s name,
          contact details, balances or individual transactions. That is a privacy requirement, not an
          interface limitation.
        </p>
      </Callout>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total downline" value={all.length} icon={<Users />} deltaLabel={`Across ${levelStats.filter((l) => l.count > 0).length} levels`} compact />
        <StatTile label="Direct referrals" value={summary.directCount} icon={<UserCheck />} deltaLabel="Level 1 members" compact />
        <StatTile label="Active members" value={activeCount} icon={<ShieldCheck />} deltaLabel={`${all.length - activeCount} inactive`} compact />
        <StatTile label="Contributed to you" value={contributed} decimals={2} prefix="₹" icon={<Users />} deltaLabel="Aggregate across the network" compact />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {levelStats.map((l) => (
          <div key={l.level} className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-4">
            <div className="flex items-center justify-between gap-2">
              <LevelBadge level={l.level} />
              <span className="tnum text-xs text-text-muted">
                {l.level === 1 ? "8%" : l.level === 2 ? "3%" : "1%"} of eligible spend
              </span>
            </div>
            <p className="tnum mt-3 font-display text-xl font-semibold text-text-primary">
              {l.count}
              <span className="ml-1.5 text-xs font-normal text-text-muted">members</span>
            </p>
            <p className="tnum mt-1 text-xs text-text-muted">
              {l.active} active · ₹{formatToken(l.contributed)} contributed
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text-primary">Network structure</h2>
        <SegmentedControl
          value={levelFilter}
          onValueChange={setLevelFilter}
          size="sm"
          options={[
            { value: "all", label: "All levels" },
            { value: "1", label: "Level 1" },
            { value: "2", label: "Level 2" },
            { value: "3", label: "Level 3" },
          ]}
        />
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="shimmer h-16 rounded-xl" />
          ))}
        </div>
      ) : tree.length === 0 ? (
        <EmptyState
          className="mt-4 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1"
          icon={<Users />}
          title="No referrals yet"
          description="Nothing about your account depends on this — gameplay and staking give you full access either way."
          action={{ label: "Back to referrals", href: "/app/referrals" }}
        />
      ) : (
        <ul className="mt-4 space-y-2">
          {tree.map((n) => (
            <NodeRow key={n.id} node={n} depth={0} levelFilter={levelFilter} />
          ))}
        </ul>
      )}

      <Callout tone="warning" title="Depth stops at three levels" icon={<Info />} className="mt-6">
        <p className="mt-1">
          There is no level 4, however large your network becomes. Deep multi-level structures are
          precisely what regulators look for when distinguishing a marketing bonus from an unlawful
          recruitment scheme, so the platform simply doesn&apos;t have one. Commission also requires a
          referred account to reach a minimum age and a minimum number of genuine gameplay sessions,
          which filters out bot-created downlines.
        </p>
      </Callout>
    </>
  );
}
