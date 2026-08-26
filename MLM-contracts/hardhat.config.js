require("./local-solc");
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY || "";

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris"
    }
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    /*
     * An external `hardhat node`, for exercising the backend indexer and relayer
     * against a real JSON-RPC endpoint. The in-process `hardhat` network has no
     * socket for another process to reach, so it cannot test the thing that
     * actually breaks in production: the RPC boundary.
     */
    localhost: {
      url: process.env.LOCAL_RPC || "http://127.0.0.1:8545",
      chainId: 31337
    },
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC || "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
    },
    bscMainnet: {
      url: process.env.BSC_MAINNET_RPC || "https://bsc-dataseed.binance.org",
      chainId: 56,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
    }
  },
  /*
   * A single string, NOT a per-network map.
   *
   * hardhat-verify 2.x treats a map as the legacy Etherscan V1 configuration,
   * and V1 was retired — so verification failed with a confusing key error even
   * with a perfectly good key. The V2 endpoint is multi-chain and takes one
   * etherscan.io key for BSC as well.
   */
  etherscan: {
    apiKey: BSCSCAN_API_KEY
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD"
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};
