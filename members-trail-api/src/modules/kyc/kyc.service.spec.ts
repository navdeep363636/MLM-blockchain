import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import {
  KycAccessLog, KycDocument, KycSubmission, User, WebhookEvent,
} from "@/database/entities";
import { CryptoService } from "@/common/crypto/crypto.service";
import { EventBusService, Events } from "@/events";
import { webhookConfig } from "@/config/configuration";
import { AuditService } from "@/modules/audit/audit.service";
import { KycService } from "./kyc.service";
import { AUTO_APPROVE_CONFIDENCE, AML_RETENTION_YEARS } from "./kyc.constants";
import type { CreateSubmissionDto } from "./dto/kyc.dto";

/* ============================================================================
 * KYC decisions, document-access logging and the provider callback.
 * ========================================================================== */

const SECRET = "kyc-webhook-secret";

function repoMock<T extends object>(rows: T[] = []) {
  return {
    rows,
    create: jest.fn((x: unknown) => (Array.isArray(x) ? x.map((i) => ({ ...i })) : { ...(x as object) })),
    save: jest.fn(async (x: unknown) => {
      const list = Array.isArray(x) ? x : [x];
      for (const item of list as Record<string, unknown>[]) {
        if (!item.id) item.id = `id-${rows.length + 1}`;
        if (!item.createdAt) item.createdAt = new Date();
        const i = rows.findIndex((r) => (r as Record<string, unknown>).id === item.id);
        if (i >= 0) rows[i] = item as T;
        else rows.push(item as T);
      }
      return Array.isArray(x) ? list : list[0];
    }),
    findOne: jest.fn(async (): Promise<T | null> => null),
    find: jest.fn(async (): Promise<T[]> => []),
  };
}

const TIER1_DOCS: CreateSubmissionDto = {
  tier: 1,
  documents: [
    { kind: "id_front", storageKey: "kyc/u1/front.jpg", mimeType: "image/jpeg", sizeBytes: 1_000, sha256: "a".repeat(64) },
    { kind: "id_back", storageKey: "kyc/u1/back.jpg", mimeType: "image/jpeg", sizeBytes: 1_000, sha256: "b".repeat(64) },
    { kind: "selfie", storageKey: "kyc/u1/selfie.jpg", mimeType: "image/jpeg", sizeBytes: 1_000, sha256: "c".repeat(64) },
  ],
};

