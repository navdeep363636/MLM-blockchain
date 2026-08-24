import {
  Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  ClientIp, CurrentUser, Idempotent, Public, RequireKyc, type AuthUser,
} from "@/common/decorators";
import type { Paginated } from "@/common/dto";
import { StoreService } from "./store.service";
import {
  ConsumeRequest, CreateListingRequest, InventoryItemResponse, ListingResponse,
  MarketPolicyResponse, MarketQuery, PurchaseListingResponse, PurchaseRequest, PurchaseResponse,
  StoreItemResponse, StoreQuery,
} from "./dto/store.dto";

/* ============================================================================
 * Store, inventory and marketplace, player side (FRD W-06, S-05).
 *
 * Every purchase response says explicitly whether it was commissionable, because
 * the answer differs by payment method and is the single most consequential fact
 * about the transaction:
 *
 *   MTT store purchase → revenue, commissionable
 *   Points purchase    → not revenue, never commissionable
 *   Marketplace buy    → the seller's money; only the fee is revenue, and a
 *                        member-to-member trade is never commissionable
 * ========================================================================== */

@ApiTags("store")
@Controller("store")
export class StoreController {
  constructor(private readonly store: StoreService) {}

  @Get("items")
  @Public()
  @ApiOperation({ summary: "Store catalogue with MTT and Points pricing" })
  items(@Query() q: StoreQuery): Promise<Paginated<StoreItemResponse>> {
    return this.store.listItems(q);
  }

  @Post("purchase")
  @HttpCode(201)
  @ApiBearerAuth()
  @RequireKyc(1)
  @Idempotent("store")
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Client-generated, 8–128 chars. A retry returns the original purchase.",
  })
  @ApiOperation({
    summary: "Buy an item with MTT or Points",
    description:
      "The charge and the inventory row commit together. An MTT purchase is recognised as `iap` " +
      "revenue and can generate referral commission; a Points purchase is neither.",
  })
  @ApiOkResponse({ type: PurchaseResponse })
  purchase(
    @CurrentUser() user: AuthUser,
    @Body() dto: PurchaseRequest,
    @Headers("idempotency-key") idempotencyKey: string,
    @ClientIp() ip: string,
  ): Promise<PurchaseResponse> {
    return this.store.purchase(user.id, dto, idempotencyKey, ip);
  }

  @Get("inventory")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Owned items with lock and sellability state",
    description: "`locked` is true while an item is listed for sale — it can then be neither used nor relisted.",
  })
  @ApiOkResponse({ type: [InventoryItemResponse] })
  inventory(@CurrentUser() user: AuthUser): Promise<InventoryItemResponse[]> {
    return this.store.myInventory(user.id);
  }

  @Post("inventory/:id/consume")
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Use a consumable",
    description: "Refused while the item is listed, so a seller cannot use something they are selling.",
  })
  @ApiOkResponse({ type: InventoryItemResponse })
  consume(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ConsumeRequest,
  ): Promise<InventoryItemResponse> {
    return this.store.consume(user.id, id, dto);
  }

  /* ------------------------------ marketplace ----------------------------- */

  @Get("market")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Active listings",
    description: "Sellers are anonymised. `sellerReceivesMtt` shows the ask net of the platform fee.",
  })
  browse(@Query() q: MarketQuery, @CurrentUser() user: AuthUser): Promise<Paginated<ListingResponse>> {
    return this.store.browse(q, user.id);
  }

  @Get("market/policy")
  @Public()
  @ApiOperation({ summary: "Marketplace fee and listing bounds currently in force" })
  @ApiOkResponse({ type: MarketPolicyResponse })
  policy(): Promise<MarketPolicyResponse> {
    return this.store.policy();
  }

  @Post("market")
  @HttpCode(201)
  @ApiBearerAuth()
  @RequireKyc(1)
  @ApiOperation({
    summary: "List an owned item for sale",
    description: "Locks the inventory row to the listing, so the same item cannot be sold twice.",
  })
  @ApiOkResponse({ type: ListingResponse })
  list(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateListingRequest,
    @ClientIp() ip: string,
  ): Promise<ListingResponse> {
    return this.store.createListing(user.id, dto, ip);
  }

  @Post("market/:ref/buy")
  @HttpCode(200)
  @ApiBearerAuth()
  @RequireKyc(1)
  @Idempotent("market")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({
    summary: "Buy a listing",
    description:
      "The MTT goes to the seller; only the platform fee is revenue, and a member-to-member trade " +
      "never generates referral commission.",
  })
  @ApiOkResponse({ type: PurchaseListingResponse })
  buy(
    @CurrentUser() user: AuthUser,
    @Param("ref") ref: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @ClientIp() ip: string,
  ): Promise<PurchaseListingResponse> {
    return this.store.buyListing(user.id, ref, idempotencyKey, ip);
  }

  @Delete("market/:ref")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Cancel your listing and release the item" })
  @ApiOkResponse({ type: ListingResponse })
  cancel(@CurrentUser() user: AuthUser, @Param("ref") ref: string): Promise<ListingResponse> {
    return this.store.cancelListing(user.id, ref);
  }
}
