/* AD-12 · Support ticket management (admin) — FRD 5.9 */

import { PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui";
import { TicketsActions, TicketsView } from "./_components/tickets-view";

export const metadata = { title: "Support tickets" };

export default function AdminTicketsPage() {
  return (
    <>
      <PageHeader
        title="Support tickets"
        description="Agent workspace: priority, live SLA countdowns, threaded conversations with internal notes, canned macros, and financial disputes routed to compliance-trained agents."
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Users & compliance" },
          { label: "Support tickets" },
        ]}
        badge={<Badge tone="info" dot>SLA tracked</Badge>}
        actions={<TicketsActions />}
      />
      <TicketsView />
    </>
  );
}
