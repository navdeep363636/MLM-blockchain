/* AD-13 · Role & permission management — FRD 5.9 */

import { PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui";
import { RolesActions, RolesView } from "./_components/roles-view";

export const metadata = { title: "Roles & permissions" };

export default function AdminRolesPage() {
  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Least-privilege RBAC across every admin module, mandatory two-factor authentication per role, and hardware-key confirmation for anything that moves funds."
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Platform" },
          { label: "Roles & permissions" },
        ]}
        badge={<Badge tone="critical" dot>Security control</Badge>}
        actions={<RolesActions />}
      />
      <RolesView />
    </>
  );
}
