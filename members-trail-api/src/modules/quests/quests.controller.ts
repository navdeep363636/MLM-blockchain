import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, type AuthUser } from "@/common/decorators";
import { QuestsService } from "./quests.service";
import {
  AchievementSummaryResponse, ClaimQuestResponse, QuestListResponse,
} from "./dto/quests.dto";

/* ============================================================================
 * Quests and achievements, player side (FRD G-04).
 *
 * There is deliberately NO endpoint that reports progress. Progress is derived
 * server-side from validated gameplay; a route that accepted "I did the thing"
 * would be the easiest exploit in the platform.
 * ========================================================================== */

@ApiTags("quests")
@ApiBearerAuth()
@Controller("quests")
export class QuestsController {
  constructor(private readonly quests: QuestsService) {}

  @Get()
  @ApiOperation({
    summary: "Active quests grouped by kind, with this period's progress",
    description:
      "Periods are UTC: daily resets at UTC midnight, weekly at the end of the ISO week. " +
      "`rewardPoints` is the promise; `pointsAwarded` is what a claim actually credited.",
  })
  @ApiOkResponse({ type: QuestListResponse })
  list(@CurrentUser() user: AuthUser): Promise<QuestListResponse> {
    return this.quests.listForUser(user.id);
  }

  @Post(":id/claim")
  @HttpCode(200)
  @ApiOperation({
    summary: "Claim a completed quest's reward",
    description:
      "Points go through the same daily caps as gameplay. If a cap intervenes, the response " +
      "reports what was refused rather than hiding it.",
  })
  @ApiOkResponse({ type: ClaimQuestResponse })
  claim(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ClaimQuestResponse> {
    return this.quests.claim(user.id, id);
  }

  @Get("achievements")
  @ApiOperation({ summary: "Achievements with progress toward each unlock" })
  @ApiOkResponse({ type: AchievementSummaryResponse })
  achievements(@CurrentUser() user: AuthUser): Promise<AchievementSummaryResponse> {
    return this.quests.achievementsFor(user.id);
  }
}
