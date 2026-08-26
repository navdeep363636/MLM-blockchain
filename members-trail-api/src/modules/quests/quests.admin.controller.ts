import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Put } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClientIp, CurrentUser, RequirePermissions, StaffOnly, type AuthUser } from "@/common/decorators";
import { QuestsService } from "./quests.service";
import { QuestResponse, UpsertQuestRequest } from "./dto/quests.dto";

/* ============================================================================
 * Quest administration (FRD AD-04).
 *
 * A quest's reward is Points issuance, so every change here is audited with a
 * mandatory reason — the same standard as changing a Points cap, because the two
 * levers control the same thing.
 * ========================================================================== */

@ApiTags("admin: quests")
@StaffOnly("support", "finance_admin", "super_admin")
@Controller("admin/quests")
export class QuestsAdminController {
  constructor(private readonly quests: QuestsService) {}

  @Put()
  @RequirePermissions("quests:write")
  @ApiOperation({
    summary: "Create or update a quest",
    description:
      "The objective metric must be one the server can derive from validated activity. " +
      "Rewards are still subject to the per-member daily Points caps.",
  })
  @ApiOkResponse({ type: QuestResponse })
  upsert(
    @Body() dto: UpsertQuestRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<QuestResponse> {
    return this.quests.upsertQuest(dto, actor.id, ip);
  }

  @Patch(":id/activate")
  @RequirePermissions("quests:write")
  @ApiOperation({ summary: "Activate a quest" })
  activate(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { reason: string },
    @CurrentUser() actor: AuthUser,
  ): Promise<QuestResponse> {
    return this.quests.setQuestActive(id, true, body.reason, actor.id);
  }

  @Patch(":id/deactivate")
  @RequirePermissions("quests:write")
  @ApiOperation({
    summary: "Deactivate a quest",
    description: "Existing instances stay claimable until their period closes — the deal was already offered.",
  })
  deactivate(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { reason: string },
    @CurrentUser() actor: AuthUser,
  ): Promise<QuestResponse> {
    return this.quests.setQuestActive(id, false, body.reason, actor.id);
  }

  @Get("expire-stale")
  @RequirePermissions("quests:write")
  @ApiOperation({ summary: "Count of unclaimed instances whose period has closed" })
  expireStale(): Promise<number> {
    return this.quests.expireStale();
  }
}
