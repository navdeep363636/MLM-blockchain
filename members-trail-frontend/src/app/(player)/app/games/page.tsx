/* G-01 · Game lobby / catalog — FRD 5.4 */

import { PageHeader } from "@/components/layout";
import { Badge, Button } from "@/components/ui";
import { GameLobby } from "./_components/lobby";

export const metadata = { title: "Game lobby" };

export default function GameLobbyPage() {
  return (
    <>
      <PageHeader
        title="Game lobby"
        description="Every playable title, the Points a session can credit, and how much of your daily cap is left on each one. Free mode earns at the same rate as paid entry — always."
        breadcrumb={[{ label: "Player", href: "/app" }, { label: "Play" }, { label: "Game lobby" }]}
        badge={<Badge tone="good" dot>Free play open</Badge>}
        actions={
          <>
            <Button href="/app/games/quests" variant="outline" size="sm">Quests</Button>
            <Button href="/app/games/tournaments" size="sm">Tournaments</Button>
          </>
        }
      />
      <GameLobby />
    </>
  );
}
