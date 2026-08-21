/* A-04 · Reset Password — FRD 5.2 */

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
      <ResetPasswordForm />
      <AuthFootLink prompt="Link expired?" label="Request a new one" href="/forgot-password" />
    </>
  );
}
