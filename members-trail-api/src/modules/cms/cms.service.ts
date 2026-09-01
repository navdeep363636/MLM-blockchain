import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CmsContent, LegalDocument } from "@/database/entities";
import { EventBusService, Events } from "@/events";
import { AuditService } from "@/modules/audit/audit.service";
import type {
  CmsContentResponse, DraftLegalRequest, LegalDocumentResponse, UpsertCmsRequest,
} from "./dto/cms.dto";

/* ============================================================================
 * Legal documents and CMS content (FRD AD-11).
 *
 * The rules, and why they are rules:
 *
 *  1. PUBLISHING IS FOUR-EYES. The author cannot publish their own version. A
 *     legal document defines what the platform may do with a member's money and
 *     data; one account should not be able to change that alone.
 *
 *  2. A PUBLISHED VERSION IS IMMUTABLE. Editing the terms people already agreed
 *     to, in place, destroys the only record of what they agreed to. A change is
 *     a new version; the old one is archived and stays readable.
 *
 *  3. `materialChange` IS DELIBERATE AND EXPLICIT. True forces every member to
 *     re-accept before continuing — right for a change in obligations, and an
 *     unjustifiable interruption for a typo. The author states which it is and
 *     the audit trail records it.
 *
 *  4. ONLY ONE VERSION OF A SLUG IS PUBLISHED AT A TIME. Publishing archives the
 *     incumbent in the same operation, so there is never a moment where two sets
 *     of terms are both in force.
 * ========================================================================== */

@Injectable()
export class CmsService {
  private readonly log = new Logger(CmsService.name);

  constructor(
    @InjectRepository(LegalDocument) private readonly legal: Repository<LegalDocument>,
    @InjectRepository(CmsContent) private readonly content: Repository<CmsContent>,
    private readonly bus: EventBusService,
    private readonly audit: AuditService,
  ) {}

  /* ==================================================================== *
   * Public reads
   * ==================================================================== */

  /** Every currently published legal document. */
  async publishedDocuments(): Promise<LegalDocumentResponse[]> {
    const rows = await this.legal.find({
      where: { status: "published" },
      order: { slug: "ASC" },
    });
    return rows.map(toLegalView);
  }

  /** The published version of one document. */
  async publishedDocument(slug: string): Promise<LegalDocumentResponse> {
    const row = await this.legal.findOne({ where: { slug, status: "published" } });
    if (!row) throw new NotFoundException("No published version of this document");
    return toLegalView(row);
  }

  /**
   * The full version history of a slug.
   *
   * Public on purpose: a member is entitled to see how the terms they agreed to
   * have changed over time, and hiding the history would make rule 2 pointless.
   */
  async documentHistory(slug: string): Promise<LegalDocumentResponse[]> {
    const rows = await this.legal.find({
      where: { slug },
      order: { createdAt: "DESC" },
      take: 100,
    });
    return rows
      .filter((r) => r.status === "published" || r.status === "archived")
      .map(toLegalView);
  }

  async publishedContent(key: string, locale = "en"): Promise<CmsContentResponse> {
    const row = await this.content.findOne({ where: { key, locale, status: "published" } });
    if (!row) {
      /* Fall back to English rather than 404-ing a page because one locale is
       * missing a translation. */
      const fallback = await this.content.findOne({ where: { key, locale: "en", status: "published" } });
      if (!fallback) throw new NotFoundException("Content not found");
      return toContentView(fallback);
    }
    return toContentView(row);
  }

  /* ==================================================================== *
   * Authoring
   * ==================================================================== */

  /**
   * Creates a draft version.
   *
   * A slug+version pair is unique, so re-drafting an existing version is refused
   * rather than silently overwriting a version someone may already have reviewed.
   */
  async draft(dto: DraftLegalRequest, actorId: string, ip: string | null): Promise<LegalDocumentResponse> {
    const existing = await this.legal.findOne({ where: { slug: dto.slug, version: dto.version } });
    if (existing) {
      if (existing.status === "published" || existing.status === "archived") {
        /* Rule 2. */
        throw new ForbiddenException({
          code: "VERSION_IMMUTABLE",
          message:
            `Version ${dto.version} of ${dto.slug} is ${existing.status} and cannot be edited. ` +
            "Draft a new version instead.",
        });
      }
      /* An unpublished draft may still be revised. */
      existing.title = dto.title;
      existing.summary = dto.summary;
      existing.sections = dto.sections;
      existing.materialChange = dto.materialChange;
      existing.effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : null;
      const updated = await this.legal.save(existing);

      await this.audit.recordOrThrow({
        actorId,
        action: "legal.draft.update",
        targetType: "legal_document",
        targetId: updated.id,
        after: { slug: dto.slug, version: dto.version, materialChange: dto.materialChange },
        ip,
      });

      return toLegalView(updated);
    }

    const row = await this.legal.save(
      this.legal.create({
        slug: dto.slug,
        title: dto.title,
        version: dto.version,
        status: "draft",
        summary: dto.summary,
        sections: dto.sections,
        materialChange: dto.materialChange,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
        authoredById: actorId,
      }),
    );

    await this.audit.recordOrThrow({
      actorId,
      action: "legal.draft.create",
      targetType: "legal_document",
      targetId: row.id,
      after: { slug: dto.slug, version: dto.version, materialChange: dto.materialChange },
      ip,
      requiredSecondApproval: true,
    });

    return toLegalView(row);
  }

