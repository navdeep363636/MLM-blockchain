# Members Trail — BSC Testnet Deployment (live reference)

Deployed 2026-08-31 to BSC Testnet (chain 97). Full sequence run: `deploy → roles → pools → fund → payout → check`, ending at **23/23 post-deployment checks passing**, 109/109 contract tests passing.

**Update 2026-09-02:** MTTStaking and both MTTVesting instances were redeployed for commit `e056d17` ("close staking penalty dodge, seal vesting allocation" — 137/137 tests passing, up from 109). MTTToken, MTTReferralDistributor and MTTPayout are untouched originals from 2026-08-31. See "Known deviations" at the bottom for what's still pending on the new contracts and why.

Machine-readable version of everything below: **`deployments/bscTestnet.integration.json`**. ABIs: **`abi/*.json`**. Raw deploy record with constructor args (for BscScan verification): **`deployments/bscTestnet.json`**. Redeploy script: **`scripts/redeploy-staking-vesting-fix.js`**.

## Contract addresses

| Contract | Address | Explorer |
|---|---|---|
| MTTToken | `0x53AE1e2888C1703b3Acf818C1305bf411a86892B` | [testnet.bscscan.com](https://testnet.bscscan.com/address/0x53AE1e2888C1703b3Acf818C1305bf411a86892B) |
| TeamVesting | `0x150f8a4B30f92eD6524b6Cdde9af0836Dc55980f` | [testnet.bscscan.com](https://testnet.bscscan.com/address/0x150f8a4B30f92eD6524b6Cdde9af0836Dc55980f) |
| AdvisorsVesting | `0xe1D8C9A2b11d0345510B6E61e8322Cb70De96315` | [testnet.bscscan.com](https://testnet.bscscan.com/address/0xe1D8C9A2b11d0345510B6E61e8322Cb70De96315) |
| MTTStaking | `0xeA3a3A586e37E0c97FF1ffb3A39855220181E8eB` | [testnet.bscscan.com](https://testnet.bscscan.com/address/0xeA3a3A586e37E0c97FF1ffb3A39855220181E8eB) |
| MTTReferralDistributor | `0x6AE2AB55b420FEA264920F2944A5A1d729A94C8F` | [testnet.bscscan.com](https://testnet.bscscan.com/address/0x6AE2AB55b420FEA264920F2944A5A1d729A94C8F) |
| MTTPayout | `0x0af73E1bbe85526D5c74b34F6eA44E94861Ff827` | [testnet.bscscan.com](https://testnet.bscscan.com/address/0x0af73E1bbe85526D5c74b34F6eA44E94861Ff827) |

Superseded (pre-fix, 2026-08-31): `MTTStaking 0xce83252a19AfcC8B9C89ef44d3f2554b89C7Cb38`, `TeamVesting 0x723053F097E8de0D7C8DAc967cD4346d0366580F`, `AdvisorsVesting 0xE1FB92AAF3190de8e2c24Dd342327F87fcfBBa29`. Do not point anything new at these.

**Network config for frontend/backend:** chainId `97`, RPC `https://data-seed-prebsc-1-s1.binance.org:8545` (fallback `https://bsc-testnet-rpc.publicnode.com`), explorer `https://testnet.bscscan.com`.

**Indexer start block:** `128242300` — scan `eth_getLogs` forward from here to capture every event, including today's setup (role grants, pool creation, initial funding), not just future activity.

## Wallets and roles

| Wallet | Address | Holds |
|---|---|---|
| Deployer / admin | `0xf832BA0d3337CC72043E47cA7a56938125801E4b` | `DEFAULT_ADMIN_ROLE` on all 4 role-based contracts (testnet fallback — **must move to a multisig + be revoked before mainnet**) |
| Rewards pool | `0xdA2cBf969F757b1Ef20269705525759460E64fFb` | 399,965,000 MTT (40% allocation, minus 35,000 already forwarded to seed pool 1 + the payout float) |
| Treasury reserve | `0x40269336F5547f1E6686723C3A0D223bF8477cD3` | 150,000,000 MTT; also the staking early-exit penalty receiver |
| Liquidity | `0x8401927F4D9d9Ff475D555E057De4E2c563cd9F6` | 150,000,000 MTT |
| Marketing | `0x26B230Dd2e30Ca6157b5dc1A8658c8d73b42cb9e` | 100,000,000 MTT |
| Team beneficiary | `0x978C3e593901Cb89cDC7Bd49329ef60E992ad292` | Paid out by TeamVesting.release() |
| Advisors beneficiary | `0xD40e3924E035B78E50584f11E02ddc9037fd4E1c` | Paid out by AdvisorsVesting.release() |
| Treasury ops | `0xf489713C222252c6260Da1E367C1E8c10342168A` | `TREASURY_ROLE` + `POOL_ADMIN_ROLE` (staking), `TREASURY_ROLE` (distributor, payout), `GUARDIAN_ROLE` (payout) |
| Backend oracle / relayer | `0xdD83d806789e199D7D4C079FEEE80523cd023AAf` | `ORACLE_ROLE` (distributor), `PAYER_ROLE` (payout) — this is the always-online hot key the backend should use to call `recordCommission()` and execute payouts |
| Compliance signer | `0x9BE3308f5d834db492ba18Ac940567D3444475e3` | `COMPLIANCE_ROLE` (distributor) |

Role hash constants (same on every network — `keccak256(name)`, `DEFAULT_ADMIN_ROLE` is the zero hash) are in `deployments/bscTestnet.integration.json` under `roles`.

## Staking pools (`MTTStaking`, 4 pools live — redeployed contract, all unfunded)

| ID | Label | Lock | Reward stream | Early-exit penalty | Funded |
|---|---|---|---|---|---|
| 0 | Flexible | 0 days | 7 days | 0% | 0 MTT |
| 1 | 30-Day | 30 days | 30 days | 20% of rewards on the withdrawn share | 0 MTT |
| 2 | 90-Day | 90 days | 30 days | 30% of rewards on the withdrawn share | 0 MTT |
| 3 | 180-Day | 180 days | 30 days | 40% of rewards on the withdrawn share | 0 MTT |

Principal is still never confiscated — the fix closed two bugs on the rewards side: `claimRewards()` used to be penalty-free and zeroed the balance `unstake()` charges against, so claim-then-unstake forfeited nothing; and the penalty now settles on the slice of accrued rewards attributable to the share of principal being withdrawn in that call, rather than on the whole accrued balance regardless of how much principal actually left. None of the 4 pools are funded yet on this new contract (pool 1's old 25,000 MTT was on the superseded contract); a UI showing an APR for any pool right now is showing a number the chain will not honour until `fundRewardPool` is called from a wallet holding MTT.

## Payout rail (`MTTPayout`)

- Float: **10,000 MTT**
- Daily limit: **5,000 MTT** per 24h window (window resets, doesn't slide — up to 2x can leave across a boundary)
- Relayer (`PAYER_ROLE`): `0xdD83d806789e199D7D4C079FEEE80523cd023AAf`
- Currently unpaused, 5,000 MTT of allowance remaining in the current window

## Referral distributor (`MTTReferralDistributor`)

Deployed and role-wired, but **unfunded** — `totalDeposited = 0`. Before the backend oracle can call `recordCommission()`, the treasury ops wallet must call `depositCommissionPool()` with real revenue. This wasn't part of the requested setup steps; do it whenever commission tracking goes live.

## For frontend/backend integration

- Use the ABIs in `abi/*.json` — regenerated fresh against this deployment (`npm run abi`).
- `TeamVesting` and `AdvisorsVesting` share the `MTTVesting` ABI (same contract, different constructor args/instances).
- To watch live activity, filter events per contract from block `128242300` onward. **These names are taken from `abi/*.json`, not from memory** — a wrong event name is a wrong `topic0`, and `eth_getLogs` then returns an empty array rather than an error, so an indexer built on a guessed name reports healthy while indexing nothing:
  - **MTTToken** — `Transfer`, `Approval`, `AllocationMinted`, `Paused`, `Unpaused`
  - **MTTStaking** — `Staked`, `Unstaked`, `RewardClaimed`, `PoolCreated`, `PoolFunded`, `PenaltyReceiverUpdated`
  - **MTTReferralDistributor** — `CommissionPoolFunded`, `CommissionRecorded`, `CommissionClaimed`, `CommissionClawedBack`, `KycStatusUpdated`
  - **MTTPayout** — `PayoutSent`, `Funded`, `Swept`, `DailyLimitUpdated`, `WindowReset`, `Paused`, `Unpaused`
  - **Both vesting contracts** — `TokensReleased`

  Note the ones that are easy to get wrong: it is `RewardClaimed` not `RewardsClaimed`, `PoolFunded` not `RewardPoolFunded`, `PayoutSent` not `PayoutExecuted`, `KycStatusUpdated` not `KycStatusSet`, and `CommissionPoolFunded` not `PoolDeposited`. The API's indexer takes these from the compiled ABI and refuses to boot if a watched name is not in it (`members-trail-api/src/modules/chain/chain.constants.ts`).
- The backend's hot key for day-to-day operation should be the **backend oracle / relayer** (`0xdD83d806789e199D7D4C079FEEE80523cd023AAf`) — it can record commissions within the funded cap and execute payouts, but cannot move treasury funds or pause anything.
- None of this is verified on BscScan yet (no `BSCSCAN_API_KEY` was configured for this run). Run `npm run verify:testnet` once a valid etherscan.io API key is available.

## Known deviations from a from-scratch rehearsal

- The deployer needed a small top-up (40,000 MTT moved in from the rewards-pool wallet, then swept back to 5,000 unused) to be able to sign the `fundRewardPool` and `payout.fund` calls, since the deploy script leaves the deployer at a zero token balance by design. This is reflected in the final rewards-pool balance above (399,965,000 instead of the full 400,000,000) and does not affect any contract logic or invariant — `post-deploy-check` still passes 23/23.
- `ADMIN_MULTISIG` was left blank as instructed (correct for a testnet rehearsal). Before mainnet, replace the deployer's admin role with a Gnosis Safe per `DEPLOYMENT-RUNBOOK.md` §9–10.

## Pending on the 2026-09-02 redeploy

The new MTTStaking and both new MTTVesting instances deployed clean (bytecode verified byte-for-byte against the compiled fix, roles wired, 137/137 tests passing) but two things could not be finished by the deploy script and need a human holding the relevant wallet key:

- **Fund pool 1's rewards** on the new MTTStaking (`0xeA3a3A...`) from the rewards-pool wallet (`0xdA2cBf...`) — the deployer key in `.env` holds 0 MTT by design and cannot do this itself.
- **Fund and `seal()`** the new TeamVesting/AdvisorsVesting instances. MTTToken has a fixed 1,000,000,000 supply with nothing left to mint, and the original 150M/50M team/advisor allocation is still sitting in the *superseded* vesting contracts, which have no admin sweep — only `release()` to the beneficiary over time. Moving that allocation to the new contracts (vs. waiting out the old ones, vs. funding the new ones from a different wallet for a smaller testnet rehearsal) is a fund-custody decision for whoever holds those wallets, not something a script should decide unilaterally.

Until both are done, the new staking pools accept stakes but pay no rewards, and neither new vesting contract releases anything (`totalAllocation()` reads 0 pre-seal).
