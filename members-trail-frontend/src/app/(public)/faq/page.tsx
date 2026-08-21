/* P-06 · FAQ — FRD 5.1 */

import { LifeBuoy, MessageSquare, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui";
import { CtaBand, PageHero, Section } from "../_components/shell";
import { FaqList } from "./_components/faq-list";

export const metadata = {
  title: "FAQ",
  description:
    "Straight answers on Points, MTT, staking yield, referral caps, KYC and withdrawals — including the questions that are awkward for us.",
};

export default function FaqPage() {
  return (
    <>
      <PageHero
        eyebrow={<>Frequently asked</>}
        title={<>Answers, including <span className="text-gradient-brand">the awkward ones.</span></>}
        lede="If a question here reads as evasive, that's a defect — tell support and we'll rewrite it. Where the honest answer is 'we can't advise you on that', we say so."
        actions={
          <>
            <Button href="/contact" size="lg" icon={<MessageSquare className="size-4" />}>Ask us directly</Button>
            <Button href="/legal" variant="outline" size="lg">Read the policies</Button>
          </>
        }
      />

      <Section>
        <FaqList />
      </Section>

      <CtaBand
        title="Still unanswered?"
        description="Support replies to account questions within one business day. Financial disputes go straight to compliance-trained agents with SLA tracking."
        primary={{ label: "Contact support", href: "/contact" }}
        secondary={{ label: "Browse the legal hub", href: "/legal" }}
      />
    </>
  );
}
