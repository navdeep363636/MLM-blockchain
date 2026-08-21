/* AD-01 · Admin dashboard (KPIs) — FRD 5.9 */

import { PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui";
import { DashboardActions, DashboardView } from "./_components/dashboard-view";

export const metadata = { title: "Admin dashboard" };

export default function AdminDashboardPage() {
  return (
    <>
      <PageHeader
        title="Operations dashboard"
        description="Real-time operational overview. Every KPI drills through to the records behind it, and the payout-to-inflow ratio is flagged the moment it approaches its ceiling."
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Dashboard" }]}
        badge={<Badge tone="brand" dot>Live</Badge>}
        actions={<DashboardActions />}
      />
      <DashboardView />
    </>
  );
}
