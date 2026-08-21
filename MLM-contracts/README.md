# Members Trail — MTT Smart Contracts (BNB Smart Chain)

Solidity contract suite for the Members Trail gaming platform: a BEP-20 utility
token, cliff/linear vesting, revenue-funded staking, and a revenue-funded
referral (affiliate) distributor.

**Status:** all contracts compile under Solidity 0.8.24 and pass a 61-test suite.
Deployment, role-setup, pool-setup, verification, and a full end-to-end economic
rehearsal script are included and have been executed successfully against a local
network.

---

## The one rule this codebase enforces

Every payout to a user — staking yield *and* referral commission — must come
from money the platform actually earned (in-app purchases, tournament fees,
subscriptions, marketplace fees, ads). Never from another member's deposit.

This is not just documented; it is enforced in code and covered by tests:

| Mechanism | Where |
|---|---|
| Referral commissions can never exceed cumulative Treasury deposits | `MTTReferralDistributor.recordCommission()` — reverts on `totalRecorded + amount > totalDeposited` |
| Staking rewards can only be funded by the Treasury role | `MTTStaking.fundRewardPool()` — `onlyRole(TREASURY_ROLE)`; stakers' principal is never reward budget |
| Staked principal is never confiscated | `MTTStaking.unstake()` — early-exit penalty applies only to *pending unclaimed rewards* |
| No escape hatch to drain user funds | Neither contract has a `withdraw`/`emergencyWithdraw`; verified by test |
| Backend key cannot move money | `ORACLE_ROLE` can only record entries within the already-funded cap |
| Commissions are traceable to their funding source | Every `CommissionRecorded` event carries a `sourceEventId` |

---

## Contracts

| Contract | Purpose |
|---|---|
| `MTTToken.sol` | BEP-20, fixed 1,000,000,000 supply minted once at deployment across six allocation buckets. **No mint function exists.** Pausable (emergency only) and burnable. |
| `MTTVesting.sol` | Cliff + linear vesting. One instance per beneficiary. Team: 12mo cliff / 36mo total. Advisors: 6mo cliff / 24mo total. |
| `MTTStaking.sol` | Multi-pool staking using the Synthetix streaming-rewards model. Rewards funded exclusively by `TREASURY_ROLE`. Configurable lock periods and early-exit penalties on rewards only. |
| `MTTReferralDistributor.sol` | Commission ledger with the hard on-chain solvency invariant, KYC-gated claiming, deduplication, and compliance clawback for refunds/fraud. |

### Token allocation (FRD Section 8.2)

| Bucket | % | Vesting |
|---|---|---|
| Play-to-Earn Rewards Pool | 40% | Released as users convert Points / claim staking rewards |
| Treasury Reserve | 15% | Backstop only — see note below |
| Team & Founders | 15% | 12-month cliff, 36-month total |
| Liquidity | 15% | Lock in DEX LP min. 12 months |
| Marketing & Partnerships | 10% | Linear over 24 months |
| Advisors | 5% | 6-month cliff, 24-month total |

> The Treasury Reserve is a **bootstrap backstop** for the pre-revenue period.
> It must not become the ongoing funding source for payouts. Track the ratio of
> real-revenue-funded vs. reserve-funded payouts and target 100% real-revenue
> funding within 12–18 months.

---

## Quick start

```bash
npm install
cp .env.example .env     # then fill it in
npm run compile
npm test                 # 61 tests
npm run e2e              # full economic cycle rehearsal on a local chain
```

## Deploying to BSC Testnet

```bash
npm run deploy:testnet
npm run roles:testnet
npm run pools:testnet
npm run check:testnet
```

## Deploying to BSC Mainnet

```bash
npm run deploy:mainnet   # refuses to run unless ADMIN_MULTISIG is configured
```

Then execute role grants from the multisig UI (Gnosis Safe transaction builder)
rather than a hot key, and finish with `npm run check:mainnet`.

### Verify on BscScan

```bash
npx hardhat verify --network bscMainnet <TOKEN_ADDR> \
  <admin> <rewardsPool> <treasuryReserve> <teamVesting> <liquidity> <marketing> <advisorsVesting>
```

---

## Scripts

| Script | What it does |
|---|---|
| `scripts/deploy.js` | Deploys all contracts, funds vesting, writes `deployments/<network>.json`. Refuses mainnet deploy without a configured admin multisig. |
| `scripts/setup-roles.js` | Grants `TREASURY_ROLE`, `ORACLE_ROLE`, `COMPLIANCE_ROLE`; optionally revokes deployer. |
| `scripts/setup-pools.js` | Creates Flexible / 30-day / 90-day / 180-day staking pools. |
| `scripts/post-deploy-check.js` | Verifies supply, allocations, solvency, the anti-pyramid invariant, and that no EOA retains admin rights. Exits non-zero on failure. |
| `scripts/e2e-local.js` | Simulates a full month: revenue → treasury → staking rewards + commission pool → user claims. Asserts all invariants. |

---

## Test coverage (61 tests)

```
MTTToken                        9 tests   supply, allocations, roles, pause, burn
MTTVesting                      9 tests   cliff, linear release, partial releases
MTTStaking                     20 tests   treasury-only funding, pro-rata rewards,
                                          principal safety, penalties, solvency
MTTReferralDistributor         23 tests   anti-pyramid invariant, access control,
                                          dedupe, KYC gating, clawback, solvency
```

Run `npm test` to execute. Run `npm run test:gas` for a gas report.

---

## Operational security requirements

- **Every admin/treasury address must be a multisig** (Gnosis Safe on BSC, 3-of-5 recommended). `deploy.js` blocks mainnet deployment if `ADMIN_MULTISIG` is unset.
- **Add a timelock** (24–48h) in front of the multisig for parameter changes, so users and auditors see changes before they take effect.
- **Separate the three operational keys.** Treasury (moves money), Oracle (records commissions, cannot move money), Compliance (KYC/clawback). Never combine them.
- **The Oracle key belongs in an HSM/MPC service**, not a plaintext `.env` on an app server.
- **Revoke deployer roles** after setup and confirm with `post-deploy-check.js`.

## Before mainnet — required

- [ ] Independent third-party audit (CertiK / Hacken / PeckShield or equivalent), report published
- [ ] 2–4 week soak on BSC Testnet with realistic traffic
- [ ] Multisig + timelock configured and tested
- [ ] `post-deploy-check.js` passing with zero failures on testnet
- [ ] Bug bounty program sized to expected TVL
- [ ] **Legal review** of the compensation plan, token classification, and all platform legal documents in every target jurisdiction

---

## Scope note

These contracts are the on-chain settlement and enforcement layer only.
Commission eligibility rules, per-user monthly caps, referral depth limits, KYC
tiers, and fraud detection live off-chain in the backend Commission Engine (FRD
Sections 6–7) for gas efficiency and flexibility. The contracts enforce the
non-negotiable financial invariant — never pay out more than has been funded
from real revenue — regardless of what the off-chain engine computes.
