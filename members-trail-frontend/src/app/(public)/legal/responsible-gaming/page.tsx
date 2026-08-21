/* L-07 · Responsible Gaming Policy — FRD 11.7 */
import { LegalDoc } from "../_components/legal-doc";
import { legalDocuments } from "@/lib/mock/legal";

export const metadata = {
  title: "Responsible Gaming Policy",
  description:
    "Deposit, spend and session limits, reality checks, cooling-off, and self-exclusion that support cannot lift during the period you set. Plus age verification, the indicators that play has stopped being play, and where to get help.",
};

export default function ResponsibleGamingPage() {
  return <LegalDoc doc={legalDocuments["responsible-gaming"]} />;
}
