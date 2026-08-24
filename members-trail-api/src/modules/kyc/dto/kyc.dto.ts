import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber,
  IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength,
  ValidateNested,
} from "class-validator";
import { DateRangeQuery } from "@/common/dto";
import type { KycDocKind, KycStatus } from "@/database/entities";
import { ALLOWED_MIME_TYPES, MAX_DOCUMENT_BYTES } from "../kyc.constants";

/* ============================================================================
 * KYC request/response shapes (FRD A-05).
 *
 * Note what the client sends for a document: an object-store key, not bytes.
 * Files are uploaded straight to storage with a presigned URL, so this API never
 * carries a 15 MB image, and the key it is given is encrypted before it is
 * stored.
 * ========================================================================== */

export class KycDocumentInput {
  @ApiProperty({ enum: ["id_front", "id_back", "selfie", "address_proof", "source_of_funds"] })
  @IsIn(["id_front", "id_back", "selfie", "address_proof", "source_of_funds"])
  kind!: KycDocKind;

  @ApiProperty({ description: "Object-store key returned by the presigned upload" })
  @IsString() @MinLength(8) @MaxLength(500)
  storageKey!: string;

  @ApiProperty({ enum: ALLOWED_MIME_TYPES })
  @IsIn([...ALLOWED_MIME_TYPES])
  mimeType!: string;

  @ApiProperty({ maximum: MAX_DOCUMENT_BYTES })
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_DOCUMENT_BYTES)
  sizeBytes!: number;

  @ApiProperty({ description: "SHA-256 of the uploaded bytes, hex" })
  @IsString() @Matches(/^[a-f0-9]{64}$/, { message: "sha256 must be 64 lowercase hex characters" })
  sha256!: string;
}

export class CreateSubmissionDto {
  @ApiProperty({ enum: [1, 2], description: "1 = basic, 2 = enhanced" })
  @Type(() => Number) @IsInt() @IsIn([1, 2])
  tier!: 1 | 2;

  @ApiProperty({ type: KycDocumentInput, isArray: true })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8)
  @ValidateNested({ each: true }) @Type(() => KycDocumentInput)
  documents!: KycDocumentInput[];

  @ApiPropertyOptional({ description: "Overrides the country on file when the ID is foreign" })
  @IsOptional() @IsString() @MaxLength(2) @MinLength(2)
  documentCountry?: string;
}

export class SubmissionStatusResponse {
  @ApiProperty() ref!: string;
  @ApiProperty({ enum: [1, 2] }) tier!: number;
  @ApiProperty({ enum: ["pending", "in_review", "approved", "rejected", "more_info"] })
  status!: KycStatus;
  @ApiProperty() submittedAt!: Date;
  @ApiPropertyOptional() reviewedAt?: Date | null;
  @ApiPropertyOptional({ description: "Reviewer note written for the member. Internal notes are never returned here." })
  reviewerNotes?: string | null;
  @ApiPropertyOptional() rejectionReason?: string | null;
  @ApiProperty({ isArray: true, type: String, description: "Kinds of document on file" })
  documents!: string[];
  @ApiProperty({ description: "Can the member submit again right now" })
  canResubmit!: boolean;
  @ApiProperty() currentKycTier!: number;
  @ApiPropertyOptional() nextAction?: string | null;
}

/* --------------------------------- webhook -------------------------------- */

export class ProviderCallbackDto {
  @ApiProperty({ description: "Provider's own event id — the replay dedupe key" })
  @IsString() @MaxLength(191)
  eventId!: string;

  @ApiProperty({ description: "Our submission reference, echoed back by the provider" })
  @IsString() @MaxLength(64)
  submissionRef!: string;

  @ApiProperty({ enum: ["approved", "rejected", "review", "expired"] })
  @IsIn(["approved", "rejected", "review", "expired"])
  outcome!: "approved" | "rejected" | "review" | "expired";

