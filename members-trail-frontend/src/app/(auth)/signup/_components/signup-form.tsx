"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle, BadgeCheck, Check, Gift, Globe, Loader2, ShieldAlert, X,
} from "lucide-react";
import {
  Badge, Button, Callout, Checkbox, Input, PasswordInput, Select, Steps, useToast,
} from "@/components/ui";
import { useRouter } from "next/navigation";
import { usePublicConfig } from "@/lib/hooks/use-data";
import { useRegister } from "@/lib/hooks/use-mutations";
import { humanMessage, isApiError } from "@/lib/api/errors";
import { OAuthRow } from "../../_components/auth-shell";

const COUNTRIES = [
  { value: "IN", label: "India" },
  { value: "AE", label: "United Arab Emirates" },
  { value: "SG", label: "Singapore" },
  { value: "GB", label: "United Kingdom" },
  { value: "BR", label: "Brazil" },
  { value: "NG", label: "Nigeria" },
  { value: "PH", label: "Philippines" },
  { value: "ID", label: "Indonesia" },
  { value: "MX", label: "Mexico" },
  { value: "PL", label: "Poland" },
  { value: "US", label: "United States" },
  { value: "KP", label: "Korea (DPRK)" },
];

/** Deliberately simple, illustrative breach-list check (FRD A-01). */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "12345678", "qwertyuiop", "letmein123", "iloveyou1", "welcome123",
]);

interface Errors {
  fullName?: string;
  email?: string;
  phone?: string;
  password?: string;
  dob?: string;
  country?: string;
  terms?: string;
  referral?: string;
}

