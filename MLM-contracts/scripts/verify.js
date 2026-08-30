/**
 * Verifies every deployed instance on BscScan from the deployment record.
 *
 *   npx hardhat run scripts/verify.js --network bscTestnet
 *
 * Why a script rather than six `hardhat verify` commands typed by hand:
 *
 *  1. The token's team and advisor constructor positions hold the DEPLOYER
 *     address, not the beneficiaries. The allocations mint to the deployer and
 *     are forwarded to the vesting contracts in the same run, so verifying with
 *     the beneficiary addresses fails with a bytecode mismatch that gives no
 *     hint about which argument was wrong.
 *  2. The vesting `start` is a block timestamp when VESTING_START_UNIX is unset.
 *     It exists only in the deployment record.
 *
 * Both are read straight from deployments/<network>.json, which deploy.js now
 * writes in full. Already-verified contracts are reported and skipped, so this
 * is safe to re-run.
 */

const { run, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const ORDER = [
  "MTTToken",
  "TeamVesting",
  "AdvisorsVesting",
  "MTTStaking",
  "MTTReferralDistributor",
  "MTTPayout",
];

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`No deployment record at ${file}. Deploy to ${network.name} first.`);
  }
  const rec = JSON.parse(fs.readFileSync(file, "utf8"));

  if (!rec.constructorArgs) {
    throw new Error(
      "This deployment record predates constructor-argument capture, so the vesting " +
      "start timestamp is not recoverable from it. Read `start()` off each vesting " +
      "contract and verify those two by hand."
    );
  }
  if (!process.env.BSCSCAN_API_KEY) {
    throw new Error("BSCSCAN_API_KEY is unset. It must be an etherscan.io key, not a legacy bscscan.com key.");
  }

  console.log("=".repeat(70));
  console.log("BscScan verification —", network.name);
  console.log("=".repeat(70));
  console.log("Vesting start:", rec.vesting?.startIso, `(${rec.vesting?.startSource})`);
  console.log("");

  let done = 0, already = 0, failed = 0;

  for (const name of ORDER) {
    const address = rec.addresses[name];
    const args = rec.constructorArgs[name];
    if (!address || !args) { console.log(`  SKIP  ${name} — not in the record`); continue; }

    process.stdout.write(`  ${name.padEnd(24)} ${address} ... `);
    try {
      await run("verify:verify", { address, constructorArguments: args });
      console.log("verified");
      done++;
    } catch (e) {
      const msg = (e.message || "").toLowerCase();
      if (msg.includes("already verified") || msg.includes("already been verified")) {
        console.log("already verified");
        already++;
      } else {
        console.log("FAILED");
        console.log("        " + (e.message || e).toString().split("\n")[0]);
        failed++;
      }
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(`Verified ${done}, already verified ${already}, failed ${failed}`);
  console.log("=".repeat(70));

  if (failed) {
    console.log("\nA bytecode mismatch usually means the compiler settings differ from the");
    console.log("deployment. This repo pins solc 0.8.24, optimizer on, 200 runs, evmVersion");
    console.log("paris — confirm hardhat.config.js still matches before re-running.");
    process.exitCode = 1;
  } else {
    const base = network.config.chainId === 56 ? "https://bscscan.com" : "https://testnet.bscscan.com";
    console.log("\nRead the verified source at:");
    for (const name of ORDER) {
      if (rec.addresses[name]) console.log(`  ${name.padEnd(24)} ${base}/address/${rec.addresses[name]}#code`);
    }
  }
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
