import {
  Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Patch, Post, Put, Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ClientIp, CurrentUser, UserAgent, type AuthUser } from "@/common/decorators";
import { PaginationQuery } from "@/common/dto";
import type { RequestContext } from "@/modules/auth/auth.service";
import { UsersService } from "./users.service";
import {
  AccountDeletionRequestDto, ChangeEmailDto, ChangePhoneDto,
  ConfirmContactChangeDto, ContactChangeStartedResponse, DataExportRequestDto,
  LegalAcceptanceDto, LegalAcceptanceResponse, LifecycleRequestResponse,
  MeResponse, NotificationPreferencesResponse, SecurityOverviewResponse,
  UpdateNotificationPreferencesDto, UpdateProfileDto,
} from "./dto/users.dto";

const MIN = 60_000;

@ApiTags("users")
@ApiBearerAuth()
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /* -------------------------------- profile -------------------------------- */

  @Get("me")
  @ApiOperation({ summary: "Current account profile (D-02)" })
  @ApiOkResponse({ type: MeResponse })
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.users.me(user.id);
  }

  @Patch("me")
  @ApiOperation({
    summary: "Update display name, avatar, locale or timezone (D-02)",
    description:
      "Email and phone are NOT patchable here — they are recovery channels and " +
      "2FA destinations, so they go through the re-verification endpoints below.",
  })
  @ApiOkResponse({ type: MeResponse })
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<MeResponse> {
    return this.users.updateProfile(user.id, dto, this.context(user, ip, userAgent, headers));
  }

  /* ---------------------------- contact changes ---------------------------- */

  @Post("me/email")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 15 * MIN } })
  @ApiOperation({
    summary: "Start an email change (D-02)",
    description: "Sends a code to the NEW address. Nothing changes until it is confirmed.",
  })
  @ApiOkResponse({ type: ContactChangeStartedResponse })
  startEmailChange(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangeEmailDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<ContactChangeStartedResponse> {
    return this.users.startEmailChange(
      user.id, dto.email, this.context(user, ip, userAgent, headers),
    );
  }

  @Post("me/email/confirm")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 15 * MIN } })
  @ApiOperation({ summary: "Confirm a pending email change with the code sent to the new address" })
  @ApiOkResponse({ type: MeResponse })
  confirmEmailChange(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmContactChangeDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<MeResponse> {
    return this.users.confirmEmailChange(
      user.id, dto.code, this.context(user, ip, userAgent, headers),
    );
  }

  @Post("me/phone")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 15 * MIN } })
  @ApiOperation({
    summary: "Start a phone change (D-02)",
    description: "Sends a code to the NEW number. Nothing changes until it is confirmed.",
  })
  @ApiOkResponse({ type: ContactChangeStartedResponse })
  startPhoneChange(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePhoneDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<ContactChangeStartedResponse> {
    return this.users.startPhoneChange(
      user.id, dto.phone, this.context(user, ip, userAgent, headers),
    );
  }

  @Post("me/phone/confirm")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 15 * MIN } })
  @ApiOperation({ summary: "Confirm a pending phone change with the code sent to the new number" })
  @ApiOkResponse({ type: MeResponse })
  confirmPhoneChange(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmContactChangeDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<MeResponse> {
    return this.users.confirmPhoneChange(
      user.id, dto.code, this.context(user, ip, userAgent, headers),
    );
  }

  /* --------------------------- notification prefs -------------------------- */

  @Get("me/notification-preferences")
  @ApiOperation({
    summary: "Notification matrix (D-02)",
    description: "Security notifications are listed under alwaysOn and cannot be configured.",
  })
  @ApiOkResponse({ type: NotificationPreferencesResponse })
  preferences(@CurrentUser() user: AuthUser): Promise<NotificationPreferencesResponse> {
    return this.users.notificationPreferences(user.id);
  }

  @Put("me/notification-preferences")
  @ApiOperation({
    summary: "Update the notification matrix (D-02)",
    description:
      "Only the configurable categories are accepted. A `security` key is rejected " +
      "with a 400 — those messages are not mutable.",
  })
  @ApiOkResponse({ type: NotificationPreferencesResponse })
  updatePreferences(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateNotificationPreferencesDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<NotificationPreferencesResponse> {
    return this.users.updateNotificationPreferences(
      user.id, dto, this.context(user, ip, userAgent, headers),
    );
  }

  /* -------------------------------- security ------------------------------- */

  @Get("me/security")
  @ApiOperation({ summary: "2FA state, active sessions and paginated login history (D-03)" })
  @ApiOkResponse({ type: SecurityOverviewResponse })
  security(
    @CurrentUser() user: AuthUser,
    @Query() q: PaginationQuery,
  ): Promise<SecurityOverviewResponse> {
    return this.users.securityOverview(user.id, user.sessionId, q);
  }

  /* --------------------------- data-subject rights ------------------------- */

  @Post("me/export")
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 2, ttl: 24 * 60 * MIN } })
  @ApiOperation({
    summary: "Request a copy of your data (GDPR Art. 15)",
    description: "Creates an ops record and publishes an event; fulfilment is asynchronous.",
  })
  @ApiOkResponse({ type: LifecycleRequestResponse })
  requestExport(
    @CurrentUser() user: AuthUser,
    @Body() dto: DataExportRequestDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<LifecycleRequestResponse> {
    return this.users.requestDataExport(user.id, dto, this.context(user, ip, userAgent, headers));
  }

  @Delete("me")
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 2, ttl: 24 * 60 * MIN } })
  @ApiOperation({
    summary: "Request account deletion (GDPR Art. 17)",
    description:
      "Creates an ops record and publishes an event. Nothing is erased synchronously: " +
      "balances, in-flight withdrawals and AML retention holds are settled first.",
  })
  @ApiOkResponse({ type: LifecycleRequestResponse })
  requestDeletion(
    @CurrentUser() user: AuthUser,
    @Body() dto: AccountDeletionRequestDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<LifecycleRequestResponse> {
    return this.users.requestAccountDeletion(
      user.id, dto, this.context(user, ip, userAgent, headers),
    );
  }

  /* ------------------------------ legal versions --------------------------- */

  @Get("me/legal-acceptance")
  @ApiOperation({ summary: "Published legal documents and which versions this account accepted" })
  @ApiOkResponse({ type: LegalAcceptanceResponse })
  legalAcceptance(@CurrentUser() user: AuthUser): Promise<LegalAcceptanceResponse> {
    return this.users.legalAcceptance(user.id);
  }

  @Post("me/legal-acceptance")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Record acceptance of a published legal document version" })
  @ApiOkResponse({ type: LegalAcceptanceResponse })
  acceptLegal(
    @CurrentUser() user: AuthUser,
    @Body() dto: LegalAcceptanceDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<LegalAcceptanceResponse> {
    return this.users.acceptLegalVersion(
      user.id, dto.slug, dto.version, this.context(user, ip, userAgent, headers),
    );
  }

  /* -------------------------------- helpers -------------------------------- */

  private context(
    user: AuthUser,
    ip: string,
    userAgent: string,
    headers: Record<string, string | undefined>,
  ): RequestContext {
    return {
      ip,
      userAgent,
      device: headers["x-device-name"] ?? null,
      fingerprint: headers["x-device-fingerprint"] ?? null,
      requestId: headers["x-request-id"] ?? null,
      sessionJti: user.sessionId,
    };
  }
}
