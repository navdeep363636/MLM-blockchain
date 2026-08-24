import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable,
  Logger, NotFoundException, UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import {
  KycAccessLog, KycDocument, KycSubmission, User, WebhookEvent,
  type KycDocKind, type KycStatus,
} from "@/database/entities";
import { CryptoService } from "@/common/crypto/crypto.service";
import { EventBusService, Events } from "@/events";
import { webhookConfig, type WebhookConfig } from "@/config/configuration";
import { Ref } from "@/common/utils";
import { paginate, safeSort, type Paginated } from "@/common/dto";
import { AuditService } from "@/modules/audit/audit.service";
import {
  ALLOWED_DOCUMENTS, AUTO_APPROVE_CONFIDENCE, AUTO_REJECT_CONFIDENCE,
  KYC_WEBHOOK_PROVIDER, REQUIRED_DOCUMENTS, retentionDeadline,
} from "./kyc.constants";
import type {
  AdminSubmissionResponse, CreateSubmissionDto, DecisionDto, DocumentAccessResponse,
  EscalateSarDto, KycQueueQuery, ProviderCallbackDto, SubmissionStatusResponse,
} from "./dto/kyc.dto";

/* ============================================================================
 * Identity verification (FRD A-05, AML Policy).
 *
 * Three invariants this service exists to hold:
 *
 *  1. A document's LOCATION is a secret, not just its contents. The object-store
 *     key is AES-256-GCM encrypted, so a database dump does not tell an attacker
 *     which bucket objects are someone's passport.
 *
 *  2. Reading a document ALWAYS writes an access-log row. That is enforced here,
 *     in the only method that can decrypt a key — not in a controller, where the
 *     next endpoint to be added would simply forget.
 *
 *  3. Approving a tier is the event that unlocks withdrawals and releases
 *     commissions that were held `pending_kyc`. It is therefore audited with
 *     `recordOrThrow`: an approval we cannot evidence is worse than one that
 *     failed.
 * ========================================================================== */

const QUEUE_SORT_COLUMNS = ["createdAt", "riskScore", "tier", "status", "reviewedAt"] as const;

export interface ActorContext {
  actorId: string;
  actorRole?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

@Injectable()
export class KycService {
  private readonly log = new Logger(KycService.name);

  constructor(
    @InjectRepository(KycSubmission) private readonly submissions: Repository<KycSubmission>,
    @InjectRepository(KycDocument) private readonly documents: Repository<KycDocument>,
    @InjectRepository(KycAccessLog) private readonly accessLog: Repository<KycAccessLog>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(WebhookEvent) private readonly webhooks: Repository<WebhookEvent>,
    private readonly crypto: CryptoService,
    private readonly bus: EventBusService,
    private readonly audit: AuditService,
    @Inject(webhookConfig.KEY) private readonly cfg: WebhookConfig,
  ) {}

  /* ==================================================================== *
   * Member: submit
   * ==================================================================== */

  async submit(
    userId: string,
    dto: CreateSubmissionDto,
    ctx: ActorContext,
  ): Promise<SubmissionStatusResponse> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("Account not found");

    if (!user.emailVerifiedAt || !user.phoneVerifiedAt) {
      throw new ForbiddenException({
        message: "Verify your email and phone number before starting identity verification",
        code: "CONTACT_NOT_VERIFIED",
      });
    }

    if (user.kycTier >= dto.tier) {
      throw new ConflictException({
        message: `Tier ${dto.tier} verification is already in place`,
        code: "TIER_ALREADY_HELD",
      });
    }

    /* Tier 2 is an escalation of an existing verified identity, not an
     * alternative to it — the enhanced checks build on the basic ones. */
    if (dto.tier === 2 && user.kycTier < 1) {
      throw new BadRequestException({
        message: "Complete Tier 1 verification before submitting Tier 2 documents",
        code: "TIER1_REQUIRED",
      });
    }

    const open = await this.submissions.findOne({
      where: { userId, status: In(["pending", "in_review"] as KycStatus[]) },
      order: { createdAt: "DESC" },
    });
    if (open) {
      throw new ConflictException({
        message: "A verification submission is already being reviewed",
        code: "SUBMISSION_IN_PROGRESS",
        reference: open.ref,
      });
    }

    this.assertDocumentSet(dto.tier, dto.documents.map((d) => d.kind));

