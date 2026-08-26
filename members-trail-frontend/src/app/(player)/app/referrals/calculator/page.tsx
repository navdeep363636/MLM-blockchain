/* R-03 · Commission Structure & Calculator — FRD 5.7 */

import Link from "next/link";
import { Ban, Info, Landmark, Scale, ShieldCheck, Users } from "lucide-react";
import { Badge, Button, Callout, LevelBadge } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { CommissionCalculator } from "@/app/(public)/referral-program/_components/calculator";
import { CapFormula, EligibilityThreshold, RateTable } from "./_components/plan-facts";

export const metadata = { title: "Commission structure" };

const ELIGIBLE = [
  { label: "In-app purchases", eligible: true, note: "Cosmetics, boosts, energy refills bought with real money." },
  { label: "Tournament entry fees", eligible: true, note: "Optional paid events. Free entries generate no commission." },
  { label: "Premium Pass subscriptions", eligible: true, note: "Monthly subscription revenue." },
  { label: "Points-to-MTT conversions", eligible: false, note: "Not real-money revenue — it's a redemption of earned Points." },
  { label: "Staking deposits", eligible: false, note: "Never commissionable. Passing a stake upward is the defining feature of an unlawful scheme." },
  { label: "Fiat or crypto deposits", eligible: false, note: "A deposit is not revenue until it is spent on something." },
  { label: "Withdrawals", eligible: false, note: "Money leaving the platform generates nothing." },
];

/* `title` is a node rather than a string because one of these thresholds comes
 * from the live plan. `key` therefore uses an explicit id. */
const GATES: { id: string; icon: React.ReactNode; title: React.ReactNode; body: string }[] = [
  { id: "kyc", icon: <ShieldCheck />, title: "Tier 1 KYC before release", body: "Commission accrues in a pending state without KYC, but only becomes withdrawable once you are Tier 1 verified." },
  { id: "threshold", icon: <Users />, title: <EligibilityThreshold />, body: "A referred account must reach a minimum age and a minimum number of genuine gameplay sessions before it can generate its first commission." },
  { id: "funding", icon: <Landmark />, title: "Pool must be funded", body: "Even inside your cap, an entry only credits if the commission pool has been funded from reconciled revenue. Otherwise it queues until the next Treasury deposit." },
  { id: "loops", icon: <Ban />, title: "No self-referral or loops", body: "Shared identity, device or payment fingerprints are flagged at registration. A refers B who refers A is blocked outright." },
];

export default function CalculatorPage() {
  return (
    <>
      <PageHeader
        title="Commission structure"
        description="Exactly how a commission is derived, what counts as eligible spend, and where the caps bite. Every payout line in your history uses this same arithmetic."
        breadcrumb={[{ label: "Referrals", href: "/app/referrals" }, { label: "Structure & calculator" }]}
        actions={
          <Button href="/legal/referral-terms" variant="outline" size="sm">
            Full programme terms
          </Button>
        }
      />

      {/* Rate table and cap formula both quote the live plan, so they are client
          components — see _components/plan-facts.tsx. */}
      <RateTable />
      <CapFormula />

      {/* Eligibility */}
      <div className="mt-6 overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1">
        <div className="border-b border-border-subtle px-5 py-4">
          <h2 className="text-sm font-semibold text-text-primary">What generates commission</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Only verified real-money revenue events. The exclusions matter more than the inclusions.
          </p>
        </div>
        <ul className="divide-y divide-border-subtle">
          {ELIGIBLE.map((e) => (
            <li key={e.label} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-primary">{e.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{e.note}</p>
              </div>
              <Badge tone={e.eligible ? "good" : "critical"} dot>
                {e.eligible ? "Eligible" : "Never eligible"}
              </Badge>
            </li>
          ))}
        </ul>
      </div>

      {/* Calculator */}
      <h2 className="mt-8 mb-4 text-sm font-semibold text-text-primary">Work through an example</h2>
      <CommissionCalculator />

      {/* Gates */}
      <h2 className="mt-8 mb-4 text-sm font-semibold text-text-primary">Conditions that must also be met</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {GATES.map((g) => (
          <div key={g.id} className="flex gap-3.5 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-[var(--accent)] [&>svg]:size-4">
              {g.icon}
            </span>
            <div>
              <p className="text-sm font-medium text-text-primary">{g.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">{g.body}</p>
            </div>
          </div>
        ))}
      </div>

      <Callout tone="critical" title="No income claims — including yours" icon={<Ban />} className="mt-6">
        <p className="mt-1">
          The calculator above is arithmetic on inputs you chose. It is not a projection, a forecast,
          or a representation of what you will earn — most participants in any referral programme earn
          little or nothing. Under the{" "}
          <Link href="/legal/referral-terms">Referral Program Terms</Link> you are prohibited from
          presenting figures like these, or your own results, as typical or achievable when sharing
          your code.
        </p>
      </Callout>
    </>
  );
}
