/* ============================================================================
 * Single source of truth for navigation. Every route in the FRD page inventory
 * appears here, so there are no dead links and the sitemap is auditable.
 * ========================================================================== */

export interface NavLink {
  label: string;
  href: string;
  /** FRD page reference, e.g. "P-01". Rendered in dev tooling / sitemap. */
  frd?: string;
  description?: string;
  badge?: string;
}

export interface NavGroup {
  label: string;
  icon: string;   // lucide icon name, resolved in the layout
  items: NavLink[];
}

/* ------------------------------ Public site ------------------------------- */

export const publicNav: NavLink[] = [
  { label: "How it works", href: "/how-it-works", frd: "P-02" },
  { label: "Games", href: "/games", frd: "P-03" },
  { label: "Tokenomics", href: "/tokenomics", frd: "P-04" },
  { label: "Referrals", href: "/referral-program", frd: "P-05" },
  { label: "FAQ", href: "/faq", frd: "P-06" },
];

export const publicFooterNav: { heading: string; items: NavLink[] }[] = [
  {
    heading: "Platform",
    items: [
      { label: "How it works", href: "/how-it-works", frd: "P-02" },
      { label: "Games catalog", href: "/games", frd: "P-03" },
      { label: "Tokenomics", href: "/tokenomics", frd: "P-04" },
      { label: "Referral program", href: "/referral-program", frd: "P-05" },
    ],
  },
  {
    heading: "Company",
    items: [
      { label: "About us", href: "/about", frd: "4.1" },
      { label: "Blog & news", href: "/blog", frd: "4.1" },
      { label: "FAQ", href: "/faq", frd: "P-06" },
      { label: "Contact & support", href: "/contact", frd: "P-07" },
    ],
  },
  {
    heading: "Legal",
    items: [
      { label: "Legal hub", href: "/legal", frd: "P-08" },
      { label: "Terms & Conditions", href: "/legal/terms", frd: "11.1" },
      { label: "Privacy Policy", href: "/legal/privacy", frd: "11.2" },
      { label: "Risk Disclosure", href: "/legal/risk-disclosure", frd: "11.3" },
    ],
  },
  {
    heading: "Compliance",
    items: [
      { label: "AML / KYC Policy", href: "/legal/aml-kyc", frd: "11.4" },
      { label: "Referral Program Terms", href: "/legal/referral-terms", frd: "11.5" },
      { label: "Responsible Gaming", href: "/legal/responsible-gaming", frd: "11.7" },
      { label: "Cookie Policy", href: "/legal/cookies", frd: "11.8" },
    ],
  },
];

export const legalDocs: NavLink[] = [
  { label: "Terms & Conditions", href: "/legal/terms", frd: "11.1", description: "Eligibility, account rules, token terms, dispute resolution." },
  { label: "Privacy Policy", href: "/legal/privacy", frd: "11.2", description: "What we collect, why, how long we keep it, and your rights." },
  { label: "Risk Disclosure Statement", href: "/legal/risk-disclosure", frd: "11.3", description: "Token volatility, variable yield, and no-guaranteed-earnings notice." },
  { label: "AML / KYC Policy", href: "/legal/aml-kyc", frd: "11.4", description: "Verification tiers, monitoring, and reporting obligations." },
  { label: "Referral / Affiliate Program Terms", href: "/legal/referral-terms", frd: "11.5", description: "Commission basis, caps, prohibited conduct, income-claim rules." },
  { label: "Refund & Cancellation Policy", href: "/legal/refunds", frd: "11.6", description: "Purchase refunds, tournament cancellations, chargebacks." },
  { label: "Responsible Gaming Policy", href: "/legal/responsible-gaming", frd: "11.7", description: "Limits, self-exclusion, and support resources." },
  { label: "Cookie Policy", href: "/legal/cookies", frd: "11.8", description: "Categories of cookies and how to control them." },
];

/* ----------------------------- Player app -------------------------------- */

