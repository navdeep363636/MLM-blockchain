/* L-01 · Terms & Conditions — FRD 11.1 */
import { LegalDocFromApi } from "../_components/fetch-doc";

export const metadata = {
  title: "Terms & Conditions",
  description:
    "The agreement between you and Members Trail: eligibility and 18+ rules, account obligations, how Points and the MTT utility token work, staking, prohibited conduct, suspension, liability and dispute resolution.",
};

export default function TermsPage() {
  return <LegalDocFromApi slug="terms" />;
}
