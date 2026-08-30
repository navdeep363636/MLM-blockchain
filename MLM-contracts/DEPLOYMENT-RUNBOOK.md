# Members Trail — deployment runbook

**Target: BSC Testnet (chain 97).** Mainnet differences are in §9 and should not be attempted until §10 is satisfied.

Verified against a full local rehearsal on 30 August 2026: `deploy → roles → pools → payout → check` completed with **23/23 post-deployment checks passing** and **109/109 contract tests passing**.

---

## 0. What you are deploying

Six on-chain instances from five contracts. All immutable — no proxies, no upgrade path.

| # | Contract | What it is |
|---|---|---|
| 1 | `MTTToken` | Fixed 1,000,000,000 supply, minted once across six buckets. No mint function. |
| 2 | `TeamVesting` | 12-month cliff, 36-month linear. Holds 15%. |
| 3 | `AdvisorsVesting` | 6-month cliff, 24-month linear. Holds 5%. |
| 4 | `MTTStaking` | Multi-pool staking. No pause, no escape hatch. |
| 5 | `MTTReferralDistributor` | Commission ledger enforcing `totalRecorded <= totalDeposited`. |
| 6 | `MTTPayout` | Withdrawal settlement rail with replay guard and daily ceiling. |

**This is irreversible.** The supply is fixed at deployment and there is no upgrade mechanism. A wrong allocation address is permanent.

---

## 1. Wallets you need

You need **one signing key** and **nine addresses**. Only the deployer ever signs during deployment.

### The one key that signs

| Wallet | Needs funds? | What it does |
|---|---|---|
| **Deployer** | **Yes — tBNB for gas** | Sends all six deployments. Momentarily holds the team and advisor allocations inside the script run, forwards them to the vesting contracts, and ends at a zero token balance (asserted by the post-deployment check). On testnet it also becomes admin. |

### Six allocation addresses — receive tokens, never sign during deployment

| Wallet | Receives | Why it must be distinct |
|---|---|---|
| **Rewards pool** | 400,000,000 MTT (40%) | Funds Points→MTT conversions and the payout float |
| **Treasury reserve** | 150,000,000 MTT (15%) | Bootstrap backstop. Also the staking penalty receiver |
| **Liquidity** | 150,000,000 MTT (15%) | DEX pairs |
| **Marketing** | 100,000,000 MTT (10%) | Growth |
| **Team beneficiary** | — (vesting contract holds the 15%) | The address `release()` pays to |
| **Advisors beneficiary** | — (vesting contract holds the 5%) | The address `release()` pays to |

The preflight check fails if any two of these are the same address, and warns if any is the deployer.

### Three operational addresses — granted roles after deployment

| Wallet | Role granted | What it can do |
|---|---|---|
| **Treasury operations** | `TREASURY_ROLE` on staking, distributor and payout; `POOL_ADMIN_ROLE` on staking | Fund reward pools, deposit to the commission pool, fund and sweep the payout float, create pools |
| **Backend relayer** | `ORACLE_ROLE` on the distributor, `PAYER_ROLE` on payout | Record commission inside the already-funded cap; execute member payouts. **Cannot move funds, cannot fund itself, cannot pause.** This is the always-online hot key |
| **Compliance signer** | `COMPLIANCE_ROLE` on the distributor | Set on-chain KYC flags, claw back commission |

**Never give the relayer any other role.** The post-deployment check treats a privileged relayer as informational on testnet and a **hard failure on mainnet**.

### For a testnet rehearsal

A pre-generated set already exists in `TESTNET-WALLETS.json` (gitignored, and self-labelled *"treat them as public"*). Using it is fine for a rehearsal. **Never reuse any of those keys on mainnet.**

---

## 2. Paying the fees

Gas is paid in BNB by the **deployer only**. No other wallet needs a balance.

| Network | Currency | How to get it | Amount |
|---|---|---|---|
| Testnet (97) | tBNB | <https://www.bnbchain.org/en/testnet-faucet> — paste the deployer address | ~0.1 tBNB covers the whole sequence |
| Mainnet (56) | BNB | Buy on an exchange, withdraw to the deployer on **BNB Smart Chain (BEP-20)** | ~0.05 BNB measured; fund **0.15 BNB** for headroom |

Sending BNB on the wrong network — BNB Beacon Chain, or an ERC-20 wrapper on Ethereum — loses it. Confirm **BNB Smart Chain / BEP-20** in the withdrawal screen.

The deployer needs **no MTT**. Reward-pool funding (§7) is a separate, later step signed by the treasury operations wallet.

---

## 3. Configure

```bash
cd MLM-contracts
cp env.testnet.template.txt .env
```

Then edit `.env`:

```ini
DEPLOYER_PRIVATE_KEY=            # ← the only secret. Never commit it.
BSC_TESTNET_RPC=https://bsc-testnet-rpc.publicnode.com
BSCSCAN_API_KEY=                 # etherscan.io key, NOT a legacy bscscan.com key

ADMIN_MULTISIG=                  # leave BLANK on testnet — see below

REWARDS_POOL_WALLET=0x...
TREASURY_RESERVE_WALLET=0x...
LIQUIDITY_WALLET=0x...
MARKETING_WALLET=0x...
TEAM_BENEFICIARY=0x...
ADVISORS_BENEFICIARY=0x...

TREASURY_OPS_MULTISIG=0x...
BACKEND_ORACLE_ADDRESS=0x...
COMPLIANCE_SIGNER_ADDRESS=0x...

PAYOUT_DAILY_LIMIT_MTT=50000
REVOKE_DEPLOYER=false
```

**Leave `ADMIN_MULTISIG` blank on testnet.** The deploy script then falls back to the deployer, which is what lets the role and pool scripts execute directly. Set it to a separate address and those scripts correctly refuse to send and write Safe calldata instead — right for mainnet, an obstacle for a rehearsal.

`.env` is already gitignored. Confirm before you fill it in:

```bash
git check-ignore -v .env        # must print a match
```

### On the API key

BscScan verification goes through the Etherscan V2 multi-chain endpoint, which takes **one etherscan.io key** covering BSC. A legacy bscscan.com key fails with a misleading error. Get one at <https://etherscan.io/myapikey>.

---

## 4. Preflight — before spending any gas

```bash
npm install
npm run compile
npm test                        # expect: 109 passing
npm run preflight:testnet
```

The preflight validates the chain id against the live RPC, the deployer balance, that every allocation address is present, valid and distinct, that the relayer is not the admin, and the mainnet gates. **It exits non-zero on any failure — do not proceed past a FAIL.**

---

## 5. Deploy

```bash
npm run deploy:testnet
```

Six deployments plus two forwarding transfers. Writes `deployments/bscTestnet.json` containing every address **and every constructor argument**, which is what makes verification possible afterwards.

**Commit that file.** It is how a deployed address traces back to a commit:

```bash
git add deployments/bscTestnet.json && git commit -m "chore: record BSC testnet deployment"
```

---

## 6. Grant roles and create pools

```bash
npm run roles:testnet
npm run pools:testnet
```

`roles:testnet` grants the seven role assignments in §1. If the signer does not hold admin on every contract it **sends nothing** and writes `deployments/bscTestnet.role-calldata.json` for execution from a Safe.

`pools:testnet` creates the four pools:

| id | Name | Lock | Reward stream | Early-exit penalty |
|---|---|---|---|---|
| 0 | Flexible | 0 days | 7 days | 0% |
| 1 | 30-Day | 30 days | 30 days | 20% |
| 2 | 90-Day | 90 days | 30 days | 30% |
| 3 | 180-Day | 180 days | 30 days | 40% |

Penalties apply to **unclaimed rewards only** — never to principal.

---

## 7. Fund the rails

Two separate funding actions, both signed by the **treasury operations** wallet, which must hold MTT. Move tokens from the rewards-pool wallet to it first.

### Staking rewards

```bash
FUND_POOL_ID=1 FUND_AMOUNT_MTT=25000 npm run fund:testnet
```

Pools pay **nothing** until this runs. There is no APR to set — the rate members see is this funding divided by what is staked, over the stream window. Fund more and the rate rises; the same funding into a larger pool means a smaller share each.

If the signer lacks `TREASURY_ROLE` the script prints approve + fund calldata and writes it to a file instead of sending.

### Payout float

```bash
PAYOUT_FLOAT_MTT=10000 PAYOUT_DAILY_LIMIT_MTT=5000 npm run payout:testnet
```

Keep the daily limit **at or below the float** — the post-deployment check enforces this, because *a limit larger than the float it guards is not a limit*. And set it to no more than half of what a genuine incident could tolerate: the window resets rather than sliding, so two windows can sit back to back.

---

## 8. Validate and verify

```bash
npm run check:testnet           # expect: 23 passed, 0 failed
npm run verify:testnet
```

`verify:testnet` reads the recorded constructor arguments and verifies all six instances. Two of them cannot be verified without that record: the token's team and advisor positions hold the **deployer** address (the allocations mint there and are forwarded immediately), and the vesting `start` is the deploy block timestamp when `VESTING_START_UNIX` is unset.

Already-verified contracts are skipped, so it is safe to re-run.

---

## 9. Wire the applications

Deployment is not finished until the backend and frontend point at it.

**Backend** — `members-trail-api/.env`:

```ini
CHAIN_ID=97
BSC_RPC_URLS=https://bsc-testnet-rpc.publicnode.com
MTT_TOKEN_ADDRESS=0x...
STAKING_ADDRESS=0x...
REFERRAL_DISTRIBUTOR_ADDRESS=0x...
PAYOUT_ADDRESS=0x...
TEAM_VESTING_ADDRESS=0x...
ADVISORS_VESTING_ADDRESS=0x...
INDEXER_ENABLED=true
INDEXER_START_BLOCK=<the deploy block>
ORACLE_PRIVATE_KEY=<relayer key>
```

**Set `PAYOUT_ADDRESS`.** Without it withdrawals fall back to a direct token transfer from the relayer key, which needs that hot key to hold the rewards pool with no daily limit and no replay guard. The fallback warns on every single payout because it is the design the rail exists to replace.

