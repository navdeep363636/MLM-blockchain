/**
 * Generates the ABI modules that the backend and the frontend import.
 *
 *   npm run abi
 *   ABI_FRONTEND_DIR=../members-trail-frontend/src/lib/web3/abis \
 *   ABI_BACKEND_FILE=../members-trail-api/src/modules/chain/abis.generated.ts \
 *   npm run abi
 *
 * WHY THIS EXISTS
 * ---------------
 * The backend's chain layer was written against HAND-WRITTEN `parseAbi([...])`
 * fragments, and every one of them was wrong. Not subtly: `recordCommission` had
 * its arguments in a different order than the contract, `clawback` took a
 * `string` where the contract takes a `bytes32`, and all five staking events had
 * the wrong parameter order, the wrong types, or the wrong name entirely
 * (`RewardsClaimed` vs `RewardClaimed`, `RewardPoolFunded` vs `PoolFunded`).
 *
 * The failure mode is the reason this matters. A wrong function signature is a
 * different selector, so the call reverts — noisy, findable. A wrong EVENT
 * signature is a different topic0, so `getLogs` matches NOTHING. It does not
 * throw. The indexer runs forever, reports healthy, and silently indexes zero
 * events while members' stakes never appear.
 *
 * Hand-maintaining an ABI in three places was always going to drift. Generating
 * it from the compiled artifact means the only way to be wrong is to not run
 * this script — which `post-deploy-check.js` now verifies.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts", "contracts");

/** contract name -> the export name the frontend already imports. */
const CONTRACTS = [
  { name: "MTTToken", export: "mttTokenAbi", file: "mttToken" },
  { name: "MTTStaking", export: "mttStakingAbi", file: "mttStaking" },
  { name: "MTTReferralDistributor", export: "mttReferralDistributorAbi", file: "mttReferralDistributor" },
  { name: "MTTVesting", export: "mttVestingAbi", file: "mttVesting" },
  { name: "MTTPayout", export: "mttPayoutAbi", file: "mttPayout" },
];

function readArtifact(name) {
  const p = path.join(ARTIFACTS, `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(`No artifact for ${name} at ${p}. Run \`npx hardhat compile\` first.`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/**
 * Compiler settings, read from the BUILD INFO rather than from hardhat.config.js.
 *
 * Requiring the config here would pull in local-solc.js, which registers a
 * Hardhat subtask — and calling that outside a Hardhat run throws
 * "HardhatContext is not created". The build info is also the more truthful
 * source: it records what the artifact was ACTUALLY compiled with, which is the
 * thing BscScan verification has to match.
 */
function solcSettings() {
  const dir = path.join(ROOT, "artifacts", "build-info");
  if (!fs.existsSync(dir)) return "unknown build (no build-info; run `npx hardhat compile`)";
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return "unknown build (empty build-info)";

  const info = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8"));
  const opt = info.input?.settings?.optimizer ?? {};
  const evm = info.input?.settings?.evmVersion ?? "default";
  return `Solidity ${info.solcVersion}, optimizer ${opt.enabled ? `runs=${opt.runs}` : "disabled"}, evmVersion=${evm}.`;
}

const HEADER = (name, settings) =>
  `// GENERATED FILE — do not hand-edit.\n` +
  `//\n` +
  `// Source : MLM-contracts/artifacts/contracts/${name}.sol/${name}.json\n` +
  `// Build  : ${settings}\n` +
  `// Command: npm run abi   (in MLM-contracts)\n` +
  `//\n` +
  `// Hand-editing an ABI is how the previous chain layer ended up matching no\n` +
  `// events at all: a wrong event signature is a wrong topic0, and getLogs then\n` +
  `// returns an empty array rather than an error.\n`;

function writeFrontend(dir, settings) {
  fs.mkdirSync(dir, { recursive: true });
  for (const c of CONTRACTS) {
    const artifact = readArtifact(c.name);
    const body =
      HEADER(c.name, settings) +
      `export const ${c.export} = ${JSON.stringify(artifact.abi, null, 2)} as const;\n`;
    fs.writeFileSync(path.join(dir, `${c.file}.ts`), body);
    console.log(`  frontend: ${c.file}.ts (${artifact.abi.length} entries)`);
  }

  /* The barrel, so a new contract does not need a manual export line. */
  const barrel =
    `// GENERATED FILE — do not hand-edit. Run \`npm run abi\` in MLM-contracts.\n` +
    CONTRACTS.map((c) => `export { ${c.export} } from "./${c.file}";`).join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "index.ts"), barrel);
  console.log("  frontend: index.ts");
}

