import {
  Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Req,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ClientIp, CurrentUser, Public, UserAgent, type AuthUser } from "@/common/decorators";
import { KycService } from "./kyc.service";
import {
  CreateSubmissionDto, ProviderCallbackDto, SubmissionStatusResponse,
} from "./dto/kyc.dto";

const MIN = 60_000;

@ApiTags("kyc")
@Controller("kyc")
export class KycController {
  constructor(private readonly kyc: KycService) {}

  /* ------------------------------- member ---------------------------------- */

  @ApiBearerAuth()
  @Post("submissions")
  @Throttle({ default: { limit: 5, ttl: 60 * MIN } })
  @ApiOperation({
    summary: "Submit documents for Tier 1 or Tier 2 verification (A-05)",
    description:
      "Documents are uploaded to object storage with a presigned URL; this endpoint " +
      "records their keys, encrypted. Tier 2 requires Tier 1 to be in place.",
  })
  @ApiOkResponse({ type: SubmissionStatusResponse })
  submit(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSubmissionDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers("x-request-id") requestId: string | undefined,
  ): Promise<SubmissionStatusResponse> {
    return this.kyc.submit(user.id, dto, {
      actorId: user.id,
      actorRole: user.role,
      ip,
      userAgent,
      requestId: requestId ?? null,
    });
  }

  @ApiBearerAuth()
  @Get("submissions/me")
  @ApiOperation({
    summary: "Current verification status (A-05)",
    description:
      "Returns the member-facing reviewer note and rejection reason. Reviewer-only " +
      "internal notes are never included — they live in the audit trail.",
  })
  @ApiOkResponse({ type: SubmissionStatusResponse })
  mine(@CurrentUser() user: AuthUser): Promise<SubmissionStatusResponse | null> {
    return this.kyc.mySubmission(user.id);
  }

  /* ------------------------------- webhook --------------------------------- */

  @Public()
  @Post("webhook/provider-callback")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 120, ttl: MIN } })
  @ApiOperation({
    summary: "KYC provider result callback",
    description:
      "HMAC-SHA256 signed over the raw request body with KYC_WEBHOOK_SECRET, in the " +
      "`x-kyc-signature` header. Results above the confidence threshold are approved " +
      "automatically; anything ambiguous is routed to manual review.",
  })
  providerCallback(
    @Body() dto: ProviderCallbackDto,
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-kyc-signature") signature: string | undefined,
    @ClientIp() ip: string,
  ): Promise<{ ok: boolean; status: string; replayed?: boolean }> {
    /* Signed over the exact bytes received. Falling back to a re-serialised body
     * would make verification depend on the provider's JSON formatting. */
    const raw = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(dto);
    return this.kyc.handleProviderCallback(dto, raw, signature, ip);
  }
}
