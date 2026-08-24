import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import { CmsContent, LegalDocument } from "@/database/entities";
import { EventBusService } from "@/events";
import { AuditService } from "@/modules/audit/audit.service";
import { CmsService } from "./cms.service";

/* ============================================================================
 * Four rules, each protecting the record of what members agreed to:
 *
 *  1  publishing is four-eyes — the author cannot publish their own version
 *  2  a published version is immutable — a change is a new version
 *  3  `materialChange` forces re-acceptance, and is deliberate
 *  4  exactly one version of a slug is published at a time
 * ========================================================================== */

function repo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
    save: jest.fn(async (x: unknown) => ({
      id: "doc-1", createdAt: new Date("2026-02-01T00:00:00Z"), ...(x as object),
    })),
    create: jest.fn((x: unknown) => x),
  };
}

const REVIEWED = {
  id: "doc-1",
  slug: "terms",
  title: "Terms of Service",
  version: "2.0",
  status: "legal_review" as const,
  summary: "Updated terms",
  sections: [{ heading: "Scope", body: ["..."] }],
  materialChange: true,
  effectiveFrom: null as Date | null,
  publishedAt: null as Date | null,
  authoredById: "legal-1",
  approvedById: null as string | null,
  createdAt: new Date("2026-02-01T00:00:00Z"),
};

