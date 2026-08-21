"use client";

/* D-02 · Profile & settings — FRD 5.3
 *
 * Contact-detail changes are treated as security events: the new address or
 * number has to be re-verified before it replaces the old one, and country is
 * deliberately not self-service because it drives the jurisdiction rules. */

import { useMemo, useRef, useState } from "react";
import {
  AtSign, BadgeCheck, Bell, Download, Globe, Image as ImageIcon, Info, Link2, Lock, Mail,
  MessageSquare, Phone, Save, ShieldAlert, Smartphone, Trash2, Unlink, User as UserIcon,
} from "lucide-react";
import {
  Badge, Button, Callout, Checkbox, ConfirmDialog, Field, Input, KycBadge, Select,
  Switch, useToast,
} from "@/components/ui";
import { Avatar } from "@/components/ui";
import { Reveal } from "@/components/fx";
import { useCurrentUser, useNotifications } from "@/lib/hooks/use-data";
import { csvDownload, formatDate } from "@/lib/utils";
import { WidgetCard } from "../../_components/widget-card";

/* ------------------------------ notifications ----------------------------- */

type Channel = "email" | "sms" | "push";

const CHANNELS: { id: Channel; label: string; icon: React.ReactNode }[] = [
  { id: "email", label: "Email", icon: <Mail className="size-3.5" /> },
  { id: "sms", label: "SMS", icon: <MessageSquare className="size-3.5" /> },
  { id: "push", label: "Push", icon: <Smartphone className="size-3.5" /> },
];

interface EventRow {
  id: string;
  label: string;
  description: string;
  /** Compliance-critical categories cannot be silenced on every channel. */
  mandatoryChannel?: Channel;
  defaults: Record<Channel, boolean>;
}

const EVENTS: EventRow[] = [
  {
    id: "transactions",
    label: "Transactions",
    description: "Deposits, withdrawals, conversions, stakes and unstakes.",
    mandatoryChannel: "email",
    defaults: { email: true, sms: true, push: true },
  },
  {
    id: "security",
    label: "Security",
    description: "New device sign-ins, 2FA changes, password resets.",
    mandatoryChannel: "email",
    defaults: { email: true, sms: true, push: true },
  },
  {
    id: "kyc",
    label: "KYC & compliance",
    description: "Verification outcomes, document requests, limit changes.",
    mandatoryChannel: "email",
    defaults: { email: true, sms: false, push: true },
  },
  {
    id: "rewards",
    label: "Staking rewards",
    description: "Accrual milestones and claimable reward notices.",
    defaults: { email: true, sms: false, push: true },
  },
  {
    id: "commissions",
    label: "Referral commission",
    description: "Commission accrued, released, or held by a cap.",
    defaults: { email: true, sms: false, push: false },
  },
  {
    id: "tournaments",
    label: "Tournaments",
    description: "Registration confirmations, round pairings, results.",
    defaults: { email: false, sms: false, push: true },
  },
  {
    id: "promos",
    label: "Promotions",
    description: "Optional offers and events. Never required to earn.",
    defaults: { email: false, sms: false, push: false },
  },
];

const LANGUAGES = [
  { value: "en-IN", label: "English (India)" },
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "hi-IN", label: "हिन्दी (Hindi)" },
  { value: "pa-IN", label: "ਪੰਜਾਬੀ (Punjabi)" },
  { value: "es-ES", label: "Español" },
  { value: "pt-BR", label: "Português (Brasil)" },
];

const TIMEZONES = [
  { value: "Asia/Kolkata", label: "Asia/Kolkata · UTC+05:30" },
  { value: "Asia/Dubai", label: "Asia/Dubai · UTC+04:00" },
  { value: "Europe/London", label: "Europe/London · UTC+01:00" },
  { value: "Europe/Lisbon", label: "Europe/Lisbon · UTC+01:00" },
  { value: "America/New_York", label: "America/New_York · UTC−04:00" },
  { value: "UTC", label: "UTC · no offset" },
];

