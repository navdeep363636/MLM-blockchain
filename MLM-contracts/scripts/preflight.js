/**
 * Pre-deployment check. Run this BEFORE spending any gas.
 *
 *   npx hardhat run scripts/preflight.js --network bscTestnet
 *
 * Deployment is a sequence of irreversible transactions with a fixed-supply
 * token at the end of it. Every mistake this catches — a wrong chain, an
 * unfunded deployer, two allocation buckets pointing at the same wallet, a
 * mainnet run with the deployer as admin — is one that is either expensive or
 * permanent to discover afterwards.
 *
 * Exits non-zero on any FAIL so it can gate a scripted run.
 */

const { ethers, network } = require("hardhat");

const EXPECTED_CHAIN = { bscTestnet: 97, bscMainnet: 56, localhost: 31337, hardhat: 31337 };

/* Enough for the six deployments plus the two forwarding transfers, with room
 * for a gas-price spike. Measured at ~0.05 BNB; this is deliberately generous. */
const MIN_BALANCE_BNB = { bscTestnet: "0.1", bscMainnet: "0.15" };

let pass = 0, fail = 0, warn = 0;
const ok   = (m) => { console.log("  PASS  " + m); pass++; };
const bad  = (m) => { console.log("  FAIL  " + m); fail++; };
const note = (m) => { console.log("  WARN  " + m); warn++; };
const info = (m) => console.log("  INFO  " + m);

const ADDRESS_KEYS = [
  ["REWARDS_POOL_WALLET",       "Play-to-Earn rewards pool (40%)"],
  ["TREASURY_RESERVE_WALLET",   "Treasury reserve (15%)"],
  ["LIQUIDITY_WALLET",          "Liquidity (15%)"],
  ["MARKETING_WALLET",          "Marketing (10%)"],
  ["TEAM_BENEFICIARY",          "Team vesting beneficiary (15%)"],
  ["ADVISORS_BENEFICIARY",      "Advisors vesting beneficiary (5%)"],
  ["TREASURY_OPS_MULTISIG",     "Treasury operations"],
  ["BACKEND_ORACLE_ADDRESS",    "Backend relayer / oracle"],
  ["COMPLIANCE_SIGNER_ADDRESS", "Compliance signer"],
];

