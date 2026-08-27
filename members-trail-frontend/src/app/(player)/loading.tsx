/* Suspense boundary for the whole member area. Sits inside AppShell, so the nav
 * and header stay put and only the content column swaps — which is what makes a
 * navigation read as "the page is changing" rather than "nothing happened". */
import { DashboardRouteSkeleton } from "@/components/layout/route-skeletons";

export default function Loading() {
  return <DashboardRouteSkeleton />;
}
