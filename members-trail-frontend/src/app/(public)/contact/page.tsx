/* P-07 · Contact / Support — FRD 5.1 */

import Link from "next/link";
import { BookOpen, Clock, LifeBuoy, Mail, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { Badge, Callout } from "@/components/ui";
import { PageHero, Section, SectionHead } from "../_components/shell";
import { IconTile } from "../_components/feature-card";
import { ContactForm } from "./_components/contact-form";

export const metadata = {
  title: "Contact & support",
  description:
    "Reach the Members Trail team. Financial disputes route to compliance-trained agents with SLA tracking.",
};

const CHANNELS = [
  {
    icon: <LifeBuoy />,
    title: "In-account support",
    body: "The fastest route if you can log in. Attach screenshots, see ticket status and reply in a thread.",
    action: { label: "Open Support", href: "/app/support" },
  },
  {
    icon: <BookOpen />,
    title: "FAQ",
    body: "Most questions about Points, caps, staking yield and KYC tiers are already answered in detail.",
    action: { label: "Browse the FAQ", href: "/faq" },
  },
  {
    icon: <ShieldCheck />,
    title: "Compliance & legal",
    body: "Data-subject requests, AML enquiries and policy questions. Handled by the compliance team, not general support.",
    action: { label: "Legal hub", href: "/legal" },
  },
];

const SLA = [
  ["Financial disputes", "Withdrawal and commission tickets", "Routed immediately to compliance-trained agents with SLA tracking"],
  ["Account & KYC", "Verification, login, 2FA, session issues", "Within 1 business day"],
  ["Gameplay & Points", "Session results, quest credit, leaderboards", "Within 1–2 business days"],
  ["Technical", "Bugs, performance, wallet connection", "Within 2 business days"],
];

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow={<>Contact</>}
        title={<>Talk to a person, <span className="text-gradient-brand">not a deflection page.</span></>}
        lede="Pick the category that matches your issue and it reaches the right team directly. Money questions never sit in a general queue."
      />

      <Section>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,34rem)_1fr] lg:items-start">
          <div>
            <SectionHead as="h2" title="Send us a message" description="We reply by email. Include references and we'll resolve it in fewer rounds." />
            <div className="mt-6">
              <ContactForm />
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
              <div className="flex items-center gap-3">
                <IconTile size="sm"><Clock /></IconTile>
                <h3 className="text-sm font-semibold text-text-primary">Response expectations</h3>
              </div>
              <ul className="mt-4 space-y-3.5">
                {SLA.map(([title, scope, sla]) => (
                  <li key={title} className="border-b border-border-subtle pb-3.5 last:border-0 last:pb-0">
                    <p className="text-sm font-medium text-text-primary">{title}</p>
                    <p className="mt-0.5 text-xs text-text-muted">{scope}</p>
                    <p className="mt-1.5 text-xs font-medium text-[var(--accent-hover)]">{sla}</p>
                  </li>
                ))}
              </ul>
            </div>

            {CHANNELS.map((c) => (
              <div key={c.title} className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
                <div className="flex items-center gap-3">
                  <IconTile size="sm">{c.icon}</IconTile>
                  <h3 className="text-sm font-semibold text-text-primary">{c.title}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-text-muted">{c.body}</p>
                <Link
                  href={c.action.href}
                  className="mt-3 inline-block text-sm font-medium text-[var(--accent-hover)] hover:underline"
                >
                  {c.action.label} →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section tone="inset" bordered>
        <Callout tone="critical" title="Support will never ask for your secrets" icon={<ShieldAlert />}>
          <p className="mt-1">
            No Members Trail employee will ever ask for your password, your 2FA codes, your wallet
            seed phrase or a private key — not by email, not in a ticket, not on a call. Anyone who
            does is attempting fraud, and you should report it to us immediately. We also never ask
            you to send MTT or BNB anywhere to &ldquo;verify&rdquo; or &ldquo;unlock&rdquo; a withdrawal.
          </p>
        </Callout>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Badge tone="info" icon={<Mail className="size-3.5" />}>support@memberstrail.com</Badge>
          <Badge tone="info" icon={<ShieldCheck className="size-3.5" />}>compliance@memberstrail.com</Badge>
          <Badge tone="info" icon={<Users className="size-3.5" />}>partnerships@memberstrail.com</Badge>
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Data-subject access, rectification, erasure and portability requests are handled by the
          compliance address above, per the{" "}
          <Link href="/legal/privacy" className="text-[var(--accent-hover)] underline underline-offset-2">Privacy Policy</Link>.
        </p>
      </Section>
    </>
  );
}
