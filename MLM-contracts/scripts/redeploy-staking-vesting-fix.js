/**
 * Scoped redeploy: MTTStaking + TeamVesting + AdvisorsVesting only.
 *
 * WHY THIS EXISTS INSTEAD OF RE-RUNNING deploy.js
 * ------------------------------------------------
 * commit e056d17 ("fix(contracts): close staking penalty dodge, seal vesting
 * allocation") changed MTTStaking.sol and MTTVesting.sol only. MTTToken,
 * MTTReferralDistributor and MTTPayout are untouched and their existing
 * instances are still correct — MTTToken in particular has a fixed supply and
 * cannot be redeployed without re-doing the entire token distribution.
 * deploy.js deploys the whole six-contract suite from scratch, which would
 * orphan the live token and the tokens already sent to every wallet. This
 * script instead reuses the existing MTTToken/Distributor/Payout addresses
 * from the deployment record and only replaces the two fixed contracts.
 *
 * FUNDING IS DELIBERATELY LEFT PENDING
 * -------------------------------------
 * MTTToken has a fixed 1,000,000,000 supply, already fully allocated at the
 * original deploy. The deployer key available to this script holds 0 MTT
 * (by design — deploy.js forwards every allocation it briefly touches).
 * Funding pool 1's rewards or sealing the new vesting contracts' allocation
 * both require MTT sent from a wallet whose key is NOT in this repo's .env
 * (rewardsPool for pool funding; team/advisor allocation currently sits
 * inside the OLD, now-superseded vesting contracts, which have no admin
 * sweep — only release() to the beneficiary over time). That is a real
 * fund-custody decision, not a scripting problem, so it is left for an
 * operator holding those keys. See the printed summary at the end.
 *
 *   npx hardhat run scripts/redeploy-staking-vesting-fix.js --network bscTestnet
 */

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY;

