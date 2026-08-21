"use client";

/* AD-03 · KYC / AML review queue — compliance officer workspace. */

import { useMemo, useState } from "react";
import {
  AlertTriangle, Archive, BadgeCheck, CheckCircle2, Clock, Download, FileWarning, Flag,
  Gauge, HelpCircle, ScanFace, ShieldAlert, ShieldCheck, XCircle,
} from "lucide-react";
import {
  Badge, Button, Callout, ConfirmDialog, DetailRow, ProgressBar, SegmentedControl, Textarea,
  useToast, type Column,
} from "@/components/ui";
import { useAdminUsers, useKycQueue } from "@/lib/hooks/use-data";
import { csvDownload, formatDate, formatNumber, timeAgo } from "@/lib/utils";
import type { KycSubmission } from "@/types";
import { DetailDrawer, DrawerSection } from "../../_components/detail-drawer";
import { FilterBar } from "../../_components/filter-bar";
import { LedgerTable } from "../../_components/ledger-table";
import { AuditNote, DocTile, MiniStat, Panel } from "../../_components/panel";

/** Below this provider confidence the automated decision is refused and the
 *  submission is routed to a human. Mirrors the AML policy threshold. */
const AUTO_APPROVE_CONFIDENCE = 60;
const RETENTION_YEARS = 5;

type QueueTab = "pending" | "more_info" | "approved" | "rejected";

const DOC_LABEL: Record<KycSubmission["documents"][number]["kind"], string> = {
  id_front: "Government ID — front",
  id_back: "Government ID — back",
  selfie: "Liveness selfie",
  address_proof: "Proof of address",
};

const STATUS_BADGE: Record<KycSubmission["status"], React.ReactNode> = {
  pending: <Badge tone="warning" icon={<Clock className="size-3.5" />}>Pending review</Badge>,
  more_info: <Badge tone="info" icon={<HelpCircle className="size-3.5" />}>More info requested</Badge>,
  approved: <Badge tone="good" icon={<CheckCircle2 className="size-3.5" />}>Approved</Badge>,
  rejected: <Badge tone="critical" icon={<XCircle className="size-3.5" />}>Rejected</Badge>,
};

function ConfidenceBar({ value }: { value: number }) {
  const low = value < AUTO_APPROVE_CONFIDENCE;
  return (
    <div className="min-w-28 space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="tnum text-xs font-semibold text-text-primary">{value}%</span>
        {low && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning-400">
            <AlertTriangle className="size-3" />
            below {AUTO_APPROVE_CONFIDENCE}%
          </span>
        )}
      </div>
      <ProgressBar value={value} max={100} tone={low ? "warning" : "good"} height="h-1.5" />
    </div>
  );
}

/* -------------------------------- review panel --------------------------- */

