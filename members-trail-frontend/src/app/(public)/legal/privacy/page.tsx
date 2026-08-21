/* L-02 · Privacy Policy — FRD 11.2 */
import { LegalDoc } from "../_components/legal-doc";
import { legalDocuments } from "@/lib/mock/legal";

export const metadata = {
  title: "Privacy Policy",
  description:
    "What personal data Members Trail collects, the lawful basis for each purpose, who processes it, how long it is kept, how it is encrypted, and how to exercise your access, rectification, erasure and portability rights.",
};

export default function PrivacyPage() {
  return <LegalDoc doc={legalDocuments.privacy} />;
}
