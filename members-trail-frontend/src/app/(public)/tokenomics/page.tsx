/* P-04 · Tokenomics / MTT — FRD 5.1, 8.1–8.4 */

import Link from "next/link";
import {
  AlertTriangle, Ban, Coins, ExternalLink, Flame, Gamepad2, Landmark,
  Lock, ShieldCheck, Store, Vote,
} from "lucide-react";
import { Badge, Button, Callout, DetailRow } from "@/components/ui";
import { CtaBand, PageHero, Section, SectionHead } from "../_components/shell";
import { FactCard, FeatureCard, IconTile } from "../_components/feature-card";
import { AllocationChart, RateHistory } from "./_components/allocation";
import { RateHistoryPanel } from "./_components/rate-history-panel";
import { CHAIN_ID, IS_TESTNET, contracts, isDeployed, addressUrl, tokenUrl } from "@/lib/web3";
import { shortenAddress } from "@/lib/utils";

export const metadata = {
  title: "Tokenomics",
  description:
    "MTT is a BEP-20 utility token on BNB Smart Chain with a fixed 1,000,000,000 supply and no mint function. Full allocation, vesting and utility breakdown.",
};

const SPEC: [string, React.ReactNode, string?][] = [
  ["Name", "Members Trail Token"],
  ["Symbol", "MTT"],
  ["Chain", `BNB Smart Chain (${IS_TESTNET ? "Testnet, chain 97" : "Mainnet, chain 56"})`],
  ["Standard", "BEP-20"],
  ["Decimals", "18"],
  ["Total supply", "1,000,000,000 MTT", "Fixed at deployment"],
  ["Mintable", "No", "No mint function exists in production"],
  ["Burnable", "Yes", "Holders burn their own balance; buy-back-and-burn is multisig-gated"],
  ["Pausable", "Emergency only", "Timelocked multisig, with public disclosure"],
];

const UTILITY = [
  { icon: <Coins />, title: "Points redemption target", body: "The asset your gameplay Points convert into, at the published rate." },
  { icon: <Landmark />, title: "Stakeable for revenue-funded yield", body: "Lock MTT in a pool whose rewards come from the Revenue Treasury — variable, never fixed." },
  { icon: <Store />, title: "Spendable in-platform", body: "Cosmetics, boosts, tournament entry and peer-to-peer marketplace trades." },
  { icon: <Vote />, title: "Possible future governance", body: "Voting on new game additions and fee parameters is a Phase 2 candidate, not a current feature." },
];

