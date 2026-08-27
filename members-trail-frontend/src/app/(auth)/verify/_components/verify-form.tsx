"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Mail, PencilLine, RefreshCw, Smartphone, TriangleAlert } from "lucide-react";
import { Badge, Button, Callout, Input, Steps, useToast } from "@/components/ui";
import { useResendOtp, useVerifyOtp } from "@/lib/hooks/use-mutations";
import { humanMessage, isApiError } from "@/lib/api/errors";
import { OtpInput } from "./otp-input";

const RESEND_COOLDOWN = 60;   // FRD A-02
const MAX_ATTEMPTS = 5;
const EXPIRY_SECONDS = 600;   // 10 minutes

type Channel = "email" | "phone";

export function VerifyForm() {
  const toast = useToast();
  const params = useSearchParams();
  const verifyOtp = useVerifyOtp();
  const resendOtp = useResendOtp();
  const [channel, setChannel] = useState<Channel>("email");
  const [done, setDone] = useState<Record<Channel, boolean>>({ email: false, phone: false });
  const [code, setCode] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [expiresIn, setExpiresIn] = useState(EXPIRY_SECONDS);
  const [editing, setEditing] = useState(false);
  /* Carried from the signup step in the URL. There is no session yet — the
   * account is unverified — so there is no profile to read it from, and inventing
   * a plausible address would tell someone their code went somewhere it did not. */
  const [contact, setContact] = useState({
    email: params.get("email") ?? "",
    phone: params.get("phone") ?? "",
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  useEffect(() => {
    const t = setInterval(() => setExpiresIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const expired = expiresIn === 0;
  const lockedOut = attempts >= MAX_ATTEMPTS;
  const both = done.email && done.phone;

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (code.length !== 6) { setError("Enter all six digits."); return; }
    if (expired) { setError("This code has expired. Request a new one."); return; }
    setBusy(true);
    try {
      await verifyOtp.mutateAsync({
        channel: channel === "phone" ? "sms" : "email",
        target: channel === "phone" ? contact.phone || undefined : contact.email || undefined,
        code,
      });
    } catch (err) {
      /* The server counts attempts, not this component: a local counter resets on
       * reload, which makes the limit meaningless. `attemptsRemaining` comes back
       * on the failure when there is one to report. */
      const remaining = isApiError(err)
        ? (err.details as { attemptsRemaining?: number } | undefined)?.attemptsRemaining
        : undefined;
      setAttempts((a) => (typeof remaining === "number" ? MAX_ATTEMPTS - remaining : a + 1));
      setError(humanMessage(err));
      return;
    } finally {
      setBusy(false);
    }

    const next = { ...done, [channel]: true };
    setDone(next);
    setCode("");
    setAttempts(0);
    setExpiresIn(EXPIRY_SECONDS);
    toast.success(`${channel === "email" ? "Email" : "Phone"} verified`);

    if (!next.phone) setChannel("phone");
    else if (!next.email) setChannel("email");
  };

  const resend = async () => {
    setError(null);
    try {
      const res = await resendOtp.mutateAsync({
        channel: channel === "phone" ? "sms" : "email",
        target: channel === "phone" ? contact.phone || undefined : contact.email || undefined,
      });
      /* The server owns the cooldown and tells us how long it is. Using our own
       * constant would show "resend in 60s" while the API refuses for 90. */
      setCooldown(res?.resendAfter ?? RESEND_COOLDOWN);
      setExpiresIn(EXPIRY_SECONDS);
      setCode("");
      toast.info("Code sent", `A new code is on its way to your ${channel}.`);
    } catch (err) {
      const retryAfter = isApiError(err) ? err.retryAfter : undefined;
      if (retryAfter) setCooldown(retryAfter);
      setError(humanMessage(err));
    }
  };

  if (both) {
    return (
      <div className="text-center">
        <Steps steps={["Details", "Verify", "KYC", "Wallet"]} current={2} className="mb-8" />
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-good-500/12 text-good-400">
          <CheckCircle2 className="size-7" />
        </span>
        <h2 className="mt-4 font-display text-lg font-semibold text-text-primary">Both channels verified</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-muted">
          Your account is active and you can start playing in free mode right now — Points will
          credit to your ledger. KYC is only needed when you want to convert Points to MTT or
          withdraw.
        </p>
        <div className="mt-6 space-y-3">
          <Button href="/app" fullWidth size="lg">Go to dashboard</Button>
          <Button href="/kyc" variant="outline" fullWidth>Complete KYC now</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Steps steps={["Details", "Verify", "KYC", "Wallet"]} current={1} className="mb-8" />

      <div className="mb-6 flex gap-2">
        {(["email", "phone"] as Channel[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => { setChannel(c); setCode(""); setError(null); }}
            disabled={done[c]}
            className={
              c === channel
                ? "flex flex-1 items-center gap-2.5 rounded-xl border border-[var(--accent)] bg-accent-soft p-3.5 text-left"
                : "flex flex-1 items-center gap-2.5 rounded-xl border border-border-subtle bg-surface-1 p-3.5 text-left transition-colors hover:border-border-strong disabled:opacity-60"
            }
          >
            <span className={c === channel ? "grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--accent)] text-white" : "grid size-8 shrink-0 place-items-center rounded-lg bg-surface-3 text-text-muted"}>
              {c === "email" ? <Mail className="size-4" /> : <Smartphone className="size-4" />}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-medium uppercase tracking-wider text-text-muted">
                {c === "email" ? "Email" : "Phone"}
              </span>
              {done[c] ? (
                <Badge tone="good" className="mt-0.5" icon={<CheckCircle2 className="size-3" />}>Verified</Badge>
              ) : (
                <span className="block truncate text-xs text-text-secondary">
                  {c === "email" ? contact.email : contact.phone}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      <p className="mb-5 text-sm leading-relaxed text-text-muted">
        We sent a 6-digit code to{" "}
        <span className="font-medium text-text-primary">
          {channel === "email" ? contact.email : contact.phone}
        </span>
        . It expires in{" "}
        <span className="tnum font-medium text-text-primary">
          {String(Math.floor(expiresIn / 60)).padStart(2, "0")}:{String(expiresIn % 60).padStart(2, "0")}
        </span>
        .
      </p>

      <form onSubmit={verify} noValidate>
        <OtpInput value={code} onChange={(v) => { setCode(v); setError(null); }} invalid={!!error} disabled={lockedOut || expired} />

        {error && (
          <p className="mt-4 flex items-center justify-center gap-1.5 text-sm font-medium text-critical-400">
            <TriangleAlert className="size-4" /> {error}
          </p>
        )}

        {expired && (
          <Callout tone="warning" title="Code expired" icon={<TriangleAlert />} className="mt-4">
            <p className="mt-1">Codes are valid for 10 minutes. Request a fresh one below.</p>
          </Callout>
        )}

        {lockedOut && (
          <Callout tone="critical" title="Too many attempts" icon={<TriangleAlert />} className="mt-4">
            <p className="mt-1">
              You&apos;ve used all 5 attempts for this code. Request a new code to reset the counter.
            </p>
          </Callout>
        )}

        <Button type="submit" fullWidth size="lg" loading={busy} disabled={lockedOut || expired} className="mt-6">
          Verify {channel === "email" ? "email" : "phone"}
        </Button>
      </form>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
        <button
          type="button"
          onClick={resend}
          disabled={cooldown > 0}
          className="inline-flex items-center gap-1.5 font-medium text-[var(--accent-hover)] transition-colors hover:underline disabled:cursor-not-allowed disabled:text-text-muted disabled:no-underline"
        >
          <RefreshCw className="size-3.5" />
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </button>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="inline-flex items-center gap-1.5 text-text-muted transition-colors hover:text-text-primary"
        >
          <PencilLine className="size-3.5" />
          Change {channel === "email" ? "email" : "phone"}
        </button>
      </div>

      {editing && (
        <div className="mt-5 rounded-xl border border-border-subtle bg-surface-inset p-4">
          <Input
            label={channel === "email" ? "New email address" : "New phone number"}
            type={channel === "email" ? "email" : "tel"}
            value={channel === "email" ? contact.email : contact.phone}
            onChange={(e) =>
              setContact((c) => ({ ...c, [channel]: e.target.value }))
            }
            hint="You can change this while unverified. After verification, a change requires re-verification."
          />
          <Button size="sm" className="mt-3" onClick={() => { setEditing(false); resend(); }}>
            Save and resend code
          </Button>
        </div>
      )}

      <p className="mt-7 rounded-xl border border-border-subtle bg-surface-inset p-3.5 text-xs leading-relaxed text-text-muted">
        Your account stays in an unverified state until <strong className="text-text-secondary">both</strong>{" "}
        email and phone are confirmed. Unverified accounts can browse but can&apos;t earn withdrawable
        Points or request a withdrawal.
      </p>
    </div>
  );
}
