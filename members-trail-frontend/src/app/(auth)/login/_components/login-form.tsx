"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button, Callout, Checkbox, Input, PasswordInput, useToast } from "@/components/ui";
import { useAuth } from "@/lib/auth/auth-context";
import { humanMessage, isApiError } from "@/lib/api/errors";
import { OAuthRow } from "../../_components/auth-shell";
import { OtpInput } from "../../verify/_components/otp-input";

/**
 * The lockout shown here MIRRORS the server; it does not implement it.
 *
 * The real progressive lockout lives in the API, which counts attempts per
 * identifier in Redis and answers with `attemptsRemaining`. This component
 * displays that count. Anything enforced only in the browser is enforced only
 * for people using the browser.
 */
const MAX_ATTEMPTS = 5;

export function LoginForm() {
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const { login, completeTwoFa } = useAuth();

  const [stage, setStage] = useState<"credentials" | "twofa">("credentials");
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [lockedByServer, setLockedByServer] = useState(false);

  /* Where to land after signing in. Carried in the URL rather than in state so it
   * survives the deep link being opened in a new tab, which is how people
   * actually arrive from an email. Restricted to same-site paths: an open
   * redirect on a login page is a phishing primitive. */
  const nextParam = params.get("next");
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : null;

  const land = (isStaff: boolean) => {
    router.replace(next ?? (isStaff ? "/admin" : "/app"));
  };

  /* FRD A-03: progressive lockout with a CAPTCHA step after three failures. Both
   * flags come from the server's own answer where it gives one, and fall back to
   * the local count when it does not. */
  const showCaptcha = captchaRequired || attempts >= 3;
  const lockedOut = lockedByServer || attempts >= MAX_ATTEMPTS;

  const submitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!identifier.trim() || !password) {
      setError("Enter your email or phone and your password.");
      return;
    }
    setBusy(true);
    try {
      const res = await login(identifier, password);

      /* Not authenticated is the NORMAL path for an account with 2FA enrolled —
       * the server issues a challenge instead of tokens. Treating it as a failure
       * would break every protected account. */
      if (!res.authenticated) {
        setChallengeId(res.challengeId ?? null);
        setStage("twofa");
        toast.info(
          "Two-factor required",
          res.twoFaMethod === "sms"
            ? "We've sent a 6-digit code to your registered number."
            : "Enter the 6-digit code from your authenticator app.",
        );
        return;
      }

      toast.success("Welcome back", "Signed in successfully.");
      land(res.isStaff ?? false);
    } catch (err) {
      applyAuthError(err);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Turns an API failure into what the form shows.
   *
   * The server tells us how many attempts remain and whether a CAPTCHA is now
   * required; using those instead of a local counter means the lock the member
   * sees is the lock that actually exists — including across a page reload,
   * which a local counter would silently reset.
   */
  const applyAuthError = (err: unknown) => {
    if (isApiError(err)) {
      const details = (err.details ?? {}) as {
        attemptsRemaining?: number;
        captchaRequired?: boolean;
        lockedUntil?: string;
      };
      if (typeof details.attemptsRemaining === "number") {
        setAttempts(Math.max(0, MAX_ATTEMPTS - details.attemptsRemaining));
      } else {
        setAttempts((a) => a + 1);
      }
      if (details.captchaRequired) setCaptchaRequired(true);
      if (details.lockedUntil || err.code === "ACCOUNT_LOCKED" || err.status === 423) {
        setLockedByServer(true);
      }
      setError(humanMessage(err));
      return;
    }
    setAttempts((a) => a + 1);
    setError(humanMessage(err));
  };

  const submitTwoFa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (code.length !== 6) {
      setError("Enter the full 6-digit code.");
      return;
    }
    if (!challengeId) {
      /* The challenge is short-lived and server-side. Without an id there is
       * nothing to answer, and re-entering credentials is the only honest path. */
      setError("That sign-in attempt has expired. Please enter your password again.");
      setStage("credentials");
      return;
    }
    setBusy(true);
    try {
      const res = await completeTwoFa(challengeId, code);
      if (!res.authenticated) {
        setError("That code wasn't accepted. Codes expire every 30 seconds.");
        return;
      }
      toast.success("Welcome back", "Signed in successfully.");
      land(res.isStaff ?? false);
    } catch (err) {
      applyAuthError(err);
    } finally {
      setBusy(false);
    }
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
