/* A-04 · Forgot Password — FRD 5.2 */

import { AuthFootLink, AuthHeading } from "../_components/auth-shell";
import { ForgotPasswordForm } from "./_components/forgot-form";

export const metadata = {
  title: "Reset your password",
  description: "Request a single-use password reset link for your Members Trail account.",
};

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeading
        title="Forgot your password?"
        subtitle="Enter the email or phone number on your account and we'll send a single-use reset link."
      />
      <ForgotPasswordForm />
      <AuthFootLink prompt="Remembered it?" label="Back to log in" href="/login" />
    </>
  );
}