export default function TokenomicsPage() {
  const deployed = isDeployed(contracts.mttToken);

  return (
    <>
      <PageHero
        eyebrow={<>MTT tokenomics</>}
        title={<>A fixed supply, <span className="text-gradient-brand">no mint function</span>, and rewards that come from revenue.</>}
        lede="MTT is a utility token for gameplay and rewards on BNB Smart Chain. It is not sold as an investment and no return is promised. Everything below is verifiable on-chain."
        orbs
        /* The helix is reserved for pages where the token itself is the
           subject. This is that page. */
        helix
        actions={
          <>
            <Button href="/how-it-works" size="lg">How earning works</Button>
            {deployed && (
              <Button
                href={tokenUrl(contracts.mttToken)}
                variant="outline"
                size="lg"
                iconRight={<ExternalLink className="size-4" />}
              >
                View on BscScan
              </Button>
            )}
          </>
        }
      >
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FactCard label="Total supply" value="1,000,000,000" note="Minted once at deployment across six wallets." icon={<Coins />} />
          <FactCard label="Further minting" value="Impossible" note="There is no mint function to call." icon={<Ban />} />
          <FactCard label="Play-to-earn pool" value="40%" note="The largest bucket, reserved for players." icon={<Gamepad2 />} />
          <FactCard label="Team vesting cliff" value="12 months" note="Then linear over 24 months, on-chain." icon={<Lock />} />
        </div>
      </PageHero>

      <Section>
        <SectionHead
          eyebrow="Specification"
          title="Token contract at a glance"
          description="These are the parameters set at deployment. They cannot be changed by an administrator after the fact — that is the point of a fixed-supply design."
        />

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_minmax(0,24rem)]">
          <div className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 px-5 py-2">
            {SPEC.map(([label, value, note]) => (
              <div key={label} className="border-b border-border-subtle last:border-0">
                <DetailRow
                  label={label}
                  value={
                    <span className="inline-flex flex-col items-end">
                      <span className="tnum">{value}</span>
                      {note && <span className="mt-0.5 text-xs font-normal text-text-muted">{note}</span>}
                    </span>
                  }
                />
              </div>
            ))}
          </div>

          <div className="space-y-4">
            <div className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
              <div className="flex items-center gap-3">
                <IconTile size="sm"><ShieldCheck /></IconTile>
                <h3 className="text-sm font-semibold text-text-primary">Contract addresses</h3>
              </div>
              {deployed ? (
                <dl className="mt-4 space-y-2.5 text-xs">
                  {[
                    ["MTT token", contracts.mttToken],
                    ["Staking", contracts.staking],
                    ["Referral distributor", contracts.referralDistributor],
                  ].map(([label, addr]) =>
                    isDeployed(addr as `0x${string}`) ? (
                      <div key={label} className="flex items-center justify-between gap-3">
                        <dt className="text-text-muted">{label}</dt>
                        <dd>
                          <Link
                            href={addressUrl(addr as string)}
                            target="_blank"
                            className="font-mono-num inline-flex items-center gap-1 text-[var(--accent-hover)] hover:underline"
                          >
                            {shortenAddress(addr as string, 6)}
                            <ExternalLink className="size-3" />
                          </Link>
                        </dd>
                      </div>
                    ) : null,
                  )}
                </dl>
              ) : (
                <p className="mt-3 text-xs leading-relaxed text-text-muted">
                  Addresses are published here once the contracts are deployed and verified on
                  BscScan. Until then this page shows the specification from the functional
                  requirements document.
                </p>
              )}
              <Badge tone={IS_TESTNET ? "warning" : "good"} className="mt-4" dot>
                {IS_TESTNET ? "BSC Testnet — chain 97" : "BSC Mainnet — chain 56"}
              </Badge>
            </div>

            <div className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
              <div className="flex items-center gap-3">
                <IconTile size="sm"><Flame /></IconTile>
                <h3 className="text-sm font-semibold text-text-primary">Burn mechanics</h3>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-text-muted">
                Any holder can burn their own balance. A separate buy-back-and-burn function is
                restricted to a multisig-controlled Treasury wallet and is funded only from Treasury
                surplus — never from reward pools that players have a claim on.
              </p>
            </div>
          </div>
        </div>
      </Section>

      <Section tone="inset" bordered>
        <SectionHead
          eyebrow="Allocation"
          title="Where the supply sits"
          description="Six buckets, minted once, each to a designated wallet. Team and advisor allocations are held by on-chain vesting contracts rather than simple time-locked transfers."
        />
        <div className="mt-10">
          <AllocationChart />
        </div>

        <Callout tone="warning" title="On the 15% Treasury Reserve" icon={<AlertTriangle />} className="mt-8">
          <p className="mt-1">
            This bucket is a <strong className="text-text-primary">bootstrap backstop</strong> for the
            pre-revenue period. It must never become the ongoing funding source for staking rewards or
            referral commissions once the platform is live. The admin Treasury page tracks what
            fraction of payouts comes from real revenue versus this reserve, targeting 100%
            real-revenue funding within 12–18 months, and that ratio is published for scrutiny.
          </p>
        </Callout>
      </Section>

      <Section>
        <SectionHead
          eyebrow="Utility"
          title="What MTT is actually for"
          description="A utility token has to do something. Here is the complete list — and the one item on it that does not exist yet is labelled as such."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {UTILITY.map((u) => (
            <FeatureCard key={u.title} icon={u.icon} title={u.title} description={u.body} />
          ))}
        </div>
      </Section>

      <Section tone="inset" bordered>
        <SectionHead
          eyebrow="Transparency"
          title="Conversion rate, published and versioned"
          description="The rate that turns Points into MTT is the single most important economic lever on the platform, so its full history is public and every change needs two approvers."
        />
        <div className="mt-8">
          <RateHistoryPanel />
        </div>
      </Section>

      <Section>
        <Callout tone="critical" title="MTT is not an investment product" icon={<AlertTriangle />}>
          <p className="mt-1">
            MTT is a utility and access token for gameplay and rewards. It is not offered as an
            investment, carries no promise or expectation of profit, and its price can fall to zero.
            Staking yield is variable and derived from actual Revenue Treasury inflows — it is not a
            fixed or guaranteed return. Nothing on this page is financial advice or an offer to sell
            a security. Read the{" "}
            <Link href="/legal/risk-disclosure">Risk Disclosure Statement</Link> before acquiring,
            converting or staking MTT.
          </p>
        </Callout>
      </Section>

      <CtaBand
        title="Earn MTT by playing, not by buying"
        description="The primary way to acquire MTT on Members Trail is to convert Points you earned through gameplay. That is by design."
        primary={{ label: "Create a free account", href: "/signup" }}
        secondary={{ label: "Read the Risk Disclosure", href: "/legal/risk-disclosure" }}
      />
    </>
  );
}
