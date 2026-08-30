import { AppShell } from "@/components/layout";
import { DeferredWeb3Provider } from "@/components/web3/deferred-web3-provider";
import { adminNav } from "@/lib/nav";
import { RequireStaff } from "@/lib/auth/guard";

/**
 * The back-office.
 *
 * `RequireStaff` sends a signed-in member to the player app rather than to login:
 * they are not unauthenticated, they are in the wrong place, and asking them to
 * sign in again is a dead end they cannot escape.
 *
 * Every admin route is separately guarded server-side by role AND by permission,
 * and the permission strings the server checks are the ones `/admin/me` reports —
 * so a hidden button and a 403 cannot disagree.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <DeferredWeb3Provider>
      <AppShell nav={adminNav} variant="admin">
        <RequireStaff>{children}</RequireStaff>
      </AppShell>
    </DeferredWeb3Provider>
  );
}
