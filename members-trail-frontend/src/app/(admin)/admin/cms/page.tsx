/* AD-11 · CMS — legal & content management — FRD 5.9, 11 */

import { PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui";
import { CmsActions, CmsView } from "./_components/cms-view";

export const metadata = { title: "CMS — legal & content" };

export default function AdminCmsPage() {
  return (
    <>
      <PageHeader
        title="CMS — legal & content"
        description="Edit and version every legal document without a deploy. Draft, legal review, publish — and a material change forces re-acceptance from every member on their next login."
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Platform" },
          { label: "CMS & legal" },
        ]}
        badge={<Badge tone="info" dot>Versioned content</Badge>}
        actions={<CmsActions />}
      />
      <CmsView />
    </>
  );
}
