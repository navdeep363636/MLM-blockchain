/* L-08 · Cookie Policy — FRD 11.8 */
import { LegalDoc } from "../_components/legal-doc";
import { CookieTable } from "../_components/cookie-table";
import { legalDocuments } from "@/lib/mock/legal";

export const metadata = {
  title: "Cookie Policy",
  description:
    "The four categories of cookie Members Trail sets — strictly necessary, functional, analytics and fraud prevention — with a full table of purposes and durations, how to change your choices, and how this relates to the Privacy Policy.",
};

const doc = legalDocuments.cookies;

export default function CookiesPage() {
  return (
    <LegalDoc
      doc={doc}
      extras={{ "3. Cookie categories table": <CookieTable /> }}
    />
  );
}
