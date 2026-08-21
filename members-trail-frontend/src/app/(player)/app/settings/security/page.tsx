/* D-03 · Security settings — FRD 5.3 */

import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui";
import { SecurityView } from "./_components/security-view";

export const metadata = { title: "Security" };

export default function SecuritySettingsPage() {
  return (
    <>
      <PageHeader
        title="Security"
        description="Two-factor authentication, the devices signed in right now, and every sign-in attempt made on your account — successful or not."
        breadcrumb={[
          { label: "Player", href: "/app" },
          { label: "Account" },
          { label: "Security" },
        ]}
        actions={
          <Button href="/app/settings" variant="outline" size="sm">
            Profile & settings
          </Button>
        }
      />
      <SecurityView />
    </>
  );
}
