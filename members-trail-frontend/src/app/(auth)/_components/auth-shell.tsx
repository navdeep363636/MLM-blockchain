import Link from "next/link";
import { cn } from "@/lib/utils";

/** Consistent heading block for every auth screen. */
export function AuthHeading({
  title, subtitle, className,
}: { title: React.ReactNode; subtitle?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-7", className)}>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-text-primary">{title}</h1>
      {subtitle && <p className="mt-2 text-sm leading-relaxed text-text-muted">{subtitle}</p>}
    </div>
  );
}

export function AuthFootLink({
  prompt, label, href,
}: { prompt: string; label: string; href: string }) {
  return (
    <p className="mt-6 text-center text-sm text-text-muted">
      {prompt}{" "}
      <Link href={href} className="link-slide font-medium text-[var(--accent-hover)]">
        {label}
      </Link>
    </p>
  );
}

/** OAuth row. Present on sign-up and login per FRD A-01 / A-03. */
export function OAuthRow({ mode }: { mode: "signup" | "login" }) {
  const verb = mode === "signup" ? "Sign up" : "Log in";
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          className="inline-flex h-11 items-center justify-center gap-2.5 rounded-xl text-sm font-medium text-text-primary
                     bg-[linear-gradient(180deg,var(--surface-3),color-mix(in_oklab,var(--surface-3)_84%,var(--surface-inset)))]
                     ring-1 ring-inset ring-border-default
                     [box-shadow:inset_0_1px_0_0_var(--rim-light),var(--shadow-e1)]
                     transition-[box-shadow,transform,--tw-ring-color] duration-[var(--dur-quick)] ease-[var(--ease-tide)]
                     hover:-translate-y-px hover:ring-border-strong hover:[box-shadow:inset_0_1px_0_0_var(--rim-light-strong),var(--shadow-e2)]
                     active:translate-y-0"
        >
          <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0 0 12 23Z" />
            <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
          </svg>
          <span className="sr-only sm:not-sr-only">{verb} with</span> Google
        </button>
        <button
          type="button"
          className="inline-flex h-11 items-center justify-center gap-2.5 rounded-xl text-sm font-medium text-text-primary
                     bg-[linear-gradient(180deg,var(--surface-3),color-mix(in_oklab,var(--surface-3)_84%,var(--surface-inset)))]
                     ring-1 ring-inset ring-border-default
                     [box-shadow:inset_0_1px_0_0_var(--rim-light),var(--shadow-e1)]
                     transition-[box-shadow,transform,--tw-ring-color] duration-[var(--dur-quick)] ease-[var(--ease-tide)]
                     hover:-translate-y-px hover:ring-border-strong hover:[box-shadow:inset_0_1px_0_0_var(--rim-light-strong),var(--shadow-e2)]
                     active:translate-y-0"
        >
          <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden>
            <path d="M16.36 12.78c-.02-2.2 1.79-3.26 1.87-3.31-1.02-1.49-2.6-1.7-3.16-1.72-1.34-.14-2.62.79-3.3.79-.69 0-1.74-.77-2.86-.75-1.47.02-2.83.86-3.58 2.17-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.74 2.2 1.1-.04 1.52-.71 2.85-.71 1.33 0 1.7.71 2.86.69 1.18-.02 1.94-1.07 2.67-2.14.84-1.23 1.18-2.42 1.2-2.48-.03-.01-2.3-.88-2.33-3.5ZM14.3 5.9c.6-.74 1.01-1.75.9-2.77-.87.04-1.94.59-2.57 1.32-.56.65-1.05 1.7-.92 2.7.98.08 1.98-.5 2.59-1.25Z" />
          </svg>
          Apple
        </button>
      </div>

      <div className="my-6 flex items-center gap-3">
        <span className="divider-glow h-px flex-1 opacity-60" />
        <span className="text-xs font-medium uppercase tracking-wider text-text-muted">or</span>
        <span className="divider-glow h-px flex-1 rotate-180 opacity-60" />
      </div>
    </>
  );
}
