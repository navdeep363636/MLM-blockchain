/* ============================================================================
 * Admin-side mock dataset (AD-01 .. AD-14).
 * The treasury figures are internally consistent: commission + staking outflows
 * never exceed reconciled inflows, because that invariant is the whole point of
 * the platform and the admin UI has to demonstrate it holding.
 * ========================================================================== */

import { seeded } from "@/lib/utils";
import { NOW, games } from "./data";
import type {
  AuditLogEntry, CommissionConfig, ConversionRateConfig, FraudAlert, KycSubmission,
  LegalDocument, PointsRule, RolePermission, StaffMember, TreasuryInflow, TreasuryOutflow, User,
} from "@/types";

const rnd = seeded("members-trail-admin-v1");
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number, dp = 0) => {
  const v = a + rnd() * (b - a);
  return dp === 0 ? Math.round(v) : Number(v.toFixed(dp));
};
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400_000).toISOString();
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const daysAhead = (d: number) => new Date(NOW.getTime() + d * 86400_000).toISOString();

/* --------------------------------- KPIs ---------------------------------- */

export const adminKpis = {
  dau: 41_820,
  mau: 386_400,
  dauDelta: 4.2,
  mauDelta: 11.8,
  pointsIssued30d: 1_842_000_000,
  mttCirculating: 214_800_000,
  mttStaked: 34_226_400,
  treasuryBalanceMtt: 8_412_600,
  pendingWithdrawals: 128,
  pendingWithdrawalsMtt: 486_200,
  openKycQueue: 214,
  openTickets: 87,
  openFraudAlerts: 19,
  /** THE compliance KPI: commission paid / treasury inflow. Must stay < 100%. */
  commissionPayoutRatio: 61.4,
  stakingPayoutRatio: 48.9,
  /** Share of payouts funded by real revenue vs the 15% reserve backstop. */
  realRevenueFundedPct: 88.6,
};

const MONTHS = ["Sep 25", "Oct 25", "Nov 25", "Dec 25", "Jan 26", "Feb 26", "Mar 26", "Apr 26", "May 26", "Jun 26", "Jul 26", "Aug 26"];

export const revenueByStream = MONTHS.map((month, i) => {
  const g = 1 + i * 0.14;
  return {
    month,
    iap: Math.round(180_000 * g + between(-9_000, 9_000)),
    tournament: Math.round(96_000 * g + between(-5_000, 5_000)),
    marketplace: Math.round(41_000 * g + between(-3_000, 3_000)),
    advertising: Math.round(62_000 * g + between(-4_000, 4_000)),
    subscription: Math.round(74_000 * g + between(-4_000, 4_000)),
  };
});

/** Payout vs inflow. `ratio` is the compliance line that must stay under 100. */
export const payoutVsInflow = MONTHS.map((month, i) => {
  const inflow = Math.round(148_000 * (1 + i * 0.13));
  const commission = Math.round(inflow * (0.52 + Math.sin(i / 2.1) * 0.07));
  const staking = Math.round(inflow * (0.40 + Math.cos(i / 2.6) * 0.05));
  return { month, inflow, commission, staking, ratio: Number((((commission + staking) / inflow) * 100).toFixed(1)) };
});

export const stakingTvlTrend = MONTHS.map((month, i) => ({
  month,
  tvl: Math.round(9_400_000 * (1 + i * 0.19) + between(-320_000, 320_000)),
  stakers: Math.round(11_200 * (1 + i * 0.16)),
}));

export const kycFunnel = [
  { stage: "Registered", count: 386_400 },
  { stage: "Email + phone verified", count: 301_200 },
  { stage: "KYC submitted", count: 188_900 },
  { stage: "Tier 1 approved", count: 164_100 },
  { stage: "Tier 2 approved", count: 22_480 },
];

export const cohortRetention = ["Mar 26", "Apr 26", "May 26", "Jun 26", "Jul 26", "Aug 26"].map((month, i) => ({
  month,
  d1: between(52, 61),
  d7: between(31, 40),
  d30: between(18, 26) - i,
}));

/* ------------------------------ User management -------------------------- */

const FIRST = ["Aarav", "Priya", "Rohan", "Meera", "Kabir", "Ananya", "Vikram", "Isha", "Arjun", "Nisha", "Dev", "Tara", "Omar", "Lena", "Diego", "Yuki", "Chidi", "Sofia"];
const LAST = ["Sharma", "Nair", "Kapoor", "Iyer", "Chauhan", "Reddy", "Bose", "Menon", "Fernandes", "Haddad", "Novak", "Silva", "Okafor", "Tanaka"];
const COUNTRIES = ["IN", "AE", "SG", "GB", "BR", "NG", "PH", "ID", "MX", "PL"];

