/* L-03 · Risk Disclosure Statement — FRD 11.3 */
import { LegalDocFromApi } from "../_components/fetch-doc";

export const metadata = {
  title: "Risk Disclosure Statement",
  description:
    "The blunt version: MTT can fall to zero, staking rewards are variable and can be nothing, the smart-contract audit is not yet complete, there is no deposit insurance, and referral commission is capped — most participants earn little or nothing.",
};

export default function RiskDisclosurePage() {
  return <LegalDocFromApi slug="risk-disclosure" />;
}
