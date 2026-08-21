"use client";

import { useState } from "react";
import Link from "next/link";
import { KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button, Callout, Checkbox, Input, PasswordInput, useToast } from "@/components/ui";
import { OAuthRow } from "../../_components/auth-shell";
import { OtpInput } from "../../verify/_components/otp-input";

const MAX_ATTEMPTS = 5;

export function LoginForm() {
  const toast = useToast();
  const [stage, setStage] = useState<"credentials" | "twofa">("credentials");
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  /* FRD A-03: rate-limit login attempts with progressive lockout and a CAPTCHA
   * step after three failures. */
  const showCaptcha = attempts >= 3;
  const lockedOut = attempts >= MAX_ATTEMPTS;

  const submitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!identifier.trim() || !password) {
      setError("Enter your email or phone and your password.");
      return;
    }
    setBusy(true);
    await new Promise((r) => setTimeout(r, 800));
    setBusy(false);

    // Demo: the seeded account has 2FA enabled, so we always advance to the
    // second factor rather than pretending some accounts skip it.
    setStage("twofa");
    toast.info("Two-factor required", "Enter the 6-digit code from your authenticator app.");
  };

  const submitTwoFa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (code.length !== 6) {
      setError("Enter the full 6-digit code.");
      return;
    }
    setBusy(true);
    await new Promise((r) => setTimeout(r, 800));
    setBusy(false);
    if (code === "000000") {
      setAttempts((a) => a + 1);
      setError("That code isn't valid. Codes expire every 30 seconds.");
      return;
    }
    toast.success("Welcome back", "Signed in successfully.");
    window.location.href = "/app";
  };

  if (stage === "twofa") {
    return (
      <form onSubmit={submitTwoFa} noValidate>
        <Callout tone="info" title="Two-factor authentication" icon={<ShieldCheck />} className="mb-6">
          <p className="mt-1">
            Enter the current 6-digit code from your authenticator app. If you use SMS, we&apos;ve just
            sent one to your registered number.
          </p>
        </Callout>

        <OtpInput value={code} onChange={setCode} />

        {error && (
          <p className="mt-4 flex items-center gap-1.5 text-sm font-medium text-critical-400">
            <ShieldAlert className="size-4" /> {error}
          </p>
        )}

        <Button type="submit" fullWidth size="lg" loading={busy} className="mt-6">
          Verify and sign in
        </Button>

        <button
          type="button"
          onClick={() => { setStage("credentials"); setCode(""); setError(null); }}
          className="mt-4 w-full text-center text-sm text-text-muted transition-colors hover:text-text-primary"
        >
          Use a different account
        </button>

        <p className="mt-6 rounded-xl border border-border-subtle bg-surface-inset p-3.5 text-xs leading-relaxed text-text-muted">
          Lost your authenticator? Contact support with your account ID. Recovery requires identity
          re-verification — we can&apos;t bypass 2FA on a request alone, because that would make the
          protection meaningless.
        </p>
      </form>
    );
  }

  return (
    <div>
      <OAuthRow mode="login" />

      <form onSubmit={submitCredentials} noValidate className="space-y-4">
        <Input
          label="Email or phone"
          autoComplete="username"
          placeholder="you@example.com"
          value={identifier}
          onChange={(e) => { setIdentifier(e.target.value); setError(null); }}
          disabled={lockedOut}
        />

        <div>
          <PasswordInput
            label="Password"
            autoComplete="current-password"
            placeholder="Your password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null); }}
            disabled={lockedOut}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <Checkbox checked={remember} onCheckedChange={setRemember} label="Keep me signed in" />
            <Link href="/forgot-password" className="text-sm font-medium text-[var(--accent-hover)] hover:underline">
              Forgot password?
            </Link>
          </div>
        </div>

        {showCaptcha && !lockedOut && (
          <div className="rounded-xl border border-warning-500/30 bg-surface-inset p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-warning-400">
              <ShieldAlert className="size-4" /> Verification required
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
              After three failed attempts we add a challenge to slow down automated attacks.
            </p>
            <div className="mt-3 grid h-16 place-items-center rounded-lg border border-dashed border-border-strong bg-surface-2 text-xs text-text-muted">
              CAPTCHA challenge mounts here
            </div>
          </div>
        )}

        {error && (
          <p className="flex items-center gap-1.5 text-sm font-medium text-critical-400">
            <ShieldAlert className="size-4" /> {error}
          </p>
        )}

        {lockedOut ? (
          <Callout tone="critical" title="Temporarily locked" icon={<KeyRound />}>
            <p className="mt-1">
              Too many failed attempts. This account is locked for 15 minutes as a protective
              measure. You can reset your password now, or wait and try again.
            </p>
            <Button href="/forgot-password" size="sm" variant="danger" className="mt-3">
              Reset password
            </Button>
          </Callout>
        ) : (
          <Button type="submit" fullWidth size="lg" loading={busy}>
            Log in
          </Button>
        )}

        {attempts > 0 && !lockedOut && (
          <p className="text-center text-xs text-text-muted">
            {MAX_ATTEMPTS - attempts} attempt{MAX_ATTEMPTS - attempts === 1 ? "" : "s"} remaining before a temporary lock
          </p>
        )}
      </form>
    </div>
  );
}
