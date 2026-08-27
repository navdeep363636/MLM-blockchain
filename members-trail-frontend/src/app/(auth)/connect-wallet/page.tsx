/* A-06 · Wallet Connect / Wallet Creation — FRD 5.2 */

import { AuthHeading } from "../_components/auth-shell";
import { WalletSetup } from "./_components/wallet-setup";
import { Web3Provider } from "@/components/web3/web3-provider";

export const metadata = {
  title: "Connect your wallet",
  description:
    "Connect an external BSC wallet or generate a platform wallet secured by an HSM/MPC key-management service.",
};

export default function ConnectWalletPage() {
  return (
    <>
      <AuthHeading
        title="Where should your MTT go?"
        subtitle="Choose a destination for conversions, staking rewards and commission payouts. You can do this later, but you'll need it before your first conversion."
      />
      <Web3Provider>
        <WalletSetup />
      </Web3Provider>
    </>
  );
}