  @ApiProperty({ minimum: 0, maximum: 100 })
  @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  confidence!: number;

  @ApiPropertyOptional({ description: "Provider-side reference for the check" })
  @IsOptional() @IsString() @MaxLength(128)
  providerRef?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100)
  riskScore?: number;

  @ApiPropertyOptional({ maxLength: 2 })
  @IsOptional() @IsString() @MaxLength(2)
  country?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ description: "Raw provider detail, retained on the webhook record" })
  @IsOptional() @IsObject()
  details?: Record<string, unknown>;
}

/* ---------------------------------- admin --------------------------------- */

export class KycQueueQuery extends DateRangeQuery {
  @ApiPropertyOptional({ enum: ["pending", "in_review", "approved", "rejected", "more_info"] })
  @IsOptional() @IsIn(["pending", "in_review", "approved", "rejected", "more_info"])
  status?: KycStatus;

  @ApiPropertyOptional({ enum: [1, 2] })
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([1, 2])
  tier?: 1 | 2;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, description: "Only submissions at or above this risk score" })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100)
  minRisk?: number;

  @ApiPropertyOptional({ description: "Only submissions with a SAR already filed" })
  @IsOptional() @Type(() => Boolean) @IsBoolean()
  sarFiled?: boolean;
}

export class DecisionDto {
  @ApiProperty({ enum: ["approve", "reject", "more_info"] })
  @IsIn(["approve", "reject", "more_info"])
  decision!: "approve" | "reject" | "more_info";

  @ApiPropertyOptional({
    description: "Note shown to the member. Required for reject and more_info.",
  })
  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({
    description: "Reviewer-only note. Written to the audit trail, never returned to the member.",
  })
  @IsOptional() @IsString() @MaxLength(2000)
  internalNotes?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, description: "Reviewer's risk score override" })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100)
  riskScore?: number;
}

export class EscalateSarDto {
  @ApiProperty({ description: "Grounds for the report. Mandatory — a SAR without a narrative is not filable." })
  @IsString() @MinLength(20) @MaxLength(4000)
  narrative!: string;

  @ApiPropertyOptional({
    description:
      "Freeze the member's funds alongside the filing. Off by default: " +
      "tipping-off rules mean an account action is a deliberate decision, not a side effect.",
    default: false,
  })
  @IsOptional() @IsBoolean()
  freezeAccount?: boolean;
}

export class DocumentAccessQuery {
  @ApiProperty({
    description:
      "Why this document is being opened. Mandatory: it is written to the " +
      "append-only KYC access log alongside the actor and IP.",
  })
  @IsString() @MinLength(8) @MaxLength(120)
  reason!: string;
}

export class DocumentAccessResponse {
  @ApiProperty() documentId!: string;
  @ApiProperty() kind!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty() sha256!: string;
  @ApiProperty({ description: "Decrypted object-store key. Access has been logged." })
  storageKey!: string;
  @ApiProperty() accessLogId!: string;
}

export class AdminSubmissionResponse {
  @ApiProperty() id!: string;
  @ApiProperty() ref!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() userRef!: string;
  @ApiProperty({ enum: [1, 2] }) tier!: number;
  @ApiProperty() status!: string;
  @ApiPropertyOptional() provider?: string | null;
  @ApiPropertyOptional() providerRef?: string | null;
  @ApiPropertyOptional() providerConfidence?: number | null;
  @ApiProperty() riskScore!: number;
  @ApiPropertyOptional() country?: string | null;
  @ApiPropertyOptional() reviewedById?: string | null;
  @ApiPropertyOptional() reviewedAt?: Date | null;
  @ApiPropertyOptional() reviewerNotes?: string | null;
  @ApiPropertyOptional() rejectionReason?: string | null;
  @ApiPropertyOptional() sarFiledAt?: Date | null;
  @ApiPropertyOptional() retentionUntil?: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ isArray: true })
  documents!: {
    id: string;
    kind: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    purgedAt: Date | null;
  }[];
}
