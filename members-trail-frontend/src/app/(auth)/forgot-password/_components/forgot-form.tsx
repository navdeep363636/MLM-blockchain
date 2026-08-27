"use client";

import { useState } from "react";
import { CheckCircle2, Mail, ShieldAlert } from "lucide-react";
import { Button, Callout, Input, useToast } from "@/components/ui";
import { useForgotPassword } from "@/lib/hooks/use-mutations";
import { humanMessage } from "@/lib/api/errors";

export function ForgotPasswordForm() {
  const toast = useToast();
  const forgot = useForgotPassword();
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) { setError("Enter the email or phone on your account."); return; }
    setError(null);
    setBusy(true);
    try {
      await forgot.mutateAsync({ identifier: identifier.trim() });
      /* Shown on success AND on most failures, deliberately: this endpoint does
       * not reveal whether an account exists, so a different screen for "no such
       * user" would hand an attacker the enumeration the API refuses to give.
       * A rate limit is the one thing worth surfacing, because the member needs
       * to know to wait rather than to keep pressing. */
      setSent(true);
      toast.success("Reset link sent", "Check your inbox — the link is valid for 30 minutes.");
    } catch (err) {
      setError(humanMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-good-500/12 text-good-400">
          <CheckCircle2 className="size-7" />
        </span>
        <h2 className="mt-4 font-display text-lg font-semibold text-text-primary">Check your inbox</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-muted">
          If an account exists for{" "}
          <span className="font-medium text-text-secondary">{identifier}</span>, a reset link is on
          its way. It expires in 30 minutes and can only be used once.
        </p>
        <Callout tone="info" title="Why we don't confirm whether the account exists" icon={<ShieldAlert />} className="mt-6 text-left">
          <p className="mt-1">
            Telling you would let anyone check which emails are registered here. The message is the
            same either way — that&apos;s deliberate, not a bug.
          </p>
        </Callout>
        <div className="mt-6 space-y-3">
          <Button href="/login" variant="outline" fullWidth>Back to log in</Button>
          <button
            type="button"
            onClick={() => setSent(false)}
            className="w-full text-center text-sm text-text-muted transition-colors hover:text-text-primary"
          >
            Use a different email or phone
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Input
        label="Email or phone"
        icon={<Mail />}
        autoComplete="username"
        placeholder="you@example.com"
        value={identifier}
        onChange={(e) => { setIdentifier(e.target.value); setError(null); }}
        error={error}
        hint="We'll send a single-use reset link valid for 30 minutes."
      />

      <Button type="submit" fullWidth size="lg" loading={busy}>
        Send reset link
      </Button>

      <p className="rounded-xl border border-border-subtle bg-surface-inset p-3.5 text-xs leading-relaxed text-text-muted">
        Resetting your password signs you out of every active session on every device. If you think
        someone else has access to your account, reset immediately and then review your login history
        under Security settings.
      </p>
    </form>
  );
}