const COUNTRY_NAMES: Record<string, string> = {
  IN: "India", GB: "United Kingdom", AE: "United Arab Emirates",
  SG: "Singapore", BR: "Brazil", PT: "Portugal",
};

interface LinkedAccount {
  id: string;
  provider: string;
  handle: string;
  icon: React.ReactNode;
  linkedAt?: string;
}

const LINKED: LinkedAccount[] = [
  { id: "google", provider: "Google", handle: "navdeep@gmail.com", icon: <AtSign />, linkedAt: "2026-01-18T08:12:00Z" },
  { id: "apple", provider: "Apple", handle: "hidden relay address", icon: <Lock />, linkedAt: "2026-03-02T15:40:00Z" },
  { id: "discord", provider: "Discord", handle: "arcvector#4417", icon: <MessageSquare />, linkedAt: "2026-05-27T11:05:00Z" },
  { id: "telegram", provider: "Telegram", handle: "not connected", icon: <Link2 /> },
];

/* ------------------------------- the sections ----------------------------- */

export function ProfileSettings() {
  const { data: user } = useCurrentUser();
  const { data: notifications } = useNotifications();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone);
  const [avatarName, setAvatarName] = useState<string | null>(null);
  const [language, setLanguage] = useState("en-IN");
  const [timezone, setTimezone] = useState("Asia/Kolkata");

  const [prefs, setPrefs] = useState<Record<string, Record<Channel, boolean>>>(
    () => Object.fromEntries(EVENTS.map((e) => [e.id, { ...e.defaults }])),
  );

  const [linked, setLinked] = useState<string[]>(["google", "apple", "discord"]);
  const [unlinking, setUnlinking] = useState<LinkedAccount | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteAck, setDeleteAck] = useState(false);

  const emailChanged = email.trim().toLowerCase() !== user.email.toLowerCase();
  const phoneChanged = phone.trim() !== user.phone;
  const profileDirty = displayName !== user.displayName || emailChanged || phoneChanged || !!avatarName;

  const promoOff = useMemo(
    () => CHANNELS.every((c) => !prefs.promos[c.id]),
    [prefs],
  );

  const setPref = (event: string, channel: Channel, value: boolean) =>
    setPrefs((p) => ({ ...p, [event]: { ...p[event], [channel]: value } }));

  const saveProfile = () => {
    if (emailChanged || phoneChanged) {
      toast.toast({
        tone: "warning",
        title: "Verification sent to your new contact details",
        description:
          "Your current email and phone stay active until the new one is verified. Nothing is changed on the account until then.",
      });
    } else {
      toast.success("Profile updated", "Display name and preferences saved.");
    }
  };

  const exportData = () => {
    csvDownload(`members-trail-profile-${user.id}.csv`, [
      { field: "User ID", value: user.id },
      { field: "Display name", value: displayName },
      { field: "Full name", value: user.fullName },
      { field: "Email", value: email },
      { field: "Phone", value: phone },
      { field: "Country", value: COUNTRY_NAMES[user.country] ?? user.country },
      { field: "Date of birth", value: user.dateOfBirth },
      { field: "Account status", value: user.status },
      { field: "KYC tier", value: user.kycTier },
      { field: "Two-factor enabled", value: user.twoFactorEnabled ? "yes" : "no" },
      { field: "Wallet address", value: user.walletAddress ?? "none" },
      { field: "Referral code", value: user.referralCode },
      { field: "Joined", value: formatDate(user.joinedAt, true) },
      { field: "Language", value: language },
      { field: "Timezone", value: timezone },
      { field: "Linked accounts", value: linked.join(" | ") },
      ...EVENTS.flatMap((e) =>
        CHANNELS.map((c) => ({
          field: `Notification · ${e.label} · ${c.label}`,
          value: prefs[e.id][c.id] ? "on" : "off",
        })),
      ),
      ...notifications.map((n) => ({
        field: `Notification log · ${n.kind}`,
        value: `${formatDate(n.createdAt, true)} — ${n.title}`,
      })),
    ]);
    setExporting(false);
    toast.success("Export ready", "Your profile, preferences and notification log have been downloaded as CSV.");
  };

  return (
    <div className="space-y-6">
      {/* ------------------------------ identity ----------------------------- */}
      <Reveal>
        <WidgetCard
          title="Profile"
          icon={<UserIcon />}
          description="How you appear on leaderboards and in tournaments."
          action={
            <Button size="sm" onClick={saveProfile} disabled={!profileDirty} icon={<Save className="size-4" />}>
              Save changes
            </Button>
          }
          footnote="Your legal name and date of birth come from KYC and can only be corrected through Support with documentary evidence."
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,16rem)_1fr]">
            <div className="flex flex-col items-start gap-3">
              <Avatar name={displayName} src={user.avatarUrl} size="xl" ring />
              <div>
                <label
                  htmlFor="avatar-upload"
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-surface-3 px-3.5 text-sm font-medium text-text-primary ring-1 ring-border-default transition-colors hover:ring-border-strong focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)]"
                >
                  <ImageIcon className="size-3.5" />
                  Choose new avatar
                </label>
                <input
                  ref={fileRef}
                  id="avatar-upload"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(e) => setAvatarName(e.target.files?.[0]?.name ?? null)}
                />
                <p className="mt-2 max-w-56 text-xs leading-relaxed text-text-muted">
                  {avatarName
                    ? `“${avatarName}” selected — it is queued for automated moderation and goes live once it passes.`
                    : "PNG, JPG or WebP up to 2 MB. Avatars pass automated moderation before they appear publicly."}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <Input
                label="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                hint="Shown on leaderboards. Your legal name is never displayed publicly."
                icon={<UserIcon className="size-4" />}
                maxLength={24}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Email address"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  icon={<Mail className="size-4" />}
                  hint="Used for security and compliance notices."
                />
                <Input
                  label="Mobile number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  icon={<Phone className="size-4" />}
                  hint="Used for SMS 2FA and withdrawal confirmations."
                />
              </div>

              {(emailChanged || phoneChanged) && (
                <Callout tone="warning" title="This change needs re-verification" icon={<ShieldAlert />}>
                  <p className="mt-1">
                    {emailChanged && phoneChanged
                      ? "Both your email address and mobile number have changed."
                      : emailChanged
                        ? "Your email address has changed."
                        : "Your mobile number has changed."}{" "}
                    We will send a verification code to the new contact method. Your existing details
                    stay in force until that code is confirmed, and withdrawals are held for 24 hours
                    after any contact-detail change as an anti-fraud measure.
                  </p>
                </Callout>
              )}

              <Field
                label="Country of residence"
                hint="Read-only. Your country determines which jurisdiction rules, tax reporting and payment methods apply to your account."
              >
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-default bg-surface-inset px-3 py-2.5">
                  <Globe className="size-4 text-text-muted" />
                  <span className="text-sm font-medium text-text-primary">
                    {COUNTRY_NAMES[user.country] ?? user.country}
                  </span>
                  <Badge tone="neutral" icon={<Lock className="size-3" />}>Locked</Badge>
                  <span className="ml-auto text-xs text-text-muted">
                    Contact Support with proof of address to change this.
                  </span>
                </div>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label="Language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  options={LANGUAGES}
                  hint="Applies to the interface and to email notices."
                />
                <Select
                  label="Timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  options={TIMEZONES}
                  hint="Daily caps and quests still reset at 00:00 UTC regardless of this setting."
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-subtle bg-surface-inset px-3 py-2.5 text-xs text-text-muted">
                <KycBadge tier={user.kycTier} />
                <span>
                  Verified as {user.fullName} · member since {formatDate(user.joinedAt)}
                </span>
                <Button href="/app/settings/security" size="xs" variant="ghost" className="ml-auto">
                  Security settings
                </Button>
              </div>
            </div>
          </div>
        </WidgetCard>
      </Reveal>

      {/* --------------------------- notifications --------------------------- */}
      <Reveal delay={0.05}>
        <WidgetCard
          title="Notification preferences"
          icon={<Bell />}
          description="One switch per channel, per event type."
          footnote="Security, transaction and KYC notices always keep at least their email channel on — those are regulatory notices, not marketing. Everything else is genuinely optional."
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => toast.success("Preferences saved", "Channel choices applied to every future notice.")}
            >
              Save preferences
            </Button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-2xl border-collapse text-sm">
              <caption className="sr-only">
                Notification channel preferences by event type
              </caption>
              <thead>
                <tr className="border-b border-border-default">
                  <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Event type
                  </th>
                  {CHANNELS.map((c) => (
                    <th
                      key={c.id}
                      scope="col"
                      className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider text-text-muted"
                    >
                      <span className="inline-flex items-center gap-1.5">{c.icon}{c.label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {EVENTS.map((event) => (
                  <tr key={event.id} className="border-b border-border-subtle last:border-0">
                    <th scope="row" className="max-w-sm px-3 py-3 text-left align-top">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                        {event.label}
                        {event.mandatoryChannel && (
                          <Badge tone="info" icon={<Info className="size-3" />}>
                            {event.mandatoryChannel} required
                          </Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">
                        {event.description}
                      </span>
                    </th>
                    {CHANNELS.map((channel) => {
                      const locked = event.mandatoryChannel === channel.id;
                      return (
                        <td key={channel.id} className="px-3 py-3 text-center align-middle">
                          <span className="inline-flex flex-col items-center gap-1">
                            <Switch
                              checked={locked ? true : prefs[event.id][channel.id]}
                              onCheckedChange={(v) => setPref(event.id, channel.id, v)}
                              disabled={locked}
                            />
                            <span className="sr-only">
                              {event.label} via {channel.label}
                            </span>
                            {locked && <span className="text-[10px] text-text-muted">required</span>}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {promoOff && (
            <p className="mt-3 text-xs text-text-muted">
              Promotional messages are fully off. You will still receive the notices above, and turning
              promotions off never reduces your earning rate or your caps.
            </p>
          )}
        </WidgetCard>
      </Reveal>

      {/* -------------------------- linked accounts -------------------------- */}
      <Reveal delay={0.1}>
        <WidgetCard
          title="Linked accounts"
          icon={<Link2 />}
          description="Social sign-in providers attached to this account."
          footnote="You must keep at least one sign-in method: if you unlink your last provider, set a password first. Unlinking never deletes your account or your balances."
        >
          <ul className="divide-y divide-border-subtle">
            {LINKED.map((account) => {
              const isLinked = linked.includes(account.id);
              return (
                <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-3 text-text-secondary [&>svg]:size-4">
                      {account.icon}
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                        {account.provider}
                        {isLinked ? (
                          <Badge tone="good" icon={<BadgeCheck className="size-3" />}>Linked</Badge>
                        ) : (
                          <Badge tone="neutral">Not linked</Badge>
                        )}
                      </p>
                      <p className="truncate text-xs text-text-muted">
                        {isLinked
                          ? `${account.handle}${account.linkedAt ? ` · linked ${formatDate(account.linkedAt)}` : ""}`
                          : "Link to enable one-tap sign-in on this provider."}
                      </p>
                    </div>
                  </div>
                  {isLinked ? (
                    <Button
                      size="xs"
                      variant="outline"
                      icon={<Unlink className="size-3.5" />}
                      onClick={() => setUnlinking(account)}
                    >
                      Unlink
                    </Button>
                  ) : (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        toast.info(
                          `${account.provider} sign-in`,
                          "You will be redirected to the provider to authorise the link.",
                        )
                      }
                    >
                      Link account
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </WidgetCard>
      </Reveal>

      {/* ----------------------------- danger zone --------------------------- */}
      <Reveal delay={0.15}>
        <WidgetCard
          title="Your data"
          icon={<ShieldAlert />}
          tone="critical"
          description="Export everything we hold, or close the account."
          footnote="Deletion requests are subject to statutory AML record-retention: transaction and KYC records are retained for the legally required period even after your profile is removed."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border-subtle bg-surface-inset p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <Download className="size-4 text-text-muted" /> Export my data
              </p>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">
                Downloads your profile, preferences, linked providers and notification log as a CSV
                file, immediately and without a support request.
              </p>
              <Button className="mt-3" size="sm" variant="outline" onClick={() => setExporting(true)}>
                Export as CSV
              </Button>
            </div>

            <div className="rounded-xl border border-critical-500/40 bg-surface-inset p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <Trash2 className="size-4 text-critical-400" /> Request account deletion
              </p>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">
                Closes the account after any open balance is withdrawn or forfeited. Irreversible, and
                blocked while a withdrawal or dispute is open.
              </p>
              <Button className="mt-3" size="sm" variant="danger" onClick={() => setDeleting(true)}>
                Request deletion
              </Button>
            </div>
          </div>
        </WidgetCard>
      </Reveal>

      {/* ------------------------------- dialogs ----------------------------- */}
      <ConfirmDialog
        open={!!unlinking}
        onClose={() => setUnlinking(null)}
        onConfirm={() => {
          if (unlinking) {
            setLinked((l) => l.filter((id) => id !== unlinking.id));
            toast.success(`${unlinking.provider} unlinked`, "You can re-link it at any time from this page.");
          }
          setUnlinking(null);
        }}
        title={`Unlink ${unlinking?.provider ?? "provider"}?`}
        confirmLabel="Unlink"
        tone="danger"
      >
        <p>
          You will no longer be able to sign in with {unlinking?.provider}. Your balances, Points and
          staking positions are untouched, and you can re-link the provider later.
        </p>
        <p className="text-text-muted">
          Make sure you still have a password or another linked provider before continuing.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={exporting}
        onClose={() => setExporting(false)}
        onConfirm={exportData}
        title="Export your data"
        confirmLabel="Download CSV"
      >
        <p>
          The export contains your profile fields, notification preferences, linked providers and
          notification history. Financial ledgers export separately from the wallet and Points history
          pages so each file stays auditable on its own.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={deleting}
        onClose={() => {
          setDeleting(false);
          setDeleteAck(false);
        }}
        onConfirm={() => {
          if (!deleteAck) {
            toast.error("Acknowledgement required", "Tick the box to confirm you understand the consequences.");
            return;
          }
          setDeleting(false);
          setDeleteAck(false);
          toast.toast({
            tone: "warning",
            title: "Deletion request received",
            description:
              "Support will contact you within 5 business days to confirm identity and settle any remaining balance.",
          });
        }}
        title="Request account deletion"
        confirmLabel="Submit request"
        tone="danger"
        requireAcknowledge={
          <Checkbox
            checked={deleteAck}
            onCheckedChange={setDeleteAck}
            label="I understand this is irreversible and that unwithdrawn balances may be forfeited."
          />
        }
      >
        <p>
          Deletion is a request, not an instant action: we must first confirm your identity, settle or
          return any remaining MTT balance, and close open staking positions.
        </p>
        <p className="text-text-muted">
          Points are a non-transferable loyalty balance and are cancelled on closure. Transaction and
          KYC records are retained for the statutory AML period regardless of deletion.
        </p>
        {!deleteAck && (
          <p className="text-xs text-warning-400">Tick the acknowledgement above to enable submission.</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
