/* S-03 · Staking Rewards History — FRD 5.6 */

import { PageHeader } from "@/components/layout";
import { RewardsView } from "./_components/rewards-view";

export const metadata = { title: "Staking rewards" };

export default function RewardsPage() {
  return (
    <>
      <PageHeader
        title="Staking rewards"
        description="Accrual and claim history per position, with on-chain proof. Every reward traces back to a Treasury deposit funded by real revenue."
        breadcrumb={[{ label: "Staking", href: "/app/staking" }, { label: "Rewards" }]}
      />
      <RewardsView />
    </>
  );
}
