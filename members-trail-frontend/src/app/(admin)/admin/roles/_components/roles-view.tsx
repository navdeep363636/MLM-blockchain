"use client";

/* AD-13 · Role & permission management — RBAC matrix, 2FA enforcement, and the
 * rule that Super Admin fund actions need a hardware key, not a password. */

import { useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Download, Eye, KeyRound, Lock, Pencil, Plus,
  ShieldAlert, ShieldCheck, UserCog, Users, XCircle,
} from "lucide-react";
import {
  Badge, Button, Callout, Checkbox, ConfirmDialog, DetailRow, Modal, SegmentedControl,
  Select, Switch, useToast, type Column,
} from "@/components/ui";
import { useStaff } from "@/lib/hooks/use-data";
import { MODULES, rolePermissions } from "@/lib/mock/admin";
import { csvDownload, formatNumber, timeAgo } from "@/lib/utils";
import type { RolePermission, StaffMember, StaffRole } from "@/types";
import { FourEyesModal, ROLE_LABEL } from "../../_components/four-eyes-modal";
import { LedgerTable } from "../../_components/ledger-table";
import { AuditNote, MiniStat, Panel } from "../../_components/panel";

const ROLES: StaffRole[] = ["support", "compliance", "finance_admin", "super_admin"];

const ROLE_BLURB: Record<StaffRole, string> = {
  support: "Answers members. Reads accounts and tickets, writes only to tickets. Cannot see or move money.",
  compliance: "Owns KYC decisions, fraud alerts and SAR escalation. Approves KYC and can approve economic changes as the second pair of eyes, but cannot propose them.",
  finance_admin: "Proposes and operates the economy: conversion rate, staking pools, commission plan, Treasury transfers. Every fund movement still needs a second approver.",
  super_admin: "Full access, including role management. Fund-affecting actions require multisig hardware-key confirmation — the password alone unlocks nothing that moves money.",
};

/** Permission depends on role, never on the individual. */
const FUND_MODULES = ["Revenue treasury", "Staking pools", "Conversion rate", "Referral config"];

type Matrix = Record<StaffRole, RolePermission[]>;

export function RolesActions() {
  const { data: staff } = useStaff();
  return (
    <Button
      variant="outline"
      size="sm"
      icon={<Download className="size-4" />}
      onClick={() =>
        csvDownload("members-trail-rbac.csv", [
          ...staff.map((s) => ({
            record: "staff",
            id: s.id,
            name: s.name,
            email: s.email,
            role: s.role,
            two_factor: s.twoFactorEnabled,
            active: s.active,
            last_active: s.lastActiveAt,
            module: "",
            read: "",
            write: "",
            approve: "",
          })),
          ...ROLES.flatMap((r) =>
            rolePermissions[r].map((p) => ({
              record: "permission",
              id: r,
              name: ROLE_LABEL[r],
              email: "",
              role: r,
              two_factor: true,
              active: true,
              last_active: "",
              module: p.module,
              read: p.read,
              write: p.write,
              approve: p.approve,
            })),
          ),
        ])
      }
    >
      Export RBAC matrix
    </Button>
  );
}

