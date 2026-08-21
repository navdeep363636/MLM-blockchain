import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },

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
