/**
 * Creates the staking pools defined in FRD Section 5.6 / 7.4.
 *
 *   npx hardhat run scripts/setup-pools.js --network bscTestnet
 *
 * Pool design rationale:
 *  - Longer locks get a longer reward-stream window, so a given Treasury deposit
 *    produces a smoother (not higher-promised) APR. APR is NEVER hardcoded here;
 *    it emerges from actual funding via fundRewardPool().
 *  - Early-exit penalties apply ONLY to pending unclaimed rewards, never principal.
 */

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const DAY = 24 * 60 * 60;

const POOLS = [
  { name: "Flexible",  lockDuration: 0,        rewardsDuration: 7 * DAY,  penaltyBps: 0 },
  { name: "30-Day",    lockDuration: 30 * DAY, rewardsDuration: 30 * DAY, penaltyBps: 2000 },
  { name: "90-Day",    lockDuration: 90 * DAY, rewardsDuration: 30 * DAY, penaltyBps: 3000 },
  { name: "180-Day",   lockDuration: 180 * DAY, rewardsDuration: 30 * DAY, penaltyBps: 4000 },
];

async function main() {
  const p = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(p)) throw new Error(`No deployment record at ${p}. Run deploy.js first.`);
  const dep = JSON.parse(fs.readFileSync(p, "utf8"));

  const staking = await ethers.getContractAt("MTTStaking", dep.addresses.MTTStaking);

  console.log("Creating staking pools on", network.name);
  for (const pool of POOLS) {
    const tx = await staking.createPool(pool.lockDuration, pool.rewardsDuration, pool.penaltyBps);
    await tx.wait();
    const id = (await staking.poolCount()) - 1n;
    console.log(
      `  Pool ${id}: ${pool.name.padEnd(9)} lock=${pool.lockDuration / DAY}d ` +
      `stream=${pool.rewardsDuration / DAY}d earlyPenalty=${pool.penaltyBps / 100}% of pending rewards`
    );
  }

  console.log(`\n${await staking.poolCount()} pools now active.`);
  console.log("\nReminder: pools earn NOTHING until the Treasury calls fundRewardPool(poolId, amount)");
  console.log("with tokens reconciled against real platform revenue. See scripts/fund-pools.js");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