  /** Moves a draft into legal review. */
  async submitForReview(id: string, actorId: string): Promise<LegalDocumentResponse> {
    const row = await this.legal.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Document not found");
    if (row.status !== "draft") {
      throw new BadRequestException({
        code: "NOT_DRAFT",
        message: `This version is ${row.status} and cannot be submitted for review`,
      });
    }

    row.status = "legal_review";
    await this.legal.save(row);

    await this.audit.recordOrThrow({
      actorId,
      action: "legal.submit_review",
      targetType: "legal_document",
      targetId: row.id,
      after: { status: "legal_review" },
      requiredSecondApproval: true,
    });

    await this.bus.publish(Events.ApprovalRequested, {
      kind: "legal_publish",
      targetId: row.id,
      requestedById: actorId,
      summary: `${row.slug} v${row.version}${row.materialChange ? " (material change)" : ""}`,
    });

    return toLegalView(row);
  }

  /**
   * Publishes a reviewed version.
   *
   * Rule 1: refuses when the publisher authored it. Rule 4: archives the
   * incumbent in the same operation. Rule 3: a material change publishes an
   * event that forces re-acceptance.
   */
  async publish(
    id: string,
    reason: string,
    actorId: string,
    ip: string | null,
  ): Promise<LegalDocumentResponse> {
    const row = await this.legal.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Document not found");

    if (row.status === "published") {
      throw new ConflictException({
        code: "ALREADY_PUBLISHED",
        message: "This version is already published",
      });
    }
    if (row.status === "archived") {
      throw new ConflictException({
        code: "VERSION_ARCHIVED",
        message: "An archived version cannot be republished. Draft a new version.",
      });
    }
    if (row.status !== "legal_review") {
      throw new BadRequestException({
        code: "NOT_REVIEWED",
        message: "A version must go through legal review before it can be published",
      });
    }
    if (row.authoredById && row.authoredById === actorId) {
      throw new ForbiddenException({
        code: "FOUR_EYES_VIOLATION",
        message:
          "A legal document must be published by someone other than its author — it defines what " +
          "the platform may do with members' money and data",
      });
    }

    /* Rule 4: exactly one published version per slug, always. */
    const incumbent = await this.legal.findOne({ where: { slug: row.slug, status: "published" } });
    if (incumbent && incumbent.id !== row.id) {
      incumbent.status = "archived";
      await this.legal.save(incumbent);
    }

    row.status = "published";
    row.publishedAt = new Date();
    row.approvedById = actorId;
    row.effectiveFrom = row.effectiveFrom ?? new Date();
    await this.legal.save(row);

    await this.audit.recordOrThrow({
      actorId,
      action: "legal.publish",
      targetType: "legal_document",
      targetId: row.id,
      before: incumbent ? { version: incumbent.version, status: "published" } : null,
      after: {
        slug: row.slug, version: row.version, status: "published",
        /* Recorded explicitly: this is what interrupts every member's next login. */
        materialChange: row.materialChange,
        archivedVersion: incumbent?.version ?? null,
      },
      reason,
      ip,
      approvedById: actorId,
    });

    await this.bus.publish(Events.LegalVersionPublished, {
      slug: row.slug,
      version: row.version,
      materialChange: row.materialChange,
      effectiveFrom: row.effectiveFrom.toISOString(),
      archivedVersion: incumbent?.version ?? null,
      /* Consumers use this to decide whether to force re-acceptance. */
      requiresReacceptance: row.materialChange,
    });

    this.log.log(
      `published ${row.slug} v${row.version}` +
      `${row.materialChange ? " — MATERIAL CHANGE, re-acceptance required" : ""}`,
    );

    return toLegalView(row);
  }

  /** Every version of every document, for the authoring UI. */
  async allVersions(slug?: string): Promise<LegalDocumentResponse[]> {
    const rows = await this.legal.find({
      where: slug ? { slug } : {},
      order: { slug: "ASC", createdAt: "DESC" },
      take: 500,
    });
    return rows.map(toLegalView);
  }

  /* ==================================================================== *
   * CMS content
   * ==================================================================== */

  async listContent(): Promise<CmsContentResponse[]> {
    const rows = await this.content.find({ order: { key: "ASC" }, take: 1_000 });
    return rows.map(toContentView);
  }

  async upsertContent(
    dto: UpsertCmsRequest,
    actorId: string,
    ip: string | null,
  ): Promise<CmsContentResponse> {
    const locale = dto.locale ?? "en";
    const existing = await this.content.findOne({ where: { key: dto.key, locale } });
    const before = existing ? { status: existing.status } : null;

    const row = existing ?? this.content.create({ key: dto.key, locale });
    row.content = dto.content;
    row.status = dto.status;
    row.updatedById = actorId;
    const saved = await this.content.save(row);

    await this.audit.recordOrThrow({
      actorId,
      action: existing ? "cms.content.update" : "cms.content.create",
      targetType: "cms_content",
      targetId: saved.id,
      before,
      after: { key: dto.key, locale, status: dto.status },
      reason: dto.reason,
      ip,
    });

    return toContentView(saved);
  }
}

/* --------------------------------- helpers -------------------------------- */

function toLegalView(d: LegalDocument): LegalDocumentResponse {
  return {
    id: d.id,
    slug: d.slug,
    title: d.title,
    version: d.version,
    status: d.status,
    summary: d.summary,
    sections: d.sections,
    materialChange: d.materialChange,
    effectiveFrom: d.effectiveFrom ? d.effectiveFrom.toISOString() : null,
    publishedAt: d.publishedAt ? d.publishedAt.toISOString() : null,
    authoredById: d.authoredById ?? null,
    approvedById: d.approvedById ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function toContentView(c: CmsContent): CmsContentResponse {
  return {
    key: c.key,
    locale: c.locale,
    content: c.content,
    status: c.status,
    updatedAt: c.updatedAt.toISOString(),
  };
}
