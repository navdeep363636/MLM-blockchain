/**
 * Exercises every contract path the platform depends on, against a local node.
 *
 *   npx hardhat run scripts/exercise-all.js --network localhost
 *
 * The point is to EMIT AT LEAST ONE OF EVERY EVENT the backend indexer watches,
 * so `verify-chain-wiring.ts` on the API side can decode real logs produced by
 * the real bytecode — rather than logs produced by a mock that was built from
 * the same assumption the code under test makes.
 *
 * That distinction is the whole reason this exists. The previous chain layer had
 * sixteen passing unit tests for its event handlers, and every one of them fed
 * the handler the shape the handler expected. The contracts emitted a different
 * shape, and no test could see it.
 */

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const MTT = (n) => ethers.parseEther(String(n));

async function main() {
  const dep = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", `${network.name}.json`), "utf8"),
  );
  const [deployer, member] = await ethers.getSigners();

  const token = await ethers.getContractAt("MTTToken", dep.addresses.MTTToken);
  const staking = await ethers.getContractAt("MTTStaking", dep.addresses.MTTStaking);
  const dist = await ethers.getContractAt("MTTReferralDistributor", dep.addresses.MTTReferralDistributor);
  const payout = await ethers.getContractAt("MTTPayout", dep.addresses.MTTPayout);

  const emitted = {};
  const note = (label, receipt) => {
    emitted[label] = receipt.blockNumber;
    console.log(`  ${label.padEnd(26)} block ${receipt.blockNumber}`);
  };

  console.log("Exercising every watched path on", network.name, "\n");

  /* Both the commission source id and the withdrawal reference are REPLAY GUARDS
   * stored on chain — `recordCommissionBatch` reverts with "already recorded" and
   * `payout` reverts on a reused ref. Fixed literals therefore made this script
   * single-use per chain: the second run died halfway through, leaving a partial
   * event set that the verifier would read as missing wiring. Tagging both with
   * the current block height keeps every run unique, and the tags are written
   * into the fixtures record below so the verifier looks up what was used. */
  const runTag = String(await ethers.provider.getBlockNumber()).padStart(6, "0");
  const sourceEventRef = `REV-2026-${runTag}`;
  const withdrawalRefStr = `WD-2026-${runTag}`;

  /* The rewards-pool wallet holds 40% of supply; impersonate it to fund things. */
  const rewardsPool = dep.configuredWallets.rewardsPool;
  await network.provider.send("hardhat_impersonateAccount", [rewardsPool]);
  await network.provider.send("hardhat_setBalance", [rewardsPool, "0x21e19e0c9bab2400000"]);
  const pool = await ethers.getSigner(rewardsPool);

  /* Working capital for the deployer (treasury/oracle/payer) and one member. */
  await (await token.connect(pool).transfer(deployer.address, MTT(500_000))).wait();
  await (await token.connect(pool).transfer(member.address, MTT(10_000))).wait();

  console.log("STAKING");
  /* Staked */
  await (await token.connect(member).approve(dep.addresses.MTTStaking, MTT(5_000))).wait();
  note("Staked", await (await staking.connect(member).stake(0, MTT(2_000))).wait());

  /* PoolFunded — the only way rewards enter the contract. */
  await (await token.approve(dep.addresses.MTTStaking, MTT(10_000))).wait();
  note("PoolFunded", await (await staking.fundRewardPool(0, MTT(7_000))).wait());

  /* Let rewards stream so there is something to claim. */
  await network.provider.send("evm_increaseTime", [2 * 24 * 60 * 60]);
  await network.provider.send("evm_mine");

  note("RewardClaimed", await (await staking.connect(member).claimRewards(0)).wait());
  note("Unstaked", await (await staking.connect(member).unstake(0, MTT(1_000))).wait());
  note("PoolCreated", await (await staking.createPool(60 * 24 * 60 * 60, 30 * 24 * 60 * 60, 2500)).wait());
  note("PenaltyReceiverUpdated", await (await staking.setPenaltyReceiver(deployer.address)).wait());

  console.log("\nREFERRAL DISTRIBUTOR");
  /* CommissionPoolFunded */
  await (await token.approve(dep.addresses.MTTReferralDistributor, MTT(50_000))).wait();
  note("CommissionPoolFunded", await (await dist.depositCommissionPool(MTT(20_000))).wait());

  /* CommissionRecorded — via the BATCH path, which is how the backend settles. */
  const sourceEventId = ethers.keccak256(ethers.toUtf8Bytes(sourceEventRef));
  note("CommissionRecorded(batch)", await (await dist.recordCommissionBatch([
    { recipient: member.address, level: 1, amount: MTT(800) },
    { recipient: deployer.address, level: 2, amount: MTT(300) },
  ], sourceEventId)).wait());

  /* KycStatusUpdated + CommissionClaimed */
  note("KycStatusUpdated", await (await dist.setKycApprovedBatch([member.address], true)).wait());
  note("CommissionClaimed", await (await dist.connect(member).claimCommission()).wait());

  /* CommissionClawedBack — the reason is emitted, not stored. */
  note("CommissionClawedBack", await (await dist.clawback(
    deployer.address, MTT(300), sourceEventId, "purchase refunded by the payment provider",
  )).wait());

  console.log("\nPAYOUT RAIL");
  /* PAYER_ROLE deliberately does NOT live on the deployer — MTTPayout exists so
   * that the always-online relayer key is the only thing that can move funds out,
   * and deploy.js grants PAYER_ROLE to BACKEND_ORACLE_ADDRESS. This script signs
   * as the deployer throughout, so it has to take the role for the duration of
   * the exercise; the deployer still holds DEFAULT_ADMIN_ROLE on a local chain,
   * which is what makes the grant possible here and nowhere else. */
  const PAYER_ROLE = await payout.PAYER_ROLE();
  if (!(await payout.hasRole(PAYER_ROLE, deployer.address))) {
    await (await payout.grantRole(PAYER_ROLE, deployer.address)).wait();
  }

  await (await token.approve(dep.addresses.MTTPayout, MTT(100_000))).wait();
  note("Funded", await (await payout.fund(MTT(80_000))).wait());

  /* PayoutSent — carrying the platform's own withdrawal reference. */
  const withdrawalRef = ethers.keccak256(ethers.toUtf8Bytes(withdrawalRefStr));
  note("PayoutSent", await (await payout.payout(member.address, MTT(1_250.5), withdrawalRef)).wait());

  note("DailyLimitUpdated", await (await payout.setDailyLimit(MTT(75_000))).wait());
  note("Paused", await (await payout.pause()).wait());
  note("Unpaused", await (await payout.unpause()).wait());
  note("Swept", await (await payout.sweep(MTT(1_000), "float rebalance after the daily run")).wait());

  console.log("\nVESTING");
  const teamVesting = await ethers.getContractAt("MTTVesting", dep.addresses.TeamVesting);
  const advVesting = await ethers.getContractAt("MTTVesting", dep.addresses.AdvisorsVesting);

  /* Past the 12-month team cliff (advisors is 6) so both have something. */
  await network.provider.send("evm_increaseTime", [400 * 24 * 60 * 60]);
  await network.provider.send("evm_mine");

  note("TokensReleased", await (await teamVesting.release()).wait());
  /* BOTH vesting contracts are indexed, so both must be exercised — otherwise
   * the verifier reports zero logs for one of them, which is exactly the signal
   * it exists to raise and would be dismissed as noise. */
  note("TokensReleased(advisors)", await (await advVesting.release()).wait());

  /* ------------------------------------------------------------------ */
  const out = {
    network: network.name,
    chainId: network.config.chainId,
    addresses: dep.addresses,
    /* The oldest block any of this touched, so the verifier knows where to scan
     * from without guessing. */
    fromBlock: Math.min(...Object.values(emitted)),
    toBlock: await ethers.provider.getBlockNumber(),
    emitted,
    fixtures: {
      member: member.address,
      relayer: deployer.address,
      sourceEventRef,
      withdrawalRef: withdrawalRefStr,
      payoutAmountMtt: "1250.5",
    },
  };
  const outPath = path.join(__dirname, "..", "deployments", `${network.name}.exercised.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log(`\n${Object.keys(emitted).length} event types emitted across blocks ` +
    `${out.fromBlock}-${out.toBlock}`);
  console.log(`Record: deployments/${network.name}.exercised.json`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
