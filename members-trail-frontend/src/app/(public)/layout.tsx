import { PublicFooter, PublicHeader } from "@/components/layout";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface-0">
      <PublicHeader />
      <main id="main">{children}</main>
      <PublicFooter />
    </div>
  );
}