const POOLS = [
  { name: "Flexible", lockDuration: 0, rewardsDuration: 7 * DAY, penaltyBps: 0 },
  { name: "30-Day", lockDuration: 30 * DAY, rewardsDuration: 30 * DAY, penaltyBps: 2000 },
  { name: "90-Day", lockDuration: 90 * DAY, rewardsDuration: 30 * DAY, penaltyBps: 3000 },
  { name: "180-Day", lockDuration: 180 * DAY, rewardsDuration: 30 * DAY, penaltyBps: 4000 },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const recordPath = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(recordPath)) throw new Error(`No deployment record at ${recordPath}. Run deploy.js first.`);
  const prior = JSON.parse(fs.readFileSync(recordPath, "utf8"));

  console.log("=".repeat(70));
  console.log("Members Trail — scoped redeploy (MTTStaking + vesting fix)");
  console.log("=".repeat(70));
  console.log("Network :", network.name, `(chainId ${network.config.chainId})`);
  console.log("Deployer:", deployer.address);
  console.log("Reusing MTTToken:", prior.addresses.MTTToken);
  console.log("");

  const ADDRESSES = prior.configuredWallets;
  const treasuryOps = process.env.TREASURY_OPS_MULTISIG || ADDRESSES.treasuryOps;

  const latestBlock = await ethers.provider.getBlock("latest");
  const now = latestBlock.timestamp;

  // ---- MTTStaking -------------------------------------------------------
  console.log("[1/3] Deploying fixed MTTStaking...");
  const Staking = await ethers.getContractFactory("MTTStaking");
  const staking = await Staking.deploy(prior.addresses.MTTToken, ADDRESSES.admin, ADDRESSES.treasuryReserve);
  await staking.waitForDeployment();
  const newStaking = await staking.getAddress();
  console.log("      MTTStaking:", newStaking);

  console.log("      Creating pools...");
  for (const pool of POOLS) {
    const tx = await staking.createPool(pool.lockDuration, pool.rewardsDuration, pool.penaltyBps);
    await tx.wait();
    const id = (await staking.poolCount()) - 1n;
    console.log(`        Pool ${id}: ${pool.name.padEnd(9)} lock=${pool.lockDuration / DAY}d stream=${pool.rewardsDuration / DAY}d penalty=${pool.penaltyBps / 100}%`);
  }

  console.log("      Granting TREASURY_ROLE/POOL_ADMIN_ROLE to treasury ops...");
  const TREASURY_ROLE = await staking.TREASURY_ROLE();
  const POOL_ADMIN_ROLE = await staking.POOL_ADMIN_ROLE();
  if (!(await staking.hasRole(TREASURY_ROLE, treasuryOps))) {
    await (await staking.grantRole(TREASURY_ROLE, treasuryOps)).wait();
  }
  if (!(await staking.hasRole(POOL_ADMIN_ROLE, treasuryOps))) {
    await (await staking.grantRole(POOL_ADMIN_ROLE, treasuryOps)).wait();
  }
  console.log("      NOT funded — pool 1 rewards need MTT from the rewards-pool wallet (key not held by this script).\n");

  // ---- MTTVesting x2 ------------------------------------------------------
  console.log("[2/3] Deploying fixed MTTVesting (team + advisors)...");
  const Vesting = await ethers.getContractFactory("MTTVesting");

  const teamVest = await Vesting.deploy(ADDRESSES.teamBeneficiary, prior.addresses.MTTToken, now, 12 * MONTH, 36 * MONTH);
  await teamVest.waitForDeployment();
  const newTeamVesting = await teamVest.getAddress();
  console.log("      TeamVesting:", newTeamVesting);

  const advVest = await Vesting.deploy(ADDRESSES.advisorsBeneficiary, prior.addresses.MTTToken, now, 6 * MONTH, 24 * MONTH);
  await advVest.waitForDeployment();
  const newAdvisorsVesting = await advVest.getAddress();
  console.log("      AdvisorsVesting:", newAdvisorsVesting);
  console.log("      NOT funded/sealed — the original 150M/50M allocation is still held by the OLD");
  console.log("      vesting contracts (no admin sweep exists); moving it is a fund-custody decision");
  console.log("      for whoever holds those wallets' keys, not something this script can do.\n");

  // ---- record -------------------------------------------------------------
  console.log("[3/3] Writing updated deployment record...");
  const updated = {
    ...prior,
    deployedAt: new Date().toISOString(),
    addresses: {
      ...prior.addresses,
      MTTStaking: newStaking,
      TeamVesting: newTeamVesting,
      AdvisorsVesting: newAdvisorsVesting,
    },
    vesting: {
      ...prior.vesting,
      start: now,
      startIso: new Date(now * 1000).toISOString(),
      startSource: "block timestamp (redeploy)",
    },
    constructorArgs: {
      ...prior.constructorArgs,
      // MTTStaking's args are unchanged (same token/admin/treasuryReserve), but
      // listed explicitly so this block stays a complete, accurate replay
      // reference for BscScan verification of the NEW instances.
      MTTStaking: [prior.addresses.MTTToken, ADDRESSES.admin, ADDRESSES.treasuryReserve],
      TeamVesting: [ADDRESSES.teamBeneficiary, prior.addresses.MTTToken, now, 12 * MONTH, 36 * MONTH],
      AdvisorsVesting: [ADDRESSES.advisorsBeneficiary, prior.addresses.MTTToken, now, 6 * MONTH, 24 * MONTH],
    },
    redeployNote: {
      reason: "commit e056d17: staking penalty dodge closed, vesting allocation sealed",
      redeployedAt: new Date().toISOString(),
      redeployedContracts: ["MTTStaking", "TeamVesting", "AdvisorsVesting"],
      reusedContracts: ["MTTToken", "MTTReferralDistributor", "MTTPayout"],
      superseded: {
        MTTStaking: prior.addresses.MTTStaking,
        TeamVesting: prior.addresses.TeamVesting,
        AdvisorsVesting: prior.addresses.AdvisorsVesting,
      },
      pending: [
        "Fund new MTTStaking pool 1 rewards (needs MTT from the rewards-pool wallet).",
        "Fund + seal new TeamVesting/AdvisorsVesting (needs MTT moved from the superseded vesting contracts or another allocation wallet — a fund-custody decision, not scripted here).",
      ],
    },
  };
  fs.writeFileSync(recordPath, JSON.stringify(updated, null, 2));
  console.log("      Updated", recordPath);

  console.log("\n" + "=".repeat(70));
  console.log("Redeploy complete.");
  console.log("=".repeat(70));
  console.log("New MTTStaking      :", newStaking);
  console.log("New TeamVesting     :", newTeamVesting);
  console.log("New AdvisorsVesting :", newAdvisorsVesting);
  console.log("\nPENDING (needs a wallet this script does not hold the key for):");
  console.log("  - Fund pool 1 rewards on the new MTTStaking from the rewards-pool wallet.");
  console.log("  - Fund + seal() the new vesting contracts.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