export const adminUsers: User[] = Array.from({ length: 64 }, (_, i) => {
  const first = FIRST[i % FIRST.length];
  const last = LAST[(i * 3) % LAST.length];
  const risk = between(2, 96);
  const kyc = i % 9 === 0 ? "pending" : i % 13 === 0 ? "rejected" : i % 5 === 0 ? "tier2" : i % 3 === 0 ? "none" : "tier1";
  return {
    id: `USR-${10500 + i * 7}`,
    displayName: `${first} ${last[0]}.`,
    fullName: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
    phone: `+91 •••• ••${between(10, 99)}${between(10, 99)}`,
    country: COUNTRIES[i % COUNTRIES.length],
    dateOfBirth: `19${between(80, 99)}-0${between(1, 9)}-1${between(0, 9)}`,
    avatarUrl: null,
    status: i % 17 === 0 ? "frozen" : i % 11 === 0 ? "suspended" : kyc === "none" ? "verified_kyc_pending" : "active",
    kycTier: kyc as User["kycTier"],
    twoFactorEnabled: i % 4 !== 0,
    walletAddress: `0x${Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("")}`,
    walletType: i % 3 === 0 ? "custodial" : "external",
    referralCode: `MTT-${Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(rnd() * 32)]).join("")}`,
    referredBy: i % 3 === 0 ? null : `USR-${10500 + ((i * 3) % 40) * 7}`,
    joinedAt: daysAgo(between(3, 300)),
    lastActiveAt: hoursAgo(between(0, 400)),
    riskScore: risk,
    riskFlags: risk > 70 ? pick([["velocity"], ["device_cluster", "velocity"], ["self_referral_suspected"]]) : [],
  } satisfies User;
});

/* --------------------------------- KYC queue ----------------------------- */

export const kycQueue: KycSubmission[] = Array.from({ length: 22 }, (_, i) => {
  const u = adminUsers[i * 2];
  const conf = between(38, 99);
  return {
    id: `KYC-${8000 + i}`,
    userId: u.id,
    userName: u.fullName,
    submittedAt: hoursAgo(between(1, 96)),
    tier: (i % 5 === 0 ? 2 : 1) as 1 | 2,
    riskScore: u.riskScore,
    status: i < 14 ? "pending" : i < 18 ? "more_info" : i < 20 ? "approved" : "rejected",
    documents: [
      { kind: "id_front", filename: `id_front_${u.id}.jpg` },
      { kind: "id_back", filename: `id_back_${u.id}.jpg` },
      { kind: "selfie", filename: `selfie_${u.id}.jpg` },
      ...(i % 5 === 0 ? [{ kind: "address_proof" as const, filename: `addr_${u.id}.pdf` }] : []),
    ],
    providerConfidence: conf,
    country: u.country,
    notes: conf < 60 ? "Provider confidence below auto-approve threshold — manual review required." : undefined,
  } satisfies KycSubmission;
});

/* -------------------------------- Treasury ------------------------------- */

const STREAM_ALLOC: Record<TreasuryInflow["stream"], number> = {
  iap: 30, tournament: 20, marketplace: 25, advertising: 40, subscription: 30,
};

export const treasuryInflows: TreasuryInflow[] = Array.from({ length: 28 }, (_, i) => {
  const stream = (["iap", "tournament", "marketplace", "advertising", "subscription"] as const)[i % 5];
  const gross = between(18_000, 148_000);
  const pct = STREAM_ALLOC[stream];
  return {
    id: `TD-2026-W${34 - Math.floor(i / 5)}-${i % 5}`,
    date: daysAgo(i * 2 + 1),
    stream,
    grossRevenue: gross,
    treasuryAllocationPct: pct,
    amountToTreasury: Math.round((gross * pct) / 100),
    processorRef: `${stream === "iap" ? "RZP" : stream === "subscription" ? "STR" : "PSP"}-${between(100000, 999999)}`,
    reconciled: i > 2,
  } satisfies TreasuryInflow;
});

export const treasuryOutflows: TreasuryOutflow[] = Array.from({ length: 20 }, (_, i) => ({
  id: `TO-${900 + (20 - i)}`,
  date: daysAgo(i * 3 + 1),
  destination: i % 3 === 0 ? "commission_pool" : "staking_pool",
  poolId: i % 3 === 0 ? undefined : i % 4,
  amount: between(9_000, 74_000),
  txHash: `0x${Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("")}`,
  approvedBy: ["S. Kulkarni", "R. Menon", i % 2 ? "T. Alves" : "M. Haddad"],
}));

