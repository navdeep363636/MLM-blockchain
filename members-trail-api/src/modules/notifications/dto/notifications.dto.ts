import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength,
} from "class-validator";
import { Type } from "class-transformer";
import { PaginationQuery } from "@/common/dto";
import type { NotificationKind } from "@/database/entities";

/* ============================================================================
 * Notification DTOs (FRD N-01).
 *
 * The preferences response deliberately exposes `alwaysDelivered`. A UI that
 * renders a mute toggle for security alerts would be promising something the
 * platform will not honour, so the API states the exception rather than leaving
 * the client to discover it.
 * ========================================================================== */

export const NOTIFICATION_KINDS: NotificationKind[] = [
  "transaction", "security", "kyc", "reward", "commission", "tournament", "system", "promo",
];

export class NotificationResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: NOTIFICATION_KINDS }) kind!: NotificationKind;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiPropertyOptional({ nullable: true, description: "Deep link into the app" }) href!: string | null;
  @ApiProperty() read!: boolean;
  @ApiPropertyOptional({ nullable: true }) readAt!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional({ nullable: true }) data!: Record<string, unknown> | null;
}

export class NotificationListQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: NOTIFICATION_KINDS })
  @IsOptional() @IsIn(NOTIFICATION_KINDS)
  kind?: NotificationKind;

  @ApiPropertyOptional({ default: false })
  @IsOptional() @Type(() => Boolean) @IsBoolean()
  unreadOnly?: boolean;
}

export class MarkReadRequest {
  @ApiProperty({ type: [String], description: "Notification ids to mark read" })
  @IsArray() @ArrayMaxSize(500) @IsUUID(undefined, { each: true })
  ids!: string[];
}

export class ChannelPreference {
  @ApiProperty() @IsBoolean() email!: boolean;
  @ApiProperty() @IsBoolean() sms!: boolean;
  @ApiProperty() @IsBoolean() push!: boolean;
}

export class UpdatePreferencesRequest {
  @ApiProperty({
    description:
      "Per-kind channel settings. Unknown kinds and `security` are ignored rather than stored — " +
      "storing them would imply the platform honours them.",
    example: { transaction: { email: true, sms: false, push: true } },
  })
  @IsObject()
  channels!: Record<string, { email: boolean; sms: boolean; push: boolean }>;

  @ApiPropertyOptional({ description: "Consent for promotional messages" })
  @IsOptional() @IsBoolean()
  marketingOptIn?: boolean;
}

export class PreferencesResponse {
  @ApiProperty({ description: "Per-kind channel settings for the kinds that can be muted" })
  channels!: Record<string, { email: boolean; sms: boolean; push: boolean }>;
  @ApiProperty() marketingOptIn!: boolean;
  @ApiProperty({
    type: [String],
    description: "Kinds that are always delivered and cannot be muted",
  })
  alwaysDelivered!: string[];
  @ApiProperty() note!: string;
}

export class UnreadCountResponse {
  @ApiProperty() unread!: number;
  @ApiProperty({ description: "Unread counts per kind" }) byKind!: Record<string, number>;
}

/* --------------------------------- admin ---------------------------------- */

export class BroadcastRequest {
  @ApiProperty({ type: [String], description: "Recipient user ids" })
  @IsArray() @ArrayMaxSize(10_000) @IsUUID(undefined, { each: true })
  userIds!: string[];

  @ApiProperty({ enum: ["system", "promo"], description: "Broadcasts are limited to these kinds" })
  @IsIn(["system", "promo"] as const)
  kind!: "system" | "promo";

  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200)
  title!: string;

  @ApiProperty() @IsString() @MinLength(3) @MaxLength(2_000)
  body!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300)
  href?: string;

  @ApiProperty({ description: "Reason recorded in the audit trail" })
  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}
