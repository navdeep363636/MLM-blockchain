"use client";

/* The chart plus the provider it needs, in one lazily-imported chunk.
 * See ./allocation-lazy.tsx for why this is split out. */

import { Web3Provider } from "@/components/web3/web3-provider";
import { AllocationChart } from "./allocation";

export function AllocationChartWithWeb3() {
  return (
    <Web3Provider>
      <AllocationChart />
    </Web3Provider>
  );
}