export function RolesView() {
  const { data: staff, isLoading } = useStaff();
  const toast = useToast();

  const [role, setRole] = useState<StaffRole>("compliance");
  const [matrix, setMatrix] = useState<Matrix>(() =>
    ROLES.reduce((acc, r) => ({ ...acc, [r]: rolePermissions[r].map((p) => ({ ...p })) }), {} as Matrix),
  );
  const [publish, setPublish] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [baseRole, setBaseRole] = useState<StaffRole>("support");
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [newRoleFor, setNewRoleFor] = useState<StaffRole>("support");
  const [enforce2fa, setEnforce2fa] = useState<StaffMember | null>(null);
  const [mandatory2fa, setMandatory2fa] = useState<Record<StaffRole, boolean>>({
    support: true, compliance: true, finance_admin: true, super_admin: true,
  });

  const rows = matrix[role];
  const dirty = useMemo(
    () =>
      ROLES.some((r) =>
        matrix[r].some((p, i) =>
          p.read !== rolePermissions[r][i].read ||
          p.write !== rolePermissions[r][i].write ||
          p.approve !== rolePermissions[r][i].approve,
        ),
      ),
    [matrix],
  );

  const noTwoFactor = staff.filter((s) => !s.twoFactorEnabled);
  const superAdmins = staff.filter((s) => s.role === "super_admin");

  const toggle = (module: string, key: "read" | "write" | "approve") =>
    setMatrix((cur) => ({
      ...cur,
      [role]: cur[role].map((p) => {
        if (p.module !== module) return p;
        const next = { ...p, [key]: !p[key] };
        /* write and approve are meaningless without read — keep the row coherent */
        if ((key === "write" || key === "approve") && next[key]) next.read = true;
        if (key === "read" && !next.read) { next.write = false; next.approve = false; }
        return next;
      }),
    }));

  const staffColumns: Column<StaffMember>[] = [
    {
      key: "name",
      header: "Staff member",
      sortValue: (s) => s.name,
      cell: (s) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">{s.name}</p>
          <p className="truncate text-xs text-text-muted">{s.email}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      sortValue: (s) => s.role,
      cell: (s) => (
        <Badge tone={s.role === "super_admin" ? "critical" : s.role === "finance_admin" ? "brand" : "neutral"}>
          {ROLE_LABEL[s.role]}
        </Badge>
      ),
    },
    {
      key: "2fa",
      header: "2FA",
      sortValue: (s) => (s.twoFactorEnabled ? 1 : 0),
      cell: (s) =>
        s.twoFactorEnabled ? (
          <Badge tone="good" icon={<KeyRound className="size-3.5" />}>Enabled</Badge>
        ) : (
          <Badge tone="critical" icon={<ShieldAlert className="size-3.5" />}>Disabled — non-compliant</Badge>
        ),
    },
    {
      key: "status",
      header: "Status",
      hideBelow: "md",
      sortValue: (s) => (s.active ? 1 : 0),
      cell: (s) =>
        s.active ? (
          <Badge tone="good" icon={<CheckCircle2 className="size-3.5" />}>Active</Badge>
        ) : (
          <Badge tone="neutral" icon={<XCircle className="size-3.5" />}>Deactivated</Badge>
        ),
    },
    {
      key: "seen",
      header: "Last active",
      hideBelow: "lg",
      align: "right",
      sortValue: (s) => s.lastActiveAt,
      cell: (s) => <span className="text-xs text-text-muted">{timeAgo(s.lastActiveAt)}</span>,
    },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (s) => (
        <span className="flex justify-end gap-1.5">
          {!s.twoFactorEnabled && (
            <Button variant="outline" size="xs" icon={<KeyRound className="size-3.5" />} onClick={() => setEnforce2fa(s)}>
              Enforce 2FA
            </Button>
          )}
          <Button
            variant="ghost"
            size="xs"
            icon={<UserCog className="size-3.5" />}
            onClick={() => { setNewRoleFor(s.role); setEditing(s); }}
          >
            Change role
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat label="Staff accounts" value={formatNumber(staff.length)} sub={`${staff.filter((s) => s.active).length} active`} />
        <MiniStat label="Roles" value={formatNumber(ROLES.length)} sub="least-privilege by default" />
        <MiniStat
          label="2FA non-compliant"
          value={formatNumber(noTwoFactor.length)}
          sub="must be resolved before next sign-in"
          tone={noTwoFactor.length > 0 ? "critical" : "good"}
        />
        <MiniStat
          label="Super Admins"
          value={formatNumber(superAdmins.length)}
          sub="hardware key required for fund actions"
          tone={superAdmins.length > 2 ? "warning" : "good"}
        />
      </div>

      {noTwoFactor.length > 0 && (
        <Callout tone="critical" title={`${noTwoFactor.length} staff account${noTwoFactor.length > 1 ? "s" : ""} without 2FA`} icon={<ShieldAlert />}>
          <p className="mt-1">
            Two-factor authentication is mandatory for every admin role without exception, so these
            accounts are non-compliant right now:{" "}
            <strong className="text-text-primary">{noTwoFactor.map((s) => `${s.name} (${ROLE_LABEL[s.role]})`).join(", ")}</strong>.
            Enforcing it below blocks the account at next sign-in until an authenticator is enrolled.
            An admin without 2FA is a single stolen password away from being the platform&apos;s worst
            incident.
          </p>
        </Callout>
      )}

      {/* ------------------------------ role picker ----------------------- */}
      <Panel
        icon={<ShieldCheck />}
        title="Permission matrix"
        description="Per-module read, write and approve rights. Write and approve imply read; removing read removes both."
        action={
          <>
            <Button variant="ghost" size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Create role
            </Button>
            <Button size="sm" icon={<Lock className="size-4" />} disabled={!dirty} onClick={() => setPublish(true)}>
              Publish permissions
            </Button>
          </>
        }
        footnote="Approve rights are what make four-eyes possible: the role that proposes a change is never the role that confirms it. Granting a single role both write and approve on the same money module defeats the control, and the publication step flags it."
      >
        <div className="space-y-5">
          <SegmentedControl
            value={role}
            onValueChange={setRole}
            options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          />

          <Callout tone="info" title={ROLE_LABEL[role]} icon={<Users />}>
            <p className="mt-1">{ROLE_BLURB[role]}</p>
          </Callout>

          <div className="overflow-x-auto rounded-xl border border-border-subtle">
            <table className="w-full min-w-[34rem] text-sm">
              <caption className="sr-only">
                Permission matrix for the {ROLE_LABEL[role]} role: read, write and approve rights per module
              </caption>
              <thead className="bg-surface-inset">
                <tr>
                  <th scope="col" className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Module
                  </th>
                  {(["read", "write", "approve"] as const).map((k) => (
                    <th key={k} scope="col" className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-text-muted">
                      <span className="inline-flex items-center gap-1.5">
                        {k === "read" ? <Eye className="size-3.5" /> : k === "write" ? <Pencil className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                        {k}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {rows.map((p) => {
                  const fundModule = FUND_MODULES.includes(p.module);
                  return (
                    <tr key={p.module} className="bg-surface-1">
                      <td className="px-4 py-2.5">
                        <span className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
                          {p.module}
                          {fundModule && <Badge tone="warning">Fund-affecting</Badge>}
                        </span>
                      </td>
                      {(["read", "write", "approve"] as const).map((k) => (
                        <td key={k} className="px-4 py-2.5 text-center">
                          <span className="inline-flex justify-center">
                            <Checkbox
                              checked={p[k]}
                              onCheckedChange={() => toggle(p.module, k)}
                              id={`${role}-${p.module}-${k}`}
                              label={<span className="sr-only">{`${k} ${p.module} as ${ROLE_LABEL[role]}`}</span>}
                            />
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat
              label="Readable modules"
              value={`${rows.filter((p) => p.read).length} / ${MODULES.length}`}
              sub="visibility"
            />
            <MiniStat
              label="Writable modules"
              value={`${rows.filter((p) => p.write).length} / ${MODULES.length}`}
              sub="can change state"
              tone={rows.filter((p) => p.write).length > MODULES.length * 0.7 ? "warning" : "default"}
            />
            <MiniStat
              label="Approve rights"
              value={`${rows.filter((p) => p.approve).length} / ${MODULES.length}`}
              sub="second pair of eyes"
            />
          </div>

          {rows.some((p) => FUND_MODULES.includes(p.module) && p.write && p.approve) && (
            <Callout tone="warning" title="This role can both propose and approve a fund-affecting change" icon={<AlertTriangle />}>
              <p className="mt-1">
                {ROLE_LABEL[role]} currently holds write and approve on{" "}
                {rows.filter((p) => FUND_MODULES.includes(p.module) && p.write && p.approve).map((p) => p.module).join(", ")}.
                The four-eyes control still forces two different <em>people</em>, but keeping both
                rights in one role means those two people can share the same incentives. Super Admin is
                the deliberate exception, and its fund actions are gated by hardware key instead.
              </p>
            </Callout>
          )}
        </div>
      </Panel>

      {/* --------------------------- 2FA enforcement ---------------------- */}
      <Panel
        icon={<KeyRound />}
        title="Authentication policy"
        description="Enforced per role, not per person. There is no opt-out for any admin role."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            {ROLES.map((r) => (
              <div key={r} className="rounded-xl border border-border-subtle bg-surface-inset p-4">
                <Switch
                  checked={mandatory2fa[r]}
                  onCheckedChange={(v) => {
                    if (!v) {
                      toast.error(
                        "2FA cannot be disabled",
                        "Mandatory two-factor authentication for admin roles is a policy control, not a preference.",
                      );
                      return;
                    }
                    setMandatory2fa((c) => ({ ...c, [r]: v }));
                  }}
                  label={`Mandatory 2FA — ${ROLE_LABEL[r]}`}
                  description={
                    r === "super_admin"
                      ? "Plus a hardware security key for any action that moves funds."
                      : "Authenticator app or hardware key. SMS is not accepted."
                  }
                />
                <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
                  <Users className="size-3.5" />
                  {staff.filter((s) => s.role === r).length} account(s) ·{" "}
                  {staff.filter((s) => s.role === r && !s.twoFactorEnabled).length} non-compliant
                </p>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            <Callout tone="critical" title="Super Admin fund actions need a hardware key" icon={<Lock />}>
              <p className="mt-1">
                Treasury transfers, staking-contract parameters, conversion-rate publication and
                commission-plan changes are signed with the Treasury multisig using a physical security
                key. A password — even a Super Admin&apos;s, even with 2FA — is never sufficient
                authorisation to move funds. This means an attacker with full credential access still
                cannot drain the Treasury, and it means no single insider can either.
              </p>
            </Callout>
            <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
              <DetailRow label="Session timeout" value="20 minutes idle" />
              <DetailRow label="Concurrent sessions" value="1 per admin account" />
              <DetailRow label="IP allow-listing" value="Required for Finance and Super Admin" />
              <DetailRow label="SMS as second factor" value="Not accepted" />
              <DetailRow label="Shared accounts" value="Prohibited — every action needs a named human" />
              <DetailRow label="Access review" value="Quarterly, by the Compliance lead" />
            </div>
          </div>
        </div>
      </Panel>

      {/* ------------------------------ staff list ------------------------ */}
      <LedgerTable
        title="Staff accounts"
        description="Who holds which role, and whether their authentication meets policy."
        icon={<Users />}
        columns={staffColumns}
        rows={staff}
        keyOf={(s) => s.id}
        caption="Internal staff accounts with role, two-factor status and last activity"
        loading={isLoading}
        pageSize={0}
        dense={false}
        footnote="Role changes take effect at the staff member's next sign-in and are logged with both the old and the new role. Deactivating an account revokes its sessions immediately."
      />

      <AuditNote>
        Permission changes, role assignments and 2FA enforcement actions are written to append-only
        audit storage with the operator, the target account and the before/after rights. Access reviews
        read from that log rather than from the current state, so a permission that was granted and
        quietly removed is still visible to the reviewer.
      </AuditNote>

      {/* ---------------------------- publish matrix ---------------------- */}
      <FourEyesModal
        open={publish}
        onClose={() => setPublish(false)}
        onSubmit={(s) => {
          setPublish(false);
          toast.success("Permission change submitted", `Routed to ${s.secondApprover}. Rights change at affected users' next sign-in.`);
        }}
        title="Publish permission changes"
        description="RBAC changes are security controls, so they need a second approver."
        submitLabel="Submit for approval"
        icon={<ShieldCheck className="size-5" />}
        requiresMultisig
        reasonLabel="Reason for the permission change"
        reasonHint="Name the role, the module and the business need. Access reviews read this text."
        acknowledgement={
          <span>
            I confirm this change follows least privilege, that no role gains both write and approve on
            a fund-affecting module without a documented exception, and that mandatory 2FA remains in
            force for every admin role.
          </span>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">Changed rights in this submission:</p>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {ROLES.flatMap((r) =>
              matrix[r]
                .map((p, i) => ({ r, p, base: rolePermissions[r][i] }))
                .filter(({ p, base }) => p.read !== base.read || p.write !== base.write || p.approve !== base.approve)
                .map(({ r, p, base }) => (
                  <div key={`${r}-${p.module}`} className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-2.5">
                    <p className="text-sm font-medium text-text-primary">
                      {ROLE_LABEL[r]} · {p.module}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      read {String(base.read)} → {String(p.read)} · write {String(base.write)} →{" "}
                      {String(p.write)} · approve {String(base.approve)} → {String(p.approve)}
                    </p>
                  </div>
                )),
            )}
          </div>
        </div>
      </FourEyesModal>

      {/* ----------------------------- create role ------------------------ */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Create a role"
        description="New roles start from an existing one and can only be narrowed at creation."
        icon={<Plus className="size-5" />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              disabled={newRoleName.trim().length < 3}
              onClick={() => {
                setCreating(false);
                toast.success(`Role “${newRoleName.trim()}” drafted`, `Cloned from ${ROLE_LABEL[baseRole]} with no additional rights. It needs a second approver before it can be assigned.`);
                setNewRoleName("");
              }}
            >
              Create draft role
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium text-text-secondary">
              Role name <span className="text-[var(--accent)]">*</span>
            </span>
            <input
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder="e.g. Payments Support"
              className="h-11 w-full rounded-xl border border-border-default bg-surface-3 px-3.5 text-sm text-text-primary placeholder:text-text-muted focus:border-[var(--accent)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-soft)]"
            />
          </label>
          <Select
            label="Clone permissions from"
            value={baseRole}
            onChange={(e) => setBaseRole(e.target.value as StaffRole)}
            options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
            hint="A new role can start no broader than the role it clones. Widening it later is a separate, approved change."
          />
          <Callout tone="info" title="Least privilege at creation" icon={<ShieldCheck />}>
            <p className="mt-1">
              New roles are created with read-only rights on the cloned modules. Write and approve
              rights are granted individually afterwards, each with its own approval — which makes
              accidental over-provisioning much harder than getting it right.
            </p>
          </Callout>
        </div>
      </Modal>

      {/* --------------------------- change role -------------------------- */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Change role — ${editing?.name ?? ""}`}
        description={editing ? `Currently ${ROLE_LABEL[editing.role]}` : undefined}
        icon={<UserCog className="size-5" />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              disabled={!editing || newRoleFor === editing.role}
              onClick={() => {
                const name = editing?.name;
                setEditing(null);
                toast.success("Role change queued", `${name} → ${ROLE_LABEL[newRoleFor]}. Applies at their next sign-in, after a second admin approves.`);
              }}
            >
              Queue role change
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="New role"
            value={newRoleFor}
            onChange={(e) => setNewRoleFor(e.target.value as StaffRole)}
            options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          />
          <Callout tone="info" title={ROLE_LABEL[newRoleFor]} icon={<Users />}>
            <p className="mt-1">{ROLE_BLURB[newRoleFor]}</p>
          </Callout>
          {newRoleFor === "super_admin" && (
            <Callout tone="critical" title="Super Admin is not a convenience" icon={<ShieldAlert />}>
              <p className="mt-1">
                Granting Super Admin gives access to role management and every configuration surface on
                the platform. It requires a hardware security key to be enrolled first, and the grant
                itself is reviewed at the next quarterly access review. If the need is a single module,
                grant that module instead.
              </p>
            </Callout>
          )}
        </div>
      </Modal>

      {/* ---------------------------- enforce 2FA ------------------------- */}
      <ConfirmDialog
        open={!!enforce2fa}
        onClose={() => setEnforce2fa(null)}
        onConfirm={() => {
          const name = enforce2fa?.name;
          setEnforce2fa(null);
          toast.success("2FA enforcement applied", `${name} must enrol an authenticator at their next sign-in.`);
        }}
        title="Enforce two-factor authentication?"
        confirmLabel="Enforce 2FA"
        requireAcknowledge={
          <Callout tone="warning" title="The account is blocked until enrolment" icon={<KeyRound />}>
            <p className="mt-1">
              At next sign-in the staff member is taken straight to enrolment and cannot reach any admin
              surface until it is complete. Their active sessions are revoked immediately, so anything
              they are mid-way through will need to be redone.
            </p>
          </Callout>
        }
      >
        <p>
          {enforce2fa?.name} ({enforce2fa ? ROLE_LABEL[enforce2fa.role] : ""}) is currently
          non-compliant with the mandatory 2FA policy.
        </p>
      </ConfirmDialog>
    </div>
  );
}
