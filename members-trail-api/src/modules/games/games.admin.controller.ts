import { Body, Controller, Get, Put, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClientIp, CurrentUser, RequirePermissions, StaffOnly, type AuthUser } from "@/common/decorators";
import type { Paginated } from "@/common/dto";
import type { PointsRule } from "@/database/entities";
import { GamesService } from "./games.service";
import {
  AdminSessionQuery, GameQuery, GameResponse, SessionResponse, UpsertGameRequest,
} from "./dto/games.dto";

/* ============================================================================
 * Game administration (FRD AD-03, AD-04).
 *
 * The caps configured here are the platform's Points emission control, so a
 * change is audited with a mandatory reason. `flaggedOnly` is the anti-cheat
 * review queue: sessions where a heuristic fired but the evidence was not
 * conclusive enough to refuse the Points automatically.
 * ========================================================================== */

@ApiTags("admin: games")
@StaffOnly("support", "compliance", "finance_admin", "super_admin")
@Controller("admin/games")
export class GamesAdminController {
  constructor(private readonly games: GamesService) {}

  @Get()
  @ApiOperation({ summary: "All games, including inactive ones" })
  list(@Query() q: GameQuery): Promise<Paginated<GameResponse>> {
    return this.games.list(q, true);
  }

  @Put()
  @RequirePermissions("games:write")
  @ApiOperation({
    summary: "Create or update a game and its Points caps",
    description: "Refuses a session cap above the daily cap — a single session must not out-earn a whole day.",
  })
  @ApiOkResponse({ type: GameResponse })
  upsert(
    @Body() dto: UpsertGameRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<GameResponse> {
    return this.games.upsertGame(dto, actor.id, ip);
  }

  @Get("sessions")
  @ApiOperation({
    summary: "Session review queue across all members",
    description: "Use flaggedOnly=true for sessions an anti-cheat heuristic flagged but did not refuse.",
  })
  sessions(@Query() q: AdminSessionQuery): Promise<Paginated<SessionResponse & { userId: string }>> {
    return this.games.adminSessions(q);
  }

  @Get("points-rules")
  @ApiOperation({ summary: "Points rules by version — rules are never applied retroactively" })
  rules(@Query("gameId") gameId?: string): Promise<PointsRule[]> {
    return this.games.pointsRules(gameId);
  }
}
