/* A-01 · Sign Up — FRD 5.2 */

import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { AuthFootLink, AuthHeading } from "../_components/auth-shell";
import { SignUpForm } from "./_components/signup-form";

export const metadata = {
  title: "Create your account",
  description: "Free to join, no deposit required. 18+ only, restricted in some jurisdictions.",
};

export default function SignUpPage() {
  return (
    <>
      <AuthHeading
        title="Create your account"
        subtitle="Free forever to join. You can play and earn Points as soon as your email and phone are verified — KYC comes later, only when you convert or withdraw."
      />
      <Suspense fallback={<div className="space-y-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>}>
        <SignUpForm />
      </Suspense>
      <AuthFootLink prompt="Already have an account?" label="Log in" href="/login" />
    </>
  );
}
