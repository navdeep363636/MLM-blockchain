import {
  Body, Controller, Get, Headers, HttpCode, Post, Req,
} from "@nestjs/common";
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ClientIp, Public, StaffOnly } from "@/common/decorators";
import { WebhooksService, type InboundResult } from "./webhooks.service";

/* ============================================================================
 * Provider callbacks.
 *
 * These are @Public because a provider cannot hold a bearer token — the
 * signature IS the authentication, which is why it is verified against the raw
 * body before anything in the payload is trusted.
 *
 * They are excluded from the public Swagger document: the shapes are dictated by
 * each provider, and publishing the endpoints invites probing without helping any
 * legitimate integrator.
 * ========================================================================== */

@ApiTags("webhooks")
@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post("payment")
  @Public()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: "Payment processor callback",
    description:
      "Verified against the raw request body. Deduped on the provider's event id, then processed " +
      "on a queue — a provider that times out retries, which multiplies load exactly when the " +
      "system is already slow.",
  })
  payment(
    @Body() payload: Record<string, unknown>,
    @Headers("x-webhook-signature") signature: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
    @ClientIp() ip: string,
  ): Promise<InboundResult> {
    return this.webhooks.receive({
      provider: "payment",
      /* The exact bytes received, or null. Re-serialising the parsed body would
       * compare a different string to the one the provider signed, so a missing
       * raw body is reported as its own failure rather than papered over — the
       * alternative is every delivery failing with a misleading
       * "signature invalid". */
      rawBody: req.rawBody?.toString("utf8") ?? null,
      signature,
      payload,
      sourceIp: ip,
    });
  }

  @Post("kyc")
  @Public()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: "KYC provider callback" })
  kyc(
    @Body() payload: Record<string, unknown>,
    @Headers("x-webhook-signature") signature: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
    @ClientIp() ip: string,
  ): Promise<InboundResult> {
    return this.webhooks.receive({
      provider: "kyc",
      rawBody: req.rawBody?.toString("utf8") ?? null,
      signature,
      payload,
      sourceIp: ip,
    });
  }
}

/* ============================================================================
 * Webhook operations.
 * ========================================================================== */

@ApiTags("admin: webhooks")
@StaffOnly("super_admin")
@Controller("admin/webhooks")
export class WebhooksAdminController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get("status")
  @ApiOperation({
    summary: "Webhook health",
    description:
      "Rejected signatures make this unhealthy deliberately: it is either our misconfiguration or " +
      "someone probing, and both need looking at.",
  })
  status() {
    return this.webhooks.status();
  }

  @Get("inbound/unprocessed")
  @ApiOperation({ summary: "Verified deliveries that have not been processed yet" })
  unprocessed() {
    return this.webhooks.unprocessed();
  }

  @Get("inbound/rejected")
  @ApiOperation({ summary: "Deliveries whose signature failed verification" })
  rejected() {
    return this.webhooks.rejected();
  }

  @Get("outbound/due")
  @ApiOperation({ summary: "Outbound deliveries whose retry is due" })
  due() {
    return this.webhooks.dueForRetry();
  }
}
