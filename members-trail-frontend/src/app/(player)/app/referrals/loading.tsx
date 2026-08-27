/* Suspense fallback for this route.
 *
 * One of these sits beside every page.tsx, and that placement is the point: the
 * App Router only shows a loading boundary for a segment it is NEWLY rendering.
 * A boundary on the parent layout does nothing for a sibling navigation, because
 * the parent is already mounted and React deliberately keeps showing existing
 * content through a transition. Without a file here, clicking a link to this
 * page left the previous page on screen until this one was completely ready —
 * which is what made every navigation look like it had been ignored.
 */

import { DashboardRouteSkeleton } from "@/components/layout/route-skeletons";

export default function Loading() {
  return <DashboardRouteSkeleton />;
}
