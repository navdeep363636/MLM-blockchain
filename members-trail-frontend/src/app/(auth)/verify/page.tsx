/* A-02 · Email / Phone Verification — FRD 5.2 */

import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { AuthHeading } from "../_components/auth-shell";
import { VerifyForm } from "./_components/verify-form";

export const metadata = {
  title: "Verify your account",
  description: "Confirm your email and phone to activate your Members Trail account.",
};

export default function VerifyPage() {
  return (
    <>
      <AuthHeading
        title="Verify your details"
        subtitle="Both channels need confirming — your phone doubles as a two-factor method, so it matters as much as your email."
      />
      {/* Suspense boundary: the form reads `useSearchParams` — the post-login
          destination, the OTP target, the reset token — and a client hook that
          reads the URL cannot be prerendered. Without this the whole page opts
          out of static rendering. */}
      <Suspense fallback={<div className="space-y-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>}>
        <VerifyForm />
      </Suspense>
    </>
  );
}