    const now = new Date();
    const submission = await this.submissions.save(
      this.submissions.create({
        ref: Ref.kyc(),
        userId,
        tier: dto.tier,
        status: "pending",
        riskScore: user.riskScore,
        country: (dto.documentCountry ?? user.country).toUpperCase().slice(0, 2),
        /* Set at submission so a document can never sit outside a retention
         * window; refreshed from the decision date once reviewed. */
        retentionUntil: retentionDeadline(now),
      }),
    );

    await this.documents.save(
      dto.documents.map((d) =>
        this.documents.create({
          submissionId: submission.id,
          kind: d.kind,
          /* The key itself is the secret being protected here. */
          storageKeyEnc: this.crypto.encrypt(d.storageKey),
          mimeType: d.mimeType,
          sizeBytes: d.sizeBytes,
          sha256: d.sha256,
        }),
      ),
    );

    await this.audit.recordOrThrow({
      actorId: userId,
      action: "kyc.submission.created",
      targetType: "kyc_submission",
      targetId: submission.id,
      after: {
        ref: submission.ref,
        tier: submission.tier,
        documentKinds: dto.documents.map((d) => d.kind),
        country: submission.country,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });

    await this.bus.publish(
      Events.KycSubmitted,
      {
        submissionId: submission.id,
        ref: submission.ref,
        userId,
        tier: submission.tier,
        country: submission.country,
        documentKinds: dto.documents.map((d) => d.kind),
      },
      { actorId: userId, correlationId: ctx.requestId ?? undefined },
    );

    return this.toStatus(submission, dto.documents.map((d) => d.kind), user.kycTier);
  }

  /* ==================================================================== *
   * Member: read own status
   * ==================================================================== */

  async mySubmission(userId: string): Promise<SubmissionStatusResponse | null> {
    const submission = await this.submissions.findOne({
      where: { userId },
      order: { createdAt: "DESC" },
    });
    if (!submission) return null;

    const user = await this.users.findOne({ where: { id: userId } });
    const docs = await this.documents.find({ where: { submissionId: submission.id } });

    return this.toStatus(submission, docs.map((d) => d.kind), user?.kycTier ?? 0);
  }

  /* ==================================================================== *
   * Provider callback
   * ==================================================================== */

