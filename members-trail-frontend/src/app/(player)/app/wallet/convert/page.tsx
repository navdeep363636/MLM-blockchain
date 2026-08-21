/* W-02 · Points-to-MTT Conversion — FRD 5.5 */

import { PageHeader } from "@/components/layout";
import { ConvertView } from "./_components/convert-view";

export const metadata = { title: "Convert Points" };

export default function ConvertPage() {
  return (
    <>
      <PageHeader
        title="Convert Points to MTT"
        description="At the current published rate, inside your daily allowance. Rate changes need two approvers and are published publicly."
        breadcrumb={[{ label: "Wallet", href: "/app/wallet" }, { label: "Convert" }]}
      />
      <ConvertView />
    </>
  );
}
