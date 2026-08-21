/* G-03 · Tournament Hub — FRD 5.4 */

import { Trophy } from "lucide-react";
import { Button } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { TournamentsView } from "./_components/tournaments-view";

export const metadata = { title: "Tournaments" };

export default function TournamentsPage() {
  return (
    <>
      <PageHeader
        title="Tournaments"
        description="Skill-based events with published prize splits. Format, scoring and distribution are always disclosed before you pay anything."
        breadcrumb={[{ label: "Play", href: "/app/games" }, { label: "Tournaments" }]}
        actions={
          <Button href="/app/games" variant="outline" size="sm" icon={<Trophy className="size-4" />}>
            Game lobby
          </Button>
        }
      />
      <TournamentsView />
    </>
  );
}
