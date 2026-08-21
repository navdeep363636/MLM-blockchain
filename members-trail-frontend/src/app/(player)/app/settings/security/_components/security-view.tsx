"use client";

/* D-03 · Security settings — FRD 5.3
 *
 * Two rules from the FRD drive the whole screen: enabling TOTP has to prove the
 * authenticator works before the factor is armed, and disabling 2FA requires
 * full re-authentication (password + a current 2FA code). */

import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Check, Copy, KeyRound, Laptop, LogOut, MapPin, Monitor, QrCode, ShieldAlert, ShieldCheck,
  Smartphone, TriangleAlert, X,
} from "lucide-react";
import {
  Badge, Button, Callout, ConfirmDialog, DataTable, Field, Input, InfoHint, Modal, PasswordInput,
  SegmentedControl, Steps, Switch, useToast, type Column,
} from "@/components/ui";
import { Reveal } from "@/components/fx";
import { useCurrentUser } from "@/lib/hooks/use-data";
import { cn, copyToClipboard, formatDate } from "@/lib/utils";
import { WidgetCard, WidgetStat } from "../../../_components/widget-card";
import { RelativeTime } from "../../../_components/time";
import {
  loginHistory, sessions as seedSessions, TOTP_ACCOUNT, TOTP_ISSUER, TOTP_SECRET, TOTP_URI,
  type LoginEvent, type PlayerSession,
} from "./security-data";

type Method = "totp" | "sms";

/* ------------------------------ 2FA management ---------------------------- */

