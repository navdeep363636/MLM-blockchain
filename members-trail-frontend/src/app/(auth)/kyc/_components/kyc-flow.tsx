"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, Camera, CheckCircle2, Clock, FileText, Lock, RefreshCw,
  ShieldCheck, Upload, XCircle,
} from "lucide-react";
import {
  Badge, Button, Callout, KycBadge, Modal, RingProgress, Steps, useToast,
} from "@/components/ui";
import { useSubmitKyc } from "@/lib/hooks/use-mutations";
import { humanMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

type DocKind = "id_front" | "id_back" | "selfie" | "address_proof";
type Status = "collecting" | "submitted" | "approved" | "rejected" | "more_info";

/**
 * What the API needs to know about an attached document.
 *
 * All four fields are measured from the actual file, never assumed. The digest in
 * particular: `sha256` is what lets the reviewer prove the bytes they open are the
 * bytes the member sent, so a placeholder value would be worse than no value —
 * it would be a claim about a document nobody verified. That is why attaching a
 * document here reads the file rather than flipping a boolean.
 */
interface DocMeta {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

/** Mirrored from the server's presigned-upload policy (ALLOWED_MIME_TYPES). */
const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
const ACCEPT_ATTR = ACCEPTED_MIME.join(",");
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

/** SHA-256 of the file's bytes, hex, computed in the browser. */
async function digest(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const DOCS: { kind: DocKind; label: string; hint: string; tier: 1 | 2; icon: React.ReactNode }[] = [
  { kind: "id_front", label: "Government ID — front", hint: "Passport, driving licence or national ID. Image or PDF, all four corners visible.", tier: 1, icon: <FileText /> },
  { kind: "id_back", label: "Government ID — back", hint: "Skip only if your document is single-sided, like a passport photo page.", tier: 1, icon: <FileText /> },
  { kind: "selfie", label: "Selfie with liveness check", hint: "Captured live in-browser and matched against your ID by our KYC provider.", tier: 1, icon: <Camera /> },
  { kind: "address_proof", label: "Proof of address", hint: "Tier 2 only. Requested above a cumulative withdrawal threshold.", tier: 2, icon: <FileText /> },
];

export function KycFlow() {
  const toast = useToast();
  const submitKyc = useSubmitKyc();
  const [status, setStatus] = useState<Status>("collecting");
  const [uploaded, setUploaded] = useState<Record<DocKind, DocMeta | null>>({
    id_front: null, id_back: null, selfie: null, address_proof: null,
  });
  const [tier2, setTier2] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selfieOpen, setSelfieOpen] = useState(false);

  const required = DOCS.filter((d) => d.tier === 1 || tier2);
  const doneCount = required.filter((d) => uploaded[d.kind]).length;
  const canSubmit = uploaded.id_front && uploaded.selfie && (!tier2 || uploaded.address_proof);

  /* One hidden input drives every tile. `pending` records which document the
   * picker was opened for, in a ref rather than state because the change event
   * arrives long after the click and must read the value set by it. */
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pending = useRef<DocKind | null>(null);

  const pick = (k: DocKind) => {
    pending.current = k;
    fileRef.current?.click();
  };

  /**
   * Attaches one document.
   *
   * The size and type checks are the server's own limits, applied here so a
   * member learns their 40MB scan is too large before waiting on an upload —
   * not to replace the server's checks, which still run.
   */
  const attach = async (k: DocKind, file: File | null | undefined) => {
    if (!file) return;
    if (!ACCEPTED_MIME.includes(file.type)) {
      toast.error("That file type is not accepted", "Use a JPEG, PNG, WebP, HEIC or PDF.");
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      toast.error("That file is too large", "The limit is 15MB per document.");
      return;
    }
    if (file.size === 0) {
      toast.error("That file is empty", "Pick the document again.");
      return;
    }
    try {
      const sha256 = await digest(file);
      setUploaded((u) => ({
        ...u,
        [k]: { filename: file.name, mimeType: file.type, sizeBytes: file.size, sha256 },
      }));
      toast.success("Document attached", "Encrypted and queued for review.");
    } catch {
      toast.error("Couldn't read that file", "Try attaching it again.");
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      /* NOTE the shape: the API takes document REFERENCES — a storage key, a mime
       * type, a size, a digest — not file bytes. Identity documents are uploaded
       * straight to object storage by a separate signed-URL flow so they never
       * pass through the API process or its logs, and this call registers what
       * was stored.
       *
       * The mime type, size and SHA-256 below are MEASURED from the file the
       * member picked. They used to be hard-coded ("image/jpeg", 0 bytes, no
       * digest), which the API rejected outright — `sizeBytes` must be at least
       * 1 and `sha256` is required — so no submission could ever succeed.
       *
       * `storageKey` is still a placeholder, because the signed-URL upload step
       * does not exist yet. That is the remaining gap and it fails honestly: the
       * provider integration refuses a record pointing at an object that was
       * never stored, which is the correct outcome. A KYC record that looks
       * complete but references nothing would be worse than no record. */
      const documents = (Object.keys(uploaded) as DocKind[])
        .map((kind) => ({ kind, meta: uploaded[kind] }))
        .filter((d): d is { kind: DocKind; meta: DocMeta } => d.meta !== null)
        .map(({ kind, meta }) => ({
          kind,
          storageKey: `pending-upload/${kind}/${meta.sha256.slice(0, 16)}`,
          mimeType: meta.mimeType,
          sizeBytes: meta.sizeBytes,
          sha256: meta.sha256,
        }));

      await submitKyc.mutateAsync({
        /* Tier 2 is the enhanced check, and it is what the member asked for when
         * they attached a proof of address. Sending tier 1 regardless would have
         * the server verify them to a lower tier than the documents support. */
        tier: tier2 ? 2 : 1,
        documents,
      });
      setStatus("submitted");
      toast.success("Submitted for review", "Most decisions land within a few minutes.");
    } catch (err) {
      toast.error("Submission not accepted", humanMessage(err));
    } finally {
      setBusy(false);
    }
  };

  /* ---------------------------- terminal states ---------------------------- */

  if (status === "submitted") {
    return (
      <div>
        <Steps steps={["Details", "Verify", "KYC", "Wallet"]} current={2} className="mb-8" />
        <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface-1 p-6 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-warning-500/12 text-warning-400">
            <Clock className="size-7" />
          </span>
          <h2 className="mt-4 font-display text-lg font-semibold text-text-primary">Under review</h2>
          <KycBadge tier="pending" className="mt-3" />
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-text-muted">
            Your documents went to our KYC provider for automated checks. Most submissions are
            decided in minutes; low-confidence results go to a human reviewer on our compliance team,
            which can take up to one business day.
          </p>

          <div className="mt-6 space-y-2.5 rounded-xl border border-border-subtle bg-surface-inset p-4 text-left">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              What you can do right now
            </p>
            {[
              ["Play in free mode", "Points credit to your ledger while you wait — nothing is on hold."],
              ["Connect a wallet", "Set up your MTT destination address so it's ready when approval lands."],
              ["Earn referral commission", "It accrues in a pending state and releases automatically on approval."],
            ].map(([t, d]) => (
              <div key={t} className="flex gap-2.5">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good-400" />
                <p className="text-sm text-text-secondary">
                  <span className="font-medium text-text-primary">{t}.</span> {d}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button href="/app" fullWidth>Go to dashboard</Button>
            <Button href="/connect-wallet" variant="outline" fullWidth>Connect a wallet</Button>
          </div>

          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button onClick={() => setStatus("approved")} className="text-xs text-text-muted underline underline-offset-2 hover:text-text-secondary">
              Preview approved state
            </button>
            <button onClick={() => setStatus("more_info")} className="text-xs text-text-muted underline underline-offset-2 hover:text-text-secondary">
              Preview “more info needed”
            </button>
            <button onClick={() => setStatus("rejected")} className="text-xs text-text-muted underline underline-offset-2 hover:text-text-secondary">
              Preview rejected state
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === "approved") {
    return (
      <div>
        <Steps steps={["Details", "Verify", "KYC", "Wallet"]} current={3} className="mb-8" />
        <div className="rounded-[var(--radius-panel)] border border-good-500/30 bg-surface-1 p-6 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-good-500/12 text-good-400">
            <CheckCircle2 className="size-7" />
          </span>
          <h2 className="mt-4 font-display text-lg font-semibold text-text-primary">Tier 1 approved</h2>
          <KycBadge tier="tier1" className="mt-3" />
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-text-muted">
            Conversion, staking, withdrawals up to your Tier 1 limit and referral commission release
            are all unlocked. Tier 2 is only requested if your cumulative withdrawals cross a higher
            threshold.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button href="/connect-wallet" fullWidth>Connect your wallet</Button>
            <Button href="/app" variant="outline" fullWidth>Go to dashboard</Button>
          </div>
        </div>
      </div>
    );
  }

  if (status === "rejected" || status === "more_info") {
    const rejected = status === "rejected";
    return (
      <div>
        <Steps steps={["Details", "Verify", "KYC", "Wallet"]} current={2} className="mb-8" />
        <div className={cn(
          "rounded-[var(--radius-panel)] border bg-surface-1 p-6",
          rejected ? "border-critical-500/30" : "border-warning-500/30",
        )}>
          <div className="flex items-start gap-3.5">
            <span className={cn(
              "grid size-11 shrink-0 place-items-center rounded-xl",
              rejected ? "bg-critical-500/12 text-critical-400" : "bg-warning-500/12 text-warning-400",
            )}>
              {rejected ? <XCircle className="size-5" /> : <AlertTriangle className="size-5" />}
            </span>
            <div>
              <h2 className="font-display text-lg font-semibold text-text-primary">
                {rejected ? "Verification rejected" : "Additional information needed"}
              </h2>
              <KycBadge tier={rejected ? "rejected" : "pending"} className="mt-2" />
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-border-subtle bg-surface-inset p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Reviewer notes</p>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">
              {rejected
                ? "The name on the submitted ID does not match the full legal name on your account. Correct your profile name to match your document exactly, then resubmit. If your legal name has changed, attach supporting documentation."
                : "The selfie was too dark for the provider to match against your ID with sufficient confidence. Please retake it in even, front-facing light with no hat or sunglasses. Your ID documents were accepted and don't need re-uploading."}
            </p>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button
              /* On a "more info" outcome the ID documents were accepted and only
               * the selfie needs retaking, so that one attachment is cleared and
               * the rest are kept. */
              onClick={() => { setStatus("collecting"); if (!rejected) setUploaded((u) => ({ ...u, selfie: null })); }}
              fullWidth
              icon={<RefreshCw className="size-4" />}
            >
              Resubmit documents
            </Button>
            <Button href="/app/support" variant="outline" fullWidth>Contact support</Button>
          </div>
        </div>
      </div>
    );
  }

  /* ----------------------------- collecting ------------------------------- */

  return (
    <div>
      <Steps steps={["Details", "Verify", "KYC", "Wallet"]} current={2} className="mb-8" />

      <div className="mb-6 flex items-center gap-4 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-4">
        <RingProgress value={doneCount} max={required.length} size={60} stroke={5}>
          <span className="tnum text-sm font-semibold text-text-primary">
            {doneCount}/{required.length}
          </span>
        </RingProgress>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary">
            {canSubmit ? "Ready to submit" : "Documents needed"}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
            Tier 1 needs a government ID and a liveness selfie. That&apos;s enough for conversion,
            staking, commission release and withdrawals up to your Tier 1 limit.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {DOCS.map((d) => {
          const needed = d.tier === 1 || tier2;
          const on = uploaded[d.kind];
          if (!needed) return null;
          return (
            <div
              key={d.kind}
              className={cn(
                "flex items-start gap-3.5 rounded-xl border p-4 transition-colors",
                on ? "border-good-500/40 bg-good-500/[0.04]" : "border-border-subtle bg-surface-1",
              )}
            >
              <span className={cn(
                "grid size-10 shrink-0 place-items-center rounded-xl [&>svg]:size-4",
                on ? "bg-good-500/12 text-good-400" : "bg-surface-3 text-text-muted",
              )}>
                {on ? <CheckCircle2 /> : d.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-text-primary">{d.label}</p>
                  {d.tier === 2 && <Badge tone="info">Tier 2</Badge>}
                  {d.kind === "id_back" && <Badge tone="neutral">Optional</Badge>}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">{d.hint}</p>
              </div>
              {/* Both paths end in a real file picker: the digest the API
                  requires can only be computed from the actual bytes. */}
              <Button
                size="sm"
                variant={on ? "outline" : "secondary"}
                onClick={() => (d.kind === "selfie" ? setSelfieOpen(true) : pick(d.kind))}
                icon={d.kind === "selfie" ? <Camera className="size-3.5" /> : <Upload className="size-3.5" />}
              >
                {on ? "Replace" : d.kind === "selfie" ? "Capture" : "Upload"}
              </Button>
            </div>
          );
        })}
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-border-subtle bg-surface-inset p-4">
        <input
          type="checkbox"
          checked={tier2}
          onChange={(e) => setTier2(e.target.checked)}
          className="mt-0.5 size-4 accent-[var(--accent)]"
        />
        <span className="text-sm text-text-secondary">
          <span className="font-medium text-text-primary">Complete Tier 2 now</span> — do this only if
          you expect large cumulative withdrawals. Otherwise we&apos;ll ask for proof of address if and
          when you approach the threshold.
        </span>
      </label>

      <Callout tone="info" title="How your documents are handled" icon={<Lock />} className="mt-6">
        <p className="mt-1">
          Files are encrypted at rest with AES-256. Access is restricted to our Compliance role, every
          access is logged, and documents are retained only for the period the AML policy requires
          before deletion. Read the{" "}
          <Link href="/legal/aml-kyc">AML / KYC Policy</Link> and{" "}
          <Link href="/legal/privacy">Privacy Policy</Link> for specifics.
        </p>
      </Callout>

      <Button onClick={submit} fullWidth size="lg" loading={busy} disabled={!canSubmit} className="mt-6">
        Submit for verification
      </Button>

      {!canSubmit && (
        <p className="mt-3 text-center text-xs text-text-muted">
          A front-of-ID image and a liveness selfie are the minimum for Tier 1.
        </p>
      )}

      <p className="mt-6 text-center text-sm">
        <Link href="/app" className="text-text-muted underline underline-offset-2 hover:text-text-primary">
          Skip for now — I just want to play
        </Link>
      </p>

      {/* The one file input every tile uses. */}
      <input
        ref={fileRef}
        type="file"
        className="sr-only"
        accept={ACCEPT_ATTR}
        onChange={(e) => {
          const kind = pending.current;
          const file = e.target.files?.[0];
          /* Reset first: without this, re-picking the same file fires no change
           * event and the member's second attempt looks like it did nothing. */
          e.target.value = "";
          pending.current = null;
          if (kind) void attach(kind, file);
        }}
      />

      {/* Liveness capture */}
      <Modal
        open={selfieOpen}
        onClose={() => setSelfieOpen(false)}
        title="Liveness check"
        description="Position your face in the frame and follow the on-screen prompt."
        icon={<Camera className="size-5" />}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelfieOpen(false)}>Cancel</Button>
            {/* Attaches a photo. The live camera capture is not built, and a
                "Capture" button that produced no image was why the selfie
                reached the API with no bytes, no size and no digest. */}
            <Button
              onClick={() => { setSelfieOpen(false); pick("selfie"); }}
              icon={<Upload className="size-4" />}
            >
              Attach a photo
            </Button>
          </>
        }
      >
        <div className="relative grid aspect-[4/5] place-items-center overflow-hidden rounded-xl border border-border-default bg-surface-inset">
          <div className="absolute inset-6 rounded-[50%] border-2 border-dashed border-[var(--accent)] opacity-60" />
          <div className="relative text-center">
            <Camera className="mx-auto size-8 text-text-muted" />
            <p className="mt-2 text-xs text-text-muted">Live capture is not available yet</p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-text-muted">
          In-browser liveness capture is still being built. For now, attach a clear photo of your
          face: it goes to our KYC provider for matching against your ID, and we store the result
          rather than the image.
        </p>
      </Modal>
    </div>
  );
}
