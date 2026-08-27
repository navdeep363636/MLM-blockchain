/* A-04 · Reset Password — FRD 5.2 */

import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { AuthFootLink, AuthHeading } from "../_components/auth-shell";
import { ResetPasswordForm } from "./_components/reset-form";

export const metadata = {
  title: "Set a new password",
  description: "Choose a new password for your Members Trail account.",
};

export default function ResetPasswordPage() {
  return (
    <>
      <AuthHeading
        title="Set a new password"
        subtitle="Choose something you don't use anywhere else. We check new passwords against known breach lists."
      />
      {/* Suspense boundary: the form reads `useSearchParams` — the post-login
          destination, the OTP target, the reset token — and a client hook that
          reads the URL cannot be prerendered. Without this the whole page opts
          out of static rendering. */}
      <Suspense fallback={<div className="space-y-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>}>
        <ResetPasswordForm />
      </Suspense>
      <AuthFootLink prompt="Link expired?" label="Request a new one" href="/forgot-password" />
    </>
  );
}
