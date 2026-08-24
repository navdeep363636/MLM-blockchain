import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, type AuthUser } from "@/common/decorators";
import { LeaderboardService } from "./leaderboard.service";
import { LeaderboardQuery, LeaderboardResponse } from "./dto/leaderboard.dto";

/* ============================================================================
 * Leaderboards (FRD G-05).
 *
 * `source` tells the client whether it is looking at the live index or the
 * persisted record. That distinction is exposed rather than hidden because a
 * past period is always served from the snapshot table, and a support question
 * about a rank is answered from the same field.
 * ========================================================================== */

@ApiTags("leaderboard")
@ApiBearerAuth()
@Controller("leaderboard")
export class LeaderboardController {
  constructor(private readonly leaderboard: LeaderboardService) {}

  @Get()
  @ApiOperation({
    summary: "A leaderboard page plus your own row",
    description:
      "Periods are UTC. Your row is always returned, even when it falls outside the visible page. " +
      "Scores derive from server-validated gameplay only.",
  })
  @ApiOkResponse({ type: LeaderboardResponse })
  board(
    @Query() q: LeaderboardQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<LeaderboardResponse> {
    return this.leaderboard.board(q, user.id);
  }

  @Get("me")
  @ApiOperation({ summary: "Your rank and score across the standard boards" })
  async me(@CurrentUser() user: AuthUser): Promise<Record<string, { rank: number; score: number } | null>> {
    const [points, score, sessions] = await Promise.all([
      this.leaderboard.rankFor(user.id, "points", "weekly"),
      this.leaderboard.rankFor(user.id, "score", "weekly"),
      this.leaderboard.rankFor(user.id, "sessions", "weekly"),
    ]);
    return { points, score, sessions };
  }
}
