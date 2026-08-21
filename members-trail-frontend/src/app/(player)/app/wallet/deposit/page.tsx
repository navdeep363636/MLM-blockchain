/* W-03 · Deposit — FRD 5.5 */

import { PageHeader } from "@/components/layout";
import { DepositView } from "./_components/deposit-view";

export const metadata = { title: "Deposit" };

export default function DepositPage() {
  return (
    <>
      <PageHeader
        title="Deposit"
        description="Fund purchases, boosts and tournament entries. Depositing is never required to earn — and never earns a return by itself."
        breadcrumb={[{ label: "Wallet", href: "/app/wallet" }, { label: "Deposit" }]}
      />
      <DepositView />
    </>
  );
}
