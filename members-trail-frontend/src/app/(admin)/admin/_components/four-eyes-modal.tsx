"use client";

/* Four-eyes modal — the shape every money-moving or policy-changing admin
 * action takes on this platform:
 *
 *   1. a mandatory typed reason (free text, no preset excuses)
 *   2. a named second approver who is not the requester
 *   3. an explicit acknowledgement of what is about to happen
 *   4. a statement that the request is written to append-only audit storage
 *
 * `blocked` is a hard stop, not a warning: when it is set the submit control
 * cannot be reached at all. Treasury funding uses it for the
 * "outflow > reconciled inflow" rule. */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, KeyRound, ShieldCheck, Users } from "lucide-react";
import { Badge, Button, Callout, Checkbox, Modal, Select, Textarea } from "@/components/ui";
import { AuditNote } from "./panel";
import { useSession } from "./session";

export interface FourEyesSubmission {
  reason: string;
  secondApprover: string;
}

const MIN_REASON = 15;

export function FourEyesModal({
  open, onClose, onSubmit, title, description, submitLabel = "Submit for second approval",
  tone = "primary", children, blocked, blockedTitle, blockedMessage, acknowledgement,
  requiresMultisig, size = "lg", icon, reasonLabel = "Reason for this change",
  reasonHint = "Recorded verbatim in the audit log and disclosed to auditors. Be specific — “fixing an error” is not a reason.",
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (s: FourEyesSubmission) => void;
  title: string;
  description?: React.ReactNode;
  submitLabel?: string;
  tone?: "primary" | "danger";
  children?: React.ReactNode;
  /** Hard block — submission is impossible while true. */
  blocked?: boolean;
  blockedTitle?: string;
  blockedMessage?: React.ReactNode;
  acknowledgement: React.ReactNode;
  /** Super Admin fund-affecting actions: hardware key, never a password. */
  requiresMultisig?: boolean;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  icon?: React.ReactNode;
  reasonLabel?: string;
  reasonHint?: string;
}) {
  const { me, approvers } = useSession();
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState("");
  const [ack, setAck] = useState(false);
  const [key, setKey] = useState(false);

  useEffect(() => {
    if (open) {
      setReason("");
      setApprover("");
      setAck(false);
      setKey(false);
    }
  }, [open]);

  const options = useMemo(
    () => approvers.map((a) => ({ value: a.name, label: `${a.name} — ${ROLE_LABEL[a.role]}` })),
    [approvers],
  );

  const reasonShort = reason.trim().length > 0 && reason.trim().length < MIN_REASON;
  const valid =
    !blocked &&
    reason.trim().length >= MIN_REASON &&
    approver !== "" &&
    ack &&
    (!requiresMultisig || key);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      icon={icon ?? <ShieldCheck className="size-5" />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            disabled={!valid}
            onClick={() => onSubmit({ reason: reason.trim(), secondApprover: approver })}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {blocked && (
          <Callout tone="critical" title={blockedTitle ?? "Blocked by policy"} icon={<AlertTriangle />}>
            <p className="mt-1">{blockedMessage}</p>
          </Callout>
        )}

        {children}

        <Textarea
          label={reasonLabel}
          hint={reasonHint}
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Player raised ticket TK-3041; session credit failed server-side validation on 18 Aug. Crediting the 340 Points the log shows were earned."
          error={reasonShort && `Give at least ${MIN_REASON} characters of context.`}
          className="min-h-28"
        />

        <div className="rounded-xl border border-border-default bg-surface-inset p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Users className="size-4 text-[var(--accent)]" />
              Four-eyes principle
            </p>
            <Badge tone="warning" dot>Second approval required</Badge>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-text-muted">
            You ({me?.name ?? "current operator"} — {me ? ROLE_LABEL[me.role] : "admin"}) are the
            requester. This action does not take effect until a different admin with approve rights
            confirms it. You cannot approve your own request.
          </p>
          <Select
            className="mt-3 h-10"
            label="Route to second approver"
            required
            value={approver}
            onChange={(e) => setApprover(e.target.value)}
            placeholder="Select an approver…"
            options={options}
            hint="Only active staff with 2FA enabled and approve rights on this module are listed."
          />
        </div>

        {requiresMultisig && (
          <div className="rounded-xl border border-warning-500/40 bg-warning-500/[0.06] p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-warning-400">
              <KeyRound className="size-4" />
              Hardware-key confirmation
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
              This action moves funds, so it is signed by the Treasury multisig with a hardware key.
              A password alone is never sufficient for a fund-affecting Super Admin action.
            </p>
            <Checkbox
              className="mt-3"
              checked={key}
              onCheckedChange={setKey}
              label="My hardware key is connected and I will sign the multisig transaction now."
            />
          </div>
        )}

        <Checkbox checked={ack} onCheckedChange={setAck} label={acknowledgement} />

        <AuditNote>
          This request, your reason, your IP address and the approver&apos;s decision are written to
          append-only audit storage the moment you submit. Audit records cannot be edited or deleted
          by any role, including Super Admin, and are retained for the regulatory record-keeping
          period.
        </AuditNote>
      </div>
    </Modal>
  );
}

export const ROLE_LABEL: Record<"support" | "compliance" | "finance_admin" | "super_admin", string> = {
  support: "Support",
  compliance: "Compliance",
  finance_admin: "Finance Admin",
  super_admin: "Super Admin",
};