  /**
   * Inbound provider result.
   *
   * Signature is verified over the RAW body: re-serialising the parsed object
   * changes byte order and whitespace, so a signature check against
   * JSON.stringify(body) passes or fails depending on the provider's formatter
   * rather than on authenticity.
   */
  async handleProviderCallback(
    dto: ProviderCallbackDto,
    rawBody: string,
    signature: string | undefined,
    sourceIp: string | null,
  ): Promise<{ ok: boolean; status: string; replayed?: boolean }> {
    const secret = this.cfg.kycSecret;
    if (!secret) {
      this.log.error("KYC webhook received but KYC_WEBHOOK_SECRET is not configured");
      throw new UnauthorizedException("Webhook verification is not configured");
    }

    const valid = Boolean(signature) &&
      this.crypto.verifyWebhookSignature(secret, rawBody, signature ?? "");

    /* Recorded whether or not the signature is valid: a stream of invalid
     * signatures is the signal that someone is probing the endpoint. */
    const record = this.webhooks.create({
      provider: KYC_WEBHOOK_PROVIDER,
      eventId: dto.eventId,
      eventType: `kyc.${dto.outcome}`,
      payload: { ...dto } as Record<string, unknown>,
      signatureValid: valid,
      sourceIp,
    });

    let saved: WebhookEvent;
    try {
      saved = await this.webhooks.save(record);
    } catch {
      /* Unique (provider, eventId) — the provider retried a delivery we already
       * handled. Acknowledging is correct; processing twice is not. */
      return { ok: true, status: "duplicate", replayed: true };
    }

    if (!valid) {
      throw new UnauthorizedException({
        message: "Invalid webhook signature",
        code: "WEBHOOK_SIGNATURE_INVALID",
      });
    }

    const submission = await this.submissions.findOne({ where: { ref: dto.submissionRef } });
    if (!submission) {
      saved.error = "unknown submission reference";
      saved.processedAt = new Date();
      await this.webhooks.save(saved);
      throw new NotFoundException("Unknown submission reference");
    }

    if (submission.status === "approved" || submission.status === "rejected") {
      saved.processedAt = new Date();
      saved.error = `submission already ${submission.status}`;
      await this.webhooks.save(saved);
      return { ok: true, status: submission.status, replayed: true };
    }

    submission.provider = KYC_WEBHOOK_PROVIDER;
    submission.providerRef = dto.providerRef ?? submission.providerRef ?? null;
    submission.providerConfidence = Math.round(dto.confidence);
    if (dto.riskScore !== undefined) submission.riskScore = dto.riskScore;
    if (dto.country) submission.country = dto.country.toUpperCase().slice(0, 2);

    let outcome: string;

    if (dto.outcome === "approved" && dto.confidence >= AUTO_APPROVE_CONFIDENCE) {
      await this.applyApproval(submission, {
        actorId: null,
        actorRole: "system",
        reason: `auto-approved on provider confidence ${dto.confidence}`,
        memberNote: null,
        ip: sourceIp,
      });
      outcome = "approved";
    } else if (dto.outcome === "rejected" && dto.confidence <= AUTO_REJECT_CONFIDENCE) {
      submission.status = "rejected";
      submission.rejectionReason =
        dto.reason ?? "The documents provided could not be verified. Please submit again.";
      submission.reviewedAt = new Date();
      submission.retentionUntil = retentionDeadline(submission.reviewedAt);
      await this.submissions.save(submission);

      await this.bus.publish(Events.KycRejected, {
        submissionId: submission.id,
        userId: submission.userId,
        tier: submission.tier,
        automated: true,
        confidence: dto.confidence,
      });
      outcome = "rejected";
    } else {
      /* Anything ambiguous goes to a human. This is the branch that carries the
       * confidence threshold's whole value: an uncertain automated result must
       * never become a silent approval. */
      submission.status = "in_review";
      await this.submissions.save(submission);
      outcome = "in_review";
    }

    await this.audit.recordOrThrow({
      actorId: null,
      actorRole: "system",
      action: `kyc.provider_callback.${outcome}`,
      targetType: "kyc_submission",
      targetId: submission.id,
      after: {
        outcome: dto.outcome,
        confidence: dto.confidence,
        resolvedTo: outcome,
        providerRef: dto.providerRef ?? null,
      },
      reason: dto.reason ?? null,
      ip: sourceIp,
    });

    saved.processedAt = new Date();
    await this.webhooks.save(saved);

    return { ok: true, status: outcome };
  }

  /* ==================================================================== *
   * Compliance queue
   * ==================================================================== */

  async queue(q: KycQueueQuery): Promise<Paginated<AdminSubmissionResponse>> {
    const sortBy = safeSort(q.sortBy, QUEUE_SORT_COLUMNS, "createdAt");

    const qb = this.submissions.createQueryBuilder("s");

    if (q.status) qb.andWhere("s.status = :status", { status: q.status });
    if (q.tier) qb.andWhere("s.tier = :tier", { tier: q.tier });
    if (q.minRisk !== undefined) qb.andWhere("s.riskScore >= :minRisk", { minRisk: q.minRisk });
    if (q.sarFiled === true) qb.andWhere("s.sarFiledAt IS NOT NULL");
    if (q.sarFiled === false) qb.andWhere("s.sarFiledAt IS NULL");
    if (q.from) qb.andWhere("s.createdAt >= :from", { from: q.from });
    if (q.to) qb.andWhere("s.createdAt <= :to", { to: q.to });
    if (q.q) qb.andWhere("s.ref LIKE :ref", { ref: `%${q.q}%` });

    /* Column name comes from the allowlist above, never from the query string. */
    qb.orderBy(`s.${sortBy}`, q.sortDir).skip(q.skip).take(q.limit);

    const [rows, total] = await qb.getManyAndCount();
    const views = await Promise.all(rows.map((r) => this.toAdminView(r)));
    return paginate(views, total, q);
  }

  async adminSubmission(id: string): Promise<AdminSubmissionResponse> {
    const submission = await this.submissions.findOne({ where: { id } });
    if (!submission) throw new NotFoundException("Submission not found");
    return this.toAdminView(submission);
  }

  /* ==================================================================== *
   * Decision
   * ==================================================================== */

