import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsNumberString, IsOptional, IsString, Length, MaxLength } from "class-validator";
import { DateRangeQuery } from "@/common/dto";
import type { DepositMethod, DepositStatus } from "@/database/entities";

/* ============================================================================
 * Deposit DTOs (FRD W-03).
 *
 * A deposit credits nothing until the processor settlement is reconciled — the
 * client "success" callback is treated as a hint, never as an authorisation.
 * ========================================================================== */

export const DEPOSIT_METHODS: DepositMethod[] = ["card", "upi", "bank", "crypto"];
export const DEPOSIT_STATUSES: DepositStatus[] = [
  "initiated", "pending", "processing", "completed", "failed", "expired", "refunded",
];

export class CreateDepositRequest {
  @ApiProperty({ enum: DEPOSIT_METHODS })
  @IsEnum(DEPOSIT_METHODS)
  method!: DepositMethod;

  @ApiProperty({ description: "Fiat amount as a decimal string" })
  @IsNumberString()
  amountFiat!: string;

  @ApiProperty({ description: "ISO-4217 currency code", example: "INR" })
  @IsString() @Length(3, 3)
  currency!: string;
}

export class DepositResponse {
  @ApiProperty() ref!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ enum: DEPOSIT_METHODS }) method!: DepositMethod;
  @ApiProperty() amountFiat!: string;
  @ApiProperty() currency!: string;
  @ApiPropertyOptional({ nullable: true, description: "Credited MTT — null until reconciled" })
  amountMtt!: string | null;
  @ApiProperty({ enum: DEPOSIT_STATUSES }) status!: DepositStatus;
  @ApiPropertyOptional({ nullable: true }) reconciledAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) settledAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) txHash!: string | null;
}

export class DepositIntentResponse extends DepositResponse {
  @ApiProperty({ description: "Reference the client hands to the payment processor" })
  processorReference!: string;
  @ApiProperty({ description: "Indicative MTT at the current reference price. Not a promise." })
  indicativeMtt!: string;
  @ApiProperty({
    description: "Always true: funds are credited only after the processor settlement is reconciled.",
  })
  creditsOnReconciliationOnly!: boolean;
}

export class DepositHistoryQuery extends DateRangeQuery {
  @ApiPropertyOptional({ enum: DEPOSIT_STATUSES })
  @IsOptional() @IsEnum(DEPOSIT_STATUSES)
  status?: DepositStatus;
}

export class AdminDepositQuery extends DepositHistoryQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64)
  userId?: string;
}
