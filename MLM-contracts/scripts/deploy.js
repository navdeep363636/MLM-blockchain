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
    /* The backend relayer that settles member withdrawals. Gets PAYER_ROLE on
     * MTTPayout and nothing else — see MTTPayout.sol for why that matters. */
    payoutRelayer:    process.env.PAYOUT_RELAYER_ADDRESS    || process.env.BACKEND_ORACLE_ADDRESS || deployer.address,
  };

  /* Ceiling on what the payout relayer may move per 24h window. Deliberately a
   * required decision rather than a default: it is the bound on how much a
   * compromised hot key can cost, and nobody should discover it by accident. */
  const PAYOUT_DAILY_LIMIT = ethers.parseEther(process.env.PAYOUT_DAILY_LIMIT_MTT || "50000");

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

  /*
   * Vesting start.
   *
   * This used to be `Date.now()`, which anchors a 12-month team cliff to the
   * wall-clock moment the deploy script happened to run — on the deployer's
   * machine, in whatever timezone, possibly minutes before or after the block
   * that actually mines the contract. A cliff that nobody can state precisely is
   * a cliff that gets argued about.
   *
   * VESTING_START_UNIX makes it an explicit, reviewable decision. Falling back to
   * the LATEST BLOCK timestamp rather than the local clock at least keeps it on
   * chain time.
   */
  const latestBlock = await ethers.provider.getBlock("latest");
  const now = process.env.VESTING_START_UNIX
    ? Number(process.env.VESTING_START_UNIX)
    : latestBlock.timestamp;
  if (!process.env.VESTING_START_UNIX) {
    console.log(`NOTE: VESTING_START_UNIX unset — anchoring vesting to block time ${now}`);
    console.log(`      (${new Date(now * 1000).toISOString()}). Set it explicitly for mainnet.\n`);
  }
  if (!Number.isFinite(now) || now <= 0) {
    throw new Error(`VESTING_START_UNIX is not a valid unix timestamp: ${process.env.VESTING_START_UNIX}`);
  }

  const Vesting = await ethers.getContractFactory("MTTVesting");

  // MTTVesting requires a live token address in its constructor, so ordering is:
  //   token (vesting buckets minted to deployer) -> vesting contracts -> forward buckets in.
  // The deployer holds the team/advisor allocations only momentarily, within this
  // same script run, and post-deploy-check.js asserts the deployer ends at zero.

  // 1) Token — team/advisor allocations mint to the deployer, forwarded below
  console.log("[1/5] Deploying MTTToken...");
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
  console.log("[2/5] Deploying vesting contracts...");
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
  console.log("[3/5] Deploying MTTStaking...");
  const Staking = await ethers.getContractFactory("MTTStaking");
  const staking = await Staking.deploy(
    deployed.MTTToken, ADDRESSES.admin, ADDRESSES.treasuryReserve
  );
  await staking.waitForDeployment();
  deployed.MTTStaking = await staking.getAddress();
  console.log("      MTTStaking:", deployed.MTTStaking);

  // 4) Referral distributor
  console.log("[4/5] Deploying MTTReferralDistributor...");
  const Dist = await ethers.getContractFactory("MTTReferralDistributor");
  const dist = await Dist.deploy(deployed.MTTToken, ADDRESSES.admin);
  await dist.waitForDeployment();
  deployed.MTTReferralDistributor = await dist.getAddress();
  console.log("      MTTReferralDistributor:", deployed.MTTReferralDistributor);

  // 5) Payout rail — the withdrawal settlement contract
  console.log("[5/5] Deploying MTTPayout...");
  const Payout = await ethers.getContractFactory("MTTPayout");
  const payout = await Payout.deploy(
    deployed.MTTToken,
    ADDRESSES.admin,
    ADDRESSES.payoutRelayer,
    PAYOUT_DAILY_LIMIT
  );
  await payout.waitForDeployment();
  deployed.MTTPayout = await payout.getAddress();
  console.log("      MTTPayout:", deployed.MTTPayout);
  console.log("      payer    :", ADDRESSES.payoutRelayer);
  console.log("      dailyLimit:", ethers.formatEther(PAYOUT_DAILY_LIMIT), "MTT per 24h window");

  // Save the deployment record
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  /*
   * The record carries the EXACT constructor arguments for every instance, not
   * just the addresses.
   *
   * BscScan verification replays the constructor, so a missing argument makes a
   * contract unverifiable after the fact. Two of them cannot be reconstructed
   * from configuration alone:
   *
   *   - The vesting `start` is the BLOCK TIMESTAMP when VESTING_START_UNIX is
   *     unset, so it exists nowhere except in this run.
   *   - The token's team and advisor positions hold the DEPLOYER address, not
   *     the beneficiaries — the allocations mint here and are forwarded to the
   *     vesting contracts immediately afterwards. Verifying with the
   *     beneficiary addresses produces a bytecode mismatch and a confusing
   *     afternoon.
   *
   * scripts/verify.js reads this block and passes it through verbatim.
   */
  const record = {
    network: network.name,
    chainId: network.config.chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    addresses: deployed,
    configuredWallets: ADDRESSES,
    vesting: {
      start: now,
      startIso: new Date(now * 1000).toISOString(),
      startSource: process.env.VESTING_START_UNIX ? "VESTING_START_UNIX" : "block timestamp",
      team: { cliffSeconds: 12 * MONTH, durationSeconds: 36 * MONTH },
      advisors: { cliffSeconds: 6 * MONTH, durationSeconds: 24 * MONTH },
    },
    payout: {
      dailyLimitWei: PAYOUT_DAILY_LIMIT.toString(),
      dailyLimitMtt: ethers.formatEther(PAYOUT_DAILY_LIMIT),
    },
    constructorArgs: {
      MTTToken: [
        ADDRESSES.admin,
        ADDRESSES.rewardsPool,
        ADDRESSES.treasuryReserve,
        deployer.address,
        ADDRESSES.liquidityWallet,
        ADDRESSES.marketingWallet,
        deployer.address,
      ],
      TeamVesting: [
        ADDRESSES.teamBeneficiary, deployed.MTTToken, now, 12 * MONTH, 36 * MONTH,
      ],
      AdvisorsVesting: [
        ADDRESSES.advisorsBeneficiary, deployed.MTTToken, now, 6 * MONTH, 24 * MONTH,
      ],
      MTTStaking: [deployed.MTTToken, ADDRESSES.admin, ADDRESSES.treasuryReserve],
      MTTReferralDistributor: [deployed.MTTToken, ADDRESSES.admin],
      MTTPayout: [
        deployed.MTTToken,
        ADDRESSES.admin,
        ADDRESSES.payoutRelayer,
        PAYOUT_DAILY_LIMIT.toString(),
      ],
    },
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
  console.log("  5. payout.grantRole(TREASURY_ROLE, <treasury ops multisig>)");
  console.log("  6. payout.grantRole(GUARDIAN_ROLE, <guardian multisig>)");
  console.log("  7. Fund the payout float: treasury approves, then payout.fund(amount)");
  console.log("  8. Revoke any roles still held by the deployer EOA");
  console.log("  9. Create staking pools via scripts/setup-pools.js");
  console.log(" 10. Verify all contracts on BscScan (npx hardhat verify ...)");
  console.log("\n  scripts/setup-roles.js does 1-6 for you, or prints the exact");
  console.log("  calldata to paste into a Gnosis Safe when admin is a multisig.");
  console.log("\nRun scripts/post-deploy-check.js to validate the wiring.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
