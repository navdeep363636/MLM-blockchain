/* Blog / News — FRD 4.1 (CMS-driven) */

import Link from "next/link";
import { ArrowUpRight, CalendarDays, Clock, Rss } from "lucide-react";
import { Avatar, Badge, Button, PillTabs } from "@/components/ui";
import { RevealGroup, RevealItem } from "@/components/fx";
import { SpotlightCard } from "@/components/fx";
import { CtaBand, PageHero, Section, SectionHead } from "../_components/shell";
import { GameArt } from "../_components/game-art";
import { formatDate } from "@/lib/utils";

export const metadata = {
  title: "Blog & news",
  description:
    "Release notes, transparency reports, tournament results and engineering write-ups from the Members Trail team.",
};

interface Post {
  slug: string;
  title: string;
  excerpt: string;
  category: "Transparency" | "Engineering" | "Product" | "Tournaments" | "Compliance";
  author: string;
  authorRole: string;
  date: string;
  readMins: number;
  hue: number;
  featured?: boolean;
}

const POSTS: Post[] = [
  {
    slug: "q2-2026-transparency-report",
    title: "Q2 2026 transparency report: 88.6% of payouts were revenue-funded",
    excerpt:
      "The number we care most about. This quarter 88.6% of everything paid to players came from settled platform revenue and 11.4% from the Treasury Reserve backstop — up from 79.2% last quarter. Full breakdown by stream, plus the reconciliation exceptions we had to chase.",
    category: "Transparency",
    author: "S. Kulkarni",
    authorRole: "Finance",
    date: "2026-08-12",
    readMins: 9,
    hue: 24,
    featured: true,
  },
  {
    slug: "testnet-deployment-notes",
    title: "Deploying the contract suite to BSC Testnet: two bugs we found first",
    excerpt:
      "Our role-setup script reverted the moment we pointed ADMIN_MULTISIG at a Safe rather than the deployer, and BscScan verification silently used a retired API path. Both are fixed. Here's the post-deploy check output, in full.",
    category: "Engineering",
    author: "Blockchain team",
    authorRole: "Engineering",
    date: "2026-08-04",
    readMins: 12,
    hue: 200,
  },
  {
    slug: "why-our-apr-is-variable",
    title: "Why our staking APR moves — and why a fixed one would be a lie",
    excerpt:
      "Pool APR is reward-pool inflow divided by total value staked, annualised. When more people stake the same funded pool, each share falls. That's arithmetic, not policy, and pretending otherwise is how platforms end up insolvent.",
    category: "Product",
    author: "Product team",
    authorRole: "Product",
    date: "2026-07-28",
    readMins: 7,
    hue: 42,
  },
  {
    slug: "hex-tactics-masters-results",
    title: "Hex Tactics Masters Invitational: results and the 61,500 MTT split",
    excerpt:
      "256 entrants, double elimination, and a final that went to a tiebreak on board control. Full bracket, prize distribution against the pre-published split, and the rake that flowed to the Treasury.",
    category: "Tournaments",
    author: "K. Bose",
    authorRole: "Community",
    date: "2026-07-19",
    readMins: 6,
    hue: 288,
  },
  {
    slug: "server-side-score-validation",
    title: "How we validate a game score without trusting your client",
    excerpt:
      "Signed telemetry, deterministic seeds, and server-side recomputation. A walk through the Game Result Validator, the exploits it caught in closed beta, and where it's still weaker than we'd like.",
    category: "Engineering",
    author: "Game Engineering",
    authorRole: "Engineering",
    date: "2026-07-11",
    readMins: 14,
    hue: 160,
  },
  {
    slug: "commission-caps-explained",
    title: "The monthly commission cap, and why we tied it to your own spend",
    excerpt:
      "Five times your trailing three-month average spend plus a base allowance, under an absolute ceiling. The formula exists to keep referral income secondary to playing — here's the modelling behind the multiplier.",
    category: "Compliance",
    author: "R. Menon",
    authorRole: "Compliance",
    date: "2026-07-02",
    readMins: 8,
    hue: 12,
  },
  {
    slug: "self-referral-ring-detection",
    title: "Anatomy of a self-referral ring we caught in week three",
    excerpt:
      "Four accounts, one card BIN, a circular sponsor graph, and all of it inside 38 minutes. What the fraud engine flagged, what a human had to confirm, and what we changed afterwards.",
    category: "Compliance",
    author: "Compliance team",
    authorRole: "Compliance",
    date: "2026-06-24",
    readMins: 10,
    hue: 340,
  },
  {
    slug: "pulse-beat-community-charting",
    title: "Pulse Beat opens community charting — with accuracy grading rules",
    excerpt:
      "Player-authored charts are coming to Pulse Beat. How submissions are moderated, how Points are capped on community content, and why we won't let chart authors set their own reward rates.",
    category: "Product",
    author: "Product team",
    authorRole: "Product",
    date: "2026-06-15",
    readMins: 5,
    hue: 96,
  },
  {
    slug: "audit-scope-published",
    title: "Publishing our audit scope before the audit starts",
    excerpt:
      "The four contracts in scope, the specific invariants we've asked the auditor to try to break, and our commitment to publish the report unedited — including anything they find.",
    category: "Compliance",
    author: "M. Haddad",
    authorRole: "Leadership",
    date: "2026-06-06",
    readMins: 6,
    hue: 224,
  },
  {
    slug: "points-cap-tuning",
    title: "Retuning daily Points caps per title — the data behind it",
    excerpt:
      "Six titles had caps that were binding for the top 2% of players and irrelevant to everyone else. New per-title caps, the distribution curves we used, and the scheduled effective date.",
    category: "Product",
    author: "Product team",
    authorRole: "Product",
    date: "2026-05-29",
    readMins: 7,
    hue: 68,
  },
];