  async decide(
    id: string,
    dto: DecisionDto,
    ctx: ActorContext,
  ): Promise<AdminSubmissionResponse> {
    const submission = await this.submissions.findOne({ where: { id } });
    if (!submission) throw new NotFoundException("Submission not found");

    if (submission.status === "approved" || submission.status === "rejected") {
      throw new ConflictException({
        message: `This submission was already ${submission.status}`,
        code: "SUBMISSION_ALREADY_DECIDED",
      });
    }

    /* A reviewer may not decide their own verification. Same principle as
     * four-eyes on money: the decider and the subject must differ. */
    if (submission.userId === ctx.actorId) {
      throw new ForbiddenException({
        message: "You cannot review your own verification submission",
        code: "SELF_REVIEW_FORBIDDEN",
      });
    }

    if (dto.decision !== "approve" && !dto.notes?.trim()) {
      throw new BadRequestException({
        message: "A note for the member is required when rejecting or asking for more information",
        code: "MEMBER_NOTE_REQUIRED",
      });
    }

    const before = {
      status: submission.status,
      riskScore: submission.riskScore,
    };

    if (dto.riskScore !== undefined) submission.riskScore = dto.riskScore;

    if (dto.decision === "approve") {
      await this.applyApproval(submission, {
        actorId: ctx.actorId,
        actorRole: ctx.actorRole ?? null,
        reason: dto.internalNotes ?? "manual approval",
        memberNote: dto.notes ?? null,
        ip: ctx.ip ?? null,
      });
    } else {
      submission.status = dto.decision === "reject" ? "rejected" : "more_info";
      submission.reviewedById = ctx.actorId;
      submission.reviewedAt = new Date();
      /* `reviewerNotes` is the member-facing note. Reviewer-only commentary
       * goes to the audit trail below and is never written to this row, which
       * is what makes GET submissions/me safe to return verbatim. */
      submission.reviewerNotes = dto.notes ?? null;
      submission.rejectionReason = dto.decision === "reject" ? (dto.notes ?? null) : null;
      submission.retentionUntil = retentionDeadline(submission.reviewedAt);
      await this.submissions.save(submission);

      await this.bus.publish(
        dto.decision === "reject" ? Events.KycRejected : Events.KycMoreInfoRequested,
        {
          submissionId: submission.id,
          userId: submission.userId,
          tier: submission.tier,
          reviewedById: ctx.actorId,
          automated: false,
        },
        { actorId: ctx.actorId },
      );
    }

    await this.audit.recordOrThrow({
      actorId: ctx.actorId,
      actorRole: ctx.actorRole ?? null,
      action: `kyc.decision.${dto.decision}`,
      targetType: "kyc_submission",
      targetId: submission.id,
      before,
      after: {
        status: submission.status,
        riskScore: submission.riskScore,
        memberNote: dto.notes ?? null,
        internalNotes: dto.internalNotes ?? null,
      },
      reason: dto.internalNotes ?? dto.notes ?? null,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });

    return this.toAdminView(submission);
  }

  /* ==================================================================== *
   * SAR escalation
   * ==================================================================== */

  async escalateSar(
    id: string,
    dto: EscalateSarDto,
    ctx: ActorContext,
  ): Promise<AdminSubmissionResponse> {
    const submission = await this.submissions.findOne({ where: { id } });
    if (!submission) throw new NotFoundException("Submission not found");

    if (submission.sarFiledAt) {
      throw new ConflictException({
        message: "A suspicious activity report has already been filed for this submission",
        code: "SAR_ALREADY_FILED",
      });
    }

    const now = new Date();
    submission.sarFiledAt = now;
    submission.status = submission.status === "approved" ? submission.status : "in_review";
    /* The retention clock restarts from the filing: a reported case must be
     * retrievable for the full period after the report, not after the upload. */
    submission.retentionUntil = retentionDeadline(now);
    await this.submissions.save(submission);

    let frozen = false;
    if (dto.freezeAccount) {
      const user = await this.users.findOne({ where: { id: submission.userId } });
      if (user && user.status !== "closed") {
        user.status = "frozen";
        /* Deliberately non-specific: the reason field surfaces in support tools
         * and tipping-off rules forbid telling the customer a SAR was filed. */
        user.statusReason = "Compliance review in progress";
        await this.users.save(user);
        frozen = true;

        await this.bus.publish(
          Events.AccountFrozen,
          { userId: user.id, reason: "compliance_review", submissionId: submission.id },
          { actorId: ctx.actorId },
        );
      }
    }

    await this.audit.recordOrThrow({
      actorId: ctx.actorId,
      actorRole: ctx.actorRole ?? null,
      action: "kyc.sar.filed",
      targetType: "kyc_submission",
      targetId: submission.id,
      after: {
        sarFiledAt: now.toISOString(),
        accountFrozen: frozen,
        retentionUntil: submission.retentionUntil?.toISOString() ?? null,
      },
      reason: dto.narrative,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });

    await this.bus.publish(
      Events.FraudAlertRaised,
      {
        kind: "sar_escalation",
        severity: "critical",
        userId: submission.userId,
        submissionId: submission.id,
        accountFrozen: frozen,
      },
      { actorId: ctx.actorId },
    );

    return this.toAdminView(submission);
  }