Regenerate the ABIs so both applications match the deployed bytecode:

```bash
npm run abi                     # in MLM-contracts
```

The indexer refuses to boot if any watched event or callable function name is absent from the generated ABI — that guard exists because hand-written fragments were once wrong for 7 of 8 events, and a wrong event signature makes log queries match nothing **without throwing**.

**Frontend** — `members-trail-frontend/.env.local`:

```ini
NEXT_PUBLIC_CHAIN_ID=97
NEXT_PUBLIC_MTT_TOKEN_ADDRESS=0x...
NEXT_PUBLIC_STAKING_ADDRESS=0x...
NEXT_PUBLIC_REFERRAL_DISTRIBUTOR_ADDRESS=0x...
NEXT_PUBLIC_PAYOUT_ADDRESS=0x...
```

Until these are set the app shows a demo-mode banner and reads from the ledger instead of the chain.

---

## 10. Mainnet — what changes

Everything above still applies. These are additional and non-negotiable.

**Wallet architecture.** Every address in §1 becomes a **Gnosis Safe**, not an EOA, except the backend relayer — which stays an EOA because it must sign automatically, and therefore belongs in a KMS or HSM. The recommended shape is a 3-of-5 Safe for admin with a 24–48 hour timelock.

**The deploy script refuses to run** on chain 56 with `ADMIN_MULTISIG` unset. With it set, `roles:mainnet` sends nothing and writes calldata for the Safe. That is not a fallback — a script that could grant roles on a multisig-owned contract would mean the multisig was not really in control.

**Set `REVOKE_DEPLOYER=true`.** Roles are revoked only after verifying on-chain that someone else holds each one, so revoking the last holder cannot make a contract permanently unmanageable.

**Three gates are code, not policy:**

1. `preflight:mainnet` fails if `REVOKE_DEPLOYER` is not true, if any allocation wallet is the deployer, or if the relayer is the admin.
2. `deploy.js` throws on chain 56 with no admin multisig.
3. `check:mainnet` turns three informational lines into **hard failures**: the deployer must hold no admin role on the token, staking or distributor, and the relayer must hold `PAYER_ROLE` and nothing else.

**Before any of it:**

- [ ] Independent third-party security audit completed and the report published. **Not done.** The FAQ currently tells members to *"treat the contracts as unaudited"*, and that is accurate.
- [ ] Testnet soak of at least 2–4 weeks with the indexer and relayer running against it
- [ ] `MLM-contracts` committed to git so deployed bytecode traces to a commit
- [ ] Fresh keys generated for mainnet — never anything from `TESTNET-WALLETS.json`
- [ ] Bug bounty sized to the value locked

---

## 11. Command summary

```bash
# prepare
cd MLM-contracts
cp env.testnet.template.txt .env      # then fill it in
git check-ignore -v .env              # confirm it is ignored
npm install
npm run compile
npm test                              # 109 passing

# preflight — no gas spent
npm run preflight:testnet             # must show 0 failed

# deploy
npm run deploy:testnet
git add deployments/bscTestnet.json && git commit -m "chore: record BSC testnet deployment"

# configure
npm run roles:testnet
npm run pools:testnet

# fund
FUND_POOL_ID=1 FUND_AMOUNT_MTT=25000 npm run fund:testnet
PAYOUT_FLOAT_MTT=10000 PAYOUT_DAILY_LIMIT_MTT=5000 npm run payout:testnet

# validate and publish
npm run check:testnet                 # 23 passed, 0 failed
npm run verify:testnet

# wire the apps
npm run abi                           # regenerate ABIs for backend + frontend
```

Rehearse the whole thing locally first — it costs nothing and catches configuration errors:

```bash
npx hardhat node &                    # terminal 1
npm run preflight:local
npm run deploy:local
npm run roles:local
npm run pools:local
npm run check:local                   # 23 passed, 0 failed
```

---

## 12. If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| `AccessControlUnauthorizedAccount` on roles or pools | `ADMIN_MULTISIG` is set to an address other than the deployer | Correct behaviour. Execute the generated `*.role-calldata.json` from that address |
| Verification fails with a bytecode mismatch | Compiler settings drifted | Confirm `hardhat.config.js` still pins solc 0.8.24, optimizer on, 200 runs, `evmVersion: paris` |
| Verification rejects the API key | A legacy bscscan.com key | Use an etherscan.io key |
| `HH502` / 403 downloading solc | Blocked binary host | `local-solc.js` shims this; ensure solc is pinned to exactly `0.8.24` |
| RPC rate limiting | The default seed node | Use `https://bsc-testnet-rpc.publicnode.com` |
| Deploy runs out of gas mid-sequence | Underfunded deployer | Top up and re-run. **Contracts already deployed are not rolled back** — start from a clean record or reuse the deployed addresses deliberately |
| Indexer refuses to boot | A watched event name is absent from the ABI | Run `npm run abi` after any contract change |

**There is no undo.** If a deployment goes out with a wrong allocation address, the only remedy is to redeploy the whole suite and migrate — the token has no mint function and no admin can move an allocation afterwards.
