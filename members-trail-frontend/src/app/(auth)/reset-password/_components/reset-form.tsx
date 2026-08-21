"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Check, ShieldAlert, X } from "lucide-react";
import { Button, Callout, PasswordInput, useToast } from "@/components/ui";

const COMMON = new Set(["password", "password1", "12345678", "qwertyuiop", "letmein123"]);

function checks(pw: string) {
  return [
    { label: "At least 10 characters", ok: pw.length >= 10 },
    { label: "Upper and lower case", ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
    { label: "A number", ok: /\d/.test(pw) },
    { label: "A symbol", ok: /[^A-Za-z0-9]/.test(pw) },
    { label: "Not a commonly breached password", ok: pw.length > 0 && !COMMON.has(pw.toLowerCase()) },
  ];
}

export function ResetPasswordForm() {
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useMemo(() => checks(pw), [pw]);
  const score = list.filter((c) => c.ok).length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (list.some((c) => !c.ok)) { setError("Password doesn't meet all requirements."); return; }
    if (pw !== confirm) { setError("The two passwords don't match."); return; }
    setError(null);
    setBusy(true);
    await new Promise((r) => setTimeout(r, 850));
    setBusy(false);
    setDone(true);
    toast.success("Password updated", "All other sessions have been signed out.");
  };

  if (done) {
    return (
      <div className="text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-good-500/12 text-good-400">
          <CheckCircle2 className="size-7" />
        </span>
        <h2 className="mt-4 font-display text-lg font-semibold text-text-primary">Password updated</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-muted">
          Every other active session has been invalidated. Sign in with your new password to continue.
        </p>
        <Button href="/login" fullWidth size="lg" className="mt-6">Log in</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div>
        <PasswordInput
          label="New password"
          autoComplete="new-password"
          value={pw}
          onChange={(e) => { setPw(e.target.value); setError(null); }}
          placeholder="At least 10 characters"
        />
        {pw.length > 0 && (
          <div className="mt-2.5 space-y-2">
            <div className="flex gap-1" aria-hidden>
              {Array.from({ length: 5 }).map((_, i) => (
                <span
                  key={i}
                  className={
                    i < score
                      ? score <= 2 ? "h-1 flex-1 rounded-full bg-critical-500"
                        : score <= 4 ? "h-1 flex-1 rounded-full bg-warning-500"
                        : "h-1 flex-1 rounded-full bg-good-500"
                      : "h-1 flex-1 rounded-full bg-surface-3"
                  }
                />
              ))}
            </div>
            <ul className="grid gap-1 sm:grid-cols-2">
              {list.map((c) => (
                <li key={c.label} className={c.ok ? "flex items-center gap-1.5 text-xs text-good-400" : "flex items-center gap-1.5 text-xs text-text-muted"}>
                  {c.ok ? <Check className="size-3 shrink-0" /> : <X className="size-3 shrink-0" />}
                  {c.label}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <PasswordInput
        label="Confirm new password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => { setConfirm(e.target.value); setError(null); }}
        error={error}
        placeholder="Type it again"
      />

      <Callout tone="warning" title="This ends every other session" icon={<ShieldAlert />}>
        <p className="mt-1">
          Once you set a new password, all active sessions on all devices are invalidated — including
          any session an attacker might hold. You&apos;ll need to sign in again everywhere.
        </p>
      </Callout>

      <Button type="submit" fullWidth size="lg" loading={busy}>Set new password</Button>
    </form>
  );
}
