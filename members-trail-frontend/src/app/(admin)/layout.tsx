import { AppShell } from "@/components/layout";
import { adminNav } from "@/lib/nav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AppShell nav={adminNav} variant="admin">{children}</AppShell>;
}
