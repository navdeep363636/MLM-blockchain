"use client";

/* AD-11 · CMS — legal & content management. Edit, version, review and publish
 * legal documents without a deploy. A material change forces re-acceptance. */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Bold, CheckCircle2, Clock, Download, Eye, FileText, Heading2, History,
  Italic, Link2, List, Quote, RotateCcw, Save, Scale, Send, ShieldAlert, Undo2, UserCheck,
} from "lucide-react";
import Link from "next/link";
import {
  Badge, Button, Callout, Checkbox, ConfirmDialog, DetailRow, EmptyState, Modal, SearchInput,
  SkeletonCard, Steps, Switch, Textarea, useToast, type Column,
} from "@/components/ui";
import { useAuditLog } from "@/lib/hooks/use-data";
import { useAdminLegalDocuments } from "@/lib/hooks/use-data";
import { csvDownload, formatDate, formatNumber, timeAgo } from "@/lib/utils";
import type { LegalDocument } from "@/types";
import { LedgerTable } from "../../_components/ledger-table";
import { AuditNote, MiniStat, Panel } from "../../_components/panel";

const WORKFLOW = ["Draft", "Legal review", "Published"];

const STATUS_META: Record<LegalDocument["status"], { label: string; tone: "neutral" | "warning" | "good"; Icon: typeof Clock; step: number }> = {
  draft: { label: "Draft", tone: "neutral", Icon: FileText, step: 0 },
  legal_review: { label: "In legal review", tone: "warning", Icon: Scale, step: 1 },
  published: { label: "Published", tone: "good", Icon: CheckCircle2, step: 2 },
};

/* Indexed through here, never directly. `status` is whatever the API said, and a
 * value this map does not know threw on `.step` — taking the whole CMS route to
 * its error boundary over a badge. An unrecognised status reads as a draft,
 * which is the safe end of this workflow: it never claims a document is
 * published. */
const statusMeta = (s: LegalDocument["status"]) => STATUS_META[s] ?? STATUS_META.draft;

/** Documents serialise to a simple marked-up text form for the editor. */
function serialise(doc: LegalDocument) {
  return doc.sections
    .map((s) => `## ${s.heading}\n\n${s.body.join("\n\n")}`)
    .join("\n\n");
}

/* ------------------------------ header actions --------------------------- */

export function CmsActions() {
  const { data: docs } = useAdminLegalDocuments();
  return (
    <Button
      variant="outline"
      size="sm"
      icon={<Download className="size-4" />}
      onClick={() =>
        csvDownload(
          "members-trail-legal-documents.csv",
          docs.map((d) => ({
            slug: d.slug,
            title: d.title,
            version: d.version,
            status: d.status,
            updated_at: d.updatedAt,
            effective_from: d.effectiveFrom,
            material_change: d.materialChange,
            sections: d.sections.length,
          })),
        )
      }
    >
      Export document index
    </Button>
  );
}

/* -------------------------------- the editor ----------------------------- */