  /* ==================================================================== *
   * Document access
   * ==================================================================== */

  /**
   * Returns a document's decrypted storage key and writes the access log.
   *
   * The log row is written BEFORE the key is returned. If the insert fails the
   * caller gets an error and no key — an unlogged read is not an option, which
   * is exactly what the AML policy requires and why this cannot live in a
   * controller.
   */
  async readDocument(
    submissionId: string,
    documentId: string,
    reason: string,
    ctx: ActorContext,
  ): Promise<DocumentAccessResponse> {
    if (!reason?.trim()) {
      throw new BadRequestException({
        message: "A reason is required to open a verification document",
        code: "ACCESS_REASON_REQUIRED",
      });
    }

    const doc = await this.documents
      .createQueryBuilder("d")
      .addSelect("d.storageKeyEnc")
      .where("d.id = :documentId", { documentId })
      .andWhere("d.submissionId = :submissionId", { submissionId })
      .getOne();

    if (!doc) throw new NotFoundException("Document not found");
    if (doc.purgedAt) {
      throw new NotFoundException({
        message: "This document has been purged under the retention policy",
        code: "DOCUMENT_PURGED",
      });
    }

    const logRow = await this.accessLog.save(
      this.accessLog.create({
        documentId: doc.id,
        actorId: ctx.actorId,
        ip: ctx.ip ?? null,
        reason: reason.trim().slice(0, 120),
      }),
    );

    await this.audit.record({
      actorId: ctx.actorId,
      actorRole: ctx.actorRole ?? null,
      action: "kyc.document.read",
      targetType: "kyc_document",
      targetId: doc.id,
      reason: reason.trim(),
      after: { submissionId, kind: doc.kind, accessLogId: logRow.id },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });

    return {
      documentId: doc.id,
      kind: doc.kind,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      sha256: doc.sha256,
      storageKey: this.crypto.decrypt(doc.storageKeyEnc),
      accessLogId: logRow.id,
    };
  }

  /** Access history for a document — what an auditor asks for first. */
  accessHistory(documentId: string): Promise<KycAccessLog[]> {
    return this.accessLog.find({
      where: { documentId },
      order: { createdAt: "DESC" },
      take: 200,
    });
  }

  /* ==================================================================== *
   * Internals
   * ==================================================================== */

  /**
   * The approval path. Raises the tier, activates the account, and announces
   * both the approval and the commission release.
   *
   * The commission release is a published event rather than a direct call: the
   * referral module owns the `pending_kyc` → `released` transition and the cap
   * arithmetic that goes with it. Reaching into it from here would put two
   * owners on the same state machine.
   */
  private async applyApproval(
    submission: KycSubmission,
    meta: {
      actorId: string | null;
      actorRole: string | null;
      reason: string;
      memberNote: string | null;
      ip: string | null;
    },
  ): Promise<void> {
    const now = new Date();
    submission.status = "approved";
    submission.reviewedById = meta.actorId;
    submission.reviewedAt = now;
    submission.reviewerNotes = meta.memberNote;
    submission.rejectionReason = null;
    submission.retentionUntil = retentionDeadline(now);
    await this.submissions.save(submission);

    const user = await this.users.findOne({ where: { id: submission.userId } });
    if (!user) throw new NotFoundException("Account not found");

    const previous = { kycTier: user.kycTier, status: user.status };

    /* Never lower a tier: a Tier 1 approval arriving late must not undo Tier 2. */
    if (submission.tier > user.kycTier) {
      user.kycTier = submission.tier;
    }

    /* A suspended, frozen or closed account is not activated by a KYC pass —
     * that decision belongs to whoever applied the restriction. */
    if (user.status === "pending_verification" || user.status === "verified_kyc_pending") {
      user.status = "active";
    }
    await this.users.save(user);

    await this.bus.publish(
      Events.KycApproved,
      {
        submissionId: submission.id,
        userId: user.id,
        tier: submission.tier,
        kycTier: user.kycTier,
        automated: meta.actorId === null,
        reviewedById: meta.actorId,
      },
      { actorId: meta.actorId ?? undefined },
    );

    if (previous.status !== user.status) {
      await this.bus.publish(
        Events.UserStatusChanged,
        { userId: user.id, from: previous.status, to: user.status, reason: "kyc_approved" },
        { actorId: meta.actorId ?? undefined },
      );
    }

    /* Releases commissions held for this recipient (FRD A-05: Tier 1 required
     * before the first commission payout). */
    await this.bus.publish(
      Events.CommissionReleased,
      {
        userId: user.id,
        recipientId: user.id,
        trigger: "kyc_approved",
        scope: "pending_kyc",
        kycTier: user.kycTier,
      },
      { actorId: meta.actorId ?? undefined },
    );
  }

