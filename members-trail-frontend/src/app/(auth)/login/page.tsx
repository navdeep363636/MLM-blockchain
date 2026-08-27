/* A-03 · Login — FRD 5.2 */

import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { AuthFootLink, AuthHeading } from "../_components/auth-shell";
import { LoginForm } from "./_components/login-form";

export const metadata = {
  title: "Log in",
  description: "Sign in to Members Trail. Two-factor authentication protects your balances.",
};

export default function LoginPage() {
  return (
    <>
      <AuthHeading
        title="Welcome back"
        subtitle="Sign in to keep playing, claim staking rewards or check your commission ledger."
      />
      {/* Suspense boundary: the form reads `useSearchParams` — the post-login
          destination, the OTP target, the reset token — and a client hook that
          reads the URL cannot be prerendered. Without this the whole page opts
          out of static rendering. */}
      <Suspense fallback={<div className="space-y-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>}>
        <LoginForm />
      </Suspense>
      <AuthFootLink prompt="New to Members Trail?" label="Create a free account" href="/signup" />
    </>
  );
}
