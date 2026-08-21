/**
 * OPTIONAL fallback — only needed if `npx hardhat compile` fails with:
 *
 *   Error HH502: Couldn't download compiler version list
 *   ... Failed to download https://binaries.soliditylang.org/... 403
 *
 * That happens on machines/networks that block binaries.soliditylang.org.
 * This shim makes Hardhat compile with the solc 0.8.24 build from npm
 * (solc-js) instead of the downloaded native binary.
 *
 * To enable:
 *   npm install solc@0.8.24 --no-save
 *   add this as the FIRST line of hardhat.config.js:   require("./local-solc");
 *
 * Note: solc-js produces identical bytecode to the native binary for the same
 * version and settings, so BscScan verification still matches. It is just slower.
 * If your machine can reach binaries.soliditylang.org, do NOT enable this.
 */
const { subtask } = require("hardhat/config");
const {
  TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
} = require("hardhat/builtin-tasks/task-names");

const TARGET_VERSION = "0.8.24";

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === TARGET_VERSION) {
    try {
      const compilerPath = require.resolve("solc/soljson.js");
      const installed = require("solc/package.json").version;
      if (!installed.startsWith(TARGET_VERSION)) {
        throw new Error(
          `local solc is ${installed}, expected ${TARGET_VERSION}. ` +
          `Run: npm install solc@${TARGET_VERSION} --no-save`
        );
      }
      return {
        compilerPath,
        isSolcJs: true,
        version: args.solcVersion,
        longVersion: installed,
      };
    } catch (e) {
      console.warn(`[local-solc] falling back to download: ${e.message}`);
    }
  }
  return runSuper();
});
