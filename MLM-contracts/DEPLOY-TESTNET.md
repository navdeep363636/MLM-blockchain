# BSC Testnet Deployment — Runbook & Findings

**Date:** 2026-08-20
**Repo:** `MLM-blockchain/MLM-contracts`
**Target:** BNB Smart Chain Testnet (chainId 97)

---

## TL;DR

The contracts are in good shape. Compilation is clean, all **61 tests pass**, the
economic rehearsal (`e2e-local.js`) holds every invariant, and the full deploy
sequence completes with **17/17 post-deploy checks passing** — but only under a
specific `.env` configuration, because of two bugs in the scripts (Issues 2 and 3
below).

**The deployment was not executed on testnet.** The sandbox this was prepared in
has an allowlisted network egress and cannot reach any BSC testnet RPC endpoint
(all return `403 Host not in allowlist`), and there was no deployer key. Everything
short of the live transaction was verified against a local chain. Run the four
commands in *Deployment steps* below from a machine with internet access.

---

## What was verified

| Step | Result |
|---|---|
| `npm install` | 644 packages, OK (45 npm-audit advisories, all in dev tooling) |
| `npx hardhat compile` | 22 files compiled, Solidity 0.8.24, evm target `paris` — no warnings |
| `npx hardhat test` | **61 passing**, 0 failing |
| `npx hardhat run scripts/e2e-local.js` | All compliance invariants hold |
| `deploy.js` → `setup-roles.js` → `setup-pools.js` → `post-deploy-check.js` | Full sequence green against a local node: 4 pools created, **17 passed / 0 failed** |

The four contracts deploy in the right order, the team/advisor buckets are
forwarded out of the deployer correctly, and `post-deploy-check.js` confirms the
fixed supply, the 40/15/15/15/10/5 split, the anti-pyramid invariant, staking
solvency, and the absence of any `withdraw`/`emergencyWithdraw` escape hatch.

---

## Issues found

### Issue 1 — Blocker: no `.env` exists, and no deployer key

The repo ships `.env.example` only. Without `DEPLOYER_PRIVATE_KEY`,
`hardhat.config.js` resolves `accounts: []` and any `--network bscTestnet` run
fails immediately. A funded key is a prerequisite, not an optional step.

**Resolution:** a fresh testnet key set has been generated for you — see
`TESTNET-WALLETS.json` and `env.testnet.template.txt` in this folder. Fund the deployer only.

### Issue 2 — Bug: `setup-roles.js` and `setup-pools.js` revert whenever `ADMIN_MULTISIG` is set

Both scripts sign as the **deployer**, but every role-admin function on the
contracts is gated on `DEFAULT_ADMIN_ROLE` / `POOL_ADMIN_ROLE`, which the
constructors assign to `ADMIN_MULTISIG`. So the moment you set `ADMIN_MULTISIG`
to anything other than the deployer, the first grant reverts:

```
staking.grantRole(TREASURY_ROLE, treasuryOps)
ProviderError: reverted with custom error
  'AccessControlUnauthorizedAccount("0xf39Fd6...92266", "0x0000...0000")'
  at main (scripts/setup-roles.js:45:10)
```

Reproduced locally. This leaves no configuration in which both things are true:

- `ADMIN_MULTISIG` unset → scripts work, but the deployer EOA holds admin over everything.
- `ADMIN_MULTISIG` set → allocations are clean, but `setup-roles.js` and `setup-pools.js` are unusable.

**Workaround used in `env.testnet.template.txt`:** leave `ADMIN_MULTISIG` blank (deployer
becomes admin, which `deploy.js` already warns about and accepts on testnet) and
set the six *allocation* wallets to distinct addresses. That combination is what
produces the clean 17/17 run — the deployer ends at a zero token balance, so the
deployer-hygiene assertion passes.

**Proper fix** (worth doing before the testnet soak, and required before mainnet):
give both scripts an `ADMIN_PRIVATE_KEY` signer, or make them print the encoded
calldata for the Gnosis Safe transaction builder instead of sending transactions.
The README already says mainnet role grants must come from the Safe UI — these two
scripts contradict that and will mislead whoever runs them.

### Issue 3 — Bug: BscScan verification will fail as configured

`hardhat.config.js` uses the per-network **map** form:

```js
etherscan: { apiKey: { bsc: BSCSCAN_API_KEY, bscTestnet: BSCSCAN_API_KEY } }
```

The installed `@nomicfoundation/hardhat-verify` is 2.1.3, which treats a map as
legacy Etherscan **V1** and only uses the V2 unified endpoint when `apiKey` is a
plain string (`internal/etherscan.js:58` — `const isV2 = typeof apiKey === "string"`).
V1 explorer endpoints were retired, so `npx hardhat verify` will fail with the
current config.

**Fix** — one line, and use an `etherscan.io` key rather than a legacy
`bscscan.com` key:

```diff
-  etherscan: {
-    apiKey: {
-      bsc: BSCSCAN_API_KEY,
-      bscTestnet: BSCSCAN_API_KEY
-    }
-  },
+  etherscan: {
+    apiKey: BSCSCAN_API_KEY
+  },
```

### Issue 4 — Environment: solc download is blocked in some networks

`npx hardhat compile` failed here with `HH502 ... Failed to download
https://binaries.soliditylang.org/linux-amd64/list.json - 403`. If your machine
hits the same wall, `local-solc.js` (included in this folder) makes Hardhat use
the npm `solc@0.8.24` build instead. Enable it only if you need it — instructions
are in the file header. Bytecode is identical, so verification still matches.

