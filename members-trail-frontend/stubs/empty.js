/* An empty module.
 *
 * RainbowKit pulls in Coinbase's Base-Account connector, which lazily requires
 * the optional @x402/* payment SDKs and the optional WalletConnect peers. None
 * are installed and none are reached by the connectors this app uses.
 *
 * webpack stubs these with `resolve.alias: false` and `externals`, but Turbopack
 * reads neither — it only reads the `turbopack` key — so `next dev --turbopack`
 * died on "Can't resolve '@x402/core/client'" before rendering anything. Both
 * bundlers now point at this file. */
module.exports = {};
