/* AD-05 · Conversion rate configuration — FRD 5.9 */

import { PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui";
import { ConversionActions, ConversionView } from "./_components/conversion-view";

export const metadata = { title: "Conversion rate configuration" };

export default function AdminConversionRatePage() {
  return (
    <>
      <PageHeader
        title="Conversion rate configuration"
        description="Set and schedule the Points-to-MTT rate. Proposing and approving are separate acts by separate people, and the whole history is published publicly."
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Configuration" },
          { label: "Conversion rate" },
        ]}
        badge={<Badge tone="warning" dot>Four-eyes required</Badge>}
        actions={<ConversionActions />}
      />
      <ConversionView />
    </>
  );
}
