import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum, IsEthereumAddress, IsOptional, IsString, Matches, MaxLength, MinLength,
} from "class-validator";
import { DateRangeQuery } from "@/common/dto";
import type { TxStatus, TxType } from "@/database/entities";

/* ============================================================================
 * Wallet DTOs — balances, addresses and the transaction ledger (FRD W-01, W-05).
 * ========================================================================== */

export const TX_TYPES: TxType[] = [
  "conversion", "stake", "unstake", "reward_claim", "commission_claim",
  "deposit", "withdrawal", "store_purchase", "marketplace_sale",
  "marketplace_purchase", "tournament_entry", "prize_payout", "clawback",
  "admin_adjustment",
];

export const TX_STATUSES: TxStatus[] = [
  "pending", "queued", "processing", "review", "completed", "failed", "cancelled",
];

export class BalanceResponse {
  @ApiProperty({ description: "Points balance — integral by definition" }) points!: number;
  @ApiProperty({ description: "Spendable MTT" }) mttAvailable!: string;
  @ApiProperty({ description: "Mirror of on-chain staked principal" }) mttStaked!: string;
  @ApiProperty() mttPendingRewards!: string;
  @ApiProperty({ description: "Accrued commission not yet released" }) commissionPending!: string;
  @ApiProperty({ description: "Released commission, claimable now" }) commissionAvailable!: string;
  @ApiProperty({ description: "Lifetime commission earned — monotonic, never reduced" })
  commissionLifetime!: string;
  @ApiProperty({ description: "Reserved against in-flight withdrawals and not spendable" })
  mttLockedForWithdrawal!: string;
  @ApiProperty({ description: "available + staked + pendingRewards + commissionAvailable + locked" })
  totalMtt!: string;
  @ApiPropertyOptional({ nullable: true }) lastLedgerAt!: string | null;
  @ApiProperty({ description: "Server instant this snapshot was read. Balances are never cached." })
  readAt!: string;
}

export class TransactionQuery extends DateRangeQuery {
  @ApiPropertyOptional({ enum: TX_TYPES })
  @IsOptional() @IsEnum(TX_TYPES)
  type?: TxType;

  @ApiPropertyOptional({ enum: TX_STATUSES })
  @IsOptional() @IsEnum(TX_STATUSES)
  status?: TxStatus;
}

export class TransactionResponse {
  @ApiProperty() ref!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ enum: TX_TYPES }) type!: TxType;
  @ApiProperty({ description: "Signed from the member's perspective" }) amountMtt!: string;
  @ApiPropertyOptional({ nullable: true }) amountFiat!: string | null;
  @ApiPropertyOptional({ nullable: true }) currency!: string | null;
  @ApiProperty({ enum: TX_STATUSES }) status!: TxStatus;
  @ApiPropertyOptional({ nullable: true }) sourceTag!: string | null;
  @ApiPropertyOptional({ nullable: true }) txHash!: string | null;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiPropertyOptional({ nullable: true }) settledAt!: string | null;
}

export class TransactionExportResponse {
  @ApiProperty() filename!: string;
  @ApiProperty({ type: [String] }) columns!: string[];
  @ApiProperty({ type: "array", items: { type: "array", items: { type: "string" } } })
  rows!: string[][];
  @ApiProperty() rowCount!: number;
  @ApiProperty() generatedAt!: string;
}

/* ------------------------------- addresses -------------------------------- */

export class LinkChallengeResponse {
  @ApiProperty({ description: "Sign this exact string with the wallet to prove ownership" })
  message!: string;
  @ApiProperty({ description: "Seconds until the challenge expires" }) expiresInSeconds!: number;
}

export class LinkAddressRequest {
  @ApiProperty({ description: "EVM address to link" })
  @IsEthereumAddress()
  address!: string;

  @ApiProperty({ description: "EIP-191 signature of the challenge message" })
  @IsString() @Matches(/^0x[0-9a-fA-F]{130}$/, { message: "signature must be a 65-byte hex string" })
  signature!: string;

  @ApiPropertyOptional({ description: "Member's own label for this address" })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64)
  label?: string;
}

export class WalletAddressResponse {
  @ApiProperty() id!: string;
  @ApiProperty() address!: string;
  @ApiProperty({ enum: ["external", "custodial"] }) type!: "external" | "custodial";
  @ApiProperty() isPrimary!: boolean;
  @ApiPropertyOptional({ nullable: true }) label!: string | null;
  @ApiPropertyOptional({ nullable: true }) verifiedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, description: "When the cooling-off clock started" })
  whitelistedAt!: string | null;
  @ApiProperty({ description: "False while the anti-fraud cooling-off window is still open" })
  withdrawable!: boolean;
  @ApiPropertyOptional({ nullable: true, description: "Instant this address becomes withdrawable" })
  withdrawableAt!: string | null;
}
