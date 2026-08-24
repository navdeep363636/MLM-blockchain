import { Body, Controller, Get, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClientIp, CurrentUser, RequirePermissions, StaffOnly, type AuthUser } from "@/common/decorators";
import type { Paginated } from "@/common/dto";
import type { MarketplacePolicyConfig } from "@/modules/economy-config/economy-config.constants";
import { StoreService } from "./store.service";
import {
  StoreItemResponse, StoreQuery, UpdateMarketPolicyRequest, UpsertItemRequest,
} from "./dto/store.dto";

/* ============================================================================
 * Store administration (FRD AD-09).
 *
 * The fee change is the one to watch: it is the platform's take on every
 * member-to-member trade, so it is versioned in platform_config and audited with
 * a mandatory reason, exactly like a withdrawal limit.
 * ========================================================================== */

@ApiTags("admin: store")
@StaffOnly("support", "finance_admin", "super_admin")
@Controller("admin/store")
export class StoreAdminController {
  constructor(private readonly store: StoreService) {}

  @Get("items")
  @ApiOperation({ summary: "All items including inactive ones" })
  items(@Query() q: StoreQuery): Promise<Paginated<StoreItemResponse>> {
    return this.store.listItems(q, true);
  }

  @Put("items")
  @RequirePermissions("store:write")
  @ApiOperation({
    summary: "Create or update a store item",
    description:
      "Refuses a consumable that is also tradable — it could be used and then sold, and no lock " +
      "protects the buyer from that.",
  })
  @ApiOkResponse({ type: StoreItemResponse })
  upsert(
    @Body() dto: UpsertItemRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<StoreItemResponse> {
    return this.store.upsertItem(dto, actor.id, ip);
  }

  @Patch("market/policy")
  @RequirePermissions("store:write")
  @ApiOperation({
    summary: "Update the marketplace fee and listing bounds",
    description: "Versioned in platform_config; the previous values stay readable for audit.",
  })
  policy(
    @Body() dto: UpdateMarketPolicyRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<MarketplacePolicyConfig> {
    return this.store.updatePolicy(dto, actor.id, ip);
  }

  @Post("market/expire-stale")
  @RequirePermissions("store:write")
  @ApiOperation({
    summary: "Expire listings past their TTL and release the locked items",
    description: "Normally driven by the daily cron; exposed here for operations.",
  })
  expireStale(): Promise<number> {
    return this.store.expireStaleListings();
  }
}
