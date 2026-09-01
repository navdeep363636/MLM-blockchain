import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClientIp, CurrentUser, Public, type AuthUser } from "@/common/decorators";
import type { Paginated } from "@/common/dto";
import { GamesService } from "./games.service";
import {
  GameQuery, GameResponse, SessionQuery, SessionResponse, StartSessionRequest,
  StartSessionResponse, SubmitSessionRequest, SubmitSessionResponse,
} from "./dto/games.dto";

/* ============================================================================
 * Gameplay, player side (FRD G-01, G-02).
 *
 * `POST sessions/:ref/submit` does not return a score or any Points. It accepts
 * the claim and queues the server-side replay, because the server — not the
 * client — decides what a session was worth. Points appear when validation
 * completes, and the session record then carries both scores side by side.
 * ========================================================================== */

@ApiTags("games")
@Controller("games")
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: "Game catalogue with per-title Points bands and caps" })
  list(@Query() q: GameQuery): Promise<Paginated<GameResponse>> {
    return this.games.list(q);
  }

  @Get("genres")
  @Public()
  @ApiOperation({ summary: "Distinct genres across active titles" })
  genres(): Promise<string[]> {
    return this.games.genres();
  }

  @Get("sessions")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "The member's session history, with both the claimed and the replayed score",
    description: "`serverScore` is what Points were credited from. `clientScore` is kept for comparison.",
  })
  sessions(
    @CurrentUser() user: AuthUser,
    @Query() q: SessionQuery,
  ): Promise<Paginated<SessionResponse>> {
    return this.games.mySessions(user.id, q);
  }

  @Get("sessions/today")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Today's play summary for the dashboard" })
  today(@CurrentUser() user: AuthUser) {
    return this.games.todaySummary(user.id);
  }

  @Get("sessions/:ref")
  @ApiBearerAuth()
  @ApiOperation({ summary: "One session, including any anti-cheat flags that fired" })
  @ApiOkResponse({ type: SessionResponse })
  session(@CurrentUser() user: AuthUser, @Param("ref") ref: string): Promise<SessionResponse> {
    return this.games.session(user.id, ref);
  }

  @Get(":slug")
  @Public()
  @ApiOperation({ summary: "One game by slug" })
  @ApiOkResponse({ type: GameResponse })
  bySlug(@Param("slug") slug: string): Promise<GameResponse> {
    return this.games.bySlug(slug);
  }

  @Post("sessions")
  @HttpCode(201)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Start a session and receive the seed and one-time session token",
    description:
      "The token is returned exactly once and is required to submit. `pointsHeadroom` is shown " +
      "up front so a cap is never a surprise after playing.",
  })
  @ApiOkResponse({ type: StartSessionResponse })
  start(
    @CurrentUser() user: AuthUser,
    @Body() dto: StartSessionRequest,
    @ClientIp() ip: string,
  ): Promise<StartSessionResponse> {
    return this.games.startSession(user.id, dto, ip);
  }

  @Post("sessions/:ref/abandon")
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Give up an open session without submitting it",
    description:
      "Forfeits the session: nothing is scored and nothing is credited. This is what makes the " +
      "one-open-session-per-title rule actionable — without it, closing a tab mid-game locked the " +
      "title until the session expired. Idempotent on a session that is already closed.",
  })
  @ApiOkResponse({ type: SessionResponse })
  abandon(@CurrentUser() user: AuthUser, @Param("ref") ref: string): Promise<SessionResponse> {
    return this.games.abandonSession(user.id, ref);
  }

  @Post("sessions/:ref/submit")
  @HttpCode(202)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Submit a finished session for server-side validation",
    description:
      "Returns 202: the score is replayed from the telemetry on the queue, and Points are " +
      "credited from the SERVER score. A session can be submitted only once.",
  })
  @ApiOkResponse({ type: SubmitSessionResponse })
  submit(
    @CurrentUser() user: AuthUser,
    @Param("ref") ref: string,
    @Body() dto: SubmitSessionRequest,
  ): Promise<SubmitSessionResponse> {
    return this.games.submitSession(user.id, ref, dto);
  }
}
