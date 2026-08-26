import { Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  ClientIp, CurrentUser, Idempotent, Public, RequireKyc, type AuthUser,
} from "@/common/decorators";
import type { Paginated } from "@/common/dto";
import { TournamentsService } from "./tournaments.service";
import {
  EntryResponse, TournamentRegisterResponse, StandingsResponse, TournamentQuery, TournamentResponse,
} from "./dto/tournaments.dto";

/* ============================================================================
 * Tournaments, player side (FRD G-03).
 *
 * The prize split is visible on every response and is immutable from the moment
 * entry opens — `prizeSplitLockedAt` is the timestamp that proves it. Standings
 * rank on server-validated scores only, so a submission still under anti-cheat
 * review cannot appear to be winning.
 * ========================================================================== */

@ApiTags("tournaments")
@Controller("tournaments")
export class TournamentsController {
  constructor(private readonly tournaments: TournamentsService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: "Tournaments with prize pool, split and entry status" })
  list(@Query() q: TournamentQuery): Promise<Paginated<TournamentResponse>> {
    return this.tournaments.list(q);
  }

  @Get("mine")
  @ApiBearerAuth()
  @ApiOperation({ summary: "The member's entries with rank, prize and any disqualification" })
  @ApiOkResponse({ type: [EntryResponse] })
  mine(@CurrentUser() user: AuthUser): Promise<EntryResponse[]> {
    return this.tournaments.myEntries(user.id);
  }

  @Get(":ref")
  @Public()
  @ApiOperation({ summary: "One tournament, including the published prize split" })
  @ApiOkResponse({ type: TournamentResponse })
  byRef(@Param("ref") ref: string): Promise<TournamentResponse> {
    return this.tournaments.byRef(ref);
  }

  @Get(":ref/standings")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Live standings with projected prizes",
    description:
      "Other players are anonymised. Your own row is always returned, even when it falls outside " +
      "the visible page. Ranking uses validated scores only.",
  })
  @ApiOkResponse({ type: StandingsResponse })
  standings(
    @Param("ref") ref: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StandingsResponse> {
    return this.tournaments.standings(ref, user.id);
  }

  @Post(":ref/register")
  @Idempotent("tournament")
  @HttpCode(201)
  @ApiBearerAuth()
  @RequireKyc(1)
  @ApiOperation({
    summary: "Enter a tournament, paying the entry fee",
    description:
      "The fee is charged and recognised as revenue in one operation, so it is traceable to the " +
      "Treasury allocation and the referral commission it generates. Entering twice is a no-op.",
  })
  @ApiOkResponse({ type: TournamentRegisterResponse })
  register(
    @Param("ref") ref: string,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string,
  ): Promise<TournamentRegisterResponse> {
    return this.tournaments.register(user.id, ref, ip);
  }
}
