/* L-01 · Terms & Conditions — FRD 11.1 */
import { LegalDoc } from "../_components/legal-doc";
import { legalDocuments } from "@/lib/mock/legal";

export const metadata = {
  title: "Terms & Conditions",
  description:
    "The agreement between you and Members Trail: eligibility and 18+ rules, account obligations, how Points and the MTT utility token work, staking, prohibited conduct, suspension, liability and dispute resolution.",
};

export default function TermsPage() {
  return <LegalDoc doc={legalDocuments.terms} />;
}
