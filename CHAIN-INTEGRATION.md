# Chain integration — contracts, backend, frontend

What changed when the platform was actually wired to its contracts, and why.

---

## The finding that shaped the work

The backend's chain layer was written against hand-typed `parseAbi([...])`
fragments. Checked against the compiled contracts for the first time:

| | wrong | total |
| --- | --- | --- |
| Events the indexer watched | **7** | 8 |
| Functions the relayer could call | **3** | 8 |

```
Staked(address,uint256,uint256,uint256)      → Staked(uint256,address,uint256,uint64)
Unstaked(address,uint256,…,uint256)          → Unstaked(uint256,address,uint256,uint256,bool)
RewardsClaimed(…)                            → RewardClaimed(…)            name
RewardPoolFunded(…)                          → PoolFunded(…)               name
PoolCreated(uint256,uint256,uint256,uint256) → PoolCreated(uint256,uint64,uint64,uint16)
CommissionRecorded(addr,bytes32,uint8,u256)  → CommissionRecorded(addr,uint8,u256,bytes32,bytes32)
CommissionPoolDeposited(…)                   → CommissionPoolFunded(…)     name
recordCommission(addr,bytes32,uint8,u256)    → recordCommission(addr,uint8,u256,bytes32)
clawback(addr,uint256,string)                → clawback(addr,uint256,bytes32,string)
```

**Why this was worse than a normal bug.** A wrong *function* signature is a
different selector — the call reverts, loudly, and someone investigates. A wrong
*event* signature is a different topic0 — `getLogs` returns an empty array and
never throws. The indexer would have run in production, advanced its cursor to
the head, reported itself healthy on `/admin/chain/indexer/status`, and indexed
**zero events**. The only symptom would have been that members' stakes never
appeared.

Sixteen unit tests covered those handlers and all sixteen passed, because each
one constructed the event payload from the same assumption the handler made.

There was a second layer to it. Even with a correct topic0, the dispatcher read
`args.rewards` and `args.penalty` off `Unstaked`; the contract emits
`forfeitedRewards` and `early`. Both resolved to `undefined` → `"0"`, so the
early-exit penalty was silently dropped from the ledger.

**The fix is structural, not a correction.** ABIs are now generated from the
compiled artifacts (`npm run abi`), the watched-event and callable-function
*names* are validated against those ABIs at boot (`assertSpecsValid`, fatal on
mismatch), and a script proves decoding against a live chain.

---

## Contract changes

### New: `MTTPayout.sol` — the withdrawal settlement rail

Before this, the only way to pay a member was `token.transfer` from the relayer —
which means **the always-online backend key had to hold the 400,000,000 MTT
rewards pool**, with no on-chain limit on what it could move in a day and no link
between a payout and the withdrawal it settled. Every other privileged action on
this platform is capped or dual-controlled. This one was neither, and it was the
largest.

- The hot key holds nothing; treasury funds a working float
- `dailyLimit` bounds a compromised key, with a resetting 24h window
- `payout(to, amount, withdrawalRef)` — the reference is **stored** (on-chain
  replay guard) and **emitted** (traceable on the explorer)
- `pause()` stops payouts without touching custody
- Funding, paying and recovery are three separate roles; `sweep` sends only to
  `msg.sender` under `TREASURY_ROLE`, so there is no destination parameter to aim

### `MTTReferralDistributor.sol`

- **`recordCommissionBatch`** — one revenue event generates up to three
  commissions up the referral chain. Settling them one transaction at a time
  means level 1 can land while level 2 reverts on the funding invariant, leaving
  a member paid for a purchase their upline was not, with nothing on chain
  marking it incomplete. The batch checks the invariant once against the total.
- `clawback` now takes and emits a **reason** (emitted, not stored)
- `setKycApprovedBatch` — reviewers clear a queue, so decisions arrive in groups
- `dedupeKeyFor` / `isRecorded` — the contract computes its own dedupe key, so
  the backend cannot disagree with the storage it is checking
- `getAccount`, `commissionBalances`, `isSolvent`

### `MTTStaking.sol`

- `totalStakedAllPools` — makes solvency verifiable on chain in two calls
- `getPool`, `getPools`, `getPosition`, `getPositions` — named structs replacing
  a positional 11-tuple that every caller indexed by number
- `rewardFloat`, `isSolvent`
- Documented: rewards that stream while a pool has no stakers are skipped by the
  streaming model and stay in the contract. Deliberately **not** recoverable — a
  function that could pull "excess" out is one accounting mistake away from
  taking staker principal with it.

### `MTTVesting.sol`

- `releasable()` — the only way to ask this used to be
  `vestedAmount(timestamp) - released`, with the *caller* supplying the
  timestamp. A browser clock a few seconds fast makes `release()` revert on a
  figure the page just showed as available.
- `schedule()` — the whole schedule in one call

### `MTTToken.sol`

- `AllocationMinted(string indexed bucket, …)` → **not indexed**. For dynamic
  types `indexed` stores `keccak256(value)` in a topic, so the bucket name could
  never be read back — an indexer reconstructing the allocation table for the
  public tokenomics page recovered a 32-byte hash where it needed
  `"REWARDS_POOL"`.

**Tests: 109 passing** (61 original, 48 new).

---

## Deployment script fixes

The three open issues from the testnet-readiness review, closed:

