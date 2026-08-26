/**
 * Funds the MTTPayout working float and sets its daily ceiling.
 *
 *   npx hardhat run scripts/setup-payout.js --network bscTestnet
 *   npm run payout:testnet
 *
 * This is step 7 of the deployment checklist printed by deploy.js, and the one
 * step that cannot be folded into setup-roles.js: funding moves tokens, so it
 * needs a decision about HOW MUCH — not just who is allowed to.
 *
 * Two knobs, both from env:
 *
 *   PAYOUT_FLOAT_MTT        tokens to move from the treasury signer into the
 *                           rail. The rail holds a float precisely so that the
 *                           always-online payer key never custodies the whole
 *                           400,000,000 MTT rewards pool.
 *   PAYOUT_DAILY_LIMIT_MTT  the 24h ceiling. deploy.js already set this at
 *                           construction; passing it again re-applies it, which
 *                           is how you change it later.
 *
 * A NOTE ON THE LIMIT. The window resets rather than sliding, so up to 2x the
 * limit can leave across a boundary. Set it to half of what an incident could
 * tolerate, not to what a normal day costs.
 *
 * Like setup-roles.js, this refuses to guess: if the signer does not hold the
 * role a step needs, the step is written out as Safe-ready calldata instead of
 * being sent. On mainnet, where TREASURY_ROLE and GUARDIAN_ROLE belong to
 * multisigs, that is the only path that can work.
 */

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const depPath = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(depPath)) {
    throw new Error(`No deployment record at ${depPath}. Run deploy.js first.`);
  }
  const dep = JSON.parse(fs.readFileSync(depPath, "utf8"));

  if (!dep.addresses.MTTPayout) {
    throw new Error(
      "This deployment record has no MTTPayout address. Withdrawals would fall back to a\n" +
      "direct token.transfer from the relayer key — the exact arrangement the payout rail\n" +
      "exists to replace. Redeploy with the current deploy.js.",
    );
  }

  const [signer] = await ethers.getSigners();
  const payout = await ethers.getContractAt("MTTPayout", dep.addresses.MTTPayout);
  const token = await ethers.getContractAt("MTTToken", dep.addresses.MTTToken);

  const floatMtt = process.env.PAYOUT_FLOAT_MTT || "0";
  const limitMtt = process.env.PAYOUT_DAILY_LIMIT_MTT || "";

  const TREASURY_ROLE = await payout.TREASURY_ROLE();
  const GUARDIAN_ROLE = await payout.GUARDIAN_ROLE();

  console.log("Payout rail setup on", network.name);
  console.log("  MTTPayout   :", dep.addresses.MTTPayout);
  console.log("  Signer      :", signer.address);
  console.log("  Float now   :", ethers.formatEther(await payout.float()), "MTT");
  console.log("  Daily limit :", ethers.formatEther(await payout.dailyLimit()), "MTT");
  console.log("  Paused      :", await payout.paused());
  console.log("");

  /* Each step carries the role it needs, so an unauthorised signer produces
   * calldata rather than a revert three transactions in. */
  const steps = [];

  if (floatMtt !== "0") {
    const amount = ethers.parseEther(floatMtt);
    steps.push({
      label: `MTTToken.approve(MTTPayout, ${floatMtt} MTT)`,
      to: dep.addresses.MTTToken,
      data: token.interface.encodeFunctionData("approve", [dep.addresses.MTTPayout, amount]),
      role: null, /* anyone can approve their own tokens */
      send: async () => token.approve(dep.addresses.MTTPayout, amount),
    });
    steps.push({
      label: `MTTPayout.fund(${floatMtt} MTT)`,
      to: dep.addresses.MTTPayout,
      data: payout.interface.encodeFunctionData("fund", [amount]),
      role: { name: "TREASURY_ROLE", hash: TREASURY_ROLE },
      send: async () => payout.fund(amount),
    });
  }

  if (limitMtt !== "") {
    const next = ethers.parseEther(limitMtt);
    if (next === (await payout.dailyLimit())) {
      console.log(`  = daily limit is already ${limitMtt} MTT — skipping`);
    } else {
      steps.push({
        label: `MTTPayout.setDailyLimit(${limitMtt} MTT)`,
        to: dep.addresses.MTTPayout,
        data: payout.interface.encodeFunctionData("setDailyLimit", [next]),
        role: { name: "GUARDIAN_ROLE", hash: GUARDIAN_ROLE },
        send: async () => payout.setDailyLimit(next),
      });
    }
  }

  if (steps.length === 0) {
    console.log("Nothing to do. Set PAYOUT_FLOAT_MTT and/or PAYOUT_DAILY_LIMIT_MTT.");
    return;
  }

  const blocked = [];
  for (const step of steps) {
    if (step.role && !(await payout.hasRole(step.role.hash, signer.address))) {
      blocked.push(step);
      continue;
    }
    console.log(`  + ${step.label}`);
    await (await step.send()).wait();
  }

  if (blocked.length > 0) {
    const out = path.join(__dirname, "..", "deployments", `${network.name}.payout-calldata.json`);
    fs.writeFileSync(out, JSON.stringify({
      network: network.name,
      chainId: network.config.chainId,
      payout: dep.addresses.MTTPayout,
      transactions: blocked.map((s) => ({
        description: s.label,
        requiredRole: s.role.name,
        to: s.to,
        value: "0",
        data: s.data,
      })),
    }, null, 2));

    console.log("\nThe signer does not hold the role these steps need:\n");
    blocked.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.label}  (needs ${s.role.name})`);
      console.log(`      to  : ${s.to}`);
      console.log(`      data: ${s.data}`);
    });
    console.log(`\nSafe-ready calldata written to deployments/${network.name}.payout-calldata.json`);
    console.log("Nothing was sent for those steps.");
  }

  console.log("\n  Float now   :", ethers.formatEther(await payout.float()), "MTT");
  console.log("  Daily limit :", ethers.formatEther(await payout.dailyLimit()), "MTT");
  console.log("  Allowance   :", ethers.formatEther(await payout.remainingAllowance()), "MTT left in this window");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
