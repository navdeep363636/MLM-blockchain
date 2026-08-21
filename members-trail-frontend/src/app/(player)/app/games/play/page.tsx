/* G-02 · Gameplay screen — FRD 5.4 */

import { Suspense } from "react";
import { PageHeader } from "@/components/layout";
import { Badge, Button, SkeletonCard } from "@/components/ui";
import { GameplayScreen } from "./_components/gameplay";

export const metadata = { title: "Play" };

export default function GameplayPage() {
  return (
    <>
      <PageHeader
        title="Play"
        description="Free-mode play with a live score and session timer. Points are credited only after the server validates the signed session result — never from a score reported by your browser."
        breadcrumb={[
          { label: "Player", href: "/app" },
          { label: "Play", href: "/app/games" },
          { label: "Session" },
        ]}
        badge={<Badge tone="good" dot>No entry fee</Badge>}
        actions={
          <>
            <Button href="/app/games" variant="outline" size="sm">Game lobby</Button>
            <Button href="/app/games/leaderboard" size="sm">Leaderboard</Button>
          </>
        }
      />
      <Suspense
        fallback={
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <SkeletonCard className="h-[26rem]" />
            <SkeletonCard className="h-[26rem]" />
          </div>
        }
      >
        <GameplayScreen />
      </Suspense>
    </>
  );
}
