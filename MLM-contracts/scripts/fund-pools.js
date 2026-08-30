/**
 * Funds staking reward pools from the Treasury.
 *
 *   FUND_POOL_ID=1 FUND_AMOUNT_MTT=25000 \
 *     npx hardhat run scripts/fund-pools.js --network bscTestnet
 *
 * setup-pools.js creates pools; this is the script it points at, and until it
 * runs a pool pays nothing at all — a pool with no funding accrues zero, which
 * is the property the whole design rests on.
 *
 * WHAT THIS IS NOT: a way to top up rewards from spare tokens. The signer must
 * hold TREASURY_ROLE, and on a real deployment that is the Treasury operations
 * multisig, which does not run scripts — it executes calldata. When the signer
 * is not the role holder this prints the calldata to paste into the Safe rather
 * than sending anything.
 *
 * The APR members see is a CONSEQUENCE of what is funded here divided by what
 * is staked. There is no rate to set: fund more and the rate rises, fund the
 * same into a larger pool and each staker's share falls.
 */

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment record at ${file}.`);
  const rec = JSON.parse(fs.readFileSync(file, "utf8"));

  const poolId = process.env.FUND_POOL_ID;
  const amountMtt = process.env.FUND_AMOUNT_MTT;
  if (poolId === undefined || amountMtt === undefined) {
    throw new Error("Set FUND_POOL_ID and FUND_AMOUNT_MTT. Both are deliberate decisions, not defaults.");
  }
  if (!/^\d+$/.test(poolId)) throw new Error(`FUND_POOL_ID must be a whole number: ${poolId}`);
  if (!/^\d+(\.\d+)?$/.test(amountMtt) || Number(amountMtt) <= 0) {
    throw new Error(`FUND_AMOUNT_MTT must be a positive decimal amount: ${amountMtt}`);
  }

  const amount = ethers.parseEther(amountMtt);
  const [signer] = await ethers.getSigners();
  const token = await ethers.getContractAt("MTTToken", rec.addresses.MTTToken);
  const staking = await ethers.getContractAt("MTTStaking", rec.addresses.MTTStaking);

  const TREASURY_ROLE = ethers.id("TREASURY_ROLE");
  const holdsRole = await staking.hasRole(TREASURY_ROLE, signer.address);

  const pool = await staking.getPool(poolId);
  console.log("=".repeat(70));
  console.log(`Funding staking pool ${poolId} on ${network.name}`);
  console.log("=".repeat(70));
  console.log("  Staking  :", rec.addresses.MTTStaking);
  console.log("  Signer   :", signer.address);
  console.log("  Amount   :", amountMtt, "MTT");
  console.log("  Active   :", pool.active);
  console.log("  Staked   :", ethers.formatEther(pool.totalStaked), "MTT");
  console.log("  Funded   :", ethers.formatEther(pool.totalRewardsFunded), "MTT (all time)");
  console.log("  Paid     :", ethers.formatEther(pool.totalRewardsPaid), "MTT (all time)");
  console.log("  Stream   :", Number(pool.rewardsDuration) / 86400, "days");
  console.log("");

  if (!pool.active) {
    throw new Error(`Pool ${poolId} is not active. fundRewardPool reverts on an inactive pool.`);
  }

  if (!holdsRole) {
    console.log("Signer does NOT hold TREASURY_ROLE — printing calldata instead of sending.\n");
    const approve = token.interface.encodeFunctionData("approve", [rec.addresses.MTTStaking, amount]);
    const fund = staking.interface.encodeFunctionData("fundRewardPool", [poolId, amount]);
    const out = {
      network: network.name,
      note: "Execute both, in order, from the address holding TREASURY_ROLE.",
      transactions: [
        { step: 1, to: rec.addresses.MTTToken,   value: "0", data: approve, description: `approve ${amountMtt} MTT to MTTStaking` },
        { step: 2, to: rec.addresses.MTTStaking, value: "0", data: fund,    description: `fundRewardPool(${poolId}, ${amountMtt} MTT)` },
      ],
    };
    const outFile = path.join(__dirname, "..", "deployments", `${network.name}.fund-pool-${poolId}.calldata.json`);
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
    console.log(`  1. ${rec.addresses.MTTToken}\n     ${approve}\n`);
    console.log(`  2. ${rec.addresses.MTTStaking}\n     ${fund}\n`);
    console.log("Written to", outFile);
    return;
  }

  const bal = await token.balanceOf(signer.address);
  if (bal < amount) {
    throw new Error(`Signer holds ${ethers.formatEther(bal)} MTT, needs ${amountMtt}.`);
  }

  console.log("Approving...");
  await (await token.approve(rec.addresses.MTTStaking, amount)).wait();
  console.log("Funding...");
  const tx = await staking.fundRewardPool(poolId, amount);
  const receipt = await tx.wait();
  console.log("  tx:", receipt.hash);

  const after = await staking.getPool(poolId);
  console.log("\n  Funded now :", ethers.formatEther(after.totalRewardsFunded), "MTT");
  console.log("  Stream ends:", new Date(Number(after.periodFinish) * 1000).toISOString());
  console.log("\nRewards now accrue to stakers in this pool over the stream window.");
  console.log("The observed APR is this funding divided by the value staked — it is not set anywhere.");
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
