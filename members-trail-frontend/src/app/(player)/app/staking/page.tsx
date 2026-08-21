/* S-01 · Staking Pools — FRD 5.6 */

import { PageHeader } from "@/components/layout";
import { PoolsView } from "./_components/pools-view";

export const metadata = { title: "Staking pools" };

export default function StakingPage() {
  return (
    <>
      <PageHeader
        title="Staking pools"
        description="Lock MTT to earn a share of Treasury-funded rewards. Rates are variable by design — they track real revenue rather than a promise."
        breadcrumb={[{ label: "Staking" }]}
      />
      <PoolsView />
    </>
  );
}
