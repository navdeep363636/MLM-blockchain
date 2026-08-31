import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean, IsIn, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
} from "class-validator";
import { Type } from "class-transformer";
import { PaginationQuery } from "@/common/dto";
import type { ItemCategory, ItemRarity, ListingStatus } from "@/database/entities";

/* ============================================================================
 * Store, inventory and marketplace DTOs (FRD W-06, S-05).
 *
 * `payWith` is explicit rather than inferred from which price is set, because
 * the two currencies have completely different consequences: MTT is real value
 * and makes the purchase revenue (and therefore commissionable); Points are an
 * in-game score and make it nothing of the sort.
 * ========================================================================== */

export const ITEM_CATEGORIES: ItemCategory[] = ["cosmetic", "boost", "energy", "pass"];
export const ITEM_RARITIES: ItemRarity[] = ["common", "rare", "epic", "legendary"];
export const LISTING_STATUSES: ListingStatus[] = ["active", "sold", "cancelled", "expired"];

export const PAYMENT_METHODS = ["mtt", "points"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export class StoreItemResponse {
  @ApiProperty() id!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: ITEM_CATEGORIES }) category!: ItemCategory;
  @ApiProperty({ enum: ITEM_RARITIES }) rarity!: ItemRarity;
  @ApiProperty({ description: "Price in MTT" }) priceMtt!: string;
  @ApiPropertyOptional({ nullable: true, description: "Points price, when the item can be bought with Points" })
  pricePoints!: number | null;
  @ApiProperty({ description: "Hue for the procedural artwork" }) hue!: number;
  @ApiProperty() active!: boolean;
  @ApiProperty({ description: "Consumables cannot be resold once used" }) consumable!: boolean;
  @ApiProperty({ description: "False for items that can never be listed on the marketplace" })
  tradable!: boolean;
}

export class StoreQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ITEM_CATEGORIES })
  @IsOptional() @IsIn(ITEM_CATEGORIES)
  category?: ItemCategory;

  @ApiPropertyOptional({ enum: ITEM_RARITIES })
  @IsOptional() @IsIn(ITEM_RARITIES)
  rarity?: ItemRarity;

  @ApiPropertyOptional({ description: "Free-text search over name and sku" })
  @IsOptional() @IsString() @MaxLength(120)
  q?: string;
}

export class PurchaseRequest {
  @ApiProperty() @IsUUID()
  itemId!: string;

  @ApiProperty({
    enum: PAYMENT_METHODS,
    description:
      "MTT is real value: the purchase is recognised as revenue and can generate referral " +
      "commission. Points are an in-game score: the purchase is neither.",
  })
  @IsIn(PAYMENT_METHODS)
  payWith!: PaymentMethod;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  quantity?: number;
}

export class PurchaseResponse {
  @ApiProperty() orderRef!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ enum: PAYMENT_METHODS }) paidWith!: PaymentMethod;
  @ApiProperty({ description: "MTT charged, zero for a Points purchase" }) paidMtt!: string;
  @ApiProperty({ description: "Points charged, zero for an MTT purchase" }) paidPoints!: number;
  @ApiPropertyOptional({
    nullable: true,
    description: "Revenue event created for an MTT purchase. Null for Points — no real money moved.",
  })
  revenueEventId!: string | null;
  @ApiProperty({ description: "Whether this purchase can generate referral commission" })
  commissionable!: boolean;
  @ApiProperty() inventoryItemId!: string;
}

export class InventoryItemResponse {
  @ApiProperty() id!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ITEM_CATEGORIES }) category!: ItemCategory;
  @ApiProperty({ enum: ITEM_RARITIES }) rarity!: ItemRarity;
  @ApiProperty() quantity!: number;
  @ApiProperty() hue!: number;
  @ApiPropertyOptional({ nullable: true }) consumedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) expiresAt!: string | null;
  @ApiProperty({ description: "True while the item is listed for sale and cannot be used or resold" })
  locked!: boolean;
  @ApiProperty({ description: "False for consumables already used, or untradable items" })
  sellable!: boolean;
}

export class ConsumeRequest {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  quantity?: number;
}

/* ------------------------------- marketplace ------------------------------ */

