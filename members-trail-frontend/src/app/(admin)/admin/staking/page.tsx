/* AD-06 · Staking pool configuration — FRD 5.9 */

import { PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui";
import { StakingActions, StakingView } from "./_components/staking-view";

export const metadata = { title: "Staking pool configuration" };

export default function AdminStakingPage() {
  return (
    <>
      <PageHeader
        title="Staking pool configuration"
        description="Lock periods, reward epochs and early-exit terms per pool — plus reward-pool funding, which leaves the Treasury as a multisig-signed on-chain transfer with a public hash."
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Configuration" },
          { label: "Staking pools" },
        ]}
        badge={<Badge tone="warning" dot>Multisig gated</Badge>}
        actions={<StakingActions />}
      />
      <StakingView />
    </>
  );
}
