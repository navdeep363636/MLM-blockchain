/* W-05 · Transaction History — FRD 5.5 */

import { PageHeader } from "@/components/layout";
import { HistoryView } from "./_components/history-view";

export const metadata = { title: "Transaction history" };

export default function HistoryPage() {
  return (
    <>
      <PageHeader
        title="Transaction history"
        description="Every financial event on your account, filterable and exportable, with a BscScan link on everything that settled on-chain."
        breadcrumb={[{ label: "Wallet", href: "/app/wallet" }, { label: "History" }]}
      />
      <HistoryView />
    </>
  );
}
