import {
  Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClientIp, CurrentUser, StaffOnly, UserAgent, type AuthUser } from "@/common/decorators";
import type { Paginated } from "@/common/dto";
import type { KycAccessLog } from "@/database/entities";
import { KycService, type ActorContext } from "./kyc.service";
import {
  AdminSubmissionResponse, DecisionDto, DocumentAccessQuery,
  DocumentAccessResponse, EscalateSarDto, KycQueueQuery,
} from "./dto/kyc.dto";

/* ============================================================================
 * Compliance back-office for KYC.
 *
 * Scoped to the compliance role (and super_admin, which the matrix grants
 * implicitly): FRD A-05 restricts document access to Compliance, and that is
 * enforced at the route as well as logged in the service.
 * ========================================================================== */

@ApiTags("kyc")
@StaffOnly("compliance", "super_admin")
@Controller("kyc/admin")
export class KycAdminController {
  constructor(private readonly kyc: KycService) {}

  @Get("queue")
  @ApiOperation({
    summary: "Review queue, filterable by status, tier and risk (A-05)",
    description: "Sorting is restricted to an allowlist of columns.",
  })
  queue(@Query() q: KycQueueQuery): Promise<Paginated<AdminSubmissionResponse>> {
    return this.kyc.queue(q);
  }

  @Get("submissions/:id")
  @ApiOperation({ summary: "One submission with document metadata (no storage keys)" })
  @ApiOkResponse({ type: AdminSubmissionResponse })
  submission(@Param("id") id: string): Promise<AdminSubmissionResponse> {
    return this.kyc.adminSubmission(id);
  }

  @Post("submissions/:id/decision")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Approve, reject or request more information (A-05)",
    description:
      "Approval raises the member's KYC tier, activates the account and announces " +
      "the release of commissions held pending KYC. A reviewer may not decide their " +
      "own submission.",
  })
  @ApiOkResponse({ type: AdminSubmissionResponse })
  decide(
    @Param("id") id: string,
    @Body() dto: DecisionDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers("x-request-id") requestId: string | undefined,
  ): Promise<AdminSubmissionResponse> {
    return this.kyc.decide(id, dto, this.ctx(actor, ip, userAgent, requestId));
  }

  @Post("submissions/:id/escalate-sar")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "File a suspicious activity report against a submission",
    description:
      "Records the filing date and restarts the retention clock. Freezing the account " +
      "is opt-in — tipping-off rules make that a deliberate decision.",
  })
  @ApiOkResponse({ type: AdminSubmissionResponse })
  escalate(
    @Param("id") id: string,
    @Body() dto: EscalateSarDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers("x-request-id") requestId: string | undefined,
  ): Promise<AdminSubmissionResponse> {
    return this.kyc.escalateSar(id, dto, this.ctx(actor, ip, userAgent, requestId));
  }

  @Get("submissions/:id/documents/:documentId")
  @ApiOperation({
    summary: "Open a verification document",
    description:
      "Returns the decrypted object-store key. Every call writes a kyc_access_log row " +
      "with the actor, IP and the supplied reason — the reason is mandatory.",
  })
  @ApiOkResponse({ type: DocumentAccessResponse })
  readDocument(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @Query() q: DocumentAccessQuery,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers("x-request-id") requestId: string | undefined,
  ): Promise<DocumentAccessResponse> {
    return this.kyc.readDocument(id, documentId, q.reason, this.ctx(actor, ip, userAgent, requestId));
  }

  @Get("documents/:documentId/access-log")
  @ApiOperation({ summary: "Who has opened this document, most recent first" })
  accessLog(@Param("documentId") documentId: string): Promise<KycAccessLog[]> {
    return this.kyc.accessHistory(documentId);
  }

  private ctx(
    actor: AuthUser,
    ip: string,
    userAgent: string,
    requestId: string | undefined,
  ): ActorContext {
    return {
      actorId: actor.id,
      actorRole: actor.role,
      ip,
      userAgent,
      requestId: requestId ?? null,
    };
  }
}
