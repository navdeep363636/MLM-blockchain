/* R-05 · Marketing Assets / Share Tools — FRD 5.7 */

import { PageHeader } from "@/components/layout";
import { AssetsView } from "./_components/assets-view";

export const metadata = { title: "Marketing assets" };

export default function AssetsPage() {
  return (
    <>
      <PageHeader
        title="Marketing assets"
        description="Pre-approved banners, social sizes and captions — all written to contain no income claims, so using them keeps you compliant."
        breadcrumb={[{ label: "Referrals", href: "/app/referrals" }, { label: "Marketing assets" }]}
      />
      <AssetsView />
    </>
  );
}