export const treasuryTotals = (() => {
  const inflow = treasuryInflows.filter((i) => i.reconciled).reduce((s, i) => s + i.amountToTreasury, 0);
  const outflow = treasuryOutflows.reduce((s, o) => s + o.amount, 0);
  const commission = treasuryOutflows.filter((o) => o.destination === "commission_pool").reduce((s, o) => s + o.amount, 0);
  const staking = outflow - commission;
  return {
    reconciledInflow: inflow,
    unreconciledInflow: treasuryInflows.filter((i) => !i.reconciled).reduce((s, i) => s + i.amountToTreasury, 0),
    totalOutflow: outflow,
    commissionOutflow: commission,
    stakingOutflow: staking,
    headroom: inflow - outflow,
    utilisationPct: Number(((outflow / inflow) * 100).toFixed(1)),
  };
})();

/* ------------------------------ Fraud alerts ----------------------------- */

const ALERT_DEFS: Array<[FraudAlert["kind"], string, string[]]> = [
  ["self_referral_ring", "Closed referral loop detected: 4 accounts referring each other with shared payment fingerprint.", ["Same card BIN across 4 accounts", "Circular sponsor graph A→B→C→A", "All registered within 38 minutes"]],
  ["bot_farming", "Points velocity 9.4σ above cohort mean with near-identical session durations.", ["Session length variance < 0.4s", "No input jitter", "412 sessions in 24h"]],
  ["multi_account", "11 accounts sharing one device fingerprint and IP /32.", ["Identical canvas hash", "Same IP 103.•.•.•", "Sequential email pattern"]],
  ["velocity", "Withdrawal velocity spike: 6 requests in 40 minutes to 6 new addresses.", ["All destinations first-seen", "Amounts just under review threshold"]],
  ["structuring", "Repeated withdrawals at 98% of the auto-approval threshold.", ["14 withdrawals in 9 days", "Mean 4,900 of 5,000 cap"]],
  ["device_cluster", "Device cluster of 7 accounts converting Points at the daily cap every day.", ["Cap hit 21 days consecutively", "Shared GPU fingerprint"]],
];

export const fraudAlerts: FraudAlert[] = Array.from({ length: 19 }, (_, i) => {
  const [kind, summary, signals] = ALERT_DEFS[i % ALERT_DEFS.length];
  const score = between(45, 98);
  return {
    id: `FA-${6000 + (19 - i)}`,
    raisedAt: hoursAgo(between(1, 140)),
    kind,
    severity: score > 88 ? "critical" : score > 74 ? "high" : score > 58 ? "medium" : "low",
    riskScore: score,
    affectedUsers: Array.from({ length: between(1, 4) }, (_, k) => {
      const u = adminUsers[(i * 5 + k * 3) % adminUsers.length];
      return { id: u.id, name: u.fullName };
    }),
    summary,
    status: i < 11 ? "open" : i < 15 ? "investigating" : i < 17 ? "actioned" : "dismissed",
    signals,
  } satisfies FraudAlert;
});

/* -------------------------------- Config --------------------------------- */

export const conversionRates: ConversionRateConfig[] = [
  { pointsPerMtt: 1_050, effectiveFrom: daysAhead(12), proposedBy: "S. Kulkarni (Finance)", status: "pending_approval" },
  { pointsPerMtt: 1_000, effectiveFrom: daysAgo(24), proposedBy: "S. Kulkarni (Finance)", approvedBy: "R. Menon (Compliance)", status: "active" },
  { pointsPerMtt: 950, effectiveFrom: daysAgo(86), proposedBy: "S. Kulkarni (Finance)", approvedBy: "M. Haddad (Super Admin)", status: "superseded" },
  { pointsPerMtt: 900, effectiveFrom: daysAgo(148), proposedBy: "T. Alves (Finance)", approvedBy: "M. Haddad (Super Admin)", status: "superseded" },
];

export const conversionCaps = {
  perUserDaily: 25_000,
  perUserMonthly: 400_000,
  globalDaily: 42_000_000,
  globalDailyUsed: 28_400_000,
};

export const commissionConfig: CommissionConfig = {
  levels: [{ level: 1, ratePct: 8 }, { level: 2, ratePct: 3 }, { level: 3, ratePct: 1 }],
  eligibleTypes: ["iap", "tournament_entry", "subscription"],
  monthlyCapAbsolute: 50_000,
  monthlyCapMultiplier: 5,
  monthlyCapBase: 5_000,
  maxDepth: 3,
  minAccountAgeDays: 7,
  minGameplaySessions: 5,
};

export const pointsRules: PointsRule[] = games.flatMap((g) =>
  ["Win", "Session complete", "Daily quest", "Rewarded ad"].map((action) => ({
    gameId: g.id,
    gameTitle: g.title,
    action,
    points: action === "Win" ? between(120, 400) : action === "Session complete" ? between(40, 120) : action === "Daily quest" ? between(150, 450) : between(40, 90),
    dailyCapPerUser: g.dailyPointsCap,
    enabled: g.active,
  })),
);

