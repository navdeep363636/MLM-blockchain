import { AppShell } from "@/components/layout";
import { playerNav } from "@/lib/nav";

export default function PlayerLayout({ children }: { children: React.ReactNode }) {
  return <AppShell nav={playerNav} variant="player">{children}</AppShell>;
}
