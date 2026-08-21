/* AD-10 · Reports & analytics — FRD 5.9 */

import { PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui";
import { ReportsActions, ReportsView } from "./_components/reports-view";

export const metadata = { title: "Reports & analytics" };

export default function AdminReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports & analytics"
        description="Five standing templates for finance, compliance and growth, each rendering live data — plus a custom builder for everything else."
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Finance" },
          { label: "Reports & analytics" },
        ]}
        badge={<Badge tone="info" dot>Warehouse-backed</Badge>}
        actions={<ReportsActions />}
      />
      <ReportsView />
    </>
  );
}
