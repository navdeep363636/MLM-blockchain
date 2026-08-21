/* G-04 · Leaderboard — FRD 5.4 */

import { PageHeader } from "@/components/layout";
import { LeaderboardView } from "./_components/leaderboard-view";

export const metadata = { title: "Leaderboards" };

export default function LeaderboardPage() {
  return (
    <>
      <PageHeader
        title="Leaderboards"
        description="Global and friends boards by Points, MTT staked and tournament wins. Same board, same rules, same seed for everyone."
        breadcrumb={[{ label: "Play", href: "/app/games" }, { label: "Leaderboards" }]}
      />
      <LeaderboardView />
    </>
  );
}