  private assertDocumentSet(tier: 1 | 2, kinds: KycDocKind[]): void {
    const allowed = ALLOWED_DOCUMENTS[tier];
    const unexpected = kinds.filter((k) => !allowed.includes(k));
    if (unexpected.length) {
      throw new BadRequestException({
        message: `Document type(s) not accepted for Tier ${tier}: ${unexpected.join(", ")}`,
        code: "DOCUMENT_KIND_NOT_ACCEPTED",
      });
    }

    const duplicates = kinds.filter((k, i) => kinds.indexOf(k) !== i);
    if (duplicates.length) {
      throw new BadRequestException({
        message: `Provide one file per document type — duplicated: ${[...new Set(duplicates)].join(", ")}`,
        code: "DOCUMENT_DUPLICATED",
      });
    }

    const missing = REQUIRED_DOCUMENTS[tier].filter((k) => !kinds.includes(k));
    if (missing.length) {
      throw new BadRequestException({
        message: `Tier ${tier} requires: ${missing.join(", ")}`,
        code: "DOCUMENTS_MISSING",
        missing,
      });
    }
  }

  private toStatus(
    submission: KycSubmission,
    documentKinds: string[],
    currentKycTier: number,
  ): SubmissionStatusResponse {
    const canResubmit = ["rejected", "more_info"].includes(submission.status);
    return {
      ref: submission.ref,
      tier: submission.tier,
      status: submission.status,
      submittedAt: submission.createdAt,
      reviewedAt: submission.reviewedAt ?? null,
      /* Member-facing only. Reviewer-only commentary lives in the audit trail
       * and is not reachable from this response. */
      reviewerNotes: submission.reviewerNotes ?? null,
      rejectionReason: submission.rejectionReason ?? null,
      documents: documentKinds,
      canResubmit,
      currentKycTier,
      nextAction: this.nextAction(submission.status, canResubmit),
    };
  }

  private nextAction(status: KycStatus, canResubmit: boolean): string | null {
    if (status === "approved") return null;
    if (canResubmit) return "resubmit_documents";
    if (status === "pending") return "await_automated_check";
    return "await_review";
  }

  private async toAdminView(submission: KycSubmission): Promise<AdminSubmissionResponse> {
    const [docs, user] = await Promise.all([
      this.documents.find({ where: { submissionId: submission.id } }),
      this.users.findOne({ where: { id: submission.userId } }),
    ]);

    return {
      id: submission.id,
      ref: submission.ref,
      userId: submission.userId,
      userRef: user?.ref ?? "unknown",
      tier: submission.tier,
      status: submission.status,
      provider: submission.provider ?? null,
      providerRef: submission.providerRef ?? null,
      providerConfidence: submission.providerConfidence ?? null,
      riskScore: submission.riskScore,
      country: submission.country ?? null,
      reviewedById: submission.reviewedById ?? null,
      reviewedAt: submission.reviewedAt ?? null,
      reviewerNotes: submission.reviewerNotes ?? null,
      rejectionReason: submission.rejectionReason ?? null,
      sarFiledAt: submission.sarFiledAt ?? null,
      retentionUntil: submission.retentionUntil ?? null,
      createdAt: submission.createdAt,
      /* Metadata only. The encrypted key is never part of a list response — it
       * is only ever handed out by readDocument(), which logs the access. */
      documents: docs.map((d) => ({
        id: d.id,
        kind: d.kind,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        sha256: d.sha256,
        purgedAt: d.purgedAt ?? null,
      })),
    };
  }
}
