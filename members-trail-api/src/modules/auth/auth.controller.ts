import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Headers,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import {
  ClientIp, CurrentUser, Public, UserAgent, type AuthUser,
} from "@/common/decorators";
import { PaginationQuery, OkResponse, type Paginated } from "@/common/dto";
import type { LoginHistory } from "@/database/entities";
import { AuthService, type RequestContext } from "./auth.service";
import { TwoFactorService } from "./two-factor.service";
import {
  ChangePasswordDto, ForgotPasswordDto, LoginDto, LoginResponse, RefreshDto,
  RegisterDto, RegisterResponse, ResendOtpDto, ResendOtpResponse,
  ResetPasswordDto, SessionView, TwoFaDisableDto, TwoFaEnableDto,
  TwoFaEnableResponse, TwoFaLoginDto, TwoFaSetupDto, TwoFaSetupResponse,
  VerifyOtpDto, VerifyOtpResponse,
} from "./dto/auth.dto";

/* ============================================================================
 * Auth surface (FRD A-01 … A-04, D-03).
 *
 * Throttling: the global default (120/min) is far too generous for credential
 * endpoints, so each one carries its own limit. These are per-IP for anonymous
 * calls and per-user once authenticated — see UserThrottlerGuard.
 * ========================================================================== */

/** One minute, in the milliseconds @Throttle expects. */
const MIN = 60_000;

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFa: TwoFactorService,
  ) {}

  /* ------------------------------ registration ----------------------------- */

  @Public()
  @Post("register")
  @Throttle({ default: { limit: 5, ttl: 15 * MIN } })
  @ApiOperation({
    summary: "Register a new account (A-01)",
    description:
      "Rejects restricted jurisdictions, enforces the jurisdiction minimum age, " +
      "validates password strength against a breach list, and attaches a referral " +
      "relationship when a valid code is supplied. A signup that looks like a " +
      "self-referral is flagged for review and its commission edges are withheld.",
  })
  @ApiOkResponse({ type: RegisterResponse })
  register(
    @Body() dto: RegisterDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<RegisterResponse> {
    return this.auth.register(dto, this.context(ip, userAgent, headers));
  }

  /* ------------------------------ verification ----------------------------- */

  @Public()
  @Post("verify-otp")
  @Throttle({ default: { limit: 10, ttl: 10 * MIN } })
  @ApiOperation({
    summary: "Confirm an email or phone one-time code (A-02)",
    description:
      "Enforces the code TTL and the per-target attempt budget. When both channels " +
      "are confirmed the account moves to verified_kyc_pending.",
  })
  @ApiOkResponse({ type: VerifyOtpResponse })
  verifyOtp(
    @Body() dto: VerifyOtpDto,
    @CurrentUser() user: AuthUser | undefined,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<VerifyOtpResponse> {
    return this.auth.verifyOtp(
      dto.channel,
      dto.code,
      dto.identifier,
      user?.id,
      this.context(ip, userAgent, headers),
    );
  }

  @Public()
  @Post("resend-otp")
  @Throttle({ default: { limit: 5, ttl: 10 * MIN } })
  @ApiOperation({
    summary: "Resend a verification code (A-02)",
    description:
      "Subject to the resend cooldown. The response is identical for a known and " +
      "an unknown identifier.",
  })
  @ApiOkResponse({ type: ResendOtpResponse })
  resendOtp(
    @Body() dto: ResendOtpDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<ResendOtpResponse> {
    return this.auth.resendOtp(dto.channel, dto.identifier, this.context(ip, userAgent, headers));
  }

  /* --------------------------------- login --------------------------------- */

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 15 * MIN } })
  @ApiOperation({
    summary: "Sign in with email or phone and password (A-03)",
    description:
      "Progressive lockout after repeated failures. Every attempt is recorded in " +
      "login history, including attempts against addresses that do not exist. " +
      "Returns a 2FA challenge instead of tokens when a second factor is enrolled.",
  })
  @ApiOkResponse({ type: LoginResponse })
  login(
    @Body() dto: LoginDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<LoginResponse> {
    return this.auth.login(dto, this.context(ip, userAgent, headers));
  }

  @Public()
  @Post("login/2fa")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 15 * MIN } })
  @ApiOperation({
    summary: "Complete a two-factor sign-in challenge (A-03)",
    description: "Accepts a TOTP/SMS code, or a single-use recovery code.",
  })
  @ApiOkResponse({ type: LoginResponse })
  loginTwoFa(
    @Body() dto: TwoFaLoginDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<LoginResponse> {
    return this.auth.loginTwoFa(dto, this.context(ip, userAgent, headers));
  }

  /* -------------------------------- tokens --------------------------------- */

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 15 * MIN } })
  @ApiOperation({
    summary: "Rotate a refresh token",
    description:
      "Single-use: the presented token is retired and a new pair is issued. " +
      "Presenting a token that was already rotated is treated as a compromise — " +
      "the session family and every other session for that user are destroyed.",
  })
  @ApiOkResponse({ type: LoginResponse })
  refresh(
    @Body() dto: RefreshDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<LoginResponse> {
    return this.auth.refresh(dto.refreshToken, this.context(ip, userAgent, headers));
  }

  @ApiBearerAuth()
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Sign out of the current session",
    description: "Deletes the session key, so the outstanding access token stops working immediately.",
  })
  @ApiOkResponse({ type: OkResponse })
  logout(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<OkResponse> {
    return this.auth.logout(user.sessionId, user.id, this.context(ip, userAgent, headers));
  }

  @ApiBearerAuth()
  @Post("logout-all")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Sign out of every session on every device (D-03)" })
  @ApiOkResponse({ type: OkResponse })
  logoutAll(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<OkResponse> {
    return this.auth.logoutAll(user.id, this.context(ip, userAgent, headers));
  }

  /* ------------------------------- passwords ------------------------------- */

  @Public()
  @Post("forgot-password")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 15 * MIN } })
  @ApiOperation({
    summary: "Request a password reset link (A-04)",
    description:
      "Always returns the same response whether or not the account exists. " +
      "The link is single-use and expires in 30 minutes.",
  })
  @ApiOkResponse({ type: OkResponse })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<OkResponse> {
    return this.auth.forgotPassword(dto, this.context(ip, userAgent, headers));
  }

  @Public()
  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 15 * MIN } })
  @ApiOperation({
    summary: "Set a new password from a reset link (A-04)",
    description: "Invalidates every active session on success.",
  })
  @ApiOkResponse({ type: OkResponse })
  resetPassword(
    @Body() dto: ResetPasswordDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<OkResponse> {
    return this.auth.resetPassword(dto, this.context(ip, userAgent, headers));
  }

  @ApiBearerAuth()
  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 15 * MIN } })
  @ApiOperation({
    summary: "Change the password of the signed-in account",
    description: "Requires the current password. Signs out every other device.",
  })
  @ApiOkResponse({ type: OkResponse })
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<OkResponse> {
    return this.auth.changePassword(
      user.id,
      user.sessionId,
      dto.currentPassword,
      dto.newPassword,
      this.context(ip, userAgent, headers),
    );
  }

  /* -------------------------------- sessions ------------------------------- */

  @ApiBearerAuth()
  @Get("sessions")
  @ApiOperation({ summary: "List active sessions with device, IP and last-active (D-03)" })
  @ApiOkResponse({ type: SessionView, isArray: true })
  sessions(@CurrentUser() user: AuthUser): Promise<SessionView[]> {
    return this.auth.listSessions(user.id, user.sessionId);
  }

  @ApiBearerAuth()
  @Delete("sessions/:id")
  @ApiOperation({ summary: "Revoke one session (D-03)" })
  @ApiOkResponse({ type: OkResponse })
  revokeSession(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<OkResponse> {
    return this.auth.revokeSession(user.id, id, this.context(ip, userAgent, headers));
  }

  @ApiBearerAuth()
  @Get("login-history")
  @ApiOperation({ summary: "Paginated sign-in history for the current account (D-03)" })
  loginHistory(
    @CurrentUser() user: AuthUser,
    @Query() q: PaginationQuery,
  ): Promise<Paginated<LoginHistory>> {
    return this.auth.loginHistory(user.id, q);
  }

  /* ---------------------------------- 2FA ---------------------------------- */

  @ApiBearerAuth()
  @Post("2fa/setup")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 15 * MIN } })
  @ApiOperation({
    summary: "Begin two-factor enrolment (D-03)",
    description:
      "Returns an otpauth URI and a QR data URL for an authenticator app, or sends " +
      "an SMS code. The secret is held pending confirmation and is never returned " +
      "as a standalone value.",
  })
  @ApiOkResponse({ type: TwoFaSetupResponse })
  twoFaSetup(
    @CurrentUser() user: AuthUser,
    @Body() dto: TwoFaSetupDto,
    @ClientIp() ip: string,
  ): Promise<TwoFaSetupResponse> {
    return this.twoFa.setup(user.id, dto.method ?? "totp", ip);
  }

  @ApiBearerAuth()
  @Post("2fa/enable")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 15 * MIN } })
  @ApiOperation({
    summary: "Confirm and enable two-factor authentication (D-03)",
    description: "Returns 10 single-use recovery codes. They are shown once and stored hashed.",
  })
  @ApiOkResponse({ type: TwoFaEnableResponse })
  twoFaEnable(
    @CurrentUser() user: AuthUser,
    @Body() dto: TwoFaEnableDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<TwoFaEnableResponse> {
    return this.twoFa.enable(user.id, dto.code, { ip, userAgent });
  }

  @ApiBearerAuth()
  @Post("2fa/disable")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 15 * MIN } })
  @ApiOperation({
    summary: "Disable two-factor authentication (D-03)",
    description:
      "Requires re-authentication: the account password AND a current 2FA code " +
      "(a recovery code is accepted in its place).",
  })
  @ApiOkResponse({ type: OkResponse })
  async twoFaDisable(
    @CurrentUser() user: AuthUser,
    @Body() dto: TwoFaDisableDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<OkResponse> {
    await this.twoFa.disable(user.id, dto, { ip, userAgent });
    return { ok: true, message: "Two-factor authentication disabled" };
  }

  /* -------------------------------- helpers -------------------------------- */

  /**
   * Builds the per-request security context. Fingerprint and country come from
   * headers, which are hints only — nothing authorises on them, they feed risk
   * scoring and the jurisdiction cross-check.
   */
  private context(
    ip: string,
    userAgent: string,
    headers: Record<string, string | undefined>,
  ): RequestContext {
    const country =
      headers["cf-ipcountry"] ??
      headers["x-vercel-ip-country"] ??
      headers["x-geo-country"] ??
      headers["x-appengine-country"] ??
      null;

    return {
      ip,
      userAgent,
      device: headers["x-device-name"] ?? null,
      fingerprint: headers["x-device-fingerprint"] ?? null,
      ipCountry: country && country !== "XX" ? country : null,
      requestId: headers["x-request-id"] ?? null,
    };
  }
}