function ReviewPanel({
  submission, onClose,
}: {
  submission: KycSubmission | null;
  onClose: () => void;
}) {
  const { data: users } = useAdminUsers();
  const toast = useToast();
  const [decision, setDecision] = useState<"approve" | "more_info" | "reject">("approve");
  const [notes, setNotes] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [sar, setSar] = useState(false);

  const user = useMemo(
    () => (submission ? users.find((u) => u.id === submission.userId) ?? null : null),
    [users, submission],
  );

  if (!submission) return null;
  const lowConfidence = submission.providerConfidence < AUTO_APPROVE_CONFIDENCE;
  const highRisk = submission.riskScore >= 70;
  const notesRequired = decision !== "approve";
  const canSubmit = !notesRequired || notes.trim().length >= 15;

  const decisionCopy = {
    approve: {
      label: "Approve",
      body: `Grants Tier ${submission.tier} verification. Withdrawals and commission release unlock immediately.`,
      tone: "good" as const,
    },
    more_info: {
      label: "Request more info",
      body: "The member is asked for a specific additional document. The submission stays in the queue and the SLA clock keeps running.",
      tone: "info" as const,
    },
    reject: {
      label: "Reject",
      body: "Verification is refused. The member is told the reason category and how to appeal. Funds are not confiscated.",
      tone: "critical" as const,
    },
  }[decision];

  return (
    <>
      <DetailDrawer
        open={!!submission}
        onClose={onClose}
        width="max-w-3xl"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {submission.userName}
            <span className="font-mono-num text-xs text-text-muted">{submission.id}</span>
          </span>
        }
        subtitle={`Tier ${submission.tier} submission · ${submission.country} · submitted ${timeAgo(submission.submittedAt)}`}
        badges={
          <>
            {STATUS_BADGE[submission.status]}
            <Badge tone={highRisk ? "critical" : "neutral"} icon={<Gauge className="size-3.5" />}>
              Risk <span className="tnum">{submission.riskScore}</span>
            </Badge>
            <Badge tone={lowConfidence ? "warning" : "good"} icon={<ScanFace className="size-3.5" />}>
              Provider confidence <span className="tnum">{submission.providerConfidence}%</span>
            </Badge>
          </>
        }
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              icon={<Flag className="size-4" />}
              onClick={() => setSar(true)}
            >
              Escalate to SAR
            </Button>
            <Button
              size="sm"
              disabled={!canSubmit}
              icon={<ShieldCheck className="size-4" />}
              onClick={() => setConfirm(true)}
            >
              Record decision
            </Button>
          </>
        }
      >
        {lowConfidence && (
          <Callout tone="warning" title="Why this needs a human" icon={<AlertTriangle />}>
            <p className="mt-1">
              The identity provider returned{" "}
              <strong className="text-text-primary">{submission.providerConfidence}% confidence</strong>,
              below the {AUTO_APPROVE_CONFIDENCE}% auto-approve threshold, so no automated decision
              was taken. {submission.notes ?? "Compare the document photo against the liveness selfie and check the MRZ against the entered details."}
            </p>
          </Callout>
        )}

        <DrawerSection
          title="Submitted documents"
          description="Rendered as labelled records. Full-resolution images open in the secure viewer with access itself logged."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {submission.documents.map((d) => (
              <DocTile
                key={d.kind}
                label={DOC_LABEL[d.kind]}
                filename={d.filename}
                note={d.kind === "selfie" && lowConfidence ? "Liveness match uncertain" : undefined}
                onOpen={() =>
                  toast.info("Opening in the secure document viewer", "Your access to this document is itself logged.")
                }
              />
            ))}
          </div>
          {submission.tier === 2 && (
            <p className="text-xs text-text-muted">
              Tier 2 additionally requires proof of address dated within the last three months and a
              declared source of funds.
            </p>
          )}
        </DrawerSection>

        <DrawerSection title="Applicant record">
          <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
            <DetailRow label="Member" value={<span className="font-mono-num text-xs">{submission.userId}</span>} />
            <DetailRow label="Legal name on file" value={user?.fullName ?? submission.userName} />
            <DetailRow label="Date of birth" value={<span className="tnum">{user?.dateOfBirth ?? "—"}</span>} />
            <DetailRow label="Country of residence" value={submission.country} />
            <DetailRow label="Submitted" value={<span className="tnum">{formatDate(submission.submittedAt, true)}</span>} />
            <DetailRow label="Requested tier" value={`Tier ${submission.tier}`} />
            <DetailRow
              label="Fraud-engine flags"
              value={
                user && user.riskFlags.length ? (
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {user.riskFlags.map((f) => (
                      <Badge key={f} tone="serious">{f.replace(/_/g, " ")}</Badge>
                    ))}
                  </span>
                ) : (
                  "None"
                )
              }
            />
          </div>
        </DrawerSection>

        <DrawerSection
          title="Decision"
          description="Your identity, the decision, the timestamp and these notes are stored together."
        >
          <SegmentedControl
            value={decision}
            onValueChange={setDecision}
            options={[
              { value: "approve", label: "Approve", icon: <CheckCircle2 className="size-3.5" /> },
              { value: "more_info", label: "Request info", icon: <HelpCircle className="size-3.5" /> },
              { value: "reject", label: "Reject", icon: <XCircle className="size-3.5" /> },
            ]}
          />
          <Callout tone={decisionCopy.tone} title={decisionCopy.label} icon={<ShieldCheck />}>
            <p className="mt-1">{decisionCopy.body}</p>
          </Callout>
          <Textarea
            label="Internal compliance notes"
            required={notesRequired}
            hint={
              notesRequired
                ? "Mandatory for anything other than a clean approval. Written to the case file, not shown to the member verbatim."
                : "Optional for a clean approval. Anything you write is retained with the case."
            }
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. MRZ matches entered name and DOB. Selfie liveness re-run at 82%. Address document dated 04 Aug 2026, within range."
            error={notesRequired && notes.trim().length > 0 && notes.trim().length < 15 && "Add at least 15 characters."}
          />
        </DrawerSection>

        <AuditNote>
          The decision and the reviewing officer&apos;s identity are logged and retained for
          approximately {RETENTION_YEARS} years per the AML Policy record-keeping period. Documents
          are stored encrypted, access to them is logged separately, and neither the decision nor the
          document access record can be edited afterwards.
        </AuditNote>
      </DetailDrawer>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          onClose();
          toast.success(
            `${submission.id} — ${decisionCopy.label.toLowerCase()} recorded`,
            "The member has been notified and the case file is sealed.",
          );
        }}
        title={`${decisionCopy.label} this submission?`}
        tone={decision === "reject" ? "danger" : "primary"}
        confirmLabel={`${decisionCopy.label} and log`}
        requireAcknowledge={
          <Callout tone="info" title="This becomes part of the AML record" icon={<Archive />}>
            <p className="mt-1">
              Your name, role, IP address, the decision and your notes are written to append-only
              storage and retained for ~{RETENTION_YEARS} years. Corrections are made by adding a new
              decision, never by editing this one.
            </p>
          </Callout>
        }
      >
        <p>
          {submission.userName} ({submission.userId}) · Tier {submission.tier} ·{" "}
          {submission.providerConfidence}% provider confidence · risk {submission.riskScore}.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={sar}
        onClose={() => setSar(false)}
        onConfirm={() => {
          setSar(false);
          toast.toast({
            tone: "warning",
            title: "Escalated to the SAR workflow",
            description: "Case opened for the MLRO. Do not discuss this escalation with the member.",
          });
        }}
        title="Escalate to a Suspicious Activity Report?"
        tone="danger"
        confirmLabel="Open SAR case"
        requireAcknowledge={
          <Callout tone="critical" title="Tipping-off rules apply" icon={<ShieldAlert />}>
            <p className="mt-1">
              Once escalated, the case is owned by the Money Laundering Reporting Officer. Do not
              inform the member that a report is being considered or filed, and do not use the SAR as
              the stated reason for any account action.
            </p>
          </Callout>
        }
      >
        <p>
          Opens a SAR case for {submission.userName} ({submission.userId}) with the documents, risk
          score, device and transaction history attached. The account is placed under enhanced
          monitoring, and withdrawals above the review threshold are held pending the MLRO&apos;s
          decision.
        </p>
      </ConfirmDialog>
    </>
  );
}