function writeBackend(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const parts = [];
  parts.push(
    `/* GENERATED FILE — do not hand-edit.\n` +
    ` *\n` +
    ` * Source : MLM-contracts/artifacts/contracts/*.sol/*.json\n` +
    ` * Build  : ${settings}\n` +
    ` * Command: npm run abi   (in MLM-contracts)\n` +
    ` *\n` +
    ` * The whole ABI is exported per contract, not a curated subset. The previous\n` +
    ` * approach — hand-written \`parseAbi\` fragments listing "only what we call" —\n` +
    ` * was well-intentioned and produced a chain layer where every event signature\n` +
    ` * was wrong. A wrong event signature does not throw; it matches nothing.\n` +
    ` *\n` +
    ` * Narrowing what the codebase is ALLOWED to call is still worth doing, but it\n` +
    ` * belongs in a reviewed allowlist of function names (see chain.constants.ts),\n` +
    ` * not in a re-typed copy of the interface.\n` +
    ` */\n`,
  );

  for (const c of CONTRACTS) {
    const artifact = readArtifact(c.name);
    parts.push(
      `export const ${c.export} = ${JSON.stringify(artifact.abi, null, 2)} as const;\n`,
    );
  }

  /* Name unions, so a typo in a call site is a compile error rather than a
   * runtime revert. */
  for (const c of CONTRACTS) {
    const artifact = readArtifact(c.name);
    const fns = artifact.abi.filter((e) => e.type === "function").map((e) => e.name);
    const evts = artifact.abi.filter((e) => e.type === "event").map((e) => e.name);
    const base = c.name.replace(/^MTT/, "");
    parts.push(
      `/** Every function on ${c.name}. A typo is a compile error, not a revert. */\n` +
      `export type ${base}Function =\n  ` +
      [...new Set(fns)].sort().map((n) => `| "${n}"`).join("\n  ") + ";\n\n" +
      `/** Every event ${c.name} can emit. */\n` +
      `export type ${base}Event =\n  ` +
      [...new Set(evts)].sort().map((n) => `| "${n}"`).join("\n  ") + ";\n",
    );
  }

  /* A fingerprint the deploy check can compare against the on-chain bytecode's
   * interface, so "did anyone regenerate the ABI" is answerable. */
  const fingerprint = {};
  for (const c of CONTRACTS) {
    const artifact = readArtifact(c.name);
    fingerprint[c.name] = {
      functions: artifact.abi.filter((e) => e.type === "function").length,
      events: artifact.abi.filter((e) => e.type === "event").length,
    };
  }
  parts.push(
    `/** Shape of the interface these ABIs were generated from. */\n` +
    `export const ABI_FINGERPRINT = ${JSON.stringify(fingerprint, null, 2)} as const;\n`,
  );

  fs.writeFileSync(file, parts.join("\n"));
  console.log(`  backend : ${path.relative(ROOT, file)}`);
}

function writeJson(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const c of CONTRACTS) {
    const artifact = readArtifact(c.name);
    fs.writeFileSync(
      path.join(dir, `${c.name}.json`),
      JSON.stringify({ abi: artifact.abi }, null, 2),
    );
  }
  console.log(`  json    : abi/*.json (${CONTRACTS.length} files)`);
}

function main() {
  const settings = solcSettings();
  console.log("Exporting ABIs —", settings, "\n");

  writeJson(path.join(ROOT, "abi"));

  const frontendDir = process.env.ABI_FRONTEND_DIR;
  if (frontendDir) writeFrontend(path.resolve(ROOT, frontendDir), settings);
  else console.log("  frontend: skipped (set ABI_FRONTEND_DIR)");

  const backendFile = process.env.ABI_BACKEND_FILE;
  if (backendFile) writeBackend(path.resolve(ROOT, backendFile), settings);
  else console.log("  backend : skipped (set ABI_BACKEND_FILE)");

  console.log("\nDone.");
}

main();