export const playerNav: NavGroup[] = [
  {
    label: "Overview",
    icon: "LayoutDashboard",
    items: [{ label: "Dashboard", href: "/app", frd: "D-01" }],
  },
  {
    label: "Play",
    icon: "Gamepad2",
    items: [
      { label: "Game lobby", href: "/app/games", frd: "G-01" },
      { label: "Tournaments", href: "/app/games/tournaments", frd: "G-03" },
      { label: "Leaderboards", href: "/app/games/leaderboard", frd: "G-04" },
      { label: "Quests & achievements", href: "/app/games/quests", frd: "G-05" },
      { label: "Points history", href: "/app/games/points-history", frd: "G-06" },
    ],
  },
  {
    label: "Wallet",
    icon: "Wallet",
    items: [
      { label: "Overview", href: "/app/wallet", frd: "W-01" },
      { label: "Convert Points", href: "/app/wallet/convert", frd: "W-02" },
      { label: "Deposit", href: "/app/wallet/deposit", frd: "W-03" },
      { label: "Withdraw", href: "/app/wallet/withdraw", frd: "W-04" },
      { label: "Transaction history", href: "/app/wallet/history", frd: "W-05" },
      { label: "Store & marketplace", href: "/app/wallet/store", frd: "W-06" },
    ],
  },
  {
    label: "Staking",
    icon: "Coins",
    items: [
      { label: "Pools", href: "/app/staking", frd: "S-01" },
      { label: "Stake / unstake", href: "/app/staking/manage", frd: "S-02" },
      { label: "Rewards history", href: "/app/staking/rewards", frd: "S-03" },
    ],
  },
  {
    label: "Referrals",
    icon: "Users",
    items: [
      { label: "Dashboard", href: "/app/referrals", frd: "R-01" },
      { label: "Downline tree", href: "/app/referrals/tree", frd: "R-02" },
      { label: "Structure & calculator", href: "/app/referrals/calculator", frd: "R-03" },
      { label: "Payout history", href: "/app/referrals/payouts", frd: "R-04" },
      { label: "Marketing assets", href: "/app/referrals/assets", frd: "R-05" },
    ],
  },
  {
    label: "Account",
    icon: "Settings",
    items: [
      { label: "Profile & settings", href: "/app/settings", frd: "D-02" },
      { label: "Security", href: "/app/settings/security", frd: "D-03" },
      { label: "Notifications", href: "/app/notifications", frd: "N-01" },
      { label: "Support", href: "/app/support", frd: "N-02" },
    ],
  },
];

/* ------------------------------- Admin panel ------------------------------ */

export const adminNav: NavGroup[] = [
  {
    label: "Overview",
    icon: "LayoutDashboard",
    items: [{ label: "Dashboard", href: "/admin", frd: "AD-01" }],
  },
  {
    label: "Users & compliance",
    icon: "ShieldCheck",
    items: [
      { label: "User management", href: "/admin/users", frd: "AD-02" },
      { label: "KYC / AML queue", href: "/admin/kyc", frd: "AD-03" },
      { label: "Fraud alerts", href: "/admin/fraud", frd: "AD-09" },
      { label: "Support tickets", href: "/admin/tickets", frd: "AD-12" },
    ],
  },
  {
    label: "Configuration",
    icon: "SlidersHorizontal",
    items: [
      { label: "Games & points", href: "/admin/games", frd: "AD-04" },
      { label: "Conversion rate", href: "/admin/conversion-rate", frd: "AD-05" },
      { label: "Staking pools", href: "/admin/staking", frd: "AD-06" },
      { label: "Referral & commission", href: "/admin/commission", frd: "AD-07" },
    ],
  },
  {
    label: "Finance",
    icon: "Landmark",
    items: [
      { label: "Revenue treasury", href: "/admin/treasury", frd: "AD-08" },
      { label: "Reports & analytics", href: "/admin/reports", frd: "AD-10" },
    ],
  },
  {
    label: "Platform",
    icon: "Cog",
    items: [
      { label: "CMS & legal", href: "/admin/cms", frd: "AD-11" },
      { label: "Roles & permissions", href: "/admin/roles", frd: "AD-13" },
      { label: "Audit log", href: "/admin/audit", frd: "AD-14" },
    ],
  },
];

/** Flattened list of every app route — used by the build-time coverage check. */
export const allRoutes: string[] = [
  "/", "/how-it-works", "/games", "/tokenomics", "/referral-program",
  "/about", "/faq", "/contact", "/blog", "/legal",
  ...legalDocs.map((d) => d.href),
  "/signup", "/verify", "/login", "/forgot-password", "/reset-password", "/kyc", "/connect-wallet",
  ...playerNav.flatMap((g) => g.items.map((i) => i.href)),
  "/app/games/play",
  ...adminNav.flatMap((g) => g.items.map((i) => i.href)),
];