describe("CmsService", () => {
  let svc: CmsService;
  let legal: ReturnType<typeof repo>;
  let content: ReturnType<typeof repo>;
  let bus: { publish: jest.Mock };
  let audit: { record: jest.Mock; recordOrThrow: jest.Mock };

  beforeEach(async () => {
    legal = repo();
    content = repo();
    bus = { publish: jest.fn() };
    audit = { record: jest.fn(), recordOrThrow: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        CmsService,
        { provide: getRepositoryToken(LegalDocument), useValue: legal },
        { provide: getRepositoryToken(CmsContent), useValue: content },
        { provide: EventBusService, useValue: bus },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    svc = mod.get(CmsService);
    legal.findOne.mockResolvedValue(null);
  });

  /* ==================================================================== *
   * Rule 1 — four eyes
   * ==================================================================== */

  describe("publish — four eyes", () => {
    it("REFUSES when the publisher is the author", async () => {
      legal.findOne.mockResolvedValue({ ...REVIEWED });

      await expect(svc.publish("doc-1", "ready to go", "legal-1", null))
        .rejects.toMatchObject({ response: { code: "FOUR_EYES_VIOLATION" } });
      expect(legal.save).not.toHaveBeenCalled();
    });

    it("publishes for a different approver", async () => {
      legal.findOne.mockImplementation(async (opts: { where: Record<string, unknown> }) =>
        opts.where.id ? { ...REVIEWED } : null,
      );

      const r = await svc.publish("doc-1", "reviewed by counsel", "legal-2", null);

      expect(r.status).toBe("published");
      expect(r.approvedById).toBe("legal-2");
    });

    it("REFUSES to publish something that has not been through review", async () => {
      legal.findOne.mockResolvedValue({ ...REVIEWED, status: "draft" });
      await expect(svc.publish("doc-1", "skip the lawyers", "legal-2", null))
        .rejects.toMatchObject({ response: { code: "NOT_REVIEWED" } });
    });

    it("REFUSES to republish an already-published version", async () => {
      legal.findOne.mockResolvedValue({ ...REVIEWED, status: "published" });
      await expect(svc.publish("doc-1", "again", "legal-2", null))
        .rejects.toMatchObject({ response: { code: "ALREADY_PUBLISHED" } });
    });

    it("REFUSES to resurrect an archived version", async () => {
      legal.findOne.mockResolvedValue({ ...REVIEWED, status: "archived" });
      await expect(svc.publish("doc-1", "roll back", "legal-2", null))
        .rejects.toMatchObject({ response: { code: "VERSION_ARCHIVED" } });
    });
  });

  /* ==================================================================== *
   * Rule 2 — immutability
   * ==================================================================== */

  describe("draft — immutability", () => {
    it("REFUSES to edit a published version", async () => {
      legal.findOne.mockResolvedValue({ ...REVIEWED, status: "published" });

      await expect(
        svc.draft(
          {
            slug: "terms", title: "Terms", version: "2.0", summary: "tweaked wording",
            sections: [{ heading: "Scope", body: ["..."] }], materialChange: false,
          },
          "legal-1",
          null,
        ),
      ).rejects.toMatchObject({ response: { code: "VERSION_IMMUTABLE" } });
    });

    it("REFUSES to edit an archived version", async () => {
      legal.findOne.mockResolvedValue({ ...REVIEWED, status: "archived" });
      await expect(
        svc.draft(
          {
            slug: "terms", title: "Terms", version: "1.0", summary: "s",
            sections: [{ heading: "h", body: ["b"] }], materialChange: false,
          },
          "legal-1",
          null,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("permits revising an unpublished draft", async () => {
      legal.findOne.mockResolvedValue({ ...REVIEWED, status: "draft" });

      const r = await svc.draft(
        {
          slug: "terms", title: "Terms v2", version: "2.0", summary: "revised",
          sections: [{ heading: "Scope", body: ["new"] }], materialChange: true,
        },
        "legal-1",
        null,
      );

      expect(r.title).toBe("Terms v2");
      expect(legal.save).toHaveBeenCalled();
    });

    it("creates a new version as a draft, flagged for a second approver", async () => {
      const r = await svc.draft(
        {
          slug: "privacy", title: "Privacy Policy", version: "1.0", summary: "first version",
          sections: [{ heading: "Data", body: ["..."] }], materialChange: true,
        },
        "legal-1",
        "1.2.3.4",
      );

      expect(r.status).toBe("draft");
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ requiredSecondApproval: true }),
      );
    });
  });

  /* ==================================================================== *
   * Rule 3 — material change
   * ==================================================================== */

  describe("materialChange", () => {
    it("publishes an event that REQUIRES re-acceptance for a material change", async () => {
      legal.findOne.mockImplementation(async (opts: { where: Record<string, unknown> }) =>
        opts.where.id ? { ...REVIEWED, materialChange: true } : null,
      );

      await svc.publish("doc-1", "terms updated", "legal-2", null);

      const [, payload] = bus.publish.mock.calls[0] as [string, Record<string, unknown>];
      expect(payload.materialChange).toBe(true);
      expect(payload.requiresReacceptance).toBe(true);
    });

    it("does NOT require re-acceptance for a correction", async () => {
      legal.findOne.mockImplementation(async (opts: { where: Record<string, unknown> }) =>
        opts.where.id ? { ...REVIEWED, materialChange: false } : null,
      );

      await svc.publish("doc-1", "fixed a typo", "legal-2", null);

      const [, payload] = bus.publish.mock.calls[0] as [string, Record<string, unknown>];
      expect(payload.requiresReacceptance).toBe(false);
    });

    it("records the flag in the audit entry, since it interrupts every member", async () => {
      legal.findOne.mockImplementation(async (opts: { where: Record<string, unknown> }) =>
        opts.where.id ? { ...REVIEWED, materialChange: true } : null,
      );

      await svc.publish("doc-1", "terms updated", "legal-2", null);

      const entry = audit.recordOrThrow.mock.calls[0][0] as { after: Record<string, unknown> };
      expect(entry.after.materialChange).toBe(true);
    });
  });

  /* ==================================================================== *
   * Rule 4 — one published version
   * ==================================================================== */

  describe("publish — supersession", () => {
    it("ARCHIVES the incumbent in the same operation", async () => {
      const incumbent = { ...REVIEWED, id: "doc-0", version: "1.0", status: "published" as const };
      legal.findOne.mockImplementation(async (opts: { where: Record<string, unknown> }) =>
        opts.where.id === "doc-1" ? { ...REVIEWED } : { ...incumbent },
      );

      await svc.publish("doc-1", "v2 supersedes v1", "legal-2", null);

      expect(legal.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: "doc-0", status: "archived" }),
      );
    });

    it("names the archived version in the audit entry and the event", async () => {
      const incumbent = { ...REVIEWED, id: "doc-0", version: "1.0", status: "published" as const };
      legal.findOne.mockImplementation(async (opts: { where: Record<string, unknown> }) =>
        opts.where.id === "doc-1" ? { ...REVIEWED } : { ...incumbent },
      );

      await svc.publish("doc-1", "v2 supersedes v1", "legal-2", null);

      const entry = audit.recordOrThrow.mock.calls[0][0] as { after: Record<string, unknown> };
      expect(entry.after.archivedVersion).toBe("1.0");

      const [, payload] = bus.publish.mock.calls[0] as [string, Record<string, unknown>];
      expect(payload.archivedVersion).toBe("1.0");
    });

    it("sets an effective date when none was specified", async () => {
      legal.findOne.mockImplementation(async (opts: { where: Record<string, unknown> }) =>
        opts.where.id ? { ...REVIEWED, effectiveFrom: null } : null,
      );

      const r = await svc.publish("doc-1", "live now", "legal-2", null);

      expect(r.effectiveFrom).not.toBeNull();
      expect(r.publishedAt).not.toBeNull();
    });
  });

  describe("submitForReview", () => {
    it("moves a draft into review and asks for an approver", async () => {
      legal.findOne.mockResolvedValue({ ...REVIEWED, status: "draft" });

      const r = await svc.submitForReview("doc-1", "legal-1");

      expect(r.status).toBe("legal_review");
      const [name] = bus.publish.mock.calls[0] as [string];
      expect(name).toBe("approval.requested");
    });

    it("REFUSES anything that is not a draft", async () => {
      legal.findOne.mockResolvedValue({ ...REVIEWED, status: "published" });
      await expect(svc.submitForReview("doc-1", "legal-1")).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  /* ==================================================================== *
   * Public reads
   * ==================================================================== */

  describe("reads", () => {
    it("exposes published and archived versions as history, but not drafts", async () => {
      legal.find.mockResolvedValue([
        { ...REVIEWED, version: "2.0", status: "published" },
        { ...REVIEWED, version: "1.0", status: "archived" },
        { ...REVIEWED, version: "3.0", status: "draft" },
      ]);

      const history = await svc.documentHistory("terms");

      /* A member is entitled to see how the terms changed — and not to see an
       * unpublished draft as if it were in force. */
      expect(history.map((h) => h.version)).toEqual(["2.0", "1.0"]);
    });

    it("falls back to English rather than failing a page for a missing translation", async () => {
      content.findOne.mockImplementation(async (opts: { where: { locale: string } }) =>
        opts.where.locale === "en"
          ? { key: "home.hero", locale: "en", content: {}, status: "published", updatedAt: new Date() }
          : null,
      );

      const r = await svc.publishedContent("home.hero", "hi");

      expect(r.locale).toBe("en");
      expect(ConflictException).toBeDefined();
    });
  });
});
