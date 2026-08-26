import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClientIp, CurrentUser, RequirePermissions, StaffOnly, type AuthUser } from "@/common/decorators";
import type { Paginated } from "@/common/dto";
import { TournamentsService } from "./tournaments.service";
import {
  CreateTournamentRequest, DisqualifyRequest, EntryResponse, PublishTournamentRequest,
  SettlementResponse, TournamentQuery, TournamentResponse,
} from "./dto/tournaments.dto";

/* ============================================================================
 * Tournament administration (FRD AD-04).
 *
 * `publish` is a one-way door: it locks the prize split, and every route that
 * could otherwise change the terms refuses afterwards. That is the point — the
 * members who paid to enter bought those terms.
 * ========================================================================== */

@ApiTags("admin: tournaments")
@StaffOnly("support", "finance_admin", "super_admin")
@Controller("admin/tournaments")
export class TournamentsAdminController {
  constructor(private readonly tournaments: TournamentsService) {}

  @Get()
  @ApiOperation({ summary: "All tournaments including drafts" })
  list(@Query() q: TournamentQuery): Promise<Paginated<TournamentResponse>> {
    return this.tournaments.list(q, true);
  }

  @Post()
  @RequirePermissions("tournaments:write")
  @ApiOperation({
    summary: "Create a tournament as a draft",
    description: "Prize shares must total exactly 10000 bps. Entry cannot open until it is published.",
  })
  @ApiOkResponse({ type: TournamentResponse })
  create(
    @Body() dto: CreateTournamentRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<TournamentResponse> {
    return this.tournaments.create(dto, actor.id, ip);
  }

  @Put(":id")
  @RequirePermissions("tournaments:write")
  @ApiOperation({
    summary: "Update a draft tournament",
    description: "Refuses with PRIZE_SPLIT_LOCKED once the tournament has been published.",
  })
  @ApiOkResponse({ type: TournamentResponse })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateTournamentRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<TournamentResponse> {
    return this.tournaments.updateDraft(id, dto, actor.id, ip);
  }

  @Patch(":id/publish")
  @RequirePermissions("tournaments:write")
  @ApiOperation({
    summary: "Publish a tournament: lock the prize split and open entry",
    description: "One-way. After this the split, pool and entry fee cannot be changed.",
  })
  @ApiOkResponse({ type: TournamentResponse })
  publish(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: PublishTournamentRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<TournamentResponse> {
    return this.tournaments.publish(id, dto.reason, actor.id, ip);
  }

  @Post(":id/settle")
  @RequirePermissions("tournaments:approve")
  @ApiOperation({
    summary: "Settle a finished tournament and pay the prizes",
    description:
      "Idempotent and refuses before endsAt. Never pays more than the declared pool; a schedule " +
      "that would exceed it is logged and clamped.",
  })
  @ApiOkResponse({ type: SettlementResponse })
  settle(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<SettlementResponse> {
    return this.tournaments.settle(id, actor.id);
  }

  @Patch(":id/disqualify")
  @RequirePermissions("tournaments:approve")
  @ApiOperation({
    summary: "Disqualify an entry with a recorded reason",
    description: "Refuses once a prize has been paid — recovery goes through the audited adjustment flow.",
  })
  @ApiOkResponse({ type: EntryResponse })
  disqualify(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DisqualifyRequest,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ): Promise<EntryResponse> {
    return this.tournaments.disqualify(id, dto.userId, dto.reason, actor.id, ip);
  }
}
