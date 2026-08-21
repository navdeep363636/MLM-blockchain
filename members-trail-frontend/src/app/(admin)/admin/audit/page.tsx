/* AD-14 · Audit log — FRD 5.9 */

import { PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui";
import { AuditActions, AuditView } from "./_components/audit-view";

export const metadata = { title: "Audit log" };

export default function AdminAuditPage() {
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every sensitive administrative action, with the actor, their role, the target, the before and after values, the source IP and the second approver. Append-only and read-only."
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Platform" },
          { label: "Audit log" },
        ]}
        badge={<Badge tone="critical" dot>Write-once</Badge>}
        actions={<AuditActions />}
      />
      <AuditView />
    </>
  );
}
