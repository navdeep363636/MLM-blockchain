"use client";

/* QuickActions — the FRD's Play / Convert / Stake / Refer / Withdraw row.
 * Every tile is a real link into the module that owns the action. */

import Link from "next/link";
import { ArrowLeftRight, Banknote, Coins, Gamepad2, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuickAction {
  label: string;
  href: string;
  icon: React.ReactNode;
  hint: string;
  primary?: boolean;
}

const ACTIONS: QuickAction[] = [
  {
    label: "Play",
    href: "/app/games",
    icon: <Gamepad2 />,
    hint: "Free mode, always open",
    primary: true,
  },
  { label: "Convert", href: "/app/wallet/convert", icon: <ArrowLeftRight />, hint: "Points to MTT" },
  { label: "Stake", href: "/app/staking", icon: <Coins />, hint: "Variable, revenue-funded" },
  { label: "Refer", href: "/app/referrals", icon: <Users />, hint: "Optional and free" },
  { label: "Withdraw", href: "/app/wallet/withdraw", icon: <Banknote />, hint: "KYC tier applies" },
];

export function QuickActions({ className }: { className?: string }) {
  return (
    <nav aria-label="Quick actions" className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5", className)}>
      {ACTIONS.map((action) => (
        <Link
          key={action.label}
          href={action.href}
          className={cn(
            "group flex items-center gap-3 rounded-[var(--radius-card)] border px-4 py-3.5 transition-all duration-300",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
            "hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-24px_rgba(0,0,0,0.7)]",
            action.primary
              ? "border-[var(--accent-ring)] bg-[linear-gradient(150deg,var(--accent-soft),transparent_65%)] hover:border-[var(--accent)]"
              : "border-border-subtle bg-surface-1 hover:border-[color-mix(in_oklab,var(--accent)_38%,var(--border-default))]",
          )}
        >
          <span
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-xl transition-colors [&>svg]:size-4.5",
              action.primary
                ? "bg-[var(--accent)] text-white"
                : "bg-accent-soft text-[var(--accent)] group-hover:bg-[var(--accent)] group-hover:text-white",
            )}
          >
            {action.icon}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-text-primary">{action.label}</span>
            <span className="block truncate text-[11px] text-text-muted">{action.hint}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
