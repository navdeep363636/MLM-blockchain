import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  Equals, IsBoolean, IsEmail, IsEnum, IsISO31661Alpha2, IsOptional,
  IsString, IsUUID, Matches, MaxLength, MinLength,
} from "class-validator";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../auth.constants";

/* ============================================================================
 * Auth request/response shapes.
 *
 * Password strength is validated in the service, not here: the rules need the
 * account context (email, name) and produce a list of problems, which a
 * class-validator decorator cannot express usefully.
 * ========================================================================== */

export class RegisterDto {
  @ApiProperty({ example: "Ada Lovelace" })
  @IsString() @MinLength(2) @MaxLength(160)
  fullName!: string;

  @ApiProperty({ example: "ada@example.com" })
  @IsEmail({}, { message: "A valid email address is required" }) @MaxLength(320)
  email!: string;

  @ApiProperty({ example: "+441632960961", description: "E.164 format" })
  @IsString() @MaxLength(32)
  @Matches(/^\+?[1-9]\d{6,19}$/, { message: "Phone must be a valid international number" })
  phone!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString() @MinLength(PASSWORD_MIN_LENGTH) @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @ApiProperty({ example: "1994-05-17", description: "ISO date. Must be at least the jurisdiction minimum age." })
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "Date of birth must be YYYY-MM-DD" })
  dateOfBirth!: string;

  @ApiProperty({ example: "GB", description: "ISO-3166-1 alpha-2 country of residence" })
  @IsISO31661Alpha2({ message: "Country must be an ISO-3166-1 alpha-2 code" })
  country!: string;

  @ApiPropertyOptional({ example: "MTT-K3P7QX" })
  @IsOptional() @IsString() @MaxLength(32)
  referralCode?: string;

  @ApiProperty({ description: "Must be true — links to T&C, Privacy Policy and Risk Disclosure." })
  @IsBoolean() @Equals(true, { message: "You must accept the Terms, Privacy Policy and Risk Disclosure" })
  termsAccepted!: boolean;

  @ApiPropertyOptional({ example: "en" })
  @IsOptional() @IsString() @MaxLength(8)
  locale?: string;

  @ApiPropertyOptional({ example: "Europe/London" })
  @IsOptional() @IsString() @MaxLength(64)
  timezone?: string;
}

export class RegisterResponse {
  @ApiProperty() userRef!: string;
  @ApiProperty({ enum: ["pending_verification"] }) status!: string;
  @ApiProperty({ description: "Masked email the verification code was sent to" })
  email!: string;
  @ApiProperty({ description: "Masked phone the verification code was sent to" })
  phone!: string;
  @ApiProperty({ description: "Seconds until a code may be resent" }) resendAfter!: number;
  @ApiProperty({ description: "True when the signup was routed to fraud review" })
  underReview!: boolean;
  @ApiProperty() referralAttached!: boolean;
}

/* ------------------------------ verification ------------------------------ */

export type OtpChannel = "email" | "phone";

export class VerifyOtpDto {
  @ApiProperty({ enum: ["email", "phone"] })
  @IsEnum(["email", "phone"] as const)
  channel!: OtpChannel;

  @ApiProperty({ example: "482913" })
  @IsString() @Matches(/^\d{6}$/, { message: "Code must be 6 digits" })
  code!: string;

  @ApiPropertyOptional({ description: "Required when the caller is not authenticated." })
  @IsOptional() @IsString() @MaxLength(320)
  identifier?: string;
}

export class VerifyOtpResponse {
  @ApiProperty() emailVerified!: boolean;
  @ApiProperty() phoneVerified!: boolean;
  @ApiProperty() status!: string;
  @ApiProperty() nextStep!: string;
}

export class ResendOtpDto {
  @ApiProperty({ enum: ["email", "phone"] })
  @IsEnum(["email", "phone"] as const)
  channel!: OtpChannel;

  @ApiProperty({ description: "Email address or phone number the code goes to" })
  @IsString() @MaxLength(320)
  identifier!: string;
}

export class ResendOtpResponse {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ description: "Seconds until another resend is permitted" })
  resendAfter!: number;
}

/* --------------------------------- login ---------------------------------- */

export class LoginDto {
  @ApiProperty({ example: "ada@example.com", description: "Email address or phone number" })
  @IsString() @MinLength(3) @MaxLength(320)
  identifier!: string;

  @ApiProperty()
  @IsString() @MinLength(1) @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @ApiPropertyOptional({ description: "Remembers the device for a longer refresh window" })
  @IsOptional() @IsBoolean()
  rememberMe?: boolean;
}

