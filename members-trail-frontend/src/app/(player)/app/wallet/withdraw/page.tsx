/* W-04 · Withdraw — FRD 5.5 */

import { PageHeader } from "@/components/layout";
import { WithdrawView } from "./_components/withdraw-view";

export const metadata = { title: "Withdraw" };

export default function WithdrawPage() {
  return (
    <>
      <PageHeader
        title="Withdraw"
        description="Move MTT to your own wallet or request a fiat payout. Gameplay, staking and referral funds are all withdrawable, subject to KYC tier and AML checks."
        breadcrumb={[{ label: "Wallet", href: "/app/wallet" }, { label: "Withdraw" }]}
      />
      <WithdrawView />
    </>
  );
}