export class CreateListingRequest {
  @ApiProperty({ description: "The inventory row to sell" })
  @IsUUID()
  inventoryItemId!: string;

  @ApiProperty({ description: "Asking price in MTT" })
  @IsNumberString()
  askMtt!: string;
}

export class ListingResponse {
  @ApiProperty() ref!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ITEM_RARITIES }) rarity!: ItemRarity;
  @ApiProperty() hue!: number;
  @ApiProperty() askMtt!: string;
  @ApiProperty({ description: "Platform fee the seller will pay on a sale" }) feeMtt!: string;
  @ApiProperty({ description: "askMtt − feeMtt" }) sellerReceivesMtt!: string;
  @ApiProperty({ enum: LISTING_STATUSES }) status!: ListingStatus;
  @ApiProperty({ description: "Anonymised seller label" }) seller!: string;
  @ApiProperty({ description: "True when the caller is the seller" }) isYours!: boolean;
  @ApiProperty() listedAt!: string;
  @ApiPropertyOptional({ nullable: true }) soldAt!: string | null;
}

export class MarketQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ITEM_RARITIES })
  @IsOptional() @IsIn(ITEM_RARITIES)
  rarity?: ItemRarity;

  @ApiPropertyOptional({ enum: ITEM_CATEGORIES })
  @IsOptional() @IsIn(ITEM_CATEGORIES)
  category?: ItemCategory;

  @ApiPropertyOptional({ description: "Only your own listings" })
  @IsOptional() @IsBoolean()
  mine?: boolean;
}

export class PurchaseListingResponse {
  @ApiProperty() ref!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty() paidMtt!: string;
  @ApiProperty({ description: "Platform fee taken from the sale" }) feeMtt!: string;
  @ApiProperty({ description: "What the seller received" }) sellerReceivedMtt!: string;
  @ApiProperty({
    description: "Revenue event for the FEE only. A member-to-member trade is not a platform sale.",
  })
  feeRevenueEventId!: string | null;
  @ApiProperty({ description: "Always false: the spender bought from another member" })
  commissionable!: boolean;
  @ApiProperty() inventoryItemId!: string;
}

export class MarketPolicyResponse {
  @ApiProperty({ description: "Platform fee in basis points of the asking price" }) feeBps!: number;
  @ApiProperty() minAskMtt!: string;
  @ApiProperty() maxAskMtt!: string;
  @ApiProperty() listingTtlDays!: number;
}

/* --------------------------------- admin ---------------------------------- */

export class UpsertItemRequest {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(64)
  sku!: string;

  @ApiProperty() @IsString() @MinLength(2) @MaxLength(160)
  name!: string;

  @ApiProperty() @IsString() @MinLength(10) @MaxLength(2_000)
  description!: string;

  @ApiProperty({ enum: ITEM_CATEGORIES })
  @IsIn(ITEM_CATEGORIES)
  category!: ItemCategory;

  @ApiProperty({ enum: ITEM_RARITIES })
  @IsIn(ITEM_RARITIES)
  rarity!: ItemRarity;

  @ApiProperty() @IsNumberString()
  priceMtt!: string;

  @ApiPropertyOptional({ description: "Omit to make the item MTT-only" })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100_000_000)
  pricePoints?: number;

  @ApiProperty() @IsInt() @Min(0) @Max(360)
  hue!: number;

  @ApiProperty() @IsBoolean()
  active!: boolean;

  @ApiProperty() @IsBoolean()
  consumable!: boolean;

  @ApiProperty() @IsBoolean()
  tradable!: boolean;

  @ApiProperty({ description: "Reason recorded in the audit trail" })
  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}

export class UpdateMarketPolicyRequest {
  @ApiProperty({ description: "Fee in basis points. Capped at 3000 (30%)." })
  @IsInt() @Min(0) @Max(3_000)
  feeBps!: number;

  @ApiProperty() @IsNumberString()
  minAskMtt!: string;

  @ApiProperty() @IsNumberString()
  maxAskMtt!: string;

  @ApiProperty() @IsInt() @Min(1) @Max(365)
  listingTtlDays!: number;

  @ApiProperty({ description: "Reason recorded in the audit trail" })
  @IsString() @MinLength(10) @MaxLength(500)
  reason!: string;
}
