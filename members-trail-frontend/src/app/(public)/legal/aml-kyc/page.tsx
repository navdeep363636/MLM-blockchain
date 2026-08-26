/* L-04 · AML / KYC Policy — FRD 11.4 */
import { LegalDocFromApi } from "../_components/fetch-doc";

export const metadata = {
  title: "AML / KYC Policy",
  description:
    "Verification tiers and thresholds, the new-address cooling-off period, withdrawal source tagging, transaction and referral-network monitoring, sanctions and PEP screening, suspicious activity reporting, and five-year record retention.",
};

export default function AmlKycPage() {
  return <LegalDocFromApi slug="aml-kyc" />;
}
