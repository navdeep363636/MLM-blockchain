/* L-05 · Referral / Affiliate Program Terms — FRD 11.5 */
import { LegalDocFromApi } from "../_components/fetch-doc";

export const metadata = {
  title: "Referral / Affiliate Program Terms",
  description:
    "Free to join with no entry fee: 8/3/1% across three levels on eligible real-money spend only, never on deposits or stake principal, capped monthly, revenue-funded, released after Tier 1 verification, and clawed back on refunds or fraud.",
};

export default function ReferralTermsPage() {
  return <LegalDocFromApi slug="referral-terms" />;
}
