/* A-05 · KYC Verification — FRD 5.2 */

import { AuthHeading } from "../_components/auth-shell";
import { KycFlow } from "./_components/kyc-flow";

export const metadata = {
  title: "Identity verification",
  description:
    "Tier 1 KYC unlocks Points conversion, withdrawals and referral commission release. Documents are encrypted at rest.",
};

export default function KycPage() {
  return (
    <>
      <AuthHeading
        title="Verify your identity"
        subtitle="Required before your first conversion or withdrawal, and before referral commission is released. You can keep playing and earning Points while this is pending."
      />
      <KycFlow />
    </>
  );
}
