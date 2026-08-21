/* AD-03 · KYC / AML review queue — FRD 5.9 */

import { PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui";
import { KycActions, KycView } from "./_components/kyc-view";

export const metadata = { title: "KYC / AML review queue" };

export default function AdminKycPage() {
  return (
    <>
      <PageHeader
        title="KYC / AML review queue"
        description="Compliance officers review submissions the automated provider would not decide. Every decision carries the reviewing officer's identity and is retained for the AML record-keeping period."
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Users & compliance" },
          { label: "KYC / AML queue" },
        ]}
        badge={<Badge tone="warning" dot>Regulated workflow</Badge>}
        actions={<KycActions />}
      />
      <KycView />
    </>
  );
}
