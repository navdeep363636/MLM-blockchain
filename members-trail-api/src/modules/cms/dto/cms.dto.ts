import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsISO8601, IsIn, IsObject, IsOptional,
  IsString, MaxLength, MinLength, ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

/* ============================================================================
 * Legal and CMS DTOs (FRD AD-11).
 *
 * `materialChange` is the field that matters. Setting it forces every member to
 * re-accept the document before continuing — which is the correct behaviour for a
 * change to the terms, and an unjustifiable interruption for a typo fix. It is
 * therefore explicit, required, and audited.
 * ========================================================================== */

export class LegalSection {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200)
  heading!: string;

  @ApiProperty({ type: [String] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({ each: true })
  body!: string[];
}

export class LegalDocumentResponse {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty() version!: string;
  @ApiProperty({ enum: ["draft", "legal_review", "published", "archived"] })
  status!: "draft" | "legal_review" | "published" | "archived";
  @ApiProperty() summary!: string;
  @ApiProperty({ type: [LegalSection] }) sections!: { heading: string; body: string[] }[];
  @ApiProperty({ description: "True when publication forces every member to re-accept" })
  materialChange!: boolean;
  @ApiPropertyOptional({ nullable: true }) effectiveFrom!: string | null;
  @ApiPropertyOptional({ nullable: true }) publishedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) authoredById!: string | null;
  @ApiPropertyOptional({ nullable: true }) approvedById!: string | null;
  @ApiProperty() createdAt!: string;
}

export class DraftLegalRequest {
  @ApiProperty({ description: "Stable identifier, e.g. \"terms\", \"privacy\", \"aml-policy\"" })
  @IsString() @MinLength(2) @MaxLength(64)
  slug!: string;

  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200)
  title!: string;

  @ApiProperty({ description: "Human version label, e.g. \"2.1\"" })
  @IsString() @MinLength(1) @MaxLength(20)
  version!: string;

  @ApiProperty() @IsString() @MinLength(10) @MaxLength(2_000)
  summary!: string;

  @ApiProperty({ type: [LegalSection] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => LegalSection)
  sections!: LegalSection[];

  @ApiProperty({
    description:
      "True when the change alters the deal a member agreed to. Forces re-acceptance on next " +
      "login. Use false only for corrections that change no obligation.",
  })
  @IsBoolean()
  materialChange!: boolean;

  @ApiPropertyOptional({ description: "When the version takes effect" })
  @IsOptional() @IsISO8601()
  effectiveFrom?: string;
}

export class PublishLegalRequest {
  @ApiProperty({ description: "Why this version is being published. Audited." })
  @IsString() @MinLength(10) @MaxLength(1_000)
  reason!: string;
}

export class CmsContentResponse {
  @ApiProperty() key!: string;
  @ApiProperty() locale!: string;
  @ApiProperty() content!: unknown;
  @ApiProperty({ enum: ["draft", "published"] }) status!: "draft" | "published";
  @ApiProperty() updatedAt!: string;
}

export class UpsertCmsRequest {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120)
  key!: string;

  @ApiPropertyOptional({ default: "en" })
  @IsOptional() @IsString() @MaxLength(8)
  locale?: string;

  @ApiProperty({ description: "Arbitrary JSON payload for the surface that renders it" })
  @IsObject()
  content!: Record<string, unknown>;

  @ApiProperty({ enum: ["draft", "published"] })
  @IsIn(["draft", "published"])
  status!: "draft" | "published";

  @ApiProperty({ description: "Reason recorded in the audit trail" })
  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}
