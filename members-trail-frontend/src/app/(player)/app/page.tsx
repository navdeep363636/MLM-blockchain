/* D-01 · Player dashboard home — FRD 5.3 */

import { PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui";
import { DashboardActions, DashboardView } from "./_components/dashboard-view";

export const metadata = { title: "Dashboard" };

export default function PlayerDashboardPage() {
  return (
    <>
      <PageHeader
        title="Your dashboard"
        description="Points, MTT, staking and referral position in one place — every figure read live from the ledger, with the caps and funding rules that apply to it shown alongside."
        breadcrumb={[{ label: "Player", href: "/app" }, { label: "Dashboard" }]}
        badge={<Badge tone="brand" dot>Live balances</Badge>}
        actions={<DashboardActions />}
      />
      <DashboardView />
    </>
  );
}
