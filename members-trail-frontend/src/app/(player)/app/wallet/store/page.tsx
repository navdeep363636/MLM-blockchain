/* W-06 · In-Platform Store / Marketplace — FRD 5.5 */

import { PageHeader } from "@/components/layout";
import { StoreView } from "./_components/store-view";

export const metadata = { title: "Store & marketplace" };

export default function StorePage() {
  return (
    <>
      <PageHeader
        title="Store & marketplace"
        description="Spend Points or MTT on cosmetics and boosts, or trade owned items peer-to-peer. Marketplace fees feed the Revenue Treasury."
        breadcrumb={[{ label: "Wallet", href: "/app/wallet" }, { label: "Store" }]}
      />
      <StoreView />
    </>
  );
}
