/* R-04 · Commission Payout History — FRD 5.7 */

import { PageHeader } from "@/components/layout";
import { PayoutsView } from "./_components/payouts-view";

export const metadata = { title: "Commission payouts" };

export default function PayoutsPage() {
  return (
    <>
      <PageHeader
        title="Commission payouts"
        description="Every commission line, its full derivation, and the Treasury deposit that funded it. Disputable per entry."
        breadcrumb={[{ label: "Referrals", href: "/app/referrals" }, { label: "Payout history" }]}
      />
      <PayoutsView />
    </>
  );
}