/* ------------------------------- header action ---------------------------- */

export function KycActions() {
  const { data: queue } = useKycQueue();
  return (
    <Button
      variant="outline"
      size="sm"
      icon={<Download className="size-4" />}
      onClick={() =>
        csvDownload(
          "members-trail-kyc-queue.csv",
          queue.map((s) => ({
            submission_id: s.id,
            user_id: s.userId,
            user: s.userName,
            tier: s.tier,
            country: s.country,
            status: s.status,
            risk_score: s.riskScore,
            provider_confidence: s.providerConfidence,
            documents: s.documents.map((d) => d.kind).join(" | "),
            submitted_at: s.submittedAt,
          })),
        )
      }
    >
      Export queue
    </Button>
  );
}

/* ---------------------------------- view --------------------------------- */

export function KycView() {
  const { data: queue, isLoading } = useKycQueue();
  const [tab, setTab] = useState<QueueTab>("pending");
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("all");
  const [conf, setConf] = useState("all");
  const [selected, setSelected] = useState<KycSubmission | null>(null);

  const counts = useMemo(
    () => ({
      pending: queue.filter((s) => s.status === "pending").length,
      more_info: queue.filter((s) => s.status === "more_info").length,
      approved: queue.filter((s) => s.status === "approved").length,
      rejected: queue.filter((s) => s.status === "rejected").length,
    }),
    [queue],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return queue.filter((s) => {
      if (s.status !== tab) return false;
      if (q && ![s.id, s.userId, s.userName, s.country].some((f) => f.toLowerCase().includes(q))) return false;
      if (tier !== "all" && String(s.tier) !== tier) return false;
      if (conf === "low" && s.providerConfidence >= AUTO_APPROVE_CONFIDENCE) return false;
      if (conf === "high" && s.providerConfidence < AUTO_APPROVE_CONFIDENCE) return false;
      if (conf === "risk" && s.riskScore < 70) return false;
      return true;
    });
  }, [queue, tab, query, tier, conf]);

  const columns: Column<KycSubmission>[] = [
    {
      key: "user",
      header: "Applicant",
      sortValue: (s) => s.userName,
      cell: (s) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">{s.userName}</p>
          <p className="font-mono-num truncate text-xs text-text-muted">{s.id} · {s.userId}</p>
        </div>
      ),
    },
    {
      key: "tier",
      header: "Tier",
      align: "center",
      sortValue: (s) => s.tier,
      cell: (s) => <Badge tone={s.tier === 2 ? "brand" : "neutral"}>Tier {s.tier}</Badge>,
    },
    {
      key: "submitted",
      header: "Submitted",
      hideBelow: "md",
      sortValue: (s) => s.submittedAt,
      cell: (s) => (
        <span className="text-xs text-text-secondary">
          {timeAgo(s.submittedAt)}
          <span className="tnum block text-[11px] text-text-muted">{formatDate(s.submittedAt, true)}</span>
        </span>
      ),
    },
    {
      key: "risk",
      header: "Risk score",
      align: "right",
      sortValue: (s) => s.riskScore,
      cell: (s) => (
        <Badge tone={s.riskScore >= 85 ? "critical" : s.riskScore >= 70 ? "warning" : "neutral"}>
          <span className="tnum">{s.riskScore}</span>
        </Badge>
      ),
    },
    {
      key: "confidence",
      header: "Provider confidence",
      hideBelow: "lg",
      sortValue: (s) => s.providerConfidence,
      cell: (s) => <ConfidenceBar value={s.providerConfidence} />,
    },
    {
      key: "docs",
      header: "Documents",
      hideBelow: "xl",
      align: "center",
      sortValue: (s) => s.documents.length,
      cell: (s) => <span className="tnum text-sm text-text-secondary">{s.documents.length}</span>,
    },
    {
      key: "country",
      header: "Country",
      hideBelow: "lg",
      align: "center",
      sortValue: (s) => s.country,
      cell: (s) => <span className="tnum text-sm text-text-secondary">{s.country}</span>,
    },
    {
      key: "status",
      header: "Status",
      hideBelow: "sm",
      sortValue: (s) => s.status,
      cell: (s) => STATUS_BADGE[s.status],
    },
  ];

  const lowConfidenceCount = queue.filter(
    (s) => s.status === "pending" && s.providerConfidence < AUTO_APPROVE_CONFIDENCE,
  ).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat label="Awaiting review" value={formatNumber(counts.pending)} sub="in this queue" tone="warning" />
        <MiniStat
          label="Below auto-approve"
          value={formatNumber(lowConfidenceCount)}
          sub={`provider confidence < ${AUTO_APPROVE_CONFIDENCE}%`}
          tone="warning"
        />
        <MiniStat
          label="High risk"
          value={formatNumber(queue.filter((s) => s.riskScore >= 70).length)}
          sub="risk score ≥ 70, enhanced due diligence"
          tone="critical"
        />
        <MiniStat
          label="Decided"
          value={formatNumber(counts.approved + counts.rejected)}
          sub="approved or rejected"
          tone="good"
        />
      </div>

      <Callout tone="info" title="Manual review exists because the machine abstained" icon={<ScanFace />}>
        <p className="mt-1">
          The identity provider auto-decides only above {AUTO_APPROVE_CONFIDENCE}% confidence and only
          when no fraud-engine flag is present. Everything in this queue failed one of those two
          tests, so each case needs a named officer&apos;s judgement. Decisions and the reviewing
          officer are retained for ~{RETENTION_YEARS} years.
        </p>
      </Callout>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={tab}
          onValueChange={setTab}
          options={[
            { value: "pending", label: `Pending (${counts.pending})`, icon: <Clock className="size-3.5" /> },
            { value: "more_info", label: `More info (${counts.more_info})`, icon: <HelpCircle className="size-3.5" /> },
            { value: "approved", label: `Approved (${counts.approved})`, icon: <CheckCircle2 className="size-3.5" /> },
            { value: "rejected", label: `Rejected (${counts.rejected})`, icon: <XCircle className="size-3.5" /> },
          ]}
        />
        <p className="text-xs text-text-muted">
          Tier 1 unlocks withdrawals and commission release. Tier 2 raises limits and is required
          above the enhanced-due-diligence threshold.
        </p>
      </div>

      <FilterBar
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Submission ID, user ID, name or country…"
        shown={filtered.length}
        total={queue.filter((s) => s.status === tab).length}
        unit="submissions"
        onReset={() => { setQuery(""); setTier("all"); setConf("all"); }}
        filters={[
          {
            label: "Tier",
            value: tier,
            onChange: setTier,
            options: [
              { value: "all", label: "Any tier" },
              { value: "1", label: "Tier 1" },
              { value: "2", label: "Tier 2" },
            ],
          },
          {
            label: "Signal",
            value: conf,
            onChange: setConf,
            options: [
              { value: "all", label: "Any signal" },
              { value: "low", label: `Confidence < ${AUTO_APPROVE_CONFIDENCE}%` },
              { value: "high", label: `Confidence ≥ ${AUTO_APPROVE_CONFIDENCE}%` },
              { value: "risk", label: "Risk score ≥ 70" },
            ],
          },
        ]}
      />

      <LedgerTable
        title="Review queue"
        description="Oldest submissions first by default. Click a row to open the review panel with documents and the decision form."
        icon={<BadgeCheck />}
        columns={columns}
        rows={filtered}
        keyOf={(s) => s.id}
        caption="KYC submissions awaiting or holding a compliance decision, with risk score and identity-provider confidence"
        loading={isLoading}
        pageSize={10}
        onRowClick={setSelected}
        dense={false}
        empty={{
          title: "Nothing in this bucket",
          description: "No submissions currently match this status and filter combination.",
        }}
        footnote="Provider confidence is the identity vendor's own match score. It is one input, not the decision — a high score with a device-cluster flag still requires review."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          icon={<FileWarning />}
          title="Escalation to a Suspicious Activity Report"
          description="When a submission stops being an identity question and becomes a financial-crime question."
        >
          <ul className="space-y-2.5 text-sm text-text-secondary">
            {[
              "Document appears genuine but belongs to a different person (third-party or coerced use).",
              "The same document or face appears across multiple accounts in the fraud engine's device cluster.",
              "Declared source of funds is inconsistent with observed deposit and conversion behaviour.",
              "Applicant matches a sanctions or PEP list entry that automated screening flagged for review.",
              "Structuring pattern: repeated activity just under a review threshold.",
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <Flag className="mt-0.5 size-3.5 shrink-0 text-warning-400" />
                {t}
              </li>
            ))}
          </ul>
          <Callout tone="critical" title="No tipping off" icon={<ShieldAlert />} className="mt-4">
            <p className="mt-1">
              The member is never told a SAR is being considered or filed. Account actions taken
              alongside an escalation are communicated using their own independent reason.
            </p>
          </Callout>
        </Panel>

        <Panel
          icon={<Archive />}
          title="Record keeping"
          description="What is stored, for how long, and who can see it."
        >
          <div className="px-0">
            <DetailRow label="Decision record" value={`Retained ~${RETENTION_YEARS} years`} />
            <DetailRow label="Reviewing officer identity" value="Stored with every decision" />
            <DetailRow label="Documents" value="Encrypted at rest, access individually logged" />
            <DetailRow label="Editability" value="None — corrections are new records" />
            <DetailRow label="Member access" value="Own record disclosable on request" />
          </div>
          <AuditNote className="mt-3">
            Retention is a regulatory obligation, not a product choice: the record must outlive the
            account. Deletion requests are honoured for marketing data but cannot remove AML records
            inside the statutory period.
          </AuditNote>
        </Panel>
      </div>

      <ReviewPanel submission={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
