/* L-04 · AML / KYC Policy — FRD 11.4 */
import { LegalDoc } from "../_components/legal-doc";
import { legalDocuments } from "@/lib/mock/legal";

export const metadata = {
  title: "AML / KYC Policy",
  description:
    "Verification tiers and thresholds, the new-address cooling-off period, withdrawal source tagging, transaction and referral-network monitoring, sanctions and PEP screening, suspicious activity reporting, and five-year record retention.",
};

export default function AmlKycPage() {
  return <LegalDoc doc={legalDocuments["aml-kyc"]} />;
}
