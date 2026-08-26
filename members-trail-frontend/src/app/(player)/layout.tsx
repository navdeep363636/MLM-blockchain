import { AppShell } from "@/components/layout";
import { playerNav } from "@/lib/nav";
import { RequireAuth } from "@/lib/auth/guard";

/**
 * The member area.
 *
 * `RequireAuth` sits inside the shell rather than around it, so the chrome — nav,
 * header, theme — paints immediately and only the content area waits on the
 * session check. Wrapping the shell instead makes every reload look like a blank
 * page for as long as the refresh call takes.
 *
 * The guard is convenience, not security: every request inside is authorised on
 * the server, so deleting this wrapper would change what a signed-out visitor
 * SEES, not what they can read.
 */
export default function PlayerLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell nav={playerNav} variant="player">
      <RequireAuth>{children}</RequireAuth>
    </AppShell>
  );
}
