/* L-08 · Cookie Policy — FRD 11.8 */
import { LegalDocFromApi } from "../_components/fetch-doc";
import { CookieTable } from "../_components/cookie-table";

export const metadata = {
  title: "Cookie Policy",
  description:
    "The four categories of cookie Members Trail sets — strictly necessary, functional, analytics and fraud prevention — with a full table of purposes and durations, how to change your choices, and how this relates to the Privacy Policy.",
};

export default function CookiesPage() {
  return (
    <LegalDocFromApi
      slug="cookies"
      extras={{ "3. Cookie categories table": <CookieTable /> }}
    />
  );
}
