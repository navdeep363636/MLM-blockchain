/* N-02 · Support Ticket / Helpdesk — FRD 5.8 */

import { PageHeader } from "@/components/layout";
import { SupportView } from "./_components/support-view";

export const metadata = { title: "Support" };

export default function SupportPage() {
  return (
    <>
      <PageHeader
        title="Support"
        description="Raise and track requests. Withdrawal and commission disputes are auto-routed to compliance-trained agents with SLA tracking."
        breadcrumb={[{ label: "Support" }]}
      />
      <SupportView />
    </>
  );
}
