/* S-02 · Stake / Unstake — FRD 5.6 */

import { Suspense } from "react";
import { PageHeader } from "@/components/layout";
import { SkeletonCard } from "@/components/ui";
import { ManageView } from "./_components/manage-view";

export const metadata = { title: "Stake & unstake" };

export default function ManageStakingPage() {
  return (
    <>
      <PageHeader
        title="Stake & unstake"
        description="Approve, stake and unstake on-chain. Your principal always returns in full — early exit only ever costs unclaimed rewards."
        breadcrumb={[{ label: "Staking", href: "/app/staking" }, { label: "Stake / unstake" }]}
      />
      <Suspense fallback={<div className="grid gap-5 lg:grid-cols-2"><SkeletonCard className="h-96" /><SkeletonCard className="h-96" /></div>}>
        <ManageView />
      </Suspense>
    </>
  );
}
