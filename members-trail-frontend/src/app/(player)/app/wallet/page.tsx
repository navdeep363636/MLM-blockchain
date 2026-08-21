/* W-01 · Wallet Overview — FRD 5.5 */

import { PageHeader } from "@/components/layout";
import { LiveDot } from "@/components/fx";
import { WalletOverview } from "./_components/overview";

export const metadata = { title: "Wallet" };

export default function WalletPage() {
  return (
    <>
      <PageHeader
        title="Wallet"
        description="Points, MTT available, MTT staked and pending rewards in one view. Financial figures are read live from the ledger, never cached beyond a few seconds."
        breadcrumb={[{ label: "Wallet" }]}
        badge={<LiveDot label="Live" />}
      />
      <WalletOverview />
    </>
  );
}
