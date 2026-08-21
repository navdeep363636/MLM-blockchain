/* D-02 · Profile & settings — FRD 5.3 */

import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui";
import { ProfileSettings } from "./_components/profile-settings";

export const metadata = { title: "Profile & settings" };

export default function ProfileSettingsPage() {
  return (
    <>
      <PageHeader
        title="Profile & settings"
        description="Your public identity, contact details, notification channels and linked sign-in providers. Contact-detail changes are re-verified before they take effect."
        breadcrumb={[
          { label: "Player", href: "/app" },
          { label: "Account" },
          { label: "Profile & settings" },
        ]}
        actions={
          <Button href="/app/settings/security" variant="outline" size="sm">
            Security settings
          </Button>
        }
      />
      <ProfileSettings />
    </>
  );
}