function Editor({
  doc, body, setBody, material, setMaterial,
}: {
  doc: LegalDocument;
  body: string;
  setBody: (v: string) => void;
  material: boolean;
  setMaterial: (v: boolean) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const wrap = (before: string, after = before, placeholder = "text") => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = body.slice(start, end) || placeholder;
    const next = `${body.slice(0, start)}${before}${selected}${after}${body.slice(end)}`;
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const prefixLine = (prefix: string) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const lineStart = body.lastIndexOf("\n", start - 1) + 1;
    setBody(`${body.slice(0, lineStart)}${prefix}${body.slice(lineStart)}`);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  };

  const words = body.trim() ? body.trim().split(/\s+/).length : 0;

  const TOOLS: { label: string; Icon: typeof Bold; onClick: () => void }[] = [
    { label: "Bold", Icon: Bold, onClick: () => wrap("**") },
    { label: "Italic", Icon: Italic, onClick: () => wrap("_") },
    { label: "Heading", Icon: Heading2, onClick: () => prefixLine("## ") },
    { label: "Bulleted list item", Icon: List, onClick: () => prefixLine("- ") },
    { label: "Block quote", Icon: Quote, onClick: () => prefixLine("> ") },
    { label: "Link", Icon: Link2, onClick: () => wrap("[", "](https://)", "link text") },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border-subtle bg-surface-inset p-1.5">
        {TOOLS.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={t.onClick}
            aria-label={t.label}
            title={t.label}
            className="grid size-8 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            <t.Icon className="size-4" />
          </button>
        ))}
        <span className="ml-auto pr-2 text-xs text-text-muted">
          <span className="tnum">{formatNumber(words)}</span> words ·{" "}
          <span className="tnum">{doc.sections.length}</span> sections
        </span>
      </div>

      <Textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="min-h-[26rem] font-mono text-xs leading-relaxed"
        hint="Headings use ## , lists use - , emphasis uses ** and _ . The renderer on the public legal pages reads this same structure, so what you write here is what members read."
      />

      <div className="rounded-xl border border-border-default bg-surface-inset p-4">
        <Switch
          checked={material}
          onCheckedChange={setMaterial}
          label="This is a material change"
          description="Anything that changes a member's rights, obligations, fees, data handling or dispute route. If in doubt, it is material."
        />
        {material && (
          <Callout tone="warning" title="Re-acceptance will be forced" icon={<UserCheck />} className="mt-3">
            <p className="mt-1">
              Publishing a material change locks every member out of the app on their next login until
              they read and accept the new version. Their acceptance, its timestamp and the exact
              version they accepted are all recorded.
            </p>
          </Callout>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- view --------------------------------- */

/**
 * The editor needs a document to exist before it can hold one in state, so the
 * fetch and the gate live out here.
 *
 * This used to be one component that did `docs.find(...) ?? docs[0]` and then
 * `serialise(doc)` in a `useState` initialiser. On the very first render `docs`
 * is its empty fallback, so `doc` was undefined and the initialiser threw on
 * `doc.sections` — meaning /admin/cms went to its error boundary on every visit
 * where the document list was not already cached, which is most of them. A
 * guard could not simply be added inside, because the crash happens in a hook
 * initialiser that has to run before any early return could.
 */
export function CmsView() {
  const { data: docs, isLoading } = useAdminLegalDocuments();

  if (isLoading) {
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (docs.length === 0) {
    return (
      <EmptyState
        className="mt-6 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1"
        icon={<FileText />}
        title="No legal documents yet"
        description="Documents appear here once Compliance has drafted them. Nothing to edit until then."
      />
    );
  }

  return <CmsEditor docs={docs} />;
}

function CmsEditor({ docs }: { docs: LegalDocument[] }) {
  const { data: audit } = useAuditLog();
  const toast = useToast();

  const [slug, setSlug] = useState(docs[0]?.slug ?? "terms");
  const [query, setQuery] = useState("");
  /* `docs` is guaranteed non-empty by the gate above, so `docs[0]` is a real
     document and `doc` is never undefined. */
  const doc = docs.find((d) => d.slug === slug) ?? docs[0];

  const [body, setBody] = useState(() => serialise(doc));
  const [material, setMaterial] = useState(doc.materialChange);
  const [sendReview, setSendReview] = useState(false);
  const [publish, setPublish] = useState(false);
  const [ackReacceptance, setAckReacceptance] = useState(false);
  const [ackReviewed, setAckReviewed] = useState(false);
  const [rollback, setRollback] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    setBody(serialise(doc));
    setMaterial(doc.materialChange);
  }, [doc]);

  useEffect(() => {
    if (publish) { setAckReacceptance(false); setAckReviewed(false); }
  }, [publish]);

  const dirty = body !== serialise(doc) || material !== doc.materialChange;
  const step = statusMeta(doc.status).step;

  const filteredDocs = docs.filter((d) =>
    d.title.toLowerCase().includes(query.trim().toLowerCase()) ||
    d.slug.includes(query.trim().toLowerCase()),
  );

  /** Publication history comes from the audit log — the same append-only
   *  record an auditor would read. */
  const history = useMemo(
    () =>
      audit
        .filter((a) => a.action === "Legal document published")
        .map((a) => ({
          id: a.id,
          document: a.target,
          from: a.before ?? "—",
          to: a.after ?? "—",
          actor: a.actor,
          timestamp: a.timestamp,
        })),
    [audit],
  );

  const historyColumns: Column<(typeof history)[number]>[] = [
    {
      key: "version",
      header: "Version",
      cell: (h) => (
        <span className="font-mono-num text-sm text-text-primary">
          {h.from} → <span className="font-semibold">{h.to}</span>
        </span>
      ),
    },
    {
      key: "document",
      header: "Document",
      hideBelow: "sm",
      sortValue: (h) => h.document,
      cell: (h) => <span className="text-sm text-text-secondary">{h.document.replace(/-/g, " ")}</span>,
    },
    {
      key: "published",
      header: "Published",
      sortValue: (h) => h.timestamp,
      cell: (h) => (
        <span className="text-xs text-text-secondary">
          {timeAgo(h.timestamp)}
          <span className="tnum block text-[11px] text-text-muted">{formatDate(h.timestamp, true)}</span>
        </span>
      ),
    },
    { key: "actor", header: "Published by", hideBelow: "md", cell: (h) => <span className="text-sm text-text-secondary">{h.actor}</span> },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (h) => (
        <Button variant="ghost" size="xs" icon={<Undo2 className="size-3.5" />} onClick={() => setRollback(h.to)}>
          Roll back to {h.from}
        </Button>
      ),
    },
  ];

  const stats = {
    published: docs.filter((d) => d.status === "published").length,
    review: docs.filter((d) => d.status === "legal_review").length,
    draft: docs.filter((d) => d.status === "draft").length,
    material: docs.filter((d) => d.materialChange).length,
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat label="Documents" value={formatNumber(docs.length)} sub="legal and policy documents under management" />
        <MiniStat label="In legal review" value={formatNumber(stats.review)} sub="awaiting counsel sign-off" tone="warning" />
        <MiniStat label="Drafts" value={formatNumber(stats.draft)} sub="not visible to members" />
        <MiniStat
          label="Flagged material"
          value={formatNumber(stats.material)}
          sub="will force re-acceptance on publish"
          tone={stats.material > 0 ? "warning" : "good"}
        />
      </div>

      <Callout tone="info" title="Content changes ship without a deploy — and are still versioned" icon={<History />}>
        <p className="mt-1">
          Legal text is data, not code, so counsel can correct a clause without an engineering release.
          The trade-off is that every save, review and publication has to be versioned and attributable,
          which is what the workflow below enforces. Members always see the published version; drafts
          and documents in review are invisible to them.
        </p>
      </Callout>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr] lg:items-start">
        {/* ---------------------------- document list -------------------- */}
        <Panel icon={<FileText />} title="Documents" description="Version, status and last update." padded={false}>
          <div className="border-b border-border-subtle px-4 py-3">
            <SearchInput value={query} onValueChange={setQuery} placeholder="Filter documents…" />
          </div>
          <ul className="divide-y divide-border-subtle">
            {filteredDocs.map((d) => {
              const on = d.slug === doc.slug;
              const m = statusMeta(d.status);
              return (
                <li key={d.slug}>
                  <button
                    type="button"
                    onClick={() => setSlug(d.slug)}
                    aria-pressed={on}
                    className={
                      on
                        ? "w-full bg-accent-soft px-4 py-3.5 text-left"
                        : "w-full px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
                    }
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className={on ? "text-sm font-semibold text-[var(--accent-hover)]" : "text-sm font-medium text-text-primary"}>
                        {d.title}
                      </span>
                      <span className="font-mono-num text-xs text-text-muted">v{d.version}</span>
                    </span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Badge tone={m.tone} icon={<m.Icon className="size-3.5" />}>{m.label}</Badge>
                      {d.materialChange && <Badge tone="warning">Material</Badge>}
                      <span className="text-[11px] text-text-muted">updated {timeAgo(d.updatedAt)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
            {filteredDocs.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-text-muted">No documents match that filter.</li>
            )}
          </ul>
        </Panel>

        {/* ------------------------------ editor ------------------------- */}
        <div className="space-y-4">
          <Panel
            icon={<Save />}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {doc.title}
                <span className="font-mono-num text-xs text-text-muted">v{doc.version}</span>
                {dirty && <Badge tone="warning" dot>Unsaved changes</Badge>}
              </span>
            }
            description={`Effective from ${formatDate(doc.effectiveFrom)} · ${doc.summary}`}
            action={
              <>
                <Button variant="ghost" size="sm" icon={<Eye className="size-4" />} onClick={() => setPreview(true)}>
                  Preview
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RotateCcw className="size-4" />}
                  disabled={!dirty}
                  onClick={() => { setBody(serialise(doc)); setMaterial(doc.materialChange); }}
                >
                  Discard
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  icon={<Save className="size-4" />}
                  disabled={!dirty}
                  onClick={() => toast.success("Draft saved", "Saved as a new draft revision. Members still see the published version.")}
                >
                  Save draft
                </Button>
              </>
            }
            footnote={
              <>
                Public URL:{" "}
                <Link href={`/legal/${doc.slug}`} className="text-[var(--accent-hover)] hover:underline">
                  /legal/{doc.slug}
                </Link>{" "}
                — this shows the published version, never your draft.
              </>
            }
          >
            <div className="space-y-5">
              <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-4">
                <Steps steps={WORKFLOW} current={step} />
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={step === 0 ? "primary" : "outline"}
                    icon={<Send className="size-4" />}
                    disabled={step > 0}
                    onClick={() => setSendReview(true)}
                  >
                    Send to legal review
                  </Button>
                  <Button
                    size="sm"
                    icon={<CheckCircle2 className="size-4" />}
                    disabled={step < 1}
                    onClick={() => setPublish(true)}
                  >
                    Publish new version
                  </Button>
                  <span className="text-xs text-text-muted">
                    {step === 0
                      ? "Counsel must sign off before a legal document can be published."
                      : step === 1
                      ? "Counsel has the draft. Publishing is available once review is complete."
                      : "This version is live for members."}
                  </span>
                </div>
              </div>

              <Editor doc={doc} body={body} setBody={setBody} material={material} setMaterial={setMaterial} />
            </div>
          </Panel>
        </div>
      </div>

      {/* ---------------------------- version history --------------------- */}
      <LedgerTable
        title="Publication history"
        description="Every legal document publication across the platform, drawn from the append-only audit log."
        icon={<History />}
        columns={historyColumns}
        rows={history}
        keyOf={(h) => h.id}
        caption="Legal document publication events with version transition, publisher and timestamp"
        pageSize={10}
        empty={{ title: "No publications recorded yet", description: "The first published version will appear here." }}
        footnote="A rollback republishes an earlier text as a new version. Members who accepted the intervening version keep that acceptance record — history is added to, never rewritten."
      />

      <Panel icon={<UserCheck />} title="What re-acceptance actually does" description="The mechanism behind the material-change flag.">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { Icon: ShieldAlert, title: "Blocking gate on next login", body: "The member cannot reach gameplay, wallet or withdrawal until they have seen the new version and accepted it." },
            { Icon: Scale, title: "Diff is shown, not hidden", body: "The prompt shows what changed and why, not just a checkbox on a wall of text. Refusing is allowed: the member can withdraw and close the account instead." },
            { Icon: CheckCircle2, title: "Acceptance is evidence", body: "Version, timestamp, IP and method are stored per member so consent can be proven for any individual on any date." },
          ].map((c) => (
            <div key={c.title} className="rounded-xl border border-border-subtle bg-surface-inset p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <c.Icon className="size-4 text-[var(--accent)]" />
                {c.title}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{c.body}</p>
            </div>
          ))}
        </div>
        <AuditNote className="mt-4">
          Saves, review transitions, publications and rollbacks are all logged with the operator, the
          document, the version transition and a hash of the published text — so the exact wording in
          force on any past date can be reproduced.
        </AuditNote>
      </Panel>

      {/* ------------------------------- preview -------------------------- */}
      <Modal
        open={preview}
        onClose={() => setPreview(false)}
        title={`Preview: ${doc.title}`}
        description={`v${doc.version} · effective ${formatDate(doc.effectiveFrom)}`}
        size="xl"
        icon={<Eye className="size-5" />}
        footer={<Button variant="ghost" onClick={() => setPreview(false)}>Close preview</Button>}
      >
        <div className="space-y-4">
          <Callout tone="neutral" title="Draft preview" icon={<FileText />}>
            <p className="mt-1">
              This is your unsaved editor content rendered the way the public page will structure it.
              Members currently see version {doc.version}.
            </p>
          </Callout>
          <div className="space-y-3 rounded-xl border border-border-subtle bg-surface-inset p-5">
            {body.split("\n\n").map((block, i) =>
              block.startsWith("## ") ? (
                <h3 key={i} className="text-sm font-semibold text-text-primary">{block.replace(/^##\s*/, "")}</h3>
              ) : block.startsWith("- ") ? (
                <ul key={i} className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-text-secondary">
                  {block.split("\n").map((li, j) => <li key={j}>{li.replace(/^-\s*/, "")}</li>)}
                </ul>
              ) : block.startsWith("> ") ? (
                <blockquote key={i} className="border-l-2 border-l-[var(--accent)] pl-3 text-sm italic text-text-secondary">
                  {block.replace(/^>\s*/, "")}
                </blockquote>
              ) : (
                <p key={i} className="text-sm leading-relaxed text-text-secondary">{block}</p>
              ),
            )}
          </div>
        </div>
      </Modal>

      {/* --------------------------- send to review ----------------------- */}
      <ConfirmDialog
        open={sendReview}
        onClose={() => setSendReview(false)}
        onConfirm={() => {
          setSendReview(false);
          toast.success("Sent to legal review", "Counsel has been notified. The draft is locked to editors until they respond.");
        }}
        title="Send this draft to legal review?"
        confirmLabel="Send to counsel"
        requireAcknowledge={
          <Callout tone="info" title="The draft locks while counsel holds it" icon={<Scale />}>
            <p className="mt-1">
              Editors cannot change the text while it is in review, so the version counsel signs off is
              the version that publishes. Reviewer comments come back as a new draft revision.
            </p>
          </Callout>
        }
      >
        <p>
          {doc.title} v{doc.version} goes to counsel for sign-off.{" "}
          {material ? "It is flagged as a material change, so counsel will also confirm the re-acceptance requirement." : "It is not flagged as material."}
        </p>
      </ConfirmDialog>

      {/* ------------------------------- publish -------------------------- */}
      <Modal
        open={publish}
        onClose={() => setPublish(false)}
        title={`Publish ${doc.title}`}
        description={material ? "Material change — re-acceptance will be forced" : "Non-material change — no re-acceptance required"}
        size="lg"
        icon={material ? <AlertTriangle className="size-5" /> : <CheckCircle2 className="size-5" />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPublish(false)}>Cancel</Button>
            <Button
              variant={material ? "danger" : "primary"}
              disabled={!ackReviewed || (material && !ackReacceptance)}
              onClick={() => {
                setPublish(false);
                toast.success(
                  `${doc.title} published`,
                  material
                    ? "Every member will be asked to accept the new version at their next login."
                    : "Live on the public legal page. No re-acceptance was required.",
                );
              }}
            >
              {material ? "Publish and force re-acceptance" : "Publish version"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
            <DetailRow label="Document" value={doc.title} />
            <DetailRow label="Current version" value={<span className="font-mono-num text-xs">v{doc.version}</span>} />
            <DetailRow label="Publishing as" value={<span className="font-mono-num text-xs">v{bumpVersion(doc.version, material)}</span>} />
            <DetailRow label="Public URL" value={`/legal/${doc.slug}`} />
            <DetailRow
              label="Classification"
              value={material ? <Badge tone="warning" dot>Material change</Badge> : <Badge tone="neutral">Editorial</Badge>}
            />
            <DetailRow label="Legal review" value={<Badge tone="good" dot>Signed off</Badge>} />
          </div>

          {material ? (
            <Callout tone="critical" title="This will interrupt every member's next session" icon={<UserCheck />}>
              <p className="mt-1">
                A material change triggers a blocking re-acceptance prompt for all members on next
                login. Until a member accepts, they cannot play, convert, stake or withdraw. Members who
                decline keep the right to withdraw their balance and close the account under the
                previous terms.
              </p>
            </Callout>
          ) : (
            <Callout tone="info" title="No re-acceptance for editorial changes" icon={<CheckCircle2 />}>
              <p className="mt-1">
                Typo fixes, formatting and clarifications that do not change rights or obligations
                publish silently. The version still increments and the change is still logged — the
                classification only decides whether members are interrupted.
              </p>
            </Callout>
          )}

          <Checkbox
            checked={ackReviewed}
            onCheckedChange={setAckReviewed}
            label="Counsel has signed off on this exact text, and the version I am publishing is the version they reviewed."
          />
          {material && (
            <Checkbox
              checked={ackReacceptance}
              onCheckedChange={setAckReacceptance}
              label="I understand this publication forces re-acceptance for every member on next login, blocks gameplay and withdrawals until accepted, and cannot be undone silently — a rollback is itself a new published version."
            />
          )}

          <AuditNote>
            Publication records the operator, counsel&apos;s sign-off reference, the version transition
            and a hash of the published text. Member acceptances are recorded individually against this
            version.
          </AuditNote>
        </div>
      </Modal>

      {/* ------------------------------- rollback ------------------------- */}
      <ConfirmDialog
        open={!!rollback}
        onClose={() => setRollback(null)}
        onConfirm={() => {
          setRollback(null);
          toast.toast({
            tone: "info",
            title: "Rollback prepared",
            description: "Loaded as a new draft. It needs legal review and publication like any other version.",
          });
        }}
        title={`Roll back from ${rollback ?? ""}?`}
        confirmLabel="Prepare rollback draft"
        requireAcknowledge={
          <Callout tone="warning" title="A rollback is a forward publication" icon={<Undo2 />}>
            <p className="mt-1">
              The earlier text is loaded as a new draft and must go through legal review and publication
              again. If the reverted text differs materially from what members last accepted, publishing
              it will trigger re-acceptance too.
            </p>
          </Callout>
        }
      >
        <p>Nothing is deleted. Acceptance records for the version being rolled back are retained.</p>
      </ConfirmDialog>
    </div>
  );
}

function bumpVersion(version: string, material: boolean) {
  const [major, minor] = version.split(".").map((n) => Number(n) || 0);
  return material ? `${major + 1}.0` : `${major}.${minor + 1}`;
}
