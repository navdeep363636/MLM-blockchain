/* R-02 · Genealogy / Downline Tree — FRD 5.7 */

import { PageHeader } from "@/components/layout";
import { TreeView } from "./_components/tree-view";

export const metadata = { title: "Downline tree" };

export default function TreePage() {
  return (
    <>
      <PageHeader
        title="Downline tree"
        description="Your referral network to the platform's capped depth of three levels, shown as anonymised aggregates."
        breadcrumb={[{ label: "Referrals", href: "/app/referrals" }, { label: "Downline tree" }]}
      />
      <TreeView />
    </>
  );
}
