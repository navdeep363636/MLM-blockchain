import { Body, Controller, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  ClientIp, CurrentUser, Public, RequirePermissions, StaffOnly, type AuthUser,
} from "@/common/decorators";
import { CmsService } from "./cms.service";
import {
  CmsContentResponse, DraftLegalRequest, LegalDocumentResponse, PublishLegalRequest,
  UpsertCmsRequest,
} from "./dto/cms.dto";

/* ============================================================================
 * Legal documents and CMS content, public side (FRD AD-11).
 *
 * The version history is public deliberately: a member is entitled to see how
 * the terms they agreed to have changed, and an immutable version record that
 * nobody can read is not a record.
 * ========================================================================== */

@ApiTags("legal")
@Controller("legal")
export class CmsController {
  constructor(private readonly cms: CmsService) {}

  @Get("documents")
  @Public()
  @ApiOperation({ summary: "Every currently published legal document" })
  @ApiOkResponse({ type: [LegalDocumentResponse] })
  documents(): Promise<LegalDocumentResponse[]> {
    return this.cms.publishedDocuments();
  }

  @Get("documents/:slug")
  @Public()
  @ApiOperation({ summary: "The published version of one document" })
  @ApiOkResponse({ type: LegalDocumentResponse })
  document(@Param("slug") slug: string): Promise<LegalDocumentResponse> {
    return this.cms.publishedDocument(slug);
  }

  @Get("documents/:slug/history")
  @Public()
  @ApiOperation({
    summary: "Published and archived versions of a document, newest first",
    description: "A published version is never edited in place — a change is a new version.",
  })
  @ApiOkResponse({ type: [LegalDocumentResponse] })
  history(@Param("slug") slug: string): Promise<LegalDocumentResponse[]> {
    return this.cms.documentHistory(slug);
  }

  @Get("content/:key")
  @Public()
  @ApiOperation({
    summary: "Published CMS content by key",
    description: "Falls back to English rather than failing a page for a missing translation.",
  })
  @ApiOkResponse({ type: CmsContentResponse })
  content(
    @Param("key") key: string,
    @Query("locale") locale?: string,
  ): Promise<CmsContentResponse> {
    return this.cms.publishedContent(key, locale ?? "en");
  }
}

/* ============================================================================
 * Legal and CMS administration.
 *
 * Publishing is four-eyes: the author cannot publish their own version.
 * ========================================================================== */

@ApiTags("admin: legal")
@StaffOnly("compliance", "super_admin")
@Controller("admin/legal")
export class CmsAdminController {
  constructor(private readonly cms: CmsService) {}

  @Get("documents")
  @ApiOperation({ summary: "Every version of every document, including drafts" })
  @ApiOkResponse({ type: [LegalDocumentResponse] })
  all(@Query("slug") slug?: string): Promise<LegalDocumentResponse[]> {
    return this.cms.allVersions(slug);
  }

  @Post("documents")
  @RequirePermissions("legal:write")
  @ApiOperation({
    summary: "Create or revise a draft version",
    description:
      "A published or archived version is immutable — editing the terms people agreed to would " +
      "destroy the record of what they agreed to.",
  })
  @ApiOkResponse({ type: LegalDocumentResponse })
  draft(
    @Body() dto: DraftLegalRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<LegalDocumentResponse> {
    return this.cms.draft(dto, actor.id, ip);
  }

  @Patch("documents/:id/submit-review")
  @RequirePermissions("legal:write")
  @ApiOperation({ summary: "Submit a draft for legal review" })
  @ApiOkResponse({ type: LegalDocumentResponse })
  submit(
    @Param("id") id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<LegalDocumentResponse> {
    return this.cms.submitForReview(id, actor.id);
  }

  @Patch("documents/:id/publish")
  @RequirePermissions("legal:approve")
  @ApiOperation({
    summary: "Publish a reviewed version",
    description:
      "Refuses when the publisher is the author. Archives the incumbent in the same operation, so " +
      "two sets of terms are never in force at once. A material change forces every member to " +
      "re-accept.",
  })
  @ApiOkResponse({ type: LegalDocumentResponse })
  publish(
    @Param("id") id: string,
    @Body() dto: PublishLegalRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<LegalDocumentResponse> {
    return this.cms.publish(id, dto.reason, actor.id, ip);
  }

  @Get("content")
  @ApiOperation({ summary: "All CMS content including drafts" })
  @ApiOkResponse({ type: [CmsContentResponse] })
  content(): Promise<CmsContentResponse[]> {
    return this.cms.listContent();
  }

  @Put("content")
  @RequirePermissions("cms:write")
  @ApiOperation({ summary: "Create or update a CMS entry" })
  @ApiOkResponse({ type: CmsContentResponse })
  upsert(
    @Body() dto: UpsertCmsRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<CmsContentResponse> {
    return this.cms.upsertContent(dto, actor.id, ip);
  }
}