export class TokenPair {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ description: "Access token lifetime in seconds" }) expiresIn!: number;
  @ApiProperty({ description: "Refresh token lifetime in seconds" }) refreshExpiresIn!: number;
  @ApiProperty() tokenType!: "Bearer";
  @ApiProperty() sessionId!: string;
}

export class LoginResponse {
  @ApiProperty({ description: "False when a 2FA challenge must be completed first" })
  authenticated!: boolean;

  @ApiPropertyOptional({ type: TokenPair })
  tokens?: TokenPair;

  @ApiPropertyOptional({ description: "Present when 2FA is required" })
  challengeId?: string;

  @ApiPropertyOptional({ enum: ["sms", "totp"] })
  twoFaMethod?: "sms" | "totp";

  @ApiPropertyOptional({ description: "Seconds until the challenge expires" })
  challengeExpiresIn?: number;

  @ApiPropertyOptional({ description: "Set when re-acceptance of legal documents is outstanding" })
  legalReacceptanceRequired?: boolean;

  @ApiPropertyOptional() status?: string;
  @ApiPropertyOptional() kycTier?: number;
}

export class TwoFaLoginDto {
  @ApiProperty()
  @IsUUID() challengeId!: string;

  @ApiPropertyOptional({ example: "482913" })
  @IsOptional() @IsString() @Matches(/^\d{6}$/, { message: "Code must be 6 digits" })
  code?: string;

  @ApiPropertyOptional({ description: "Single-use recovery code, when the device is lost" })
  @IsOptional() @IsString() @MaxLength(64)
  recoveryCode?: string;
}

/* -------------------------------- refresh --------------------------------- */

export class RefreshDto {
  @ApiProperty()
  @IsString() @MinLength(20) @MaxLength(200)
  refreshToken!: string;
}

/* ------------------------------- passwords -------------------------------- */

export class ForgotPasswordDto {
  @ApiProperty({ description: "Email address or phone number" })
  @IsString() @MinLength(3) @MaxLength(320)
  identifier!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString() @MinLength(20) @MaxLength(200)
  token!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH })
  @IsString() @MinLength(PASSWORD_MIN_LENGTH) @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString() @MinLength(1) @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH })
  @IsString() @MinLength(PASSWORD_MIN_LENGTH) @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword!: string;
}

/* -------------------------------- sessions -------------------------------- */

export class SessionView {
  @ApiProperty() id!: string;
  @ApiPropertyOptional() device?: string | null;
  @ApiPropertyOptional() ip?: string | null;
  @ApiPropertyOptional() location?: string | null;
  @ApiPropertyOptional() lastActiveAt?: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() expiresAt!: Date;
  @ApiProperty({ description: "True for the session making this request" })
  current!: boolean;
}

/* ---------------------------------- 2FA ----------------------------------- */

export class TwoFaSetupDto {
  @ApiPropertyOptional({ enum: ["totp", "sms"], default: "totp" })
  @IsOptional() @IsEnum(["totp", "sms"] as const)
  method?: "totp" | "sms";
}

export class TwoFaSetupResponse {
  @ApiProperty({ enum: ["totp", "sms"] }) method!: "totp" | "sms";
  @ApiPropertyOptional({ description: "otpauth:// URI for an authenticator app" })
  otpauthUri?: string;
  @ApiPropertyOptional({ description: "PNG data URL of the otpauth URI" })
  qrDataUrl?: string;
  @ApiPropertyOptional({ description: "Masked destination for the SMS code" })
  sentTo?: string;
  @ApiProperty() expiresIn!: number;
}

export class TwoFaEnableDto {
  @ApiProperty({ example: "482913" })
  @IsString() @Matches(/^\d{6}$/, { message: "Code must be 6 digits" })
  code!: string;
}

export class TwoFaEnableResponse {
  @ApiProperty({ enum: ["totp", "sms"] }) method!: "totp" | "sms";
  @ApiProperty({
    isArray: true, type: String,
    description: "Single-use recovery codes. Shown exactly once — they are stored hashed.",
  })
  recoveryCodes!: string[];
}

export class TwoFaDisableDto {
  @ApiProperty({ description: "Current account password" })
  @IsString() @MinLength(1) @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @ApiPropertyOptional({ example: "482913", description: "Current 2FA code" })
  @IsOptional() @IsString() @Matches(/^\d{6}$/, { message: "Code must be 6 digits" })
  code?: string;

  @ApiPropertyOptional({ description: "A recovery code may be used instead of the 2FA code" })
  @IsOptional() @IsString() @MaxLength(64)
  recoveryCode?: string;
}

