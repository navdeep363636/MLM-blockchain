import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
} from "class-validator";
import { PaginationQuery } from "@/common/dto";
import type { FraudAlertKind, FraudAlertStatus, FraudSeverity } from "@/database/entities";

/* ============================================================================
 * Fraud DTOs (FRD AD-14).
 *
 * `signals` and `evidence` are part of the contract, not debugging extras. An
 * alert a reviewer cannot disagree with is not a reviewable alert — it is an
 * instruction, and freezing a member's funds on an instruction nobody can
 * evaluate is how a platform harms innocent people.
 * ========================================================================== */

export const FRAUD_KINDS: FraudAlertKind[] = [
  "velocity", "structuring", "self_referral_ring", "bot_farming",
  "multi_account", "device_cluster", "impossible_travel", "cap_hugging",
];
export const FRAUD_SEVERITIES: FraudSeverity[] = ["low", "medium", "high", "critical"];
export const FRAUD_STATUSES: FraudAlertStatus[] = ["open", "investigating", "actioned", "dismissed"];

export class AlertResponse {
  @ApiProperty() ref!: string;
  @ApiProperty({ enum: FRAUD_KINDS }) kind!: FraudAlertKind;
  @ApiProperty({ enum: FRAUD_SEVERITIES }) severity!: FraudSeverity;
  @ApiProperty({ description: "0–100, advisory context for review — not a verdict" })
  riskScore!: number;
  @ApiProperty({ type: [String] }) affectedUserIds!: string[];
  @ApiProperty() summary!: string;
  @ApiProperty({ type: [String], description: "The specific signals that fired" })
  signals!: string[];
  @ApiPropertyOptional({ nullable: true, description: "Supporting data a reviewer can check" })
  evidence!: Record<string, unknown> | null;
  @ApiProperty({ enum: FRAUD_STATUSES }) status!: FraudAlertStatus;
  @ApiPropertyOptional({ nullable: true }) assigneeId!: string | null;
  @ApiPropertyOptional({ nullable: true }) resolutionNote!: string | null;
  @ApiPropertyOptional({ nullable: true }) resolvedAt!: string | null;
  @ApiProperty() createdAt!: string;
}

export class AlertQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: FRAUD_STATUSES })
  @IsOptional() @IsIn(FRAUD_STATUSES)
  status?: FraudAlertStatus;

  @ApiPropertyOptional({ enum: FRAUD_KINDS })
  @IsOptional() @IsIn(FRAUD_KINDS)
  kind?: FraudAlertKind;

  @ApiPropertyOptional({ enum: FRAUD_SEVERITIES })
  @IsOptional() @IsIn(FRAUD_SEVERITIES)
  severity?: FraudSeverity;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  assigneeId?: string;
}

export class AssignAlertRequest {
  @ApiProperty() @IsUUID()
  assigneeId!: string;
}

export class ResolveAlertRequest {
  @ApiProperty({
    enum: ["action", "dismiss"],
    description: "A dismissal is a decision too: it says the platform looked and found nothing wrong.",
  })
  @IsIn(["action", "dismiss"])
  decision!: "action" | "dismiss";

  @ApiProperty({ description: "Required for both outcomes, and audited" })
  @IsString() @MinLength(10) @MaxLength(2_000)
  note!: string;

  @ApiPropertyOptional({
    default: false,
    description: "Freeze the affected accounts. Holds their funds — use deliberately.",
  })
  @IsOptional() @IsBoolean()
  freezeAccounts?: boolean;
}

export class FraudRuleResponse {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: FRAUD_KINDS }) kind!: FraudAlertKind;
  @ApiProperty({ description: "Thresholds, e.g. { windowMinutes: 60, maxWithdrawals: 5 }" })
  thresholds!: Record<string, number>;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({
    description: "When true this rule can hold a member's funds with no human decision",
  })
  autoFreeze!: boolean;
  @ApiProperty() baseRiskScore!: number;
}

export class UpsertRuleRequest {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(64)
  code!: string;

  @ApiProperty() @IsString() @MinLength(3) @MaxLength(160)
  name!: string;

  @ApiProperty() @IsString() @MinLength(10) @MaxLength(2_000)
  description!: string;

  @ApiProperty({ enum: FRAUD_KINDS })
  @IsIn(FRAUD_KINDS)
  kind!: FraudAlertKind;

  @ApiProperty({ description: "Numeric thresholds this pattern evaluates against" })
  @IsObject()
  thresholds!: Record<string, number>;

  @ApiProperty() @IsBoolean()
  enabled!: boolean;

  @ApiProperty({
    description:
      "Auto-freeze on firing. Reserve for unambiguous patterns: freezing a legitimate member's " +
      "funds is itself a serious harm.",
  })
  @IsBoolean()
  autoFreeze!: boolean;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsInt() @Min(0) @Max(100)
  baseRiskScore!: number;

  @ApiProperty({ description: "Reason recorded in the audit trail" })
  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}

export class SweepResultResponse {
  @ApiProperty({ enum: FRAUD_KINDS }) kind!: FraudAlertKind;
  @ApiProperty() evaluated!: number;
  @ApiProperty() raised!: number;
  @ApiProperty() frozen!: number;
  @ApiPropertyOptional({ nullable: true }) skipped?: string;
}