function passwordChecks(pw: string) {
  return [
    { label: "At least 10 characters", ok: pw.length >= 10 },
    { label: "Upper and lower case", ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
    { label: "A number", ok: /\d/.test(pw) },
    { label: "A symbol", ok: /[^A-Za-z0-9]/.test(pw) },
    { label: "Not a commonly breached password", ok: pw.length > 0 && !COMMON_PASSWORDS.has(pw.toLowerCase()) },
  ];
}

function ageFrom(dob: string) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date("2026-08-20T00:00:00Z");
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

export function SignUpForm() {
  const toast = useToast();
  const params = useSearchParams();
  const router = useRouter();
  const { data: policy } = usePublicConfig();
  const register = useRegister();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [refState, setRefState] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [form, setForm] = useState({
    fullName: "", email: "", phone: "", password: "", dob: "", country: "",
    referral: "", terms: false,
  });

  /* Referral code auto-fills from ?ref= when the user arrives via a referral link. */
  useEffect(() => {
    const ref = params.get("ref");
    if (ref) setForm((f) => ({ ...f, referral: ref.toUpperCase() }));
  }, [params]);

  /* Validate the code against "active codes" — mocked, but debounced like the real thing. */
  useEffect(() => {
    const code = form.referral.trim();
    if (!code) { setRefState("idle"); return; }
    setRefState("checking");
    const t = setTimeout(() => {
      setRefState(/^MTT-[A-Z0-9]{6}$/.test(code) ? "valid" : "invalid");
    }, 500);
    return () => clearTimeout(t);
  }, [form.referral]);

  const checks = useMemo(() => passwordChecks(form.password), [form.password]);
  const pwScore = checks.filter((c) => c.ok).length;
  const age = ageFrom(form.dob);
  /* The blocklist and the age floor come from the server (FRD A-01). They were
   * constants here, which meant this form could accept a registration the API
   * refuses — the two lists had already drifted: SG, RU, BY, VE, MM and AF are
   * blocked server-side and were not in the copy that lived in this file. */
  const restricted = policy.restrictedJurisdictions.includes(form.country);
  const minAge = policy.jurisdictionMinimumAge[form.country] ?? policy.globalMinimumAge;

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const validate = () => {
    const e: Errors = {};
    if (form.fullName.trim().length < 3) e.fullName = "Enter your full legal name — it must match your ID at KYC.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email)) e.email = "Enter a valid email address.";
    if (!/^\+?[\d\s()-]{8,}$/.test(form.phone)) e.phone = "Enter a valid phone number including country code.";
    if (checks.some((c) => !c.ok)) e.password = "Password does not meet all requirements.";
    if (age == null) e.dob = "Enter your date of birth.";
    else if (age < minAge) {
      e.dob =
        minAge === policy.globalMinimumAge
          ? `You must be at least ${minAge} to use Members Trail.`
          : `The minimum age in your jurisdiction is ${minAge}.`;
    }
    if (!form.country) e.country = "Select your country of residence.";
    else if (restricted) e.country = "Members Trail is not available in this jurisdiction.";
    if (refState === "invalid") e.referral = "That referral code isn't recognised. Clear it or correct it.";
    if (!form.terms) e.terms = "You must accept the Terms, Privacy Policy and Risk Disclosure.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) {
      toast.error("Check the highlighted fields", "Some details are missing or not accepted.");
      return;
    }
    setBusy(true);
    try {
      await register.mutateAsync({
        email: form.email.trim().toLowerCase(),
        password: form.password,
        phone: form.phone.trim(),
        fullName: form.fullName.trim(),
        country: form.country,
        dateOfBirth: form.dob,
        termsAccepted: form.terms,
        ...(form.referral.trim() ? { referralCode: form.referral.trim().toUpperCase() } : {}),
      });
      toast.success("Account created", "We've sent codes to your email and phone.");
      /* The email is carried forward so the verify screen knows which address to
       * resend to without asking for it again. */
      router.push(`/verify?email=${encodeURIComponent(form.email.trim().toLowerCase())}`);
    } catch (err) {
      /* Field-level problems are attached to the field the server names, so the
       * member sees the message next to the input rather than in a banner far
       * from the cause. */
      if (isApiError(err)) {
        const problems = err.fieldProblems;
        if (err.code === "PASSWORD_REJECTED") {
          setErrors((prev) => ({
            ...prev,
            password: problems.length > 0 ? problems.join(" ") : humanMessage(err),
          }));
        } else if (err.code === "EMAIL_IN_USE") {
          setErrors((prev) => ({ ...prev, email: "That email is already registered." }));
        } else if (err.code === "PHONE_IN_USE") {
          setErrors((prev) => ({ ...prev, phone: "That phone number is already registered." }));
        } else if (err.code === "JURISDICTION_RESTRICTED") {
          setErrors((prev) => ({
            ...prev,
            country: "Members Trail is not available in this jurisdiction.",
          }));
        } else {
          toast.error("Couldn't create your account", humanMessage(err));
        }
      } else {
        toast.error("Couldn't create your account", humanMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Steps steps={["Details", "Verify", "KYC", "Wallet"]} current={0} className="mb-8" />

      {form.referral && refState === "valid" && (
        <Callout tone="brand" title="Referral code applied" icon={<Gift />} className="mb-5">
          <p className="mt-1">
            You&apos;re joining via <span className="font-mono-num">{form.referral}</span>. This only
            records the referral relationship — it never charges you a fee and gives you no
            obligation. Your earning potential is identical either way.
          </p>
        </Callout>
      )}

      <OAuthRow mode="signup" />

      <form onSubmit={submit} noValidate className="space-y-4">
        <Input
          label="Full legal name"
          required
          autoComplete="name"
          placeholder="As printed on your government ID"
          value={form.fullName}
          onChange={(e) => set("fullName", e.target.value)}
          error={errors.fullName}
          hint="This must match your ID when you complete KYC."
        />

        <Input
          label="Email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          error={errors.email}
        />

        <Input
          label="Phone number"
          type="tel"
          required
          autoComplete="tel"
          placeholder="+91 98765 43210"
          value={form.phone}
          onChange={(e) => set("phone", e.target.value)}
          error={errors.phone}
          hint="Verified by OTP and used for two-factor authentication."
        />

        <div>
          <PasswordInput
            label="Password"
            required
            autoComplete="new-password"
            placeholder="At least 10 characters"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
            error={errors.password}
          />
          {form.password.length > 0 && (
            <div className="mt-2.5 space-y-2">
              <div className="flex gap-1" aria-hidden>
                {Array.from({ length: 5 }).map((_, i) => (
                  <span
                    key={i}
                    className={
                      i < pwScore
                        ? pwScore <= 2
                          ? "h-1 flex-1 rounded-full bg-critical-500"
                          : pwScore <= 4
                            ? "h-1 flex-1 rounded-full bg-warning-500"
                            : "h-1 flex-1 rounded-full bg-good-500"
                        : "h-1 flex-1 rounded-full bg-surface-3"
                    }
                  />
                ))}
              </div>
              <ul className="grid gap-1 sm:grid-cols-2">
                {checks.map((c) => (
                  <li
                    key={c.label}
                    className={c.ok ? "flex items-center gap-1.5 text-xs text-good-400" : "flex items-center gap-1.5 text-xs text-text-muted"}
                  >
                    {c.ok ? <Check className="size-3 shrink-0" /> : <X className="size-3 shrink-0" />}
                    {c.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Date of birth"
            type="date"
            required
            value={form.dob}
            onChange={(e) => set("dob", e.target.value)}
            error={errors.dob}
            hint={age != null && age >= 18 ? `Age ${age} — eligible` : "18+ only"}
          />
          <Select
            label="Country of residence"
            required
            placeholder="Select…"
            options={COUNTRIES}
            value={form.country}
            onChange={(e) => set("country", e.target.value)}
            error={errors.country}
          />
        </div>

        {restricted && (
          <Callout tone="critical" title="Not available in your jurisdiction" icon={<Globe />}>
            <p className="mt-1">
              We can&apos;t accept registrations from this country. Your declared country is
              cross-checked against your IP address at this step, and the restricted list is
              maintained by our legal team. If you believe this is wrong, contact support.
            </p>
          </Callout>
        )}

        <div>
          <Input
            label="Referral code"
            placeholder="MTT-XXXXXX"
            value={form.referral}
            onChange={(e) => set("referral", e.target.value.toUpperCase())}
            error={errors.referral}
            hint="Optional. Joining with a code costs nothing and changes nothing about what you can earn."
            suffix={
              refState === "checking" ? (
                <Loader2 className="size-3.5 animate-spin text-text-muted" />
              ) : refState === "valid" ? (
                <span className="inline-flex items-center gap-1 text-good-400">
                  <BadgeCheck className="size-3.5" /> Valid
                </span>
              ) : refState === "invalid" ? (
                <span className="inline-flex items-center gap-1 text-critical-400">
                  <X className="size-3.5" /> Unknown
                </span>
              ) : undefined
            }
          />
        </div>

        <div className="rounded-xl border border-border-subtle bg-surface-inset p-4">
          <Checkbox
            checked={form.terms}
            onCheckedChange={(v) => set("terms", v)}
            label={
              <>
                I&apos;m 18 or older and I accept the{" "}
                <Link href="/legal/terms" target="_blank" className="text-[var(--accent-hover)] underline underline-offset-2">Terms &amp; Conditions</Link>,{" "}
                <Link href="/legal/privacy" target="_blank" className="text-[var(--accent-hover)] underline underline-offset-2">Privacy Policy</Link>{" "}
                and{" "}
                <Link href="/legal/risk-disclosure" target="_blank" className="text-[var(--accent-hover)] underline underline-offset-2">Risk Disclosure</Link>.
              </>
            }
          />
          {errors.terms && <p className="mt-2 text-xs font-medium text-critical-400">{errors.terms}</p>}
        </div>

        <Button type="submit" fullWidth size="lg" loading={busy} disabled={restricted}>
          Create free account
        </Button>

        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <Badge tone="good" dot>No joining fee</Badge>
          <Badge tone="good" dot>No deposit required</Badge>
          <Badge tone="neutral">Referral optional</Badge>
        </div>
      </form>
    </div>
  );
}