async function main() {
  const chainId = network.config.chainId;
  const isMainnet = chainId === 56;
  const isTestnet = chainId === 97;

  console.log("=".repeat(70));
  console.log("Members Trail — deployment preflight");
  console.log("=".repeat(70));
  console.log("Network :", network.name, `(chainId ${chainId})`);
  console.log("");

  /* ---------------- chain ---------------- */
  console.log("[Chain]");
  const expected = EXPECTED_CHAIN[network.name];
  if (expected === undefined) {
    note(`unknown network name "${network.name}" — no expected chain id to check against`);
  } else if (chainId !== expected) {
    bad(`network "${network.name}" is configured with chainId ${chainId}, expected ${expected}`);
  } else {
    ok(`chain id ${chainId} matches the "${network.name}" network`);
  }

  let live;
  try {
    live = Number((await ethers.provider.getNetwork()).chainId);
    if (live !== chainId) {
      bad(`RPC reports chain ${live} but hardhat is configured for ${chainId} — WRONG ENDPOINT`);
    } else {
      ok(`RPC endpoint is reachable and reports chain ${live}`);
    }
  } catch (e) {
    bad(`cannot reach the RPC endpoint: ${e.shortMessage || e.message}`);
  }

  if (live === chainId) {
    const head = await ethers.provider.getBlockNumber();
    info(`current block ${head}`);
  }

  /* ---------------- signer ---------------- */
  console.log("\n[Deployer]");
  const signers = await ethers.getSigners();
  if (!signers.length) {
    bad("no signer available — DEPLOYER_PRIVATE_KEY is unset in .env");
  } else {
    const deployer = signers[0];
    console.log("        address:", deployer.address);
    const bal = await ethers.provider.getBalance(deployer.address);
    const min = ethers.parseEther(MIN_BALANCE_BNB[network.name] || "0");
    console.log("        balance:", ethers.formatEther(bal), "BNB");
    if (min > 0n && bal < min) {
      bad(`deployer holds ${ethers.formatEther(bal)} BNB, needs at least ${ethers.formatEther(min)}`);
    } else {
      ok("deployer is funded for the deployment sequence");
    }
    const nonce = await ethers.provider.getTransactionCount(deployer.address);
    if (nonce > 0) note(`deployer nonce is ${nonce} — this key has sent transactions before`);
    else info("deployer nonce is 0 (fresh key)");

    /* ---------------- allocation wallets ---------------- */
    console.log("\n[Allocation and role wallets]");
    const seen = new Map();
    let missing = 0;
    for (const [key, label] of ADDRESS_KEYS) {
      const v = process.env[key];
      if (!v) { note(`${key} is unset — deploy.js will fall back to the DEPLOYER address (${label})`); missing++; continue; }
      if (!ethers.isAddress(v)) { bad(`${key} is not a valid address: ${v}`); continue; }
      const norm = ethers.getAddress(v);
      if (seen.has(norm)) bad(`${key} reuses the address already set for ${seen.get(norm)} — allocation buckets must be distinct`);
      else seen.set(norm, key);
      if (norm === ethers.getAddress(deployer.address)) {
        (isMainnet ? bad : note)(`${key} is the DEPLOYER address — the deployer must not hold an allocation on a real network`);
      }
    }
    if (missing === 0) ok("every allocation and role wallet is explicitly configured");

    /* ---------------- admin ---------------- */
    console.log("\n[Admin control]");
    const admin = process.env.ADMIN_MULTISIG;
    if (!admin) {
      if (isMainnet) bad("ADMIN_MULTISIG is unset — deploy.js will REFUSE to run on mainnet");
      else note("ADMIN_MULTISIG unset: the deployer becomes admin. Correct for a testnet rehearsal, never for mainnet");
    } else if (!ethers.isAddress(admin)) {
      bad(`ADMIN_MULTISIG is not a valid address: ${admin}`);
    } else {
      const code = await ethers.provider.getCode(admin);
      if (code === "0x") {
        (isMainnet ? bad : note)("ADMIN_MULTISIG has no contract code — it is an EOA, not a Safe");
      } else {
        ok(`ADMIN_MULTISIG is a contract (${(code.length - 2) / 2} bytes) — consistent with a Gnosis Safe`);
      }
      note("with a separate admin, setup-roles.js will WRITE CALLDATA instead of sending — execute it from the Safe");
    }

    /* ---------------- relayer ---------------- */
    console.log("\n[Payout relayer]");
    const relayer = process.env.PAYOUT_RELAYER_ADDRESS || process.env.BACKEND_ORACLE_ADDRESS;
    if (!relayer) note("neither PAYOUT_RELAYER_ADDRESS nor BACKEND_ORACLE_ADDRESS is set — the deployer becomes the payer");
    else if (!ethers.isAddress(relayer)) bad(`payout relayer is not a valid address: ${relayer}`);
    else {
      ok(`payout relayer set to ${ethers.getAddress(relayer)}`);
      if (admin && ethers.isAddress(admin) && ethers.getAddress(relayer) === ethers.getAddress(admin)) {
        bad("the payout relayer is the SAME address as the admin — the hot key must never hold admin rights");
      }
    }
    const limit = process.env.PAYOUT_DAILY_LIMIT_MTT;
    info(`payout daily limit: ${limit || "50000"} MTT per 24h window${limit ? "" : " (default)"}`);
    note("set this to no more than half of what a genuine incident could tolerate — two windows can sit back to back");
  }

  /* ---------------- vesting ---------------- */
  console.log("\n[Vesting]");
  const vs = process.env.VESTING_START_UNIX;
  if (!vs) {
    note("VESTING_START_UNIX unset — the schedule anchors to the deploy block timestamp");
  } else if (!/^\d{10}$/.test(vs)) {
    bad(`VESTING_START_UNIX is not a 10-digit unix timestamp: ${vs}`);
  } else {
    ok(`vesting starts ${new Date(Number(vs) * 1000).toISOString()}`);
  }
  info("cliffs are 12 and 6 months of 30 days — 360 and 180 days, not calendar years");

  /* ---------------- verification ---------------- */
  console.log("\n[BscScan verification]");
  if (!process.env.BSCSCAN_API_KEY) note("BSCSCAN_API_KEY unset — you can deploy, but not verify until it is set");
  else ok("BSCSCAN_API_KEY is present (must be an etherscan.io key, not a legacy bscscan.com one)");

  /* ---------------- mainnet gates ---------------- */
  if (isMainnet) {
    console.log("\n[Mainnet gates]");
    note("contracts have NOT been independently audited — see README pre-mainnet checklist");
    note("run the full testnet sequence and a 2-4 week soak before this");
    if (process.env.REVOKE_DEPLOYER !== "true") {
      bad("REVOKE_DEPLOYER is not true — the deployer would keep operational roles on mainnet");
    } else {
      ok("REVOKE_DEPLOYER=true — deployer roles will be revoked after setup");
    }
  }
  if (isTestnet && process.env.REVOKE_DEPLOYER === "true") {
    note("REVOKE_DEPLOYER=true on testnet means you cannot create pools or fund rewards afterwards");
  }

  console.log("\n" + "=".repeat(70));
  console.log(`Result: ${pass} passed, ${fail} failed, ${warn} warning(s)`);
  console.log("=".repeat(70));
  if (fail > 0) {
    console.log("\nDo not deploy until every FAIL is resolved.");
    process.exitCode = 1;
  } else {
    console.log("\nPreflight clear. Review the warnings, then run the deploy script.");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
