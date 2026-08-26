/* L-02 · Privacy Policy — FRD 11.2 */
import { LegalDocFromApi } from "../_components/fetch-doc";

export const metadata = {
  title: "Privacy Policy",
  description:
    "What personal data Members Trail collects, the lawful basis for each purpose, who processes it, how long it is kept, how it is encrypted, and how to exercise your access, rectification, erasure and portability rights.",
};

export default function PrivacyPage() {
  return <LegalDocFromApi slug="privacy" />;
}
