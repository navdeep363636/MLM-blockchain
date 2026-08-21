/* G-05 · Achievements / Quests — FRD 5.4 */

import { PageHeader } from "@/components/layout";
import { QuestsView } from "./_components/quests-view";

export const metadata = { title: "Quests & achievements" };

export default function QuestsPage() {
  return (
    <>
      <PageHeader
        title="Quests & achievements"
        description="Daily and weekly objectives plus lifetime milestones. Rewards draw on the same daily Points cap as gameplay."
        breadcrumb={[{ label: "Play", href: "/app/games" }, { label: "Quests & achievements" }]}
      />
      <QuestsView />
    </>
  );
}
