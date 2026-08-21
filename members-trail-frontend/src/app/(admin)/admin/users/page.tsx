/* AD-02 · User management — FRD 5.9 */

import { PageHeader } from "@/components/layout";
import { UsersActions, UsersView } from "./_components/users-view";

export const metadata = { title: "User management" };

export default function AdminUsersPage() {
  return (
    <>
      <PageHeader
        title="User management"
        description="Search and manage every member account. Suspension, forced password reset and balance adjustment are all controlled flows — a balance never moves on one operator's word alone."
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Users & compliance" },
          { label: "User management" },
        ]}
        actions={<UsersActions />}
      />
      <UsersView />
    </>
  );
}
