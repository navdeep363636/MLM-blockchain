/* AD-07 · Referral / commission configuration — FRD 5.9, 7 */

import { PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui";
import { CommissionActions, CommissionView } from "./_components/commission-view";

export const metadata = { title: "Referral & commission configuration" };

export default function AdminCommissionPage() {
  return (
    <>
      <PageHeader
        title="Referral & commission configuration"
        description="Level rates, eligible revenue events, caps and eligibility gates — with a simulator that must project a sustainable plan before any change can be published."
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Configuration" },
          { label: "Referral & commission" },
        ]}
        badge={<Badge tone="warning" dot>Simulator gated</Badge>}
        actions={<CommissionActions />}
      />
      <CommissionView />
    </>
  );
}
