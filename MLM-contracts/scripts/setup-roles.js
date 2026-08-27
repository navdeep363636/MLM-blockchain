/**
 * Grants the production roles, and (optionally) revokes the deployer's.
 *
 *   npx hardhat run scripts/setup-roles.js --network bscTestnet
 *
 * WHY THIS SCRIPT HAS TWO MODES
 * -----------------------------
 * Role administration lives with whoever holds DEFAULT_ADMIN_ROLE, which the
 * constructors set to `ADMIN_MULTISIG`. The previous version of this script
 * always sent transactions signed by the deployer — so the moment you configured
 * a real admin multisig, which is the entire point of having one, every grant
 * reverted with `AccessControlUnauthorizedAccount`. There was no configuration
 * that satisfied both "admin is a multisig" and "the setup script works".
 *
 * So it now checks first:
 *
 *   · Signer HOLDS admin (testnet, or a deliberately hot-key deployment)
 *       → send the transactions.
 *
 *   · Signer does NOT hold admin (the correct mainnet posture)
 *       → send nothing. Write the exact calldata to
 *         deployments/<network>.role-calldata.json for the Safe transaction
 *         builder, and print a human-readable plan.
 *
 * The second mode is not a fallback for a broken script; on mainnet it is the
 * only correct behaviour. A script that could grant roles on a multisig-owned
 * contract would mean the multisig was not really in control.
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
  const guardian = process.env.GUARDIAN_MULTISIG || treasuryOps;
  const payoutRelayer = process.env.PAYOUT_RELAYER_ADDRESS || backendOracle;
  const revokeDeployer = process.env.REVOKE_DEPLOYER === "true";

  const staking = await ethers.getContractAt("MTTStaking", dep.addresses.MTTStaking);
  const dist = await ethers.getContractAt("MTTReferralDistributor", dep.addresses.MTTReferralDistributor);
  const payout = dep.addresses.MTTPayout
    ? await ethers.getContractAt("MTTPayout", dep.addresses.MTTPayout)
    : null;

  console.log("Role setup on", network.name);
  console.log("  Signer          :", signer.address);
  console.log("  Treasury ops    :", treasuryOps);
  console.log("  Backend oracle  :", backendOracle);
  console.log("  Compliance      :", complianceSigner);
  console.log("  Guardian        :", guardian);
  console.log("  Payout relayer  :", payoutRelayer);
  console.log("");

  if (!payout) {
    console.log("NOTE: no MTTPayout in the deployment record — redeploy to include the payout rail.\n");
  }

  /* ------------------------------------------------------------------ *
   * Build the plan
   * ------------------------------------------------------------------ */
  const ADMIN = ethers.ZeroHash; // DEFAULT_ADMIN_ROLE
  const plan = [];

  const add = async (contract, label, roleName, grantee) => {
    const role = await contract[roleName]();
    plan.push({
      contract: label,
      address: await contract.getAddress(),
      role: roleName,
      roleHash: role,
      grantee,
      calldata: contract.interface.encodeFunctionData("grantRole", [role, grantee]),
    });
  };

  await add(staking, "MTTStaking", "TREASURY_ROLE", treasuryOps);
  await add(staking, "MTTStaking", "POOL_ADMIN_ROLE", treasuryOps);
  await add(dist, "MTTReferralDistributor", "TREASURY_ROLE", treasuryOps);
  await add(dist, "MTTReferralDistributor", "ORACLE_ROLE", backendOracle);
  await add(dist, "MTTReferralDistributor", "COMPLIANCE_ROLE", complianceSigner);
  if (payout) {
    await add(payout, "MTTPayout", "TREASURY_ROLE", treasuryOps);
    await add(payout, "MTTPayout", "GUARDIAN_ROLE", guardian);
    /* PAYER_ROLE is granted in the constructor. Listing it makes the intended
     * final state complete in one document; re-granting is a no-op. */
    await add(payout, "MTTPayout", "PAYER_ROLE", payoutRelayer);
  }

  /* ------------------------------------------------------------------ *
   * Can the signer actually execute it?
   * ------------------------------------------------------------------ */
  const contracts = [
    ["MTTStaking", staking],
    ["MTTReferralDistributor", dist],
    ...(payout ? [["MTTPayout", payout]] : []),
  ];

  const authority = [];
  for (const [label, c] of contracts) {
    authority.push({ label, isAdmin: await c.hasRole(ADMIN, signer.address) });
  }
  const canExecuteAll = authority.every((a) => a.isAdmin);

  if (!canExecuteAll) {
    const missing = authority.filter((a) => !a.isAdmin).map((a) => a.label);
    console.log("=".repeat(70));
    console.log("SIGNER IS NOT ROLE ADMIN — emitting calldata instead of sending");
    console.log("=".repeat(70));
    console.log(`DEFAULT_ADMIN_ROLE on ${missing.join(", ")} is held by the configured`);
    console.log("admin multisig, not by this signer. That is the correct production");
    console.log("posture, so this script will not attempt to send these transactions.\n");

    const outPath = path.join(
      __dirname, "..", "deployments", `${network.name}.role-calldata.json`,
    );
    fs.writeFileSync(outPath, JSON.stringify({
      network: network.name,
      chainId: network.config.chainId,
      generatedAt: new Date().toISOString(),
      note:
        "Execute each entry from the admin multisig. `to` is the contract, " +
        "`data` is the encoded grantRole call, value is 0.",
      transactions: plan.map((p) => ({
        to: p.address,
        value: "0",
        data: p.calldata,
        description: `${p.contract}.grantRole(${p.role}, ${p.grantee})`,
      })),
    }, null, 2));

    console.log("Execute these from the admin multisig, in order:\n");
    plan.forEach((p, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. ${p.contract}.grantRole(${p.role}, ${p.grantee})`);
      console.log(`      to  : ${p.address}`);
      console.log(`      data: ${p.calldata}`);
    });
    console.log(`\nSafe-ready calldata written to deployments/${network.name}.role-calldata.json`);
    console.log("\nNothing was sent. Re-run post-deploy-check.js after the multisig executes.");
    return;
  }

  /* ------------------------------------------------------------------ *
   * Execute
   * ------------------------------------------------------------------ */
  console.log("Signer holds DEFAULT_ADMIN_ROLE on every contract — executing.\n");

  const byLabel = { MTTStaking: staking, MTTReferralDistributor: dist, MTTPayout: payout };

  for (const p of plan) {
    const contract = byLabel[p.contract];
    if (await contract.hasRole(p.roleHash, p.grantee)) {
      console.log(`  = ${p.contract}.${p.role} already held by ${p.grantee}`);
      continue;
    }
    console.log(`  + ${p.contract}.grantRole(${p.role}, ${p.grantee})`);
    await (await contract.grantRole(p.roleHash, p.grantee)).wait();
  }

  if (revokeDeployer) {
    console.log("\nRevoking the deployer's operational roles...");
    const revocations = [
      [staking, "MTTStaking", "TREASURY_ROLE"],
      [staking, "MTTStaking", "POOL_ADMIN_ROLE"],
      [dist, "MTTReferralDistributor", "TREASURY_ROLE"],
      [dist, "MTTReferralDistributor", "ORACLE_ROLE"],
      [dist, "MTTReferralDistributor", "COMPLIANCE_ROLE"],
      ...(payout ? [
        [payout, "MTTPayout", "TREASURY_ROLE"],
        [payout, "MTTPayout", "GUARDIAN_ROLE"],
      ] : []),
    ];

    for (const [c, label, roleName] of revocations) {
      const role = await c[roleName]();
      if (!(await c.hasRole(role, signer.address))) continue;

      /* Never revoke a role from the signer unless someone else demonstrably
       * holds it ON CHAIN. Revoking the last holder of POOL_ADMIN_ROLE would
       * make the staking pools permanently unmanageable, and the failure would
       * only surface the next time an operator tried to open a pool. */
      const handover = plan.find(
        (p) => p.contract === label && p.roleHash === role && p.grantee !== signer.address,
      );
      if (!handover) {
        console.log(`  ! keeping ${label}.${roleName}: nobody else was granted it`);
        continue;
      }
      if (!(await c.hasRole(role, handover.grantee))) {
        console.log(`  ! keeping ${label}.${roleName}: ${handover.grantee} does not hold it yet`);
        continue;
      }
      console.log(`  - revoke ${label}.${roleName} from ${signer.address}`);
      await (await c.revokeRole(role, signer.address)).wait();
    }

    console.log("\nNOTE: DEFAULT_ADMIN_ROLE was set at construction to the configured admin.");
    console.log("      Run post-deploy-check.js to confirm no EOA retains admin rights.");
  } else {
    console.log("\nSkipping deployer revocation (set REVOKE_DEPLOYER=true to enable).");
  }

  console.log("\nRole setup complete.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
