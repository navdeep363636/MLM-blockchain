/* N-01 · Notification Center — FRD 5.8 */

import { PageHeader } from "@/components/layout";
import { NotificationsView } from "./_components/notifications-view";

export const metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Transactional and promotional messages in one inbox. Security alerts can't be muted."
        breadcrumb={[{ label: "Notifications" }]}
      />
      <NotificationsView />
    </>
  );
}
