/* AD-08 · Revenue treasury management — FRD 5.9 */

import { PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui";
import { TreasuryActions, TreasuryView } from "./_components/treasury-view";

export const metadata = { title: "Revenue treasury" };

export default function AdminTreasuryPage() {
  return (
    <>
      <PageHeader
        title="Revenue treasury"
        description="Every rupee in, every token out. Outflows can never be approved for more than the reconciled inflow for the period — the funding form enforces it rather than warning about it."
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Finance" },
          { label: "Revenue treasury" },
        ]}
        badge={<Badge tone="critical" dot>Compliance backbone</Badge>}
        actions={<TreasuryActions />}
      />
      <TreasuryView />
    </>
  );
}
