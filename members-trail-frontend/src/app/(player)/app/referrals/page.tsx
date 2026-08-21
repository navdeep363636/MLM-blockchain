/* R-01 · Referral Dashboard — FRD 5.7 */

import { PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui";
import { ReferralDashboard } from "./_components/dashboard";

export const metadata = { title: "Referrals" };

export default function ReferralsPage() {
  return (
    <>
      <PageHeader
        title="Referrals"
        description="Share the platform if you want to. Commission is a capped bonus on real spend — it is never required to earn, and never comes out of anyone's deposit."
        breadcrumb={[{ label: "Referrals" }]}
        badge={<Badge tone="neutral">Optional programme</Badge>}
      />
      <ReferralDashboard />
    </>
  );
}
