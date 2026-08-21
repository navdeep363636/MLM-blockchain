import Link from "next/link";
import { Compass, Home } from "lucide-react";
import { Button } from "@/components/ui";
import { AuroraBackground, GridBackdrop } from "@/components/fx";
import { Logo } from "@/components/layout";

export default function NotFound() {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-surface-0 px-6">
      <AuroraBackground intensity={0.7} />
      <GridBackdrop />
      <div className="relative text-center">
        <Logo className="mx-auto" />
        <p className="mt-10 font-display text-7xl font-semibold tracking-tight text-gradient-brand">404</p>
        <h1 className="mt-3 text-xl font-semibold text-text-primary">This page went off-trail</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-text-muted">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Button href="/" icon={<Home className="size-4" />}>Back to home</Button>
          <Button href="/app" variant="outline" icon={<Compass className="size-4" />}>Go to dashboard</Button>
        </div>
        <p className="mt-8 text-xs text-text-muted">
          Need help?{" "}
          <Link href="/contact" className="text-[var(--accent-hover)] underline underline-offset-2">Contact support</Link>
        </p>
      </div>
    </div>
  );
}