describe("KycService", () => {
  let service: KycService;
  let submissions: ReturnType<typeof repoMock<KycSubmission>>;
  let documents: ReturnType<typeof repoMock<KycDocument>>;
  let accessLog: ReturnType<typeof repoMock<KycAccessLog>>;
  let users: ReturnType<typeof repoMock<User>>;
  let webhooks: ReturnType<typeof repoMock<WebhookEvent>>;
  let bus: { publish: jest.Mock };
  let audit: { record: jest.Mock; recordOrThrow: jest.Mock };
  let docQueryBuilder: { addSelect: jest.Mock; where: jest.Mock; andWhere: jest.Mock; getOne: jest.Mock };

  const member = (overrides: Partial<User> = {}): User => ({
    id: "u1",
    ref: "USR-MEMBER",
    country: "GB",
    kycTier: 0,
    riskScore: 10,
    status: "verified_kyc_pending",
    emailVerifiedAt: new Date(),
    phoneVerifiedAt: new Date(),
    ...overrides,
  }) as User;

  beforeEach(async () => {
    submissions = repoMock<KycSubmission>([]);
    documents = repoMock<KycDocument>([]);
    accessLog = repoMock<KycAccessLog>([]);
    users = repoMock<User>([]);
    webhooks = repoMock<WebhookEvent>([]);
    bus = { publish: jest.fn(async () => undefined) };
    audit = {
      record: jest.fn(async () => undefined),
      recordOrThrow: jest.fn(async () => undefined),
    };

    docQueryBuilder = {
      addSelect: jest.fn(() => docQueryBuilder),
      where: jest.fn(() => docQueryBuilder),
      andWhere: jest.fn(() => docQueryBuilder),
      getOne: jest.fn(async (): Promise<Partial<KycDocument> | null> => null),
    };
    (documents as unknown as { createQueryBuilder: jest.Mock }).createQueryBuilder =
      jest.fn(() => docQueryBuilder);

    const moduleRef = await Test.createTestingModule({
      providers: [
        KycService,
        { provide: getRepositoryToken(KycSubmission), useValue: submissions },
        { provide: getRepositoryToken(KycDocument), useValue: documents },
        { provide: getRepositoryToken(KycAccessLog), useValue: accessLog },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(WebhookEvent), useValue: webhooks },
        {
          provide: CryptoService,
          useValue: {
            encrypt: jest.fn((v: string) => `enc(${v})`),
            decrypt: jest.fn((v: string) => v.replace(/^enc\(/, "").replace(/\)$/, "")),
            verifyWebhookSignature: jest.fn(
              (secret: string, _payload: string, sig: string) => secret === SECRET && sig === "good",
            ),
          },
        },
        { provide: EventBusService, useValue: bus },
        { provide: AuditService, useValue: audit },
        { provide: webhookConfig.KEY, useValue: { kycSecret: SECRET } },
      ],
    }).compile();

    service = moduleRef.get(KycService);
  });

  /* ==================================================================== *
   * Submission
   * ==================================================================== */

  describe("submit", () => {
    const ctx = { actorId: "u1", ip: "1.2.3.4", userAgent: "jest" };

    it("encrypts each document's storage key and never stores it in the clear", async () => {
      users.findOne.mockResolvedValueOnce(member());

      const res = await service.submit("u1", TIER1_DOCS, ctx);

      expect(res.status).toBe("pending");
      expect(documents.rows).toHaveLength(3);
      for (const doc of documents.rows) {
        expect(doc.storageKeyEnc).toMatch(/^enc\(/);
      }
      /* No column holds the raw key verbatim — only the ciphertext. */
      for (const doc of documents.rows) {
        expect(Object.values(doc)).not.toContain("kyc/u1/front.jpg");
      }
      expect(bus.publish).toHaveBeenCalledWith(
        Events.KycSubmitted,
        expect.objectContaining({ tier: 1, userId: "u1" }),
        expect.anything(),
      );
    });

    it("sets a retention deadline at submission time", async () => {
      users.findOne.mockResolvedValueOnce(member());

      await service.submit("u1", TIER1_DOCS, ctx);

      const until = submissions.rows[0].retentionUntil as Date;
      const years = until.getUTCFullYear() - new Date().getUTCFullYear();
      expect(years).toBe(AML_RETENTION_YEARS);
    });

    it("refuses before the contact channels are verified", async () => {
      users.findOne.mockResolvedValueOnce(member({ phoneVerifiedAt: null }));

      await expect(service.submit("u1", TIER1_DOCS, ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "CONTACT_NOT_VERIFIED" }),
      });
      expect(documents.rows).toHaveLength(0);
    });

    it("refuses an incomplete Tier 1 document set", async () => {
      users.findOne.mockResolvedValueOnce(member());

      await expect(
        service.submit("u1", { ...TIER1_DOCS, documents: [TIER1_DOCS.documents[0]] }, ctx),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "DOCUMENTS_MISSING" }),
      });
    });

    it("refuses Tier 2 before Tier 1 is held", async () => {
      users.findOne.mockResolvedValueOnce(member({ kycTier: 0 }));

      await expect(
        service.submit(
          "u1",
          {
            tier: 2,
            documents: [
              {
                kind: "address_proof", storageKey: "kyc/u1/bill.pdf",
                mimeType: "application/pdf", sizeBytes: 2_000, sha256: "d".repeat(64),
              },
            ],
          },
          ctx,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "TIER1_REQUIRED" }),
      });
    });
  });

  /* ==================================================================== *
   * Decision
   * ==================================================================== */

  describe("decide", () => {
    const reviewer = { actorId: "staff-1", actorRole: "compliance", ip: "10.0.0.1" };

    beforeEach(() => {
      submissions.findOne.mockResolvedValue({
        id: "sub-1", ref: "KYC-1", userId: "u1", tier: 1,
        status: "in_review", riskScore: 10,
      } as KycSubmission);
    });

    it("approval raises the tier, activates the account and announces the release", async () => {
      const user = member();
      users.findOne.mockResolvedValue(user);

      await service.decide("sub-1", { decision: "approve", internalNotes: "docs match" }, reviewer);

      expect(user.kycTier).toBe(1);
      expect(user.status).toBe("active");

      expect(bus.publish).toHaveBeenCalledWith(
        Events.KycApproved,
        expect.objectContaining({ userId: "u1", tier: 1 }),
        expect.anything(),
      );
      /* Commissions held pending KYC are released by the referral module in
       * response to this event — this module does not reach into it. */
      expect(bus.publish).toHaveBeenCalledWith(
        Events.CommissionReleased,
        expect.objectContaining({ recipientId: "u1", scope: "pending_kyc" }),
        expect.anything(),
      );
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ action: "kyc.decision.approve" }),
      );
    });

    it("does not activate a frozen account on approval", async () => {
      const user = member({ status: "frozen" });
      users.findOne.mockResolvedValue(user);

      await service.decide("sub-1", { decision: "approve" }, reviewer);

      expect(user.kycTier).toBe(1);
      expect(user.status).toBe("frozen");
    });

    it("never lowers an existing tier", async () => {
      const user = member({ kycTier: 2 });
      users.findOne.mockResolvedValue(user);

      await service.decide("sub-1", { decision: "approve" }, reviewer);

      expect(user.kycTier).toBe(2);
    });

    it("keeps reviewer-only notes out of the submission row", async () => {
      users.findOne.mockResolvedValue(member());

      await service.decide(
        "sub-1",
        {
          decision: "reject",
          notes: "The ID photo is too blurry to read.",
          internalNotes: "Matches a known document-farm template.",
        },
        reviewer,
      );

      const row = submissions.rows[0];
      expect(row.reviewerNotes).toBe("The ID photo is too blurry to read.");
      expect(JSON.stringify(row)).not.toContain("document-farm");
      /* The internal note exists — in the audit trail, which members cannot read. */
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          after: expect.objectContaining({ internalNotes: "Matches a known document-farm template." }),
        }),
      );
    });

    it("requires a member-facing note when rejecting", async () => {
      await expect(
        service.decide("sub-1", { decision: "reject" }, reviewer),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "MEMBER_NOTE_REQUIRED" }),
      });
    });

    it("refuses to let a reviewer decide their own submission", async () => {
      await expect(
        service.decide("sub-1", { decision: "approve" }, { actorId: "u1" }),
      ).rejects.toThrow(ForbiddenException);

      expect(bus.publish).not.toHaveBeenCalled();
    });

    it("refuses to re-decide a closed submission", async () => {
      submissions.findOne.mockResolvedValue({
        id: "sub-1", userId: "u1", tier: 1, status: "approved", riskScore: 0,
      } as KycSubmission);

      await expect(
        service.decide("sub-1", { decision: "reject", notes: "changed my mind" }, reviewer),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "SUBMISSION_ALREADY_DECIDED" }),
      });
    });
  });

  /* ==================================================================== *
   * Document access
   * ==================================================================== */

  describe("readDocument", () => {
    const ctx = { actorId: "staff-1", actorRole: "compliance", ip: "10.0.0.1" };

    beforeEach(() => {
      docQueryBuilder.getOne.mockResolvedValue({
        id: "doc-1",
        kind: "id_front",
        mimeType: "image/jpeg",
        sizeBytes: 1_000,
        sha256: "a".repeat(64),
        storageKeyEnc: "enc(kyc/u1/front.jpg)",
        purgedAt: null,
      });
    });

    it("writes an access-log row before handing back the storage key", async () => {
      const res = await service.readDocument("sub-1", "doc-1", "manual review of KYC-1", ctx);

      expect(res.storageKey).toBe("kyc/u1/front.jpg");
      expect(accessLog.rows).toHaveLength(1);
      expect(accessLog.rows[0]).toMatchObject({
        documentId: "doc-1",
        actorId: "staff-1",
        ip: "10.0.0.1",
        reason: "manual review of KYC-1",
      });
      expect(res.accessLogId).toBe(accessLog.rows[0].id);
    });

    it("refuses without a reason, and logs nothing", async () => {
      await expect(
        service.readDocument("sub-1", "doc-1", "   ", ctx),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "ACCESS_REASON_REQUIRED" }),
      });

      expect(accessLog.rows).toHaveLength(0);
      expect(docQueryBuilder.getOne).not.toHaveBeenCalled();
    });

    it("returns no key when the log write fails — an unlogged read is not an option", async () => {
      accessLog.save.mockRejectedValueOnce(new Error("insert failed"));

      await expect(
        service.readDocument("sub-1", "doc-1", "manual review of KYC-1", ctx),
      ).rejects.toThrow("insert failed");
    });

    it("refuses a document that has been purged under the retention policy", async () => {
      docQueryBuilder.getOne.mockResolvedValue({
        id: "doc-1", kind: "id_front", mimeType: "image/jpeg", sizeBytes: 1,
        sha256: "a".repeat(64), storageKeyEnc: "enc(x)", purgedAt: new Date(),
      });

      await expect(
        service.readDocument("sub-1", "doc-1", "manual review", ctx),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "DOCUMENT_PURGED" }),
      });

      expect(accessLog.rows).toHaveLength(0);
    });
  });

  /* ==================================================================== *
   * Provider callback
   * ==================================================================== */

  describe("handleProviderCallback", () => {
    const payload = {
      eventId: "evt-1",
      submissionRef: "KYC-1",
      outcome: "approved" as const,
      confidence: 96,
    };

    beforeEach(() => {
      submissions.findOne.mockResolvedValue({
        id: "sub-1", ref: "KYC-1", userId: "u1", tier: 1,
        status: "pending", riskScore: 5,
      } as KycSubmission);
      users.findOne.mockResolvedValue(member());
    });

    it("rejects an invalid signature but still records the delivery", async () => {
      await expect(
        service.handleProviderCallback(payload, "{}", "bad", "203.0.113.9"),
      ).rejects.toThrow(UnauthorizedException);

      /* Recorded regardless: a stream of bad signatures is the signal that
       * someone is probing the endpoint. */
      expect(webhooks.rows).toHaveLength(1);
      expect(webhooks.rows[0].signatureValid).toBe(false);
    });

    it("rejects a missing signature", async () => {
      await expect(
        service.handleProviderCallback(payload, "{}", undefined, null),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("auto-approves above the confidence threshold", async () => {
      const res = await service.handleProviderCallback(payload, "{}", "good", null);

      expect(res.status).toBe("approved");
      expect(submissions.rows[0].status).toBe("approved");
      expect(bus.publish).toHaveBeenCalledWith(
        Events.KycApproved,
        expect.objectContaining({ automated: true }),
        expect.anything(),
      );
    });

    it("routes an ambiguous result to manual review instead of approving it", async () => {
      const res = await service.handleProviderCallback(
        { ...payload, confidence: AUTO_APPROVE_CONFIDENCE - 1 },
        "{}",
        "good",
        null,
      );

      expect(res.status).toBe("in_review");
      expect(submissions.rows[0].status).toBe("in_review");
      expect(bus.publish).not.toHaveBeenCalledWith(
        Events.KycApproved,
        expect.anything(),
        expect.anything(),
      );
    });

    it("auto-rejects only on a decisively low confidence", async () => {
      const res = await service.handleProviderCallback(
        { ...payload, outcome: "rejected", confidence: 5, reason: "document is a photocopy" },
        "{}",
        "good",
        null,
      );

      expect(res.status).toBe("rejected");
      expect(submissions.rows[0].rejectionReason).toBe("document is a photocopy");
    });

    it("acknowledges a replayed delivery without processing it twice", async () => {
      webhooks.save.mockRejectedValueOnce(new Error("ER_DUP_ENTRY"));

      const res = await service.handleProviderCallback(payload, "{}", "good", null);

      expect(res).toEqual({ ok: true, status: "duplicate", replayed: true });
      expect(bus.publish).not.toHaveBeenCalled();
    });

    it("does not re-open a submission that was already decided", async () => {
      submissions.findOne.mockResolvedValue({
        id: "sub-1", ref: "KYC-1", userId: "u1", tier: 1,
        status: "rejected", riskScore: 5,
      } as KycSubmission);

      const res = await service.handleProviderCallback(payload, "{}", "good", null);

      expect(res).toMatchObject({ status: "rejected", replayed: true });
      expect(bus.publish).not.toHaveBeenCalled();
    });
  });

  /* ==================================================================== *
   * SAR escalation
   * ==================================================================== */

  describe("escalateSar", () => {
    const officer = { actorId: "staff-1", actorRole: "compliance", ip: "10.0.0.1" };
    const narrative = "Structuring pattern across three linked accounts, see case notes.";

    beforeEach(() => {
      submissions.findOne.mockResolvedValue({
        id: "sub-1", ref: "KYC-1", userId: "u1", tier: 1,
        status: "in_review", riskScore: 80,
      } as KycSubmission);
    });

    it("records the filing and restarts the retention clock", async () => {
      const before = new Date();
      await service.escalateSar("sub-1", { narrative }, officer);

      const row = submissions.rows[0];
      expect(row.sarFiledAt).toBeInstanceOf(Date);
      expect((row.retentionUntil as Date).getUTCFullYear()).toBe(
        before.getUTCFullYear() + AML_RETENTION_YEARS,
      );
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ action: "kyc.sar.filed", reason: narrative }),
      );
    });

    it("does not freeze the account unless asked", async () => {
      const user = member();
      users.findOne.mockResolvedValue(user);

      await service.escalateSar("sub-1", { narrative }, officer);

      expect(user.status).not.toBe("frozen");
      expect(bus.publish).not.toHaveBeenCalledWith(
        Events.AccountFrozen,
        expect.anything(),
        expect.anything(),
      );
    });

    it("freezes with a non-specific reason when asked, to respect tipping-off rules", async () => {
      const user = member();
      users.findOne.mockResolvedValue(user);

      await service.escalateSar("sub-1", { narrative, freezeAccount: true }, officer);

      expect(user.status).toBe("frozen");
      expect(user.statusReason).toBe("Compliance review in progress");
      expect(user.statusReason).not.toMatch(/sar|suspicious/i);
    });

    it("refuses a second filing for the same submission", async () => {
      submissions.findOne.mockResolvedValue({
        id: "sub-1", userId: "u1", tier: 1, status: "in_review",
        riskScore: 80, sarFiledAt: new Date(),
      } as KycSubmission);

      await expect(
        service.escalateSar("sub-1", { narrative }, officer),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "SAR_ALREADY_FILED" }),
      });
    });
  });

  /* ==================================================================== *
   * Member-facing status
   * ==================================================================== */

  it("member status omits internal detail and reports the next action", async () => {
    submissions.findOne.mockResolvedValue({
      id: "sub-1", ref: "KYC-1", userId: "u1", tier: 1, status: "more_info",
      riskScore: 40, reviewerNotes: "Please resend the back of your ID.",
      providerConfidence: 40, providerRef: "prov-9",
    } as KycSubmission);
    users.findOne.mockResolvedValue(member());
    documents.find.mockResolvedValue([{ kind: "id_front" } as KycDocument]);

    const res = await service.mySubmission("u1");

    expect(res).toMatchObject({
      status: "more_info",
      reviewerNotes: "Please resend the back of your ID.",
      canResubmit: true,
      nextAction: "resubmit_documents",
    });
    /* Provider internals and risk scoring are not member-facing. */
    expect(res as unknown as Record<string, unknown>).not.toHaveProperty("riskScore");
    expect(res as unknown as Record<string, unknown>).not.toHaveProperty("providerConfidence");
  });

  it("returns null when nothing has ever been submitted", async () => {
    submissions.findOne.mockResolvedValue(null);
    expect(await service.mySubmission("u1")).toBeNull();
  });
});
