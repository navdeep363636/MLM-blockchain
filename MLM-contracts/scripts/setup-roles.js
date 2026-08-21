/**
 * Grants production roles and (optionally) revokes the deployer's privileges.
 *
 *   npx hardhat run scripts/setup-roles.js --network bscTestnet
 *
 * On mainnet these calls should be executed from the admin multisig UI
 * (e.g. Gnosis Safe transaction builder), not from this script with a hot key.
 * This script is primarily for testnet and for generating the exact calldata.
 */

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

function loadDeployment() {
  const p = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(p)) throw new Error(`No deployment record at ${p}. Run deploy.js first.`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const [signer] = await ethers.getSigners();
  const dep = loadDeployment();

  const treasuryOps = process.env.TREASURY_OPS_MULTISIG || signer.address;
  const backendOracle = process.env.BACKEND_ORACLE_ADDRESS || signer.address;
  const complianceSigner = process.env.COMPLIANCE_SIGNER_ADDRESS || signer.address;
  const revokeDeployer = process.env.REVOKE_DEPLOYER === "true";

  const staking = await ethers.getContractAt("MTTStaking", dep.addresses.MTTStaking);
  const dist = await ethers.getContractAt("MTTReferralDistributor", dep.addresses.MTTReferralDistributor);

  const STAKING_TREASURY = await staking.TREASURY_ROLE();
  const DIST_TREASURY = await dist.TREASURY_ROLE();
  const DIST_ORACLE = await dist.ORACLE_ROLE();
  const DIST_COMPLIANCE = await dist.COMPLIANCE_ROLE();

  console.log("Granting roles on", network.name);
  console.log("  Treasury ops    :", treasuryOps);
  console.log("  Backend oracle  :", backendOracle);
  console.log("  Compliance      :", complianceSigner);
  console.log("");

  console.log("staking.grantRole(TREASURY_ROLE, treasuryOps)");
  await (await staking.grantRole(STAKING_TREASURY, treasuryOps)).wait();

  console.log("dist.grantRole(TREASURY_ROLE, treasuryOps)");
  await (await dist.grantRole(DIST_TREASURY, treasuryOps)).wait();

  console.log("dist.grantRole(ORACLE_ROLE, backendOracle)");
  await (await dist.grantRole(DIST_ORACLE, backendOracle)).wait();

  console.log("dist.grantRole(COMPLIANCE_ROLE, complianceSigner)");
  await (await dist.grantRole(DIST_COMPLIANCE, complianceSigner)).wait();

  if (revokeDeployer && signer.address !== treasuryOps) {
    console.log("\nRevoking deployer's operational roles...");
    await (await staking.revokeRole(STAKING_TREASURY, signer.address)).wait();
    await (await dist.revokeRole(DIST_TREASURY, signer.address)).wait();
    await (await dist.revokeRole(DIST_ORACLE, signer.address)).wait();
    await (await dist.revokeRole(DIST_COMPLIANCE, signer.address)).wait();
    console.log("Deployer operational roles revoked.");
    console.log("NOTE: DEFAULT_ADMIN_ROLE was set at construction to the configured admin.");
    console.log("      Verify with post-deploy-check.js that no EOA retains admin rights.");
  } else if (!revokeDeployer) {
    console.log("\nSkipping deployer revocation (set REVOKE_DEPLOYER=true to enable).");
  }

  console.log("\nRole setup complete.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