### Issue 5 — Housekeeping

- `MLM-contracts/` is **not committed to git**. The repo's index contains only the
  top-level `README.md` and `.gitignore`; the entire contract suite is untracked.
  Commit it before the testnet soak so deployed bytecode is traceable to a commit.
- `.gitignore` ignores `deployments/hardhat.json` and `deployments/localhost.json`
  but **not** `deployments/bscTestnet.json` — that is deliberate and correct
  (you want the testnet record tracked). Just be aware it will show up as a new
  file after deploying.
- Add `TESTNET-WALLETS.json` to `.gitignore` before your next commit.
- `deploy.js` derives the vesting start from the local clock
  (`Math.floor(Date.now()/1000)`), so the 12-month team cliff is anchored to
  whenever you happen to run it. Fine for testnet; for mainnet pass an explicit,
  agreed-upon start timestamp.
- The README's claim that `post-deploy-check.js` "exits non-zero on failure" is
  accurate — confirmed exit code 1 on a failing assertion.

---

## Deployment steps

Run these on a machine with internet access, from `MLM-contracts/`.

```bash
# 0. One-time setup
npm install
cp env.testnet.template.txt .env    # delivered as .txt; remote tools cannot write dotfiles
# then edit .env and paste DEPLOYER_PRIVATE_KEY (account 0 in TESTNET-WALLETS.json)
```

Fund the deployer at <https://www.bnbchain.org/en/testnet-faucet> — about
**0.1 tBNB** covers the whole sequence comfortably.

```bash
# 1. Sanity check before spending gas
npm run compile
npm test          # expect: 61 passing

# 2. Deploy
npm run deploy:testnet      # writes deployments/bscTestnet.json

# 3. Grant the operational roles
npm run roles:testnet

# 4. Create the four staking pools
npm run pools:testnet

# 5. Verify the wiring
npm run check:testnet       # expect: 17 passed, 0 failed
```

Then paste the output back and I'll review it.

### Optional: verify on BscScan

Apply the Issue 3 fix first, then (addresses come from `deployments/bscTestnet.json`):

```bash
npx hardhat verify --network bscTestnet <MTTToken> \
  <deployer> <rewardsPool> <treasuryReserve> <TeamVesting> <liquidity> <marketing> <AdvisorsVesting>
```

Note the token's team/advisor constructor arguments are the **deployer** address
(not the vesting contracts) — `deploy.js` mints those buckets to the deployer and
forwards them afterwards, so verification must use the deployer address in those
two positions or the bytecode-argument match will fail.

---

## Generated testnet wallets

Derived from a single fresh BIP-39 mnemonic at `m/44'/60'/0'/0/{0..10}`.
Private keys and the mnemonic are in `TESTNET-WALLETS.json`.

| Env var | Address | Role |
|---|---|---|
| `DEPLOYER` | `0xBe7ac6aCBD46B63eeA20bBaa8dE96415f3DdFcD9` | deployer - THIS ONE NEEDS TESTNET BNB |
| `ADMIN_MULTISIG` | `0x1d06623A750283710926893D6Cb38d93d9B9d2F7` | admin (Safe on mainnet) |
| `REWARDS_POOL_WALLET` | `0xdA2cBf969F757b1Ef20269705525759460E64fFb` | 40% play-to-earn |
| `TREASURY_RESERVE_WALLET` | `0x40269336F5547f1E6686723C3A0D223bF8477cD3` | 15% treasury reserve |
| `LIQUIDITY_WALLET` | `0x8401927F4D9d9Ff475D555E057De4E2c563cd9F6` | 15% liquidity |
| `MARKETING_WALLET` | `0x26B230Dd2e30Ca6157b5dc1A8658c8d73b42cb9e` | 10% marketing |
| `TEAM_BENEFICIARY` | `0x978C3e593901Cb89cDC7Bd49329ef60E992ad292` | 15% team vesting beneficiary |
| `ADVISORS_BENEFICIARY` | `0xD40e3924E035B78E50584f11E02ddc9037fd4E1c` | 5% advisors vesting beneficiary |
| `TREASURY_OPS_MULTISIG` | `0xf489713C222252c6260Da1E367C1E8c10342168A` | TREASURY_ROLE |
| `BACKEND_ORACLE_ADDRESS` | `0xdD83d806789e199D7D4C079FEEE80523cd023AAf` | ORACLE_ROLE |
| `COMPLIANCE_SIGNER_ADDRESS` | `0x9BE3308f5d834db492ba18Ac940567D3444475e3` | COMPLIANCE_ROLE |

`ADMIN_MULTISIG` is listed for completeness but is intentionally left **blank** in
`env.testnet.template.txt` — see Issue 2. Only the deployer needs tBNB.

> These keys are testnet-only and were generated by an automated tool on a shared
> machine. Treat them as public. Never send mainnet value to any of them, and
> never reuse this mnemonic for anything real.

---

## Before mainnet

Beyond the checklist already in the repo README, the two code issues above must
be closed:

- [ ] Fix Issue 2 — role-setup scripts must work with a Safe as admin, or be replaced by Safe calldata output
- [ ] Fix Issue 3 — single-string `etherscan.apiKey` so verification works
- [ ] Commit `MLM-contracts/` to git (Issue 5) and tag the audited commit
- [ ] Pin the vesting start timestamp explicitly rather than using `Date.now()`
- [ ] Re-run `post-deploy-check.js` on mainnet, where the three deployer-admin
      assertions become hard failures rather than INFO lines
