/* L-07 · Responsible Gaming Policy — FRD 11.7 */
import { LegalDocFromApi } from "../_components/fetch-doc";

export const metadata = {
  title: "Responsible Gaming Policy",
  description:
    "Deposit, spend and session limits, reality checks, cooling-off, and self-exclusion that support cannot lift during the period you set. Plus age verification, the indicators that play has stopped being play, and where to get help.",
};

export default function ResponsibleGamingPage() {
  return <LegalDocFromApi slug="responsible-gaming" />;
}
