/**
 * Full deployment script for the Members Trail contract suite.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network bscTestnet
 *   npx hardhat run scripts/deploy.js --network bscMainnet
 *
 * IMPORTANT: every address in the ADDRESSES block below MUST be a multisig
 * (e.g. Gnosis Safe on BSC) in production — never an EOA. The script will
 * warn loudly if it detects the deployer being reused for admin roles.
 */

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY;

async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);

  console.log("=".repeat(70));
  console.log("Members Trail — Contract Deployment");
  console.log("=".repeat(70));
  console.log("Network :", network.name, `(chainId ${network.config.chainId})`);
  console.log("Deployer:", deployer.address);
  console.log("Balance :", ethers.formatEther(bal), "BNB");
  console.log("");

  // ---------------------------------------------------------------------
  // CONFIGURE THESE BEFORE MAINNET. Read from .env so keys never hit git.
  // ---------------------------------------------------------------------
  const ADDRESSES = {
    admin:            process.env.ADMIN_MULTISIG            || deployer.address,
    rewardsPool:      process.env.REWARDS_POOL_WALLET       || deployer.address,
    treasuryReserve:  process.env.TREASURY_RESERVE_WALLET   || deployer.address,
    liquidityWallet:  process.env.LIQUIDITY_WALLET          || deployer.address,
    marketingWallet:  process.env.MARKETING_WALLET          || deployer.address,
    teamBeneficiary:  process.env.TEAM_BENEFICIARY          || deployer.address,
    advisorsBeneficiary: process.env.ADVISORS_BENEFICIARY   || deployer.address,
    treasuryOps:      process.env.TREASURY_OPS_MULTISIG     || deployer.address,
    backendOracle:    process.env.BACKEND_ORACLE_ADDRESS    || deployer.address,
    complianceSigner: process.env.COMPLIANCE_SIGNER_ADDRESS || deployer.address,
  };

  const isMainnet = network.config.chainId === 56;
  const usingDeployerForAdmin = ADDRESSES.admin === deployer.address;
  if (isMainnet && usingDeployerForAdmin) {
    throw new Error(
      "REFUSING TO DEPLOY: ADMIN_MULTISIG is unset, so the deployer EOA would hold admin rights " +
      "over the treasury and all contracts. Set ADMIN_MULTISIG to a Gnosis Safe before mainnet."
    );
  }
  if (usingDeployerForAdmin) {
    console.log("WARNING: falling back to the deployer address for admin/role wallets.");
    console.log("         This is acceptable on testnet ONLY. Configure .env before mainnet.\n");
  }

  const deployed = {};
  const now = Math.floor(Date.now() / 1000);

  const Vesting = await ethers.getContractFactory("MTTVesting");

  // MTTVesting requires a live token address in its constructor, so ordering is:
  //   token (vesting buckets minted to deployer) -> vesting contracts -> forward buckets in.
  // The deployer holds the team/advisor allocations only momentarily, within this
  // same script run, and post-deploy-check.js asserts the deployer ends at zero.

  // 1) Token — team/advisor allocations mint to the deployer, forwarded below
  console.log("[1/4] Deploying MTTToken...");
  const MTT = await ethers.getContractFactory("MTTToken");
  const token = await MTT.deploy(
    ADDRESSES.admin,
    ADDRESSES.rewardsPool,
    ADDRESSES.treasuryReserve,
    deployer.address,          // team allocation lands here, forwarded to vesting below
    ADDRESSES.liquidityWallet,
    ADDRESSES.marketingWallet,
    deployer.address           // advisor allocation lands here, forwarded to vesting below
  );
  await token.waitForDeployment();
  deployed.MTTToken = await token.getAddress();
  console.log("      MTTToken:", deployed.MTTToken);

  // 2) Vesting contracts, now that we have the token address
  console.log("[2/4] Deploying vesting contracts...");
  const teamVest = await Vesting.deploy(
    ADDRESSES.teamBeneficiary, deployed.MTTToken, now, 12 * MONTH, 36 * MONTH
  );
  await teamVest.waitForDeployment();
  deployed.TeamVesting = await teamVest.getAddress();
  console.log("      TeamVesting:", deployed.TeamVesting);

  const advVest = await Vesting.deploy(
    ADDRESSES.advisorsBeneficiary, deployed.MTTToken, now, 6 * MONTH, 24 * MONTH
  );
  await advVest.waitForDeployment();
  deployed.AdvisorsVesting = await advVest.getAddress();
  console.log("      AdvisorsVesting:", deployed.AdvisorsVesting);

  // Forward the vesting allocations from the deployer into the vesting contracts
  const teamAmount = (await token.TOTAL_SUPPLY()) * 1500n / 10000n;
  const advAmount = (await token.TOTAL_SUPPLY()) * 500n / 10000n;
  console.log("      Funding TeamVesting with", ethers.formatEther(teamAmount), "MTT...");
  await (await token.transfer(deployed.TeamVesting, teamAmount)).wait();
  console.log("      Funding AdvisorsVesting with", ethers.formatEther(advAmount), "MTT...");
  await (await token.transfer(deployed.AdvisorsVesting, advAmount)).wait();

  // 3) Staking
  console.log("[3/4] Deploying MTTStaking...");
  const Staking = await ethers.getContractFactory("MTTStaking");
  const staking = await Staking.deploy(
    deployed.MTTToken, ADDRESSES.admin, ADDRESSES.treasuryReserve
  );
  await staking.waitForDeployment();
  deployed.MTTStaking = await staking.getAddress();
  console.log("      MTTStaking:", deployed.MTTStaking);

  // 4) Referral distributor
  console.log("[4/4] Deploying MTTReferralDistributor...");
  const Dist = await ethers.getContractFactory("MTTReferralDistributor");
  const dist = await Dist.deploy(deployed.MTTToken, ADDRESSES.admin);
  await dist.waitForDeployment();
  deployed.MTTReferralDistributor = await dist.getAddress();
  console.log("      MTTReferralDistributor:", deployed.MTTReferralDistributor);

  // Save the deployment record
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const record = {
    network: network.name,
    chainId: network.config.chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    addresses: deployed,
    configuredWallets: ADDRESSES,
  };
  fs.writeFileSync(
    path.join(outDir, `${network.name}.json`),
    JSON.stringify(record, null, 2)
  );

  console.log("\n" + "=".repeat(70));
  console.log("Deployment complete. Record saved to deployments/" + network.name + ".json");
  console.log("=".repeat(70));
  console.log("\nREQUIRED NEXT STEPS (perform from the admin multisig):");
  console.log("  1. staking.grantRole(TREASURY_ROLE, <treasury ops multisig>)");
  console.log("  2. dist.grantRole(TREASURY_ROLE, <treasury ops multisig>)");
  console.log("  3. dist.grantRole(ORACLE_ROLE, <backend relayer address>)");
  console.log("  4. dist.grantRole(COMPLIANCE_ROLE, <compliance signer>)");
  console.log("  5. Revoke any roles still held by the deployer EOA");
  console.log("  6. Create staking pools via scripts/setup-pools.js");
  console.log("  7. Verify all contracts on BscScan (npx hardhat verify ...)");
  console.log("\nRun scripts/post-deploy-check.js to validate the wiring.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
