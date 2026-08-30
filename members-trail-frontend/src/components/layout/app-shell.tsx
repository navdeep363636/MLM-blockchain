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
import { MockDataBanner } from "@/components/web3/mock-data-banner";
import { ShellWalletButton, ShellNetworkGuard } from "@/components/web3/shell-wallet";
import { useCurrentUser, useNotifications } from "@/lib/hooks/use-data";
import { MeshHaze, PageTransition } from "@/components/fx";
import { NavLink } from "./nav-link";
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
      <NavLink
        href={it.href}
        active={active}
        onNavigate={onNavigate}
        /* The whole sidebar is in the viewport at load. See NavLinkProps.prefetch. */
        prefetch={false}
        title={collapsed ? it.label : undefined}
        className={cn(
          "group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium",
          "transition-[background-color,color,box-shadow,transform] duration-[var(--dur-quick)] ease-[var(--ease-tide)]",
          "text-text-muted hover:translate-x-0.5 hover:bg-surface-2 hover:text-text-primary",
          collapsed && "justify-center px-0",
        )}
        activeClassName={cn(
          "bg-accent-soft text-[var(--accent-hover)] ring-1 ring-inset ring-[var(--accent-ring)]",
          "[box-shadow:inset_0_1px_0_0_var(--rim-light)] hover:translate-x-0",
        )}
        indicatorClassName="ml-auto"
      >
        <span
          aria-hidden
          className={cn(
            "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-[var(--accent)]",
            "opacity-0 shadow-[0_0_10px_1px_var(--accent-ring)] transition-opacity duration-[var(--dur-quick)]",
            "group-data-[active]:opacity-100",
          )}
        />
        <Icon className="size-4 shrink-0" />
        {!collapsed && it.label}
      </NavLink>
    );
  }

  if (collapsed) {
    return (
      <div className="space-y-1">
        {group.items.map((it) => {
          const active = pathname === it.href;
          return (
            <NavLink
              key={it.href}
              href={it.href}
              active={active}
              title={it.label}
              onNavigate={onNavigate}
              prefetch={false}
              showIndicator={false}
              className="flex items-center justify-center rounded-xl py-2.5 text-text-muted transition-colors hover:bg-surface-2"
              activeClassName="bg-accent-soft text-[var(--accent-hover)]"
            >
              <Icon className="size-4" />
            </NavLink>
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
                    {/* NavLink takes the active treatment on click rather than
                        when the route commits, so the highlight tracks the
                        pointer instead of the network. */}
                    <NavLink
                      href={it.href}
                      active={active}
                      onNavigate={onNavigate}
                      prefetch={false}
                      className={cn(
                        "group relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm",
                        "transition-[background-color,color,transform] duration-[var(--dur-quick)] ease-[var(--ease-tide)]",
                        "text-text-muted hover:translate-x-0.5 hover:bg-surface-2 hover:text-text-secondary",
                      )}
                      activeClassName="bg-accent-soft font-medium text-[var(--accent-hover)] hover:translate-x-0"
                      indicatorClassName="ml-auto"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "absolute -left-[calc(0.75rem+1px)] top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[var(--accent)]",
                          "opacity-0 shadow-[0_0_8px_1px_var(--accent-ring)] transition-opacity duration-[var(--dur-quick)]",
                          "group-data-[active]:opacity-100",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    </NavLink>
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
    <div className="relative flex h-full flex-col">
      {/* A very faint haze behind the sidebar. It is the only thing separating
          a 260px column of links from a grey rectangle, and it costs one
          absolutely-positioned div. */}
      <MeshHaze opacity={0.16} />
      <div className={cn("relative flex h-16 shrink-0 items-center gap-2 border-b border-border-subtle px-4", collapsed && "justify-center px-2")}>
        <Logo compact={collapsed} />
        {!collapsed && variant === "admin" && (
          <Badge tone="brand" className="ml-auto">Admin</Badge>
        )}
      </div>

      <nav className={cn("relative flex-1 space-y-1 overflow-y-auto p-3", collapsed && "px-2")} aria-label="Dashboard">
        {nav.map((g) => (
          <NavSection key={g.label} group={g} pathname={pathname} onNavigate={onNavigate} collapsed={collapsed} />
        ))}
      </nav>

      {!collapsed && (
        <div className="relative shrink-0 border-t border-border-subtle p-3">
          <div className="rounded-xl border border-border-subtle bg-surface-2 p-3 [box-shadow:inset_0_1px_0_0_var(--rim-light),var(--shadow-e1)]">
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
        className="relative hidden shrink-0 items-center gap-2 border-t border-border-subtle px-4 py-3 text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary lg:flex"
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
          "fixed inset-y-0 left-0 z-40 hidden overflow-hidden border-r border-border-subtle bg-surface-1 lg:block",
          "transition-[width] duration-[var(--dur-base)] ease-[var(--ease-tide)]",
          /* The sidebar is the nearest surface on the page, so it carries the
             page's only vertical rim light and a shadow cast rightward onto
             the content. That single edge is what makes the layout read as two
             planes rather than two background colours. */
          "[box-shadow:inset_-1px_0_0_0_var(--rim-light),8px_0_32px_-24px_rgb(0_0_0_/_0.8)]",
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
              className="absolute inset-0 bg-[radial-gradient(120%_100%_at_0%_50%,rgb(0_0_0_/_0.5),rgb(0_0_0_/_0.78))] backdrop-blur-md"
            />
            <motion.aside
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
              transition={{ duration: 0.38, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-y-0 left-0 w-[17rem] overflow-hidden border-r border-border-default bg-surface-1 [box-shadow:var(--shadow-e5),inset_-1px_0_0_0_var(--rim-light)]"
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
        <ShellNetworkGuard />
        <MockDataBanner />

        <header
          className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border-subtle px-4 sm:px-6
                     bg-[color-mix(in_oklab,var(--surface-0)_78%,transparent)] backdrop-blur-xl backdrop-saturate-150
                     [box-shadow:inset_0_1px_0_0_var(--rim-light),0_10px_30px_-24px_rgb(0_0_0_/_0.9)]"
        >
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="grid size-10 shrink-0 place-items-center rounded-xl text-text-secondary transition-colors hover:bg-surface-2 lg:hidden"
          >
            <Menu className="size-5" />
          </button>

          {title && <h1 className="truncate font-display text-base font-semibold tracking-tight text-text-primary">{title}</h1>}

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <button
              aria-label="Search"
              className="hidden size-10 place-items-center rounded-xl text-text-muted transition-[background-color,color,box-shadow] duration-[var(--dur-quick)] hover:bg-surface-2 hover:text-text-primary hover:[box-shadow:inset_0_1px_0_0_var(--rim-light)] sm:grid"
            >
              <Search className="size-4" />
            </button>

            <Link
              href={variant === "admin" ? "/admin/tickets" : "/app/notifications"}
              aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
              className="relative grid size-10 place-items-center rounded-xl text-text-muted transition-[background-color,color,box-shadow] duration-[var(--dur-quick)] hover:bg-surface-2 hover:text-text-primary hover:[box-shadow:inset_0_1px_0_0_var(--rim-light)]"
            >
              <Bell className="size-4" />
              {unread > 0 && (
                <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold leading-4 text-white shadow-[0_0_10px_1px_var(--accent-ring)]">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>

            <ThemeToggle />

            <div className="hidden sm:block">
              <ShellWalletButton compact />
            </div>

            <Dropdown
              align="end"
              trigger={
                <span className="grid place-items-center rounded-full ring-2 ring-transparent transition-[box-shadow,transform] duration-[var(--dur-quick)] ease-[var(--ease-tide)] hover:-translate-y-px hover:ring-[var(--accent-ring)] hover:[box-shadow:0_6px_18px_-8px_var(--accent-ring)]">
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

        {/* `scene` here, once, gives every card on every dashboard route a
            shared vanishing point — which is why cards in a grid tilt as one
            object rather than each about its own centre.

            No `key={pathname}`: it remounted the whole page subtree on every
            navigation, including same-page search-param changes where nothing
            below needed rebuilding. See PageTransition. */}
        <main id="main" className="scene relative mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6 sm:py-8">
          <PageTransition>{children}</PageTransition>
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
      {/* A lit hairline under every page header. It is the one element that
          makes 67 different screens feel like one product. */}
      <div aria-hidden className="divider-glow mt-5 opacity-50" />
    </div>
  );
}