/* ---------------------------------- Staff -------------------------------- */

export const staff: StaffMember[] = [
  { id: "STF-1", name: "M. Haddad", email: "m.haddad@memberstrail.com", role: "super_admin", twoFactorEnabled: true, lastActiveAt: hoursAgo(1), active: true },
  { id: "STF-2", name: "S. Kulkarni", email: "s.kulkarni@memberstrail.com", role: "finance_admin", twoFactorEnabled: true, lastActiveAt: hoursAgo(3), active: true },
  { id: "STF-3", name: "R. Menon", email: "r.menon@memberstrail.com", role: "compliance", twoFactorEnabled: true, lastActiveAt: hoursAgo(2), active: true },
  { id: "STF-4", name: "T. Alves", email: "t.alves@memberstrail.com", role: "finance_admin", twoFactorEnabled: true, lastActiveAt: daysAgo(1), active: true },
  { id: "STF-5", name: "A. Fernandes", email: "a.fernandes@memberstrail.com", role: "support", twoFactorEnabled: true, lastActiveAt: hoursAgo(4), active: true },
  { id: "STF-6", name: "K. Bose", email: "k.bose@memberstrail.com", role: "support", twoFactorEnabled: false, lastActiveAt: daysAgo(4), active: true },
  { id: "STF-7", name: "P. Okafor", email: "p.okafor@memberstrail.com", role: "compliance", twoFactorEnabled: true, lastActiveAt: daysAgo(9), active: false },
];

export const MODULES = [
  "Dashboard", "User management", "KYC / AML review", "Game & points config",
  "Conversion rate", "Staking pools", "Referral config", "Revenue treasury",
  "Fraud alerts", "Reports", "CMS / legal", "Support tickets", "Roles", "Audit log",
];

export const rolePermissions: Record<StaffMember["role"], RolePermission[]> = {
  support: MODULES.map((m) => ({
    module: m,
    read: ["Dashboard", "User management", "Support tickets"].includes(m),
    write: m === "Support tickets",
    approve: false,
  })),
  compliance: MODULES.map((m) => ({
    module: m,
    read: !["Conversion rate", "Staking pools", "Referral config", "Roles"].includes(m),
    write: ["KYC / AML review", "Fraud alerts", "Support tickets", "User management"].includes(m),
    approve: ["KYC / AML review", "Fraud alerts", "Conversion rate", "Referral config"].includes(m),
  })),
  finance_admin: MODULES.map((m) => ({
    module: m,
    read: m !== "Roles",
    write: ["Conversion rate", "Staking pools", "Referral config", "Revenue treasury", "Game & points config", "Reports"].includes(m),
    approve: ["Conversion rate", "Staking pools", "Revenue treasury"].includes(m),
  })),
  super_admin: MODULES.map((m) => ({ module: m, read: true, write: true, approve: true })),
};

/* -------------------------------- Audit log ------------------------------ */

const AUDIT_DEFS: Array<[string, string, string, string, boolean]> = [
  ["Conversion rate proposed", "ConversionRateConfig", "1,000 Points / MTT", "1,050 Points / MTT", true],
  ["KYC approved", "USR-10528", "pending", "tier1", false],
  ["Account frozen", "USR-10717", "active", "frozen", true],
  ["Treasury outflow approved", "TO-918", "—", "42,800 MTT → staking pool 2", true],
  ["Commission rate updated", "CommissionConfig.L2", "3.5%", "3.0%", true],
  ["Manual balance adjustment", "USR-10605", "1,240.00 MTT", "1,580.00 MTT", true],
  ["Staking pool created", "Pool 3", "—", "180-day / 40% penalty", true],
  ["Legal document published", "terms-and-conditions", "v2.3", "v2.4", false],
  ["Role assigned", "STF-6", "—", "support", true],
  ["Fraud alert actioned", "FA-6011", "open", "actioned", false],
  ["Points rule updated", "GAME-101 / Win", "260 pts", "300 pts", false],
  ["Session revoked", "USR-10428", "active session", "revoked", false],
];

export const auditLog: AuditLogEntry[] = Array.from({ length: 40 }, (_, i) => {
  const [action, target, before, after, needsApproval] = AUDIT_DEFS[i % AUDIT_DEFS.length];
  const actor = staff[i % staff.length];
  return {
    id: `AL-${20000 + (40 - i)}`,
    timestamp: hoursAgo(i * 5 + between(0, 3)),
    actor: actor.name,
    actorRole: actor.role,
    action, target, before, after,
    ip: `103.${between(10, 250)}.${between(1, 250)}.${between(1, 250)}`,
    requiresSecondApproval: needsApproval,
    approvedBy: needsApproval ? staff[(i + 2) % staff.length].name : undefined,
  } satisfies AuditLogEntry;
});
