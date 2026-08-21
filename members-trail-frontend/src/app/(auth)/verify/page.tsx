/* A-02 · Email / Phone Verification — FRD 5.2 */

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
      <VerifyForm />
    </>
  );
}