function TwoFactorPanel({
  enabled, method, onEnable, onDisable, onMethodChange,
}: {
  enabled: boolean;
  method: Method;
  onEnable: (method: Method) => void;
  onDisable: () => void;
  onMethodChange: (method: Method) => void;
}) {
  return (
    <WidgetCard
      title="Two-factor authentication"
      icon={<ShieldCheck />}
      tone={enabled ? "default" : "warning"}
      description="A second factor is required for withdrawals, address changes and commission release."
      footnote="Turning 2FA off requires your password and a current code from the factor you are removing — we will never disable it on a support request alone."
      action={
        enabled ? (
          <Badge tone="good" dot>Armed</Badge>
        ) : (
          <Badge tone="warning" dot>Not armed</Badge>
        )
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface-inset px-4 py-3">
          <Switch
            checked={enabled}
            onCheckedChange={(next) => (next ? onEnable(method) : onDisable())}
            label={enabled ? "Two-factor authentication is on" : "Two-factor authentication is off"}
            description={
              enabled
                ? method === "totp"
                  ? "Authenticator app (TOTP), 6-digit codes rotating every 30 seconds."
                  : "SMS codes to your verified mobile number."
                : "Withdrawals and destination-address changes are blocked while 2FA is off."
            }
          />
        </div>

        <Field
          label="Second-factor method"
          hint="An authenticator app is stronger than SMS: TOTP codes cannot be intercepted by SIM-swap or SS7 attacks."
        >
          <SegmentedControl<Method>
            value={method}
            onValueChange={(next) => {
              onMethodChange(next);
              if (enabled) onEnable(next);
            }}
            options={[
              { value: "totp", label: "Authenticator app (TOTP)", icon: <QrCode className="size-3.5" /> },
              { value: "sms", label: "SMS to my mobile", icon: <Smartphone className="size-3.5" /> },
            ]}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <WidgetStat
            label="Method"
            value={enabled ? (method === "totp" ? "TOTP app" : "SMS") : "None"}
            sub={enabled ? "active factor" : "no factor armed"}
            tone={enabled ? "good" : "warning"}
          />
          <WidgetStat label="Recovery codes" value="8 unused" sub="of 10 generated" />
          <WidgetStat label="Step-up required for" value="Withdrawals" sub="and address whitelisting" />
        </div>

        {!enabled && (
          <Callout tone="warning" title="Withdrawals are blocked while 2FA is off" icon={<TriangleAlert />}>
            <p className="mt-1">
              Your balances stay safe and you can keep playing, but MTT withdrawals, new destination
              addresses and referral commission release all need a second factor before they can be
              submitted.
            </p>
          </Callout>
        )}
      </div>
    </WidgetCard>
  );
}

/* ------------------------------ enable TOTP flow -------------------------- */

function EnableTotpModal({
  open, onClose, onConfirmed,
}: {
  open: boolean;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [step, setStep] = useState(0);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setStep(0);
    setCode("");
    setError(null);
    onClose();
  };

  const confirm = () => {
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code currently shown in your authenticator app.");
      return;
    }
    setError(null);
    onConfirmed();
    close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Set up your authenticator app"
      description="Three steps: scan, confirm a live code, store your recovery codes."
      icon={<QrCode className="size-5" />}
      size="lg"
      footer={
        step === 0 ? (
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button onClick={() => setStep(1)}>I have scanned the code</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>
            <Button onClick={confirm}>Confirm and arm 2FA</Button>
          </>
        )
      }
    >
      <div className="space-y-5">
        <Steps steps={["Scan", "Confirm code", "Armed"]} current={step} />

        {step === 0 ? (
          <div className="grid gap-5 sm:grid-cols-[minmax(0,13rem)_1fr]">
            <div className="rounded-xl border border-border-default bg-surface-3 p-3">
              <div className="grid place-items-center rounded-lg bg-white p-3">
                <QRCodeSVG value={TOTP_URI} size={160} level="M" marginSize={0} />
              </div>
              <p className="mt-2 text-center text-[11px] leading-relaxed text-text-muted">
                Scan with Google Authenticator, Authy, 1Password or any TOTP app.
              </p>
            </div>

            <div className="space-y-3">
              <Field
                label="Or enter this secret manually"
                hint="Use manual entry if your authenticator cannot scan. Type it exactly, including spacing."
              >
                <div className="flex items-center gap-2 rounded-xl border border-border-default bg-surface-inset px-3 py-2.5">
                  <code className="font-mono-num min-w-0 flex-1 break-all text-sm text-text-primary">
                    {TOTP_SECRET}
                  </code>
                  <Button
                    size="xs"
                    variant="ghost"
                    icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    onClick={async () => {
                      const ok = await copyToClipboard(TOTP_SECRET.replace(/\s/g, ""));
                      setCopied(ok);
                    }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </Field>

              <dl className="space-y-1.5 rounded-xl border border-border-subtle bg-surface-inset px-3 py-2.5 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">Issuer</dt>
                  <dd className="font-medium text-text-primary">{TOTP_ISSUER}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">Account</dt>
                  <dd className="font-medium text-text-primary">{TOTP_ACCOUNT}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">Algorithm</dt>
                  <dd className="tnum font-medium text-text-primary">SHA1 · 6 digits · 30s</dd>
                </div>
              </dl>

              <Callout tone="info" title="Never share this secret" icon={<ShieldAlert />}>
                <p className="mt-1">
                  Anyone holding it can generate your codes. Support will never ask you for it, and it
                  is shown only once during setup.
                </p>
              </Callout>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Input
              label="6-digit code from your app"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              error={error}
              hint="We verify the code against the shared secret before arming the factor — if this fails, 2FA stays off."
              className="max-w-xs"
            />
            <Callout tone="neutral" title="What happens next" icon={<KeyRound />}>
              <p className="mt-1">
                Once the code checks out we arm TOTP, invalidate every other session, and issue ten
                single-use recovery codes. Store them somewhere offline — they are the only way back in
                if you lose the authenticator.
              </p>
            </Callout>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ----------------------------- disable 2FA flow --------------------------- */

function DisableTwoFactorModal({
  open, method, onClose, onConfirmed,
}: {
  open: boolean;
  method: Method;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setPassword("");
    setCode("");
    setError(null);
    onClose();
  };

  const confirm = () => {
    if (password.length < 8) {
      setError("Enter your current account password.");
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError("Enter a current 6-digit code from the factor you are removing.");
      return;
    }
    onConfirmed();
    close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Re-authenticate to turn off 2FA"
      description="Required by policy: password plus a current code from the factor being removed."
      icon={<ShieldAlert className="size-5" />}
      footer={
        <>
          <Button variant="ghost" onClick={close}>Keep 2FA on</Button>
          <Button variant="danger" onClick={confirm}>Turn 2FA off</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Callout tone="critical" title="This weakens your account" icon={<TriangleAlert />}>
          <p className="mt-1">
            With 2FA off, withdrawals and destination-address changes are disabled until you arm a
            factor again, and a 24-hour cooling-off period applies when you do.
          </p>
        </Callout>

        <PasswordInput
          label="Account password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        <Input
          label={method === "totp" ? "Current authenticator code" : "Code sent to your mobile"}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          error={error}
          hint={
            method === "totp"
              ? "From the authenticator app currently armed on this account."
              : "We have sent a code to your verified mobile number."
          }
          className="max-w-xs"
        />
      </div>
    </Modal>
  );
}

/* ------------------------------ active sessions --------------------------- */

function SessionRow({
  session, onRevoke,
}: {
  session: PlayerSession;
  onRevoke: (session: PlayerSession) => void;
}) {
  const Icon = session.device.toLowerCase().includes("iphone") || session.device.toLowerCase().includes("android")
    ? Smartphone
    : session.device.toLowerCase().includes("macbook")
      ? Laptop
      : Monitor;

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3.5">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            "mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl",
            session.current ? "bg-accent-soft text-[var(--accent)]" : "bg-surface-3 text-text-secondary",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
            {session.device}
            {session.current && <Badge tone="brand" dot>This device</Badge>}
            {!session.trusted && <Badge tone="warning" icon={<TriangleAlert className="size-3" />}>Unrecognised</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            {session.browser} · <span className="font-mono-num">{session.ip}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-muted">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" /> {session.location}
            </span>
            <span aria-hidden>·</span>
            <span>
              active <RelativeTime date={session.lastActiveAt} />
            </span>
            <span aria-hidden>·</span>
            <span>signed in {formatDate(session.createdAt, true)}</span>
          </p>
        </div>
      </div>
      <Button
        size="xs"
        variant={session.current ? "ghost" : "outline"}
        disabled={session.current}
        icon={<X className="size-3.5" />}
        onClick={() => onRevoke(session)}
      >
        {session.current ? "Current session" : "Revoke"}
      </Button>
    </li>
  );
}

/* ------------------------------- login history ---------------------------- */

const OUTCOME_META: Record<LoginEvent["outcome"], { label: string; tone: string; icon: React.ReactNode }> = {
  success: { label: "Success", tone: "text-good-400", icon: <Check className="size-3.5" /> },
  failed: { label: "Failed", tone: "text-critical-400", icon: <X className="size-3.5" /> },
  blocked: { label: "Blocked", tone: "text-critical-400", icon: <ShieldAlert className="size-3.5" /> },
};

/* --------------------------------- the view ------------------------------- */

export function SecurityView() {
  const { data: user } = useCurrentUser();
  const toast = useToast();

  const [enabled, setEnabled] = useState(user.twoFactorEnabled);
  const [method, setMethod] = useState<Method>("totp");
  const [enrolling, setEnrolling] = useState(false);
  const [disabling, setDisabling] = useState(false);

  const [sessions, setSessions] = useState<PlayerSession[]>(seedSessions);
  const [revoking, setRevoking] = useState<PlayerSession | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  const failedRecently = useMemo(
    () => loginHistory.filter((e) => e.outcome !== "success").length,
    [],
  );
  const untrusted = sessions.filter((s) => !s.trusted).length;

  const startEnable = (next: Method) => {
    setMethod(next);
    if (next === "totp") {
      setEnrolling(true);
      return;
    }
    setEnabled(true);
    toast.success("SMS two-factor armed", "We will text a 6-digit code on every sign-in and withdrawal.");
  };

  const columns: Column<LoginEvent>[] = [
    {
      key: "at",
      header: "Timestamp",
      sortValue: (row) => Date.parse(row.at),
      cell: (row) => (
        <span className="tnum whitespace-nowrap text-text-primary">{formatDate(row.at, true)}</span>
      ),
    },
    {
      key: "outcome",
      header: "Result",
      sortValue: (row) => row.outcome,
      cell: (row) => {
        const meta = OUTCOME_META[row.outcome];
        return (
          <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", meta.tone)}>
            {meta.icon}
            {meta.label}
          </span>
        );
      },
    },
    {
      key: "ip",
      header: "IP address",
      hideBelow: "sm",
      cell: (row) => <span className="font-mono-num text-xs text-text-secondary">{row.ip}</span>,
    },
    {
      key: "device",
      header: "Device",
      hideBelow: "md",
      cell: (row) => <span className="text-text-secondary">{row.device}</span>,
    },
    {
      key: "location",
      header: "Location",
      hideBelow: "lg",
      cell: (row) => (
        <span className="inline-flex items-center gap-1 text-text-secondary">
          <MapPin className="size-3 text-text-muted" />
          {row.location}
        </span>
      ),
    },
    {
      key: "method",
      header: "Method",
      hideBelow: "xl",
      cell: (row) => <span className="text-xs text-text-muted">{row.method}</span>,
    },
    {
      key: "reason",
      header: "Detail",
      cell: (row) =>
        row.reason ? (
          <span className="text-xs text-critical-400">{row.reason}</span>
        ) : (
          <span className="text-xs text-text-muted">—</span>
        ),
    },
  ];

  const recommendations = [
    {
      ok: enabled && method === "totp",
      title: "Use an authenticator app instead of SMS",
      detail: "TOTP codes cannot be intercepted by SIM-swap. Switch method above to change this.",
    },
    { ok: true, title: "Recovery codes generated", detail: "8 of 10 single-use codes remain unused." },
    {
      ok: untrusted === 0,
      title: "No unrecognised sessions",
      detail:
        untrusted === 0
          ? "Every active session is on a device you have confirmed."
          : `${untrusted} session${untrusted > 1 ? "s" : ""} are on devices you have not confirmed — revoke anything you do not recognise.`,
    },
    {
      ok: !!user.walletAddress,
      title: "Withdrawal address whitelisted",
      detail: "New or changed destination addresses sit in a 24–48 hour cooling-off window before first use.",
    },
    {
      ok: failedRecently === 0,
      title: "No recent failed or blocked sign-ins",
      detail:
        failedRecently === 0
          ? "Nothing suspicious in your recent history."
          : `${failedRecently} failed or blocked attempts in your visible history. All were stopped before account access.`,
    },
  ];

  return (
    <div className="space-y-6">
      <Reveal>
        <TwoFactorPanel
          enabled={enabled}
          method={method}
          onEnable={startEnable}
          onDisable={() => setDisabling(true)}
          onMethodChange={setMethod}
        />
      </Reveal>

      <Reveal delay={0.05}>
        <WidgetCard
          title="Active sessions"
          icon={<Monitor />}
          description={`${sessions.length} device${sessions.length === 1 ? "" : "s"} currently signed in.`}
          footnote="Revoking a session ends it immediately and forces a fresh sign-in with your second factor. Logging out everywhere also rotates your session-signing key."
          action={
            <Button
              size="sm"
              variant="outline"
              icon={<LogOut className="size-4" />}
              onClick={() => setRevokingAll(true)}
            >
              Log out everywhere
            </Button>
          }
        >
          <ul className="divide-y divide-border-subtle">
            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} onRevoke={setRevoking} />
            ))}
          </ul>
          {untrusted > 0 && (
            <Callout className="mt-4" tone="warning" title="Unrecognised device signed in" icon={<TriangleAlert />}>
              <p className="mt-1">
                {untrusted} active session{untrusted > 1 ? "s are" : " is"} on a device we have not seen
                before. If that was not you, revoke it and change your password — we will end every
                other session automatically.
              </p>
            </Callout>
          )}
        </WidgetCard>
      </Reveal>

      <Reveal delay={0.1}>
        <WidgetCard
          title="Login history"
          icon={<KeyRound />}
          description="Every sign-in attempt on this account, successful or not."
          footnote="Failed and blocked attempts are shown deliberately: seeing them is how you spot credential stuffing early. Blocked attempts never reached your account."
          bodyClassName="px-0 py-0"
          action={
            failedRecently > 0 ? (
              <Badge tone="critical" icon={<ShieldAlert className="size-3" />}>
                {failedRecently} failed / blocked
              </Badge>
            ) : (
              <Badge tone="good" dot>All clear</Badge>
            )
          }
        >
          <DataTable
            columns={columns}
            rows={loginHistory}
            keyOf={(row) => row.id}
            pageSize={8}
            dense
            caption="Sign-in attempts with timestamp, result, IP address, device, location and method"
            empty={{ title: "No sign-in history", description: "Attempts appear here as soon as they happen." }}
          />
        </WidgetCard>
      </Reveal>

      <Reveal delay={0.15}>
        <WidgetCard
          title="Security recommendations"
          icon={<ShieldCheck />}
          description="What we would fix next on this account."
          footnote="These checks run against your live security state — nothing here is a marketing prompt or an upsell."
        >
          <ul className="space-y-2.5">
            {recommendations.map((item) => (
              <li
                key={item.title}
                className="flex items-start gap-3 rounded-xl border border-border-subtle bg-surface-inset px-3 py-2.5"
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
                    item.ok ? "bg-good-500/12 text-good-400" : "bg-warning-500/12 text-warning-400",
                  )}
                >
                  {item.ok ? <Check className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                    {item.title}
                    <Badge tone={item.ok ? "good" : "warning"}>{item.ok ? "Done" : "Action suggested"}</Badge>
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{item.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-text-muted">
            <InfoHint>
              Step-up authentication is enforced server-side. Even a fully compromised browser session
              cannot move funds without the second factor.
            </InfoHint>
            Withdrawals, address changes and commission release always re-challenge your second factor.
          </p>
        </WidgetCard>
      </Reveal>

      <EnableTotpModal
        open={enrolling}
        onClose={() => setEnrolling(false)}
        onConfirmed={() => {
          setEnabled(true);
          setMethod("totp");
          setSessions((current) => current.filter((s) => s.current));
          toast.success(
            "Authenticator armed",
            "TOTP is now your second factor. All other sessions were signed out and recovery codes reissued.",
          );
        }}
      />

      <DisableTwoFactorModal
        open={disabling}
        method={method}
        onClose={() => setDisabling(false)}
        onConfirmed={() => {
          setEnabled(false);
          toast.toast({
            tone: "warning",
            title: "Two-factor authentication disabled",
            description: "Withdrawals and address changes are now blocked until you arm a factor again.",
          });
        }}
      />

      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        onConfirm={() => {
          if (revoking) {
            setSessions((current) => current.filter((s) => s.id !== revoking.id));
            toast.success("Session revoked", `${revoking.device} has been signed out.`);
          }
          setRevoking(null);
        }}
        title="Revoke this session?"
        confirmLabel="Revoke session"
        tone="danger"
      >
        <p>
          {revoking?.device} in {revoking?.location} will be signed out immediately. Anyone using it
          will need your password and second factor to get back in.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={revokingAll}
        onClose={() => setRevokingAll(false)}
        onConfirm={() => {
          setSessions((current) => current.filter((s) => s.current));
          setRevokingAll(false);
          toast.success("Signed out everywhere", "Only this device remains signed in.");
        }}
        title="Log out of all other devices?"
        confirmLabel="Log out everywhere"
        tone="danger"
      >
        <p>
          Every session except this one ends immediately and your session-signing key is rotated, so
          any stolen token stops working.
        </p>
        <p className="text-text-muted">
          You will stay signed in here. Use this if you have lost a device or suspect your password has
          leaked.
        </p>
      </ConfirmDialog>
    </div>
  );
}
