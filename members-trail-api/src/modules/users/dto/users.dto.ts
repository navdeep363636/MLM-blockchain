import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUrl, Matches, MaxLength,
  MinLength, ValidateNested,
} from "class-validator";

/* ============================================================================
 * Profile, preferences and account-lifecycle shapes (FRD D-02, D-03).
 * ========================================================================== */

/** Notification categories a user may configure. `security` is deliberately
 *  absent: those messages are always delivered (see NotificationPreference). */
export const CONFIGURABLE_NOTIFICATION_KINDS = [
  "transaction", "kyc", "reward", "commission", "tournament", "system", "promo",
] as const;

export type ConfigurableNotificationKind = (typeof CONFIGURABLE_NOTIFICATION_KINDS)[number];

export class MeResponse {
  @ApiProperty() ref!: string;
  @ApiProperty() email!: string;
  @ApiProperty() emailVerified!: boolean;
  @ApiPropertyOptional() phone?: string | null;
  @ApiProperty() phoneVerified!: boolean;
  @ApiProperty() fullName!: string;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional() avatarUrl?: string | null;
  @ApiProperty() country!: string;
  @ApiProperty() locale!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty() status!: string;
  @ApiProperty() kycTier!: number;
  @ApiProperty() role!: string;
  @ApiProperty() referralCode!: string;
  @ApiProperty() referralDepth!: number;
  @ApiPropertyOptional() lastLoginAt?: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ description: "Legal document versions this account has accepted" })
  acceptedLegalVersions!: Record<string, string>;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60)
  displayName?: string;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional() @IsUrl({ protocols: ["https"], require_protocol: true }) @MaxLength(512)
  avatarUrl?: string;

  @ApiPropertyOptional({ example: "en" })
  @IsOptional() @IsString() @Matches(/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/, {
    message: "Locale must be a BCP-47 tag such as en or en-GB",
  }) @MaxLength(8)
  locale?: string;

  @ApiPropertyOptional({ example: "Europe/London" })
  @IsOptional() @IsString() @MaxLength(64)
  timezone?: string;
}

/* --------------------------- contact change flow -------------------------- */

export class ChangeEmailDto {
  @ApiProperty({ description: "The new email address. A code is sent to it before anything changes." })
  @IsEmail() @MaxLength(320)
  email!: string;
}

export class ChangePhoneDto {
  @ApiProperty({ description: "The new phone number in E.164 format." })
  @IsString() @MaxLength(32)
  @Matches(/^\+?[1-9]\d{6,19}$/, { message: "Phone must be a valid international number" })
  phone!: string;
}

export class ConfirmContactChangeDto {
  @ApiProperty({ example: "482913" })
  @IsString() @Matches(/^\d{6}$/, { message: "Code must be 6 digits" })
  code!: string;
}

export class ContactChangeStartedResponse {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ description: "Masked destination the verification code was sent to" })
  sentTo!: string;
  @ApiProperty() resendAfter!: number;
  @ApiProperty({ description: "Nothing changes on the account until this code is confirmed" })
  pending!: boolean;
}

/* --------------------------- notification matrix -------------------------- */

export class ChannelToggleDto {
  @ApiProperty() @IsBoolean() email!: boolean;
  @ApiProperty() @IsBoolean() sms!: boolean;
  @ApiProperty() @IsBoolean() push!: boolean;
}

/**
 * Every configurable category is declared explicitly. With the global
 * `forbidNonWhitelisted` pipe this is what makes a "security" key a 400 rather
 * than something the service has to remember to strip.
 */
export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({ type: ChannelToggleDto })
  @IsOptional() @ValidateNested() @Type(() => ChannelToggleDto)
  transaction?: ChannelToggleDto;

  @ApiPropertyOptional({ type: ChannelToggleDto })
  @IsOptional() @ValidateNested() @Type(() => ChannelToggleDto)
  kyc?: ChannelToggleDto;

  @ApiPropertyOptional({ type: ChannelToggleDto })
  @IsOptional() @ValidateNested() @Type(() => ChannelToggleDto)
  reward?: ChannelToggleDto;

  @ApiPropertyOptional({ type: ChannelToggleDto })
  @IsOptional() @ValidateNested() @Type(() => ChannelToggleDto)
  commission?: ChannelToggleDto;

  @ApiPropertyOptional({ type: ChannelToggleDto })
  @IsOptional() @ValidateNested() @Type(() => ChannelToggleDto)
  tournament?: ChannelToggleDto;

  @ApiPropertyOptional({ type: ChannelToggleDto })
  @IsOptional() @ValidateNested() @Type(() => ChannelToggleDto)
  system?: ChannelToggleDto;

  @ApiPropertyOptional({ type: ChannelToggleDto })
  @IsOptional() @ValidateNested() @Type(() => ChannelToggleDto)
  promo?: ChannelToggleDto;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  marketingOptIn?: boolean;
}

export class NotificationPreferencesResponse {
  @ApiProperty({ description: "Per-category channel matrix" })
  channels!: Record<string, { email: boolean; sms: boolean; push: boolean }>;

  @ApiProperty() marketingOptIn!: boolean;

  @ApiProperty({
    isArray: true, type: String,
    description: "Categories that are always delivered and cannot be muted",
  })
  alwaysOn!: string[];
}

/* -------------------------------- security -------------------------------- */

export class SecurityOverviewResponse {
  @ApiProperty({ enum: ["none", "sms", "totp"] }) twoFaMethod!: string;
  @ApiPropertyOptional() twoFaEnabledAt?: Date | null;
  @ApiProperty({ description: "Unused single-use recovery codes remaining" })
  recoveryCodesRemaining!: number;
  @ApiPropertyOptional() passwordChangedAt?: Date | null;
  @ApiProperty({ isArray: true }) sessions!: unknown[];
  @ApiProperty({ description: "Paginated sign-in history" }) loginHistory!: unknown;
}

/* --------------------------- account lifecycle ---------------------------- */

export class DataExportRequestDto {
  @ApiPropertyOptional({ enum: ["json", "csv"], default: "json" })
  @IsOptional() @IsIn(["json", "csv"])
  format?: "json" | "csv";
}

export class AccountDeletionRequestDto {
  @ApiPropertyOptional({ maxLength: 500, description: "Optional reason, retained for the ops record" })
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;

  @ApiProperty({ description: "Must be true — deletion requests are irreversible once processed" })
  @IsBoolean()
  confirm!: boolean;
}

export class LifecycleRequestResponse {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ description: "Reference of the ops record created for this request" })
  reference!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ description: "When the request is due to be fulfilled" })
  dueAt!: Date;
  @ApiProperty() message!: string;
}

/* ------------------------------ legal versions ---------------------------- */

export class LegalAcceptanceDto {
  @ApiProperty({ example: "terms", description: "Document slug" })
  @IsString() @MaxLength(64)
  slug!: string;

  @ApiProperty({ example: "2.1" })
  @IsString() @MaxLength(20)
  version!: string;
}

export class LegalAcceptanceView {
  @ApiProperty() slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty() currentVersion!: string;
  @ApiPropertyOptional() acceptedVersion?: string | null;
  @ApiProperty() upToDate!: boolean;
  @ApiProperty({ description: "True when the published change requires re-acceptance" })
  reacceptanceRequired!: boolean;
}

export class LegalAcceptanceResponse {
  @ApiProperty({ type: LegalAcceptanceView, isArray: true })
  documents!: LegalAcceptanceView[];

  @ApiProperty() allAccepted!: boolean;
}
