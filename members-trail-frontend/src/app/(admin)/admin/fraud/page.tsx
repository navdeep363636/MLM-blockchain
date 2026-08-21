/* AD-09 · Transaction monitoring & fraud alerts — FRD 5.9 */

import { PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui";
import { FraudActions, FraudView } from "./_components/fraud-view";

export const metadata = { title: "Fraud alerts" };

export default function AdminFraudPage() {
  return (
    <>
      <PageHeader
        title="Transaction monitoring & fraud alerts"
        description="Circular referral rings, multi-account creation from one device or IP, Points-farming velocity and structuring — each alert shows the signals that fired, not just a score."
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Users & compliance" },
          { label: "Fraud alerts" },
        ]}
        badge={<Badge tone="critical" dot>Monitoring live</Badge>}
        actions={<FraudActions />}
      />
      <FraudView />
    </>
  );
}
