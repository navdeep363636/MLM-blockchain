"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell, ChevronRight, Coins, Cog, Gamepad2, Landmark, LayoutDashboard, LogOut,
  Menu, PanelLeftClose, Search, Settings, ShieldCheck, SlidersHorizontal, User as UserIcon,
  Users, Wallet, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavGroup } from "@/lib/nav";
import { Avatar, Badge, Dropdown, KycBadge } from "@/components/ui";
import { WalletConnectButton, MockDataBanner, NetworkGuard } from "@/components/web3";
import { useCurrentUser, useNotifications } from "@/lib/hooks/use-data";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";

const ICONS = {
  LayoutDashboard, Gamepad2, Wallet, Coins, Users, Settings,
  ShieldCheck, SlidersHorizontal, Landmark, Cog,
} as const;

function NavSection({
  group, pathname, onNavigate, collapsed,
}: {
  group: NavGroup;
  pathname: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const Icon = ICONS[group.icon as keyof typeof ICONS] ?? LayoutDashboard;
  const hasActive = group.items.some((i) => pathname === i.href);
  const [open, setOpen] = useState(hasActive || group.items.length === 1);

  useEffect(() => { if (hasActive) setOpen(true); }, [hasActive]);

  // Single-item groups render as a plain link (Dashboard).
  if (group.items.length === 1) {
    const it = group.items[0];
    const active = pathname === it.href;
    return (
      <Link
        href={it.href}
        onClick={onNavigate}
        title={collapsed ? it.label : undefined}
        className={cn(
          "group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
          active
            ? "bg-accent-soft text-[var(--accent-hover)]"
            : "text-text-muted hover:bg-surface-2 hover:text-text-primary",
          collapsed && "justify-center px-0",
        )}
      >
        {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-[var(--accent)]" />}
        <Icon className="size-4 shrink-0" />
        {!collapsed && it.label}
      </Link>
    );
  }

  if (collapsed) {
    return (
      <div className="space-y-1">
        {group.items.map((it) => {
          const active = pathname === it.href;
          return (
            <Link
              key={it.href}
              href={it.href}
              title={it.label}
              onClick={onNavigate}
              className={cn(
                "flex items-center justify-center rounded-xl py-2.5 transition-colors",
                active ? "bg-accent-soft text-[var(--accent-hover)]" : "text-text-muted hover:bg-surface-2",
              )}
            >
              <Icon className="size-4" />
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
          hasActive ? "text-text-primary" : "text-text-muted hover:text-text-primary",
        )}
      >
        <Icon className="size-4 shrink-0" />
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronRight className={cn("size-3.5 transition-transform duration-300", open && "rotate-90")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="ml-[1.45rem] space-y-0.5 border-l border-border-subtle pl-3 pt-0.5">
              {group.items.map((it) => {
                const active = pathname === it.href;
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      onClick={onNavigate}
                      className={cn(
                        "relative block rounded-lg px-2.5 py-2 text-sm transition-all duration-200",
                        active
                          ? "bg-accent-soft font-medium text-[var(--accent-hover)]"
                          : "text-text-muted hover:bg-surface-2 hover:text-text-secondary",
                      )}
                    >
                      {active && (
                        <span className="absolute -left-[calc(0.75rem+1px)] top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[var(--accent)]" />
                      )}
                      {it.label}
                    </Link>
                  </li>
                );
              })}
            </div>
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Shared dashboard chrome for both the player app and the admin panel.
 * `variant` only changes the badge and the account menu — the layout, the
 * collapse behaviour and the mobile drawer are identical, by design.
 */
export function AppShell({
  nav, children, variant = "player", title,
}: {
  nav: NavGroup[];
  children: React.ReactNode;
  variant?: "player" | "admin";
  title?: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { data: user } = useCurrentUser();
  const { data: notifications } = useNotifications();
  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => setMobileOpen(false), [pathname]);

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-16 shrink-0 items-center gap-2 border-b border-border-subtle px-4", collapsed && "justify-center px-2")}>
        <Logo compact={collapsed} />
        {!collapsed && variant === "admin" && (
          <Badge tone="brand" className="ml-auto">Admin</Badge>
        )}
      </div>

      <nav className={cn("flex-1 space-y-1 overflow-y-auto p-3", collapsed && "px-2")} aria-label="Dashboard">
        {nav.map((g) => (
          <NavSection key={g.label} group={g} pathname={pathname} onNavigate={onNavigate} collapsed={collapsed} />
        ))}
      </nav>

      {!collapsed && (
        <div className="shrink-0 border-t border-border-subtle p-3">
          <div className="rounded-xl bg-surface-2 p-3">
            <div className="flex items-center gap-2.5">
              <Avatar name={user.displayName} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">{user.displayName}</p>
                <p className="truncate text-xs text-text-muted">{user.id}</p>
              </div>
            </div>
            {variant === "player" && <KycBadge tier={user.kycTier} className="mt-2.5" />}
          </div>
        </div>
      )}

      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="hidden shrink-0 items-center gap-2 border-t border-border-subtle px-4 py-3 text-xs text-text-muted transition-colors hover:text-text-primary lg:flex"
      >
        <PanelLeftClose className={cn("size-4 transition-transform duration-300", collapsed && "rotate-180")} />
        {!collapsed && "Collapse"}
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh bg-surface-0">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden border-r border-border-subtle bg-surface-1 transition-[width] duration-300 lg:block",
          collapsed ? "w-[4.5rem]" : "w-[16.5rem]",
        )}
      >
        {sidebar()}
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-[95] lg:hidden">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-y-0 left-0 w-[17rem] border-r border-border-default bg-surface-1"
            >
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="absolute right-3 top-4 z-10 grid size-8 place-items-center rounded-lg text-text-muted hover:bg-surface-2"
              >
                <X className="size-4" />
              </button>
              {sidebar(() => setMobileOpen(false))}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <div className={cn("transition-[padding] duration-300", collapsed ? "lg:pl-[4.5rem]" : "lg:pl-[16.5rem]")}>
        <NetworkGuard />
        <MockDataBanner />

        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border-subtle bg-surface-0/85 px-4 backdrop-blur-xl sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="grid size-10 shrink-0 place-items-center rounded-xl text-text-secondary transition-colors hover:bg-surface-2 lg:hidden"
          >
            <Menu className="size-5" />
          </button>

          {title && <h1 className="truncate text-base font-semibold text-text-primary">{title}</h1>}

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <button
              aria-label="Search"
              className="hidden size-10 place-items-center rounded-xl text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary sm:grid"
            >
              <Search className="size-4" />
            </button>

            <Link
              href={variant === "admin" ? "/admin/tickets" : "/app/notifications"}
              aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
              className="relative grid size-10 place-items-center rounded-xl text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
            >
              <Bell className="size-4" />
              {unread > 0 && (
                <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold leading-4 text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>

            <ThemeToggle />

            <div className="hidden sm:block">
              <WalletConnectButton compact />
            </div>

            <Dropdown
              align="end"
              trigger={
                <span className="grid place-items-center rounded-full ring-2 ring-transparent transition-all hover:ring-[var(--accent-ring)]">
                  <Avatar name={user.displayName} size="sm" />
                </span>
              }
              items={
                variant === "admin"
                  ? [
                      { label: "Audit log", icon: <ShieldCheck />, href: "/admin/audit" },
                      { label: "Roles & permissions", icon: <Cog />, href: "/admin/roles" },
                      { label: "Player view", icon: <UserIcon />, href: "/app", separatorBefore: true },
                      { label: "Sign out", icon: <LogOut />, href: "/login", tone: "danger" },
                    ]
                  : [
                      { label: "Profile & settings", icon: <UserIcon />, href: "/app/settings" },
                      { label: "Security", icon: <ShieldCheck />, href: "/app/settings/security" },
                      { label: "Support", icon: <Cog />, href: "/app/support" },
                      { label: "Admin panel", icon: <SlidersHorizontal />, href: "/admin", separatorBefore: true },
                      { label: "Sign out", icon: <LogOut />, href: "/login", tone: "danger" },
                    ]
              }
            />
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/** Standard page header inside the dashboard shell. */
export function PageHeader({
  title, description, actions, breadcrumb, badge, className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: { label: string; href?: string }[];
  badge?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6", className)}>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
          {breadcrumb.map((b, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="size-3 opacity-50" />}
              {b.href ? (
                <Link href={b.href} className="transition-colors hover:text-text-secondary">{b.label}</Link>
              ) : (
                <span className="text-text-secondary">{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">{title}</h1>
            {badge}
          </div>
          {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
