import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },

  /* Turbopack does not read the `webpack` function below, so every stub has to
   * be declared here as well or `next dev --turbopack` fails to resolve them.
   * Keep the two lists in step. */
  turbopack: {
    resolveAlias: {
      "@x402/core/client": "./stubs/empty.js",
      "@x402/evm": "./stubs/empty.js",
      "@x402/evm/exact/client": "./stubs/empty.js",
      "@x402/evm/upto/client": "./stubs/empty.js",
      "@x402/svm/exact/client": "./stubs/empty.js",
      "pino-pretty": "./stubs/empty.js",
      lokijs: "./stubs/empty.js",
      encoding: "./stubs/empty.js",
    },
  },

  experimental: {
    /*
     * Client router cache lifetimes.
     *
     * Next 15 ships `dynamic: 0`, which means a segment rendered dynamically is
     * dropped from the client cache the moment you navigate away — so going
     * Wallet -> Staking -> Wallet refetches Wallet from the server, and pressing
     * Back is a network round trip rather than an instant restore. 30s is long
     * enough that moving between pages in one sitting is instant and short
     * enough that nobody is looking at minute-old balances; anything that must
     * be fresher is invalidated by the socket already.
     */
    staleTimes: { dynamic: 30, static: 300 },
  },

  webpack: (config) => {
    /* RainbowKit pulls in the Coinbase Base-Account connector, which lazily
     * requires the optional @x402/* payment SDKs. They are not installed and
     * are never reached by the connectors this app uses, so stub them out
     * rather than shipping the extra dependency tree. */
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core/client": false,
      "@x402/evm": false,
      "@x402/evm/exact/client": false,
      "@x402/evm/upto/client": false,
      "@x402/svm/exact/client": false,
    };

    // Optional peer deps of WalletConnect that Next would otherwise bundle.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