1. **`setup-roles.js` reverted whenever `ADMIN_MULTISIG` was set** — it always
   signed as the deployer, so configuring a real admin multisig (the entire point
   of having one) made every grant fail with `AccessControlUnauthorizedAccount`.
   It now checks whether the signer holds `DEFAULT_ADMIN_ROLE` and, when it does
   not, **emits Safe-ready calldata** to
   `deployments/<network>.role-calldata.json` instead of sending. On mainnet that
   is not a fallback — it is the only correct behaviour.
2. **BscScan verification** — `etherscan.apiKey` was a per-network map, which
   hardhat-verify 2.x treats as the retired V1 config. Now a single string.
3. **Vesting start was `Date.now()`** — a 12-month cliff anchored to whatever
   the deployer's wall clock said. Now `VESTING_START_UNIX`, falling back to the
   latest **block** timestamp with a warning.

Also: `solc` was `^0.8.24` in `package.json` and resolved to 0.8.36, which broke
the `local-solc` shim. Pinned exactly.

---

## Backend

| File | What it does now |
| --- | --- |
| `abis.generated.ts` | Generated. Full ABIs + function/event name unions. |
| `chain.constants.ts` | Contract registry: address key, ABI, watched events, callable allowlist. `assertSpecsValid()` refuses to boot on a name that is not in the ABI. |
| `chain-read.service.ts` | **New.** Every view on every contract. The chain layer previously could only write. |
| `chain-write.service.ts` | **New.** Writes as domain operations — argument order declared once, idempotency keys derived from the domain fact, wei conversion at the boundary. |
| `indexer.service.ts` | Event ABIs filtered from the generated ABI, never re-declared. |
| `event-dispatcher.service.ts` | Real event names and real arg names; handlers for the payout rail, clawbacks, KYC mirroring and vesting. |
| `tx-submitter.service.ts` | Resolves the ABI per contract (by address, never by guessing an ambiguous name). Validates the allowlist **and** encodes the arguments at enqueue — before a nonce is consumed. |

New admin routes under `/admin/chain`: `overview`, `contracts`, `solvency`,
`roles/:contract/:role/:account`, `staking/positions/:address`,
`commission/account/:address`, `payout/settlement/:ref`, plus writes for pool
funding and creation, commission deposit and clawback, KYC mirroring, and payout
float / pause / daily-limit control.

**Withdrawals now settle through `MTTPayout`.** The direct-token path remains as
a fallback when `PAYOUT_ADDRESS` is unset, and warns every single time, because
the fallback is the design this rail exists to replace.

Migration `1788200000000-ChainSurfaceAndPayoutRail` widens
`outbound_transactions.kind`. Add-only; `down()` refuses rather than truncating
real settlement records.

**Tests: 902 passing.** The new encode guard immediately caught a fixture that
had been enqueueing `recordCommission` with zero arguments.

---

## Frontend

- ABIs generated into `src/lib/web3/abis/` with a generated barrel
- `useOnChainPools` → one `getPools()` call. It previously fired N `pools(i)`
  reads and indexed the positional tuple by number (`p[8]` for the penalty) — a
  scheme that silently reassigns meaning if a struct field is inserted, and fails
  by rendering the wrong number rather than by failing
- `useStakePosition` → `getPosition`. Two parallel reads could resolve at
  different block heights, and pending rewards accrue every second, so they
  usually did
- New: `useAllStakePositions`, `useStakeAllowance`, `useStakingSolvency`,
  `useVestingSchedule`, `useReleaseVesting`, `useWithdrawalSettlement`,
  `usePayoutRail`
- `useCommissionOnChain` uses `getAccount`, so the claim button's enabled state
  and the figure beside it cannot disagree

---

## Verification

```bash
# 1. contracts
npm test                                   # 109 passing

# 2. local chain, full deployment
npx hardhat node &
npm run deploy:local && npm run roles:local && npm run pools:local
npm run check:local                        # 23 passed, 0 failed

# 3. emit one of every watched event
npx hardhat run scripts/exercise-all.js --network localhost

# 4. decode them with the PRODUCTION constants (from members-trail-api)
npx ts-node -r tsconfig-paths/register scripts/verify-chain-wiring.ts
```

The last step is the one that matters. It uses the same `CONTRACT_SPECS` and
`watchedEventAbi` the production indexer uses, against logs produced by the real
bytecode — not by a mock built from the same assumption as the code under test.

**Result: 62/62 checks passed.** Including that every watched event returns a
non-zero log count (the assertion that would have failed for every contract
before this work), that decoded argument names match what each handler reads,
that `PayoutSent.amount` is exactly `1250.5` MTT with no float rounding anywhere
in the path, that the contract's dedupe key matches viem's `encodePacked`, and
that `AllocationMinted.bucket` decodes to `"REWARDS_POOL"` rather than a hash.

---

## Before mainnet

- Set `ADMIN_MULTISIG` and run `setup-roles.js` — it will emit Safe calldata
- Set `VESTING_START_UNIX` explicitly
- `PAYOUT_DAILY_LIMIT_MTT`: the resetting window means up to 2× the limit can
  move across a boundary. Set it to half what an incident could tolerate.
- `post-deploy-check.js` must show the relayer holding **only** `PAYER_ROLE`, and
  all deployer admin flags false
- `MLM-contracts/` is still untracked in git — commit before the testnet soak so
  bytecode traces to a commit
