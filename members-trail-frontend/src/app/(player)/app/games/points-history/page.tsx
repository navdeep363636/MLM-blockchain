/* G-06 · Points Earning History — FRD 5.4 */

import { PageHeader } from "@/components/layout";
import { PointsHistoryView } from "./_components/points-history-view";

export const metadata = { title: "Points history" };

export default function PointsHistoryPage() {
  return (
    <>
      <PageHeader
        title="Points history"
        description="Every Point you've earned and every conversion out, with a running balance. Exportable for your own records."
        breadcrumb={[{ label: "Play", href: "/app/games" }, { label: "Points history" }]}
      />
      <PointsHistoryView />
    </>
  );
}