const CATEGORIES = ["Transparency", "Engineering", "Product", "Tournaments", "Compliance"] as const;

const TONE: Record<Post["category"], "brand" | "info" | "good" | "warning" | "serious"> = {
  Transparency: "brand",
  Engineering: "info",
  Product: "good",
  Tournaments: "warning",
  Compliance: "serious",
};

export default function BlogPage() {
  const featured = POSTS.find((p) => p.featured)!;
  const rest = POSTS.filter((p) => !p.featured);

  return (
    <>
      <PageHero
        eyebrow={<>Blog &amp; news</>}
        title={<>Release notes, results, and <span className="text-gradient-brand">numbers we'd rather not round.</span></>}
        lede="Transparency reports every quarter, engineering write-ups when we break something interesting, and tournament results with the prize split checked against what we published beforehand."
        actions={
          <>
            <Button href="/contact" size="lg">Get release notes by email</Button>
            <Button href="/blog" variant="outline" size="lg" icon={<Rss className="size-4" />}>RSS feed</Button>
          </>
        }
      />

      <Section>
        <SectionHead eyebrow="Featured" title="Latest transparency report" />

        <Link href="/blog" className="group mt-8 block">
          <SpotlightCard className="overflow-hidden rounded-[var(--radius-panel)] border border-border-subtle bg-surface-1 transition-colors duration-300 hover:border-[color-mix(in_oklab,var(--accent)_38%,var(--border-default))]">
            <div className="grid lg:grid-cols-[minmax(0,22rem)_1fr]">
              <GameArt hue={featured.hue} title={featured.title} ratio="aspect-[16/10] lg:aspect-auto lg:h-full" />
              <div className="flex flex-col p-6 sm:p-8">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={TONE[featured.category]}>{featured.category}</Badge>
                  <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                    <CalendarDays className="size-3.5" />
                    {formatDate(featured.date)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                    <Clock className="size-3.5" />
                    {featured.readMins} min read
                  </span>
                </div>
                <h2 className="mt-4 font-display text-xl font-semibold leading-snug tracking-tight text-text-primary transition-colors group-hover:text-[var(--accent-hover)] sm:text-2xl">
                  {featured.title}
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-[0.95rem]">
                  {featured.excerpt}
                </p>
                <div className="mt-6 flex items-center gap-3 border-t border-border-subtle pt-5">
                  <Avatar name={featured.author} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary">{featured.author}</p>
                    <p className="text-xs text-text-muted">{featured.authorRole}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-[var(--accent-hover)]">
                    Read
                    <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </span>
                </div>
              </div>
            </div>
          </SpotlightCard>
        </Link>
      </Section>

      <Section tone="inset" bordered>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHead as="h2" title="All posts" description={`${POSTS.length} posts across five categories.`} />
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <Badge key={c} tone={TONE[c]}>
                {c} · {POSTS.filter((p) => p.category === c).length}
              </Badge>
            ))}
          </div>
        </div>

        <RevealGroup className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((p) => (
            <RevealItem key={p.slug}>
              <Link href="/blog" className="group block h-full">
                <SpotlightCard className="flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 transition-colors duration-300 hover:border-[color-mix(in_oklab,var(--accent)_38%,var(--border-default))]">
                  <GameArt hue={p.hue} title={p.title} ratio="aspect-[16/9]" />
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={TONE[p.category]}>{p.category}</Badge>
                      <span className="text-xs text-text-muted">{p.readMins} min</span>
                    </div>
                    <h3 className="mt-3 font-display text-base font-semibold leading-snug text-text-primary transition-colors group-hover:text-[var(--accent-hover)]">
                      {p.title}
                    </h3>
                    <p className="mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-text-muted">{p.excerpt}</p>
                    <div className="mt-4 flex items-center gap-2.5 border-t border-border-subtle pt-4">
                      <Avatar name={p.author} size="xs" />
                      <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{p.author}</span>
                      <span className="tnum shrink-0 text-xs text-text-muted">{formatDate(p.date)}</span>
                    </div>
                  </div>
                </SpotlightCard>
              </Link>
            </RevealItem>
          ))}
        </RevealGroup>

        <p className="mt-8 text-center text-xs text-text-muted">
          Post detail pages are served by the CMS. Content is authored and versioned in the admin
          panel under CMS &amp; legal content, with a draft → review → publish workflow.
        </p>
      </Section>

      <CtaBand
        title="Read the quarterly report before you read the marketing"
        description="It's the document that tells you whether the model is actually working."
        primary={{ label: "Read the tokenomics", href: "/tokenomics" }}
        secondary={{ label: "Contact the team", href: "/contact" }}
      />
    </>
  );
}
