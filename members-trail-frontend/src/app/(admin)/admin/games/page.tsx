/* AD-04 · Game & Points configuration — FRD 5.9 */

import { PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui";
import { GamesActions, GamesView } from "./_components/games-view";

export const metadata = { title: "Games & Points configuration" };

export default function AdminGamesPage() {
  return (
    <>
      <PageHeader
        title="Games & Points configuration"
        description="Points issued per action, per game, with daily and session caps per user. Changes are versioned, scheduled for a future effective date, and never applied retroactively."
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Configuration" },
          { label: "Games & points" },
        ]}
        badge={<Badge tone="info" dot>Versioned config</Badge>}
        actions={<GamesActions />}
      />
      <GamesView />
    </>
  );
}
