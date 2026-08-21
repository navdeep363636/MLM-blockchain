export interface FaqItem {
  q: string;
  a: string;
  category?: string;
}

export const FAQ_CATEGORIES: { label: string; items: FaqItem[] }[] = [
  {
    label: "Getting started",
    items: [
      {
        q: "What is Members Trail, in one paragraph?",
        a: "It's a skill-based gaming platform. You play games and earn Points, which are an off-chain, non-transferable in-game currency. You can convert Points into MTT — a BEP-20 utility token on BNB Smart Chain — then stake MTT for a revenue-funded reward stream, spend it in the store, or withdraw it to your own wallet. There's also an optional referral programme that pays a capped percentage of what people you refer actually spend.",
      },
      {
        q: "Does it cost anything to join?",
        a: "No. Registration is free and there is no joining fee, membership fee, or required purchase — now or later. This matters legally as well as practically: a scheme that charges people to join and then distributes that money upward to earlier members is a pyramid scheme, and that structure is unlawful in most jurisdictions. We don't have one.",
      },
      {
        q: "Do I need to refer anyone to earn?",
        a: "No, and this is the single most important thing to understand about the platform. Gameplay and staking give you access to 100% of what Members Trail pays out. Referrals are an optional marketing bonus on top. If you never share your code, nothing about your account is limited.",
      },
      {
        q: "How old do I have to be?",
        a: "18, or higher if your jurisdiction sets a higher minimum for this kind of platform. We check declared date of birth at sign-up and cross-check your declared country against your IP address. Some jurisdictions are restricted entirely, and sign-ups from them are rejected at the registration step.",
      },
      {
        q: "Can I try it without registering?",
        a: "Yes. Any game can be launched in demo mode without an account. You get the full game; the only difference is that demo Points aren't saved, because there's no account ledger to save them to. Demo sessions don't count toward daily caps and don't affect leaderboards.",
      },
      {
        q: "What can I do before completing KYC?",
        a: "Once your email and phone are verified you can play in free mode and earn real Points immediately. KYC Tier 1 is required before three things: converting Points to MTT, making your first withdrawal, and having referral commission released to a withdrawable state. Commission still accrues in a pending state while you're unverified.",
      },
    ],
  },
  {
    label: "Earning & Points",
    items: [
      {
        q: "How are Points calculated?",
        a: "Server-side. Your client streams signed telemetry during a session, and when the session ends the backend recomputes the score itself — or validates your client's result against the server-known rules and random seed — before crediting anything. A score your client simply asserts is never trusted on its own. This is what stops bots and modified clients.",
      },
      {
        q: "Why is there a daily cap on Points?",
        a: "Two reasons. It controls how fast tokens enter circulation, which protects the value of what everyone else has earned. And it makes farming unprofitable: a bot that can play 400 sessions a day earns no more than a person who plays to the cap. Caps apply per user, per game, and per device/IP fingerprint.",
      },
      {
        q: "Can I lose Points I've already earned?",
        a: "Points are only reversed if a session is later found to be invalid — a detected exploit, a bot, or a payment that was charged back. Legitimate earned Points aren't removed. If Points are adjusted on your account, it requires a documented reason and a second administrator's approval, and it appears in your Points history.",
      },
      {
        q: "Is free play worse than paid play?",
        a: "No, and we treat this as a hard requirement rather than a preference. Free-mode Points earning is never throttled to pressure you toward paid entry. Paid tournaments offer prize pools, not better Points rates.",
      },
      {
        q: "What are quests and achievements worth?",
        a: "Quests refresh daily and weekly and award bonus Points; achievements are one-time milestones. Both are subject to the same daily Points issuance cap as gameplay, so completing every quest doesn't let you exceed the cap.",
      },
      {
        q: "Do rewarded ads really pay?",
        a: "Yes, and they're one of the cleanest revenue streams on the platform — 40% of net ad revenue flows to the Revenue Treasury, which is what funds staking rewards and commissions. Watching an ad is always optional.",
      },
    ],
  },
  {
    label: "MTT & wallet",
    items: [
      {
        q: "What exactly is MTT?",
        a: "A BEP-20 utility token on BNB Smart Chain with 18 decimals and a fixed total supply of 1,000,000,000, all minted at deployment across six allocation wallets. There is no mint function in the production contract, so the supply cannot be inflated later. It's burnable, and transfers can be paused only as an emergency circuit breaker by a timelocked multisig, with public disclosure.",
      },
      {
        q: "Is MTT an investment?",
        a: "No. MTT is a utility and access token for gameplay and rewards. It isn't offered as an investment, carries no promise or expectation of profit, and its market price can fall to zero. Staking yield is variable and derived from actual revenue — it is not a fixed or guaranteed return. Please read the Risk Disclosure Statement before acquiring or converting MTT.",
      },
      {
        q: "How is the Points-to-MTT conversion rate set?",
        a: "A Finance Admin proposes a rate and a second authorised admin must approve it — the four-eyes principle. Changes take a scheduled effective date and are never applied retroactively. The complete rate history is permanently retained and published on the Tokenomics page.",
      },
      {
        q: "Can I use my own wallet, or do you hold my keys?",
        a: "Either. You can connect an external BSC wallet — MetaMask, Trust Wallet, or anything WalletConnect supports — and hold your own keys. Or you can use a platform wallet, in which case keys are managed by an HSM/MPC key-management service and are never stored in plaintext in our database. Once a wallet address is linked to a KYC-verified identity it can't be changed without re-verification.",
      },
      {
        q: "Why is there a delay on my first withdrawal to a new address?",
        a: "New or changed destination addresses trigger a cooling-off period of 24–48 hours before the first withdrawal to that address. It's an anti-fraud measure: if someone compromises your account and swaps the payout address, that window is what gives you and our compliance team time to catch it.",
      },
      {
        q: "Can I see proof of my transactions on-chain?",
        a: "Yes. Every on-chain event in your transaction history carries its transaction hash and links directly to BscScan. Conversions, stakes, unstakes, reward claims, commission claims and MTT withdrawals are all verifiable independently of anything we tell you.",
      },
    ],
  },
  {
    label: "Staking",
    items: [
      {
        q: "Where does staking yield come from?",
        a: "Exclusively from the Revenue Treasury, which holds a published share of real platform revenue: in-app purchases, tournament rake, marketplace fees, advertising and subscriptions. Finance triggers a multisig transaction calling fundRewardPool() on the staking contract, and that function is the only way a reward balance can grow. Rewards are never paid from other stakers' principal.",
      },
      {
        q: "Why isn't the APR fixed?",
        a: "Because it's funded rather than promised. APR for a period is the reward-pool inflow for that period divided by total value staked, annualised. If revenue rises, APR rises; if more people stake the same pool, each staker's share falls. A platform advertising a fixed, guaranteed high APR is describing something the arithmetic can't support — that's the most common red flag in enforcement actions.",
      },
      {
        q: "Is my staked principal at risk?",
        a: "Not from the protocol. The staking contract has no withdraw or emergencyWithdraw function — there is no call an administrator could make to move your principal. Unstaking always returns your full principal. This is verified by the contract test suite.",
      },
      {
        q: "What happens if I unstake early from a locked pool?",
        a: "You get 100% of your principal back. The early-exit penalty applies only to pending, unclaimed rewards — a configured percentage of them is forfeited to the Treasury. The exact penalty and amount are shown before you confirm, and you have to acknowledge them explicitly.",
      },
      {
        q: "Which pool should I choose?",
        a: "We can't advise you on that. Mechanically: the Flexible pool has no lock and no penalty; the 30, 90 and 180-day pools lock your principal for that period and carry escalating early-exit penalties on unclaimed rewards, with modestly higher reward rates to compensate for the commitment. Longer locks are not guaranteed to yield more in absolute terms.",
      },
    ],
  },
  {
    label: "Referrals",
    items: [
      {
        q: "What is commission actually calculated on?",
        a: "A referred player's verified real-money spend — in-app purchases, tournament entry fees, and Premium Pass subscriptions. It is never calculated on their Points-to-MTT conversions, their staking deposits, or their stake principal. Passing a member's deposit upward is precisely what makes a scheme unlawful, so the system is built so it cannot happen.",
      },
      {
        q: "How deep does the structure go?",
        a: "Three levels, hard-capped: 8% at Level 1 (your direct referral), 3% at Level 2, 1% at Level 3. It does not go further no matter how large your network becomes.",
      },
      {
        q: "What's my monthly cap and why do I have one?",
        a: "Your cap is the lower of an absolute ceiling (₹50,000) and a formula tied to your own genuine spending: five times your trailing three-month average real-money spend plus a ₹5,000 base allowance. The cap ties your earning ceiling loosely to your own engagement as a player rather than purely as a recruiter, which keeps referral income secondary. Amounts above the cap are not paid and do not carry over.",
      },
      {
        q: "Why was my commission queued instead of paid?",
        a: "Because the commission pool didn't have enough funded balance at the moment of calculation. The entry queues and pays out once the next Treasury deposit from reconciled revenue lands. The distributor contract enforces this on-chain: it reverts rather than recording commission beyond what has been deposited.",
      },
      {
        q: "Can I see who's in my downline?",
        a: "You see aggregate, anonymised data only — for example 'Member #4821, joined 3 months ago, active'. You never see another user's contact details, balances or transaction specifics. That's a privacy requirement, not a limitation of the interface.",
      },
      {
        q: "What am I not allowed to say when sharing my code?",
        a: "You may not make unsubstantiated income claims. That includes stating or implying guaranteed returns, presenting your own results as typical, 'passive income' framing, or suggesting that joining guarantees anything. The marketing assets we provide are pre-approved and contain no earnings claims — using them keeps you safe. Breaching this can mean removal from the programme and forfeiture of pending commission.",
      },
    ],
  },
  {
    label: "KYC & withdrawals",
    items: [
      {
        q: "What does Tier 1 KYC involve?",
        a: "A government ID (front and back) and a selfie with a liveness check, matched against the ID by a third-party KYC provider. Most submissions are decided automatically; low-confidence results go to a manual review queue staffed by our compliance team.",
      },
      {
        q: "When do I need Tier 2?",
        a: "Only above a configurable cumulative withdrawal threshold. Tier 2 adds proof of address. If you never cross the threshold you're never asked for it.",
      },
      {
        q: "How are my KYC documents stored?",
        a: "Encrypted at rest with AES-256. Access is restricted to the Compliance role, every access is logged, and documents are retained for the period the AML policy requires (typically five years) and then deleted.",
      },
      {
        q: "Why is my withdrawal under manual review?",
        a: "Withdrawals above a configured threshold always route to the compliance queue — that's a standard AML control, not a signal that anything is wrong with your account. Withdrawals are also tagged by source (gameplay, staking, or referral) for monitoring purposes.",
      },
      {
        q: "Can I withdraw to fiat?",
        a: "Where a payout method is supported in your region, yes — via a PCI-DSS compliant payment processor. Otherwise you withdraw MTT to your own wallet. Both routes are subject to the same KYC tiers and limits.",
      },
    ],
  },
  {
    label: "Security & disputes",
    items: [
      {
        q: "What security should I have on my account?",
        a: "Two-factor authentication, either SMS or a TOTP authenticator app — the authenticator app is stronger. You can review active sessions and login history at any time, revoke an individual session, or log out of all devices. Disabling 2FA requires re-authentication with your password and current 2FA code.",
      },
      {
        q: "Have the smart contracts been audited?",
        a: "An independent third-party audit before mainnet deployment is a requirement, and the report will be published. The contracts also go through a testnet soak period of at least 2–4 weeks, and a bug bounty programme runs post-launch sized to the value locked. Until an audit report is published, treat the contracts as unaudited.",
      },
      {
        q: "Who controls the treasury and contract parameters?",
        a: "A multisig wallet with a minimum of three-of-five trusted signers, with a timelock on parameter changes so that users and auditors can see a change before it takes effect. No single key controls funds. The backend relayer that records commissions has narrow permissions — it can record entries within the already-funded cap but cannot move money.",
      },
      {
        q: "How do I dispute a commission or a withdrawal?",
        a: "Open a support ticket in the Commission or Withdrawal category, or use the dispute action on the specific line in your payout history. Financial disputes are automatically routed to compliance-trained agents with SLA tracking, rather than general support.",
      },
      {
        q: "What if I want to stop playing?",
        a: "You can set deposit, spend and session limits, take a cooling-off break, or self-exclude entirely from the Responsible Gaming settings. Self-exclusion is honoured immediately and can't be reversed by support during the exclusion period. You can also request account deletion and data erasure under the Privacy Policy.",
      },
    ],
  },
];
