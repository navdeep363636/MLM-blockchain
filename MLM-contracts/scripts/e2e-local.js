/**
 * End-to-end local rehearsal: deploys, wires roles, creates pools, simulates a
 * full revenue -> commission -> claim cycle and a stake -> reward -> unstake
 * cycle, then runs the compliance checks. Local network only.
 *
 *   npx hardhat run scripts/e2e-local.js
 */
const { ethers, network } = require("hardhat");

const DAY = 24 * 60 * 60;

async function main() {
  const [deployer, treasuryOps, oracle, compliance, alice, bob] = await ethers.getSigners();
  console.log("=".repeat(70));
  console.log("END-TO-END LOCAL REHEARSAL");
  console.log("=".repeat(70));

  // --- Deploy ---
  const MTT = await ethers.getContractFactory("MTTToken");
  const token = await MTT.deploy(
    deployer.address, deployer.address, treasuryOps.address,
    deployer.address, deployer.address, deployer.address, deployer.address
  );
  const Vesting = await ethers.getContractFactory("MTTVesting");
  const now = await ethers.provider.getBlock("latest").then(b => b.timestamp);
  const teamVest = await Vesting.deploy(deployer.address, await token.getAddress(), now, 360*DAY, 1080*DAY);
  const Staking = await ethers.getContractFactory("MTTStaking");
  const staking = await Staking.deploy(await token.getAddress(), deployer.address, treasuryOps.address);
  const Dist = await ethers.getContractFactory("MTTReferralDistributor");
  const dist = await Dist.deploy(await token.getAddress(), deployer.address);
  console.log("\n[1] Contracts deployed.");

  // --- Roles ---
  await staking.grantRole(await staking.TREASURY_ROLE(), treasuryOps.address);
  await dist.grantRole(await dist.TREASURY_ROLE(), treasuryOps.address);
  await dist.grantRole(await dist.ORACLE_ROLE(), oracle.address);
  await dist.grantRole(await dist.COMPLIANCE_ROLE(), compliance.address);
  console.log("[2] Roles granted (treasury / oracle / compliance separated).");

  // --- Pools ---
  await staking.createPool(0, 7*DAY, 0);
  await staking.createPool(30*DAY, 30*DAY, 2000);
  await staking.createPool(90*DAY, 30*DAY, 3000);
  console.log(`[3] ${await staking.poolCount()} staking pools created.`);

  // --- Seed player balances (simulating Points->MTT conversions from Rewards Pool) ---
  await token.transfer(alice.address, ethers.parseEther("5000"));
  await token.transfer(bob.address, ethers.parseEther("5000"));
  console.log("[4] Players funded via Rewards Pool (simulated Points->MTT conversion).");

  // --- Staking cycle ---
  const stk = await staking.getAddress();
  await token.connect(alice).approve(stk, ethers.parseEther("2000"));
  await staking.connect(alice).stake(1, ethers.parseEther("2000"));
  await token.connect(bob).approve(stk, ethers.parseEther("1000"));
  await staking.connect(bob).stake(1, ethers.parseEther("1000"));
  console.log("[5] Alice staked 2000 MTT, Bob staked 1000 MTT into the 30-day pool.");

  // Treasury funds rewards from REAL REVENUE (30% of a simulated 1000 MTT revenue month)
  const revenueThisMonth = ethers.parseEther("1000");
  const toStakingRewards = revenueThisMonth * 30n / 100n;
  const toCommissionPool = revenueThisMonth * 12n / 100n;
  await token.connect(treasuryOps).approve(stk, toStakingRewards);
  await staking.connect(treasuryOps).fundRewardPool(1, toStakingRewards);
  console.log(`[6] Treasury funded staking rewards with ${ethers.formatEther(toStakingRewards)} MTT (30% of real revenue).`);

  await ethers.provider.send("evm_increaseTime", [30*DAY]);
  await ethers.provider.send("evm_mine");

  const aliceEarned = await staking.earned(1, alice.address);
  const bobEarned = await staking.earned(1, bob.address);
  console.log(`    Alice earned: ${ethers.formatEther(aliceEarned)} MTT (2/3 share)`);
  console.log(`    Bob   earned: ${ethers.formatEther(bobEarned)} MTT (1/3 share)`);

  await staking.connect(alice).claimRewards(1);
  await staking.connect(alice).unstake(1, ethers.parseEther("2000"));
  console.log("[7] Alice claimed rewards and unstaked full principal after lock expiry.");

  // --- Referral cycle ---
  const distAddr = await dist.getAddress();
  await token.connect(treasuryOps).approve(distAddr, toCommissionPool);
  await dist.connect(treasuryOps).depositCommissionPool(toCommissionPool);
  console.log(`[8] Treasury deposited ${ethers.formatEther(toCommissionPool)} MTT into commission pool (12% of real revenue).`);

  // Backend computes: Bob referred a player who spent 500 MTT worth. L1 = 8%.
  const spend = ethers.parseEther("500");
  const l1 = spend * 8n / 100n;
  const evt = ethers.keccak256(ethers.toUtf8Bytes("iap-txn-0001"));
  await dist.connect(oracle).recordCommission(bob.address, 1, l1, evt);
  console.log(`[9] Oracle recorded Bob's L1 commission: ${ethers.formatEther(l1)} MTT (8% of 500 spend).`);

  // Try to overspend the pool — must fail
  const tooMuch = ethers.parseEther("999999");
  let blocked = false;
  try {
    await dist.connect(oracle).recordCommission(alice.address, 1, tooMuch, ethers.keccak256(ethers.toUtf8Bytes("evil")));
  } catch { blocked = true; }
  console.log(`[10] Attempt to pay commission beyond funded revenue: ${blocked ? "BLOCKED (correct)" : "ALLOWED (BUG!)"}`);
  if (!blocked) throw new Error("INVARIANT VIOLATED");

  // Claim requires KYC
  let kycBlocked = false;
  try { await dist.connect(bob).claimCommission(); } catch { kycBlocked = true; }
  console.log(`[11] Claim without KYC: ${kycBlocked ? "BLOCKED (correct)" : "ALLOWED (BUG!)"}`);
  await dist.connect(compliance).setKycApproved(bob.address, true);
  await dist.connect(bob).claimCommission();
  console.log("[12] Bob passed KYC and claimed his commission.");

  // --- Final compliance assertions ---
  console.log("\n" + "=".repeat(70));
  console.log("COMPLIANCE ASSERTIONS");
  console.log("=".repeat(70));
  const deposited = await dist.totalDeposited();
  const recorded = await dist.totalRecorded();
  const claimed = await dist.totalClaimed();
  console.log(`  Commission deposited from revenue : ${ethers.formatEther(deposited)} MTT`);
  console.log(`  Commission recorded to users      : ${ethers.formatEther(recorded)} MTT`);
  console.log(`  Commission claimed by users       : ${ethers.formatEther(claimed)} MTT`);
  console.log(`  Invariant recorded <= deposited   : ${recorded <= deposited ? "HOLDS" : "VIOLATED"}`);

  const pool1 = await staking.pools(1);
  console.log(`  Staking rewards funded            : ${ethers.formatEther(pool1.totalRewardsFunded)} MTT`);
  console.log(`  Staking rewards paid              : ${ethers.formatEther(pool1.totalRewardsPaid)} MTT`);
  console.log(`  Invariant paid <= funded          : ${pool1.totalRewardsPaid <= pool1.totalRewardsFunded ? "HOLDS" : "VIOLATED"}`);

  if (recorded > deposited || pool1.totalRewardsPaid > pool1.totalRewardsFunded) {
    throw new Error("COMPLIANCE INVARIANT VIOLATED");
  }
  console.log("\nAll invariants hold. Every payout traced to real revenue deposits.");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
