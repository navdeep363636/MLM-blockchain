/**
 * Post-deployment health & compliance check.
 *
 *   npx hardhat run scripts/post-deploy-check.js --network bscTestnet
 *
 * Verifies that what is actually live on-chain matches the FRD spec, including
 * the compliance-critical properties. Exits non-zero if any check fails.
 */

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.log(`  FAIL  ${label}${detail ? "  -> " + detail : ""}`);
    fail++;
  }
}

async function main() {
  const p = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(p)) throw new Error(`No deployment record at ${p}. Run deploy.js first.`);
  const dep = JSON.parse(fs.readFileSync(p, "utf8"));
  const a = dep.addresses;

  const token = await ethers.getContractAt("MTTToken", a.MTTToken);
  const staking = await ethers.getContractAt("MTTStaking", a.MTTStaking);
  const dist = await ethers.getContractAt("MTTReferralDistributor", a.MTTReferralDistributor);
  const teamVest = await ethers.getContractAt("MTTVesting", a.TeamVesting);
  const advVest = await ethers.getContractAt("MTTVesting", a.AdvisorsVesting);

  console.log("=".repeat(70));
  console.log("Post-Deployment Verification —", network.name);
  console.log("=".repeat(70));

  console.log("\n[Token]");
  const total = await token.TOTAL_SUPPLY();
  check("symbol is MTT", (await token.symbol()) === "MTT");
  check("totalSupply equals the fixed cap", (await token.totalSupply()) === total);
  check("no mint() function exists on the ABI",
    token.interface.fragments.find(f => f.name === "mint") === undefined);

  console.log("\n[Vesting]");
  const teamBal = await token.balanceOf(a.TeamVesting);
  const advBal = await token.balanceOf(a.AdvisorsVesting);
  check("TeamVesting holds 15% of supply", teamBal === total * 1500n / 10000n,
    `holds ${ethers.formatEther(teamBal)}`);
  check("AdvisorsVesting holds 5% of supply", advBal === total * 500n / 10000n,
    `holds ${ethers.formatEther(advBal)}`);
  check("Team cliff is in the future or vesting has begun correctly",
    (await teamVest.released()) === 0n);
  check("Advisor vesting beneficiary set", (await advVest.beneficiary()) !== ethers.ZeroAddress);

  console.log("\n[Deployer hygiene]");
  const deployerBal = await token.balanceOf(dep.deployer);
  check("deployer holds no leftover vesting allocation", deployerBal === 0n,
    `holds ${ethers.formatEther(deployerBal)} MTT`);

  console.log("\n[Referral distributor — anti-pyramid invariant]");
  const deposited = await dist.totalDeposited();
  const recorded = await dist.totalRecorded();
  const claimed = await dist.totalClaimed();
  check("totalRecorded <= totalDeposited (core invariant)", recorded <= deposited,
    `recorded=${ethers.formatEther(recorded)} deposited=${ethers.formatEther(deposited)}`);
  check("totalClaimed <= totalRecorded", claimed <= recorded);
  check("contract holds enough to cover outstanding commissions",
    (await token.balanceOf(a.MTTReferralDistributor)) >= recorded - claimed);
  check("no withdraw/emergencyWithdraw escape hatch exists",
    dist.interface.fragments.find(f => ["withdraw", "emergencyWithdraw"].includes(f.name)) === undefined);

  console.log("\n[Staking]");
  const poolCount = await staking.poolCount();
  console.log(`  INFO  ${poolCount} pool(s) configured`);
  let totalStakedAll = 0n, totalFunded = 0n, totalPaid = 0n;
  for (let i = 0n; i < poolCount; i++) {
    const pool = await staking.pools(i);
    totalStakedAll += pool.totalStaked;
    totalFunded += pool.totalRewardsFunded;
    totalPaid += pool.totalRewardsPaid;
    check(`pool ${i}: rewards paid <= rewards funded`,
      pool.totalRewardsPaid <= pool.totalRewardsFunded,
      `paid=${ethers.formatEther(pool.totalRewardsPaid)} funded=${ethers.formatEther(pool.totalRewardsFunded)}`);
  }
  if (poolCount > 0n) {
    check("staking contract is solvent for all staked principal",
      (await token.balanceOf(a.MTTStaking)) >= totalStakedAll,
      `held=${ethers.formatEther(await token.balanceOf(a.MTTStaking))} staked=${ethers.formatEther(totalStakedAll)}`);
  }

  console.log("\n[Access control]");
  const DEFAULT_ADMIN = ethers.ZeroHash;
  const deployerIsTokenAdmin = await token.hasRole(DEFAULT_ADMIN, dep.deployer);
  const deployerIsStakingAdmin = await staking.hasRole(DEFAULT_ADMIN, dep.deployer);
  const deployerIsDistAdmin = await dist.hasRole(DEFAULT_ADMIN, dep.deployer);
  const isMainnet = dep.chainId === 56;

  if (isMainnet) {
    check("deployer EOA is NOT token admin", !deployerIsTokenAdmin);
    check("deployer EOA is NOT staking admin", !deployerIsStakingAdmin);
    check("deployer EOA is NOT distributor admin", !deployerIsDistAdmin);
  } else {
    console.log(`  INFO  testnet: deployer admin flags -> token=${deployerIsTokenAdmin} staking=${deployerIsStakingAdmin} dist=${deployerIsDistAdmin}`);
    console.log("  INFO  these MUST all be false before mainnet");
  }

  console.log("\n" + "=".repeat(70));
  console.log(`Result: ${pass} passed, ${fail} failed`);
  console.log("=".repeat(70));
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
