"use client";

/* ============================================================================
 * Route guards.
 *
 * These are a CONVENIENCE, not a security boundary. Every guard here does one
 * thing: it stops a signed-out visitor staring at a skeleton that will never
 * fill in, and it keeps a member out of a back-office shell whose every request
 * would 403. The actual authorisation happens on the server, per request, and
 * would still hold if someone deleted this file from the bundle.
 *
 * Saying that plainly matters, because a guard that reads like a security
 * control invites the next person to skip the server-side check "since the route
 * is protected".
 * ========================================================================== */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./auth-context";

/** Full-bleed placeholder for the moment before we know who is here. */
function Resolving({ label }: { label: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <div className="size-6 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
        <p className="text-sm text-[var(--text-muted)]">{label}</p>
      </div>
    </div>
  );
}

/**
 * Requires a signed-in member.
 *
 * The redirect carries the path being attempted so login can return there. Doing
 * that with a query parameter rather than session state means it survives the
 * user opening the link in a new tab, which is how people actually arrive at a
 * deep link from an email.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { phase } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (phase === "anonymous") {
      const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
      router.replace(`/login${next}`);
    }
  }, [phase, pathname, router]);

  if (phase === "loading") return <Resolving label="Checking your session…" />;
  if (phase === "anonymous") return <Resolving label="Redirecting to sign in…" />;
  return <>{children}</>;
}

/**
 * Requires a staff account.
 *
 * A signed-in member who lands here is sent to the player app rather than to
 * login — they are not unauthenticated, they are in the wrong place, and asking
 * them to sign in again would be a dead end they cannot escape.
 */
export function RequireStaff({ children }: { children: React.ReactNode }) {
  const { phase, isStaff } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (phase === "anonymous") {
      const next = pathname ? `?next=${encodeURIComponent(pathname)}` : "";
      router.replace(`/login${next}`);
      return;
    }
    if (phase === "authenticated" && !isStaff) router.replace("/app");
  }, [phase, isStaff, pathname, router]);

  if (phase === "loading") return <Resolving label="Checking your access…" />;
  if (phase === "anonymous" || !isStaff) return <Resolving label="Redirecting…" />;
  return <>{children}</>;
}

/**
 * For the auth pages themselves: sends an already-signed-in visitor onward.
 *
 * Without this, following a bookmarked /login while signed in shows a login form
 * that appears to work and then dumps the user back where they already were.
 */
export function RedirectIfAuthenticated({ children }: { children: React.ReactNode }) {
  const { phase, isStaff } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (phase === "authenticated") router.replace(isStaff ? "/admin" : "/app");
  }, [phase, isStaff, router]);

  if (phase === "loading") return <Resolving label="One moment…" />;
  return <>{children}</>;
}
