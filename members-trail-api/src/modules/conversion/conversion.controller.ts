import { Body, Controller, Get, Headers, HttpCode, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Idempotent, Public, RequireKyc, type AuthUser } from "@/common/decorators";
import type { Paginated } from "@/common/dto";
import { ConversionService } from "./conversion.service";
import {
  ConversionHistoryQuery, ConversionQuoteQuery, ConversionQuoteResponse, ConversionRateResponse,
  ConversionResponse, ConversionSummaryResponse, CreateConversionRequest,
} from "./dto/conversion.dto";

/* ============================================================================
 * Points → MTT conversion, player side (FRD W-02).
 *
 * KYC tier 1 is required to convert. Points are an in-game score and need no
 * identity check to earn; MTT is a transferable asset, so the moment Points
 * become MTT the account must be verified.
 * ========================================================================== */

@ApiTags("conversion")
@ApiBearerAuth()
@Controller("conversion")
export class ConversionController {
  constructor(private readonly conversion: ConversionService) {}

  @Get("rate")
  @Public()
  @ApiOperation({
    summary: "The approved conversion rate in force, plus the next scheduled one",
    description:
      "Rates are approved by a second staff member before they can take effect, and are " +
      "snapshotted onto each conversion — a later change never reprices past conversions. " +
      "Unauthenticated: the rate is a platform-wide published figure, not member data.",
  })
  @ApiOkResponse({ type: ConversionRateResponse })
  rate(): Promise<ConversionRateResponse> {
    /* Public, deliberately. The same `pointsPerMtt` is already served to anyone
     * on `/public/config` and `/public/stats`; this endpoint adds the NEXT
     * scheduled rate, which is exactly what the tokenomics page exists to
     * publish. The method it calls is named `ratePublic` for the same reason.
     * Nothing here is scoped to a member — no balance, no cap, no identity. */
    return this.conversion.ratePublic();
  }

  @Get("quote")
  @ApiOperation({
    summary: "Preview a conversion: MTT out, cap meters, and what is blocking it",
    description:
      "Always call this before submitting. MTT is truncated down, and Points beyond a whole " +
      "multiple of the rate stay in the balance rather than being burned.",
  })
  @ApiOkResponse({ type: ConversionQuoteResponse })
  quote(
    @CurrentUser() user: AuthUser,
    @Query() q: ConversionQuoteQuery,
  ): Promise<ConversionQuoteResponse> {
    return this.conversion.quote(user.id, q.points);
  }

  @Post()
  @HttpCode(201)
  @RequireKyc(1)
  @Idempotent("conversion")
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Client-generated, 8–128 chars. A retry with the same key returns the original conversion.",
  })
  @ApiOperation({
    summary: "Convert Points to MTT at the active rate",
    description:
      "Refuses rather than partially converting: if a cap or the balance allows less than " +
      "requested, the response carries the convertible amount so the client can re-quote.",
  })
  @ApiOkResponse({ type: ConversionResponse })
  convert(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateConversionRequest,
    @Headers("idempotency-key") idempotencyKey: string,
  ): Promise<ConversionResponse> {
    return this.conversion.convert(user.id, dto.points, idempotencyKey);
  }

  @Get("history")
  @ApiOperation({ summary: "Paginated conversion history with the rate applied to each" })
  history(
    @CurrentUser() user: AuthUser,
    @Query() q: ConversionHistoryQuery,
  ): Promise<Paginated<ConversionResponse>> {
    return this.conversion.history(user.id, q);
  }

  @Get("summary")
  @ApiOperation({ summary: "Lifetime Points spent, MTT received and the Points-weighted average rate" })
  @ApiOkResponse({ type: ConversionSummaryResponse })
  summary(@CurrentUser() user: AuthUser): Promise<ConversionSummaryResponse> {
    return this.conversion.summary(user.id);
  }
}
