/* A-03 · Login — FRD 5.2 */

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
      <LoginForm />
      <AuthFootLink prompt="New to Members Trail?" label="Create a free account" href="/signup" />
    </>
  );
}
