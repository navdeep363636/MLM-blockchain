"use client";

import { useState } from "react";
import { CheckCircle2, Paperclip, Send, ShieldAlert } from "lucide-react";
import { Button, Callout, Input, Select, Textarea, useToast } from "@/components/ui";
import { useAuth } from "@/lib/auth/auth-context";
import { useCreateTicket } from "@/lib/hooks/use-mutations";
import { humanMessage } from "@/lib/api/errors";
import { SUPPORT_EMAIL } from "@/lib/support";

const CATEGORIES = [
  { value: "account", label: "Account & login" },
  { value: "kyc", label: "KYC / verification" },
  { value: "withdrawal", label: "Withdrawal — financial dispute" },
  { value: "commission", label: "Referral commission — financial dispute" },
  { value: "gameplay", label: "Gameplay / Points" },
  { value: "technical", label: "Technical problem" },
  { value: "partnership", label: "Partnership or press" },
  { value: "other", label: "Something else" },
];

const FINANCIAL = new Set(["withdrawal", "commission"]);

interface Errors {
  name?: string;
  email?: string;
  category?: string;
  subject?: string;
  message?: string;
}

export function ContactForm() {
  const toast = useToast();
  /* A ticket belongs to an account: it has an SLA, an assignee, an audit trail
   * and a member to reply to. There is no unauthenticated ticket endpoint, and
   * inventing one would be a spam intake with no identity behind it.
   *
   * So this form does one of two honest things. Signed in, it opens a real
   * ticket. Signed out, it says plainly that it cannot, and gives the address
   * that reaches a person. What it does NOT do — what it used to do — is show
   * "we've opened a ticket and emailed you the reference" when nothing was
   * created and no email was sent. */
  const { phase } = useAuth();
  const createTicket = useCreateTicket();
  const canOpenTicket = phase === "authenticated";
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [form, setForm] = useState({
    name: "", email: "", category: "", subject: "", message: "", attachment: "",
  });

  const set = <K extends keyof typeof form>(k: K, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const validate = () => {
    const e: Errors = {};
    if (form.name.trim().length < 2) e.name = "Please enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email)) e.email = "Enter a valid email address.";
    if (!form.category) e.category = "Pick the closest category so we route this correctly.";
    if (form.subject.trim().length < 4) e.subject = "Give the subject a few more words.";
    if (form.message.trim().length < 20) e.message = "Please describe the issue in at least 20 characters.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!canOpenTicket) return;
    if (!validate()) {
      toast.error("Check the highlighted fields", "A few details are missing or invalid.");
      return;
    }
    setBusy(true);
    try {
      const ticket = await createTicket.mutateAsync({
        subject: form.subject.trim(),
        category: form.category === "partnership" ? "other" : form.category,
        body: [
          form.message.trim(),
          "",
          `— submitted via the contact form as ${form.name.trim()} <${form.email.trim()}>`,
        ].join("\n"),
        /* No `financialDispute`: the server classifies the ticket from its
         * category and refuses the field. `FINANCIAL` is still used below to set
         * the member's expectation about routing. */
      });
      setSent(true);
      toast.success("Ticket opened", `Reference ${ticket.ref}. You can follow it in Support.`);
    } catch (err) {
      toast.error("Couldn't open a ticket", humanMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-[var(--radius-panel)] border border-good-500/30 bg-surface-1 p-8 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-good-500/12 text-good-400">
          <CheckCircle2 className="size-7" />
        </span>
        <h3 className="mt-4 font-display text-lg font-semibold text-text-primary">Ticket opened</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-muted">
          We&apos;ve emailed a reference to <span className="text-text-secondary">{form.email}</span>.
          {FINANCIAL.has(form.category)
            ? " Because this is a financial dispute it has been routed straight to a compliance-trained agent with SLA tracking."
            : " Account questions are usually answered within one business day."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button variant="outline" onClick={() => { setSent(false); setForm({ name: "", email: "", category: "", subject: "", message: "", attachment: "" }); }}>
            Send another message
          </Button>
          <Button href="/faq">Browse the FAQ</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface-1 p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Your name"
          required
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          error={errors.name}
          placeholder="Navdeep Singh"
          autoComplete="name"
        />
        <Input
          label="Email"
          type="email"
          required
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          error={errors.email}
          hint="We reply to this address only."
          placeholder="you@example.com"
          autoComplete="email"
        />
      </div>

      <div className="mt-4">
        <Select
          label="Category"
          required
          options={CATEGORIES}
          placeholder="Choose the closest match…"
          value={form.category}
          onChange={(e) => set("category", e.target.value)}
          error={errors.category}
        />
      </div>

      {FINANCIAL.has(form.category) && (
        <Callout tone="serious" title="This will be treated as a financial dispute" icon={<ShieldAlert />} className="mt-4">
          <p className="mt-1">
            Withdrawal and commission tickets are auto-routed to compliance-trained agents with SLA
            tracking rather than general support. Include the transaction or commission reference if
            you have it — it speeds things up considerably.
          </p>
        </Callout>
      )}

      <div className="mt-4">
        <Input
          label="Subject"
          required
          value={form.subject}
          onChange={(e) => set("subject", e.target.value)}
          error={errors.subject}
          placeholder="Short summary of the issue"
        />
      </div>

      <div className="mt-4">
        <Textarea
          label="Message"
          required
          rows={6}
          value={form.message}
          onChange={(e) => set("message", e.target.value)}
          error={errors.message}
          hint="Include references (TX-…, CM-…), timestamps, and what you expected to happen."
          placeholder="Describe what happened…"
        />
      </div>

      <div className="mt-4">
        <Input
          label="Attachment reference (optional)"
          icon={<Paperclip />}
          value={form.attachment}
          onChange={(e) => set("attachment", e.target.value)}
          hint="Screenshots and documents can be attached from inside your account, under Support."
          placeholder="e.g. screenshot of the pending withdrawal"
        />
      </div>

      <p className="mt-5 text-xs leading-relaxed text-text-muted">
        By sending this you agree we may process the details to handle your request, as described in
        the Privacy Policy. Never include your password, seed phrase or private key — support will
        never ask for them, and anyone who does is attempting fraud.
      </p>

      {canOpenTicket ? (
        <Button type="submit" loading={busy} fullWidth className="mt-5" icon={<Send className="size-4" />}>
          Send message
        </Button>
      ) : (
        <Callout tone="info" title="Sign in to open a support ticket" className="mt-5">
          <p className="mt-1">
            A ticket is attached to your account so it has an owner, a response deadline and a
            history you can read back. Signing in takes a moment and means you can follow the reply
            in the app rather than in an inbox.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button href="/login" size="sm">Sign in</Button>
            <Button href={`mailto:${SUPPORT_EMAIL}`} size="sm" variant="outline">
              Email {SUPPORT_EMAIL}
            </Button>
          </div>
        </Callout>
      )}
    </form>
  );
}
