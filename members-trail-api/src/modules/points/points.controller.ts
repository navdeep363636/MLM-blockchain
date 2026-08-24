import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, type AuthUser } from "@/common/decorators";
import type { Paginated } from "@/common/dto";
import { PointsService } from "./points.service";
import {
  PointsCapsResponse, PointsEntryResponse, PointsExportResponse,
  PointsHistoryQuery, PointsSummaryResponse,
} from "./dto/points.dto";

/* ============================================================================
 * Player-facing Points ledger (FRD G-02, W-01, W-05).
 *
 * Read-only by design: Points are never created by an HTTP call from a client.
 * They are credited by the server-side validator through PointsService.credit(),
 * from `serverScore` — never from a score the client reported (conventions §8).
 * ========================================================================== */

@ApiTags("points")
@ApiBearerAuth()
@Controller("points")
export class PointsController {
  constructor(private readonly points: PointsService) {}

  @Get("history")
  @ApiOperation({
    summary: "Paginated Points ledger, filterable by source, game and date range",
    description: "Every row carries the running balance, so a statement is verifiable without replaying the ledger.",
  })
  history(
    @CurrentUser() user: AuthUser,
    @Query() q: PointsHistoryQuery,
  ): Promise<Paginated<PointsEntryResponse>> {
    return this.points.history(user.id, q);
  }

  @Get("history/export")
  @ApiOperation({
    summary: "The same filtered ledger as CSV rows for a statement export (W-05)",
    description: "Returns column headers plus pre-flattened rows; the client writes the file.",
  })
  @ApiOkResponse({ type: PointsExportResponse })
  export(
    @CurrentUser() user: AuthUser,
    @Query() q: PointsHistoryQuery,
  ): Promise<PointsExportResponse> {
    return this.points.export(user.id, q);
  }

  @Get("summary")
  @ApiOperation({ summary: "Lifetime earned, converted out, net, and best earning day" })
  @ApiOkResponse({ type: PointsSummaryResponse })
  summary(@CurrentUser() user: AuthUser): Promise<PointsSummaryResponse> {
    return this.points.summary(user.id);
  }

  @Get("caps")
  @ApiOperation({
    summary: "Today's issuance headroom per game and overall (G-02 cap meters)",
    description:
      "Windows are UTC days — a cap that rolled over at local midnight would be " +
      "exploitable near a timezone boundary. `resetsInSeconds` is the countdown to reset.",
  })
  @ApiOkResponse({ type: PointsCapsResponse })
  caps(@CurrentUser() user: AuthUser): Promise<PointsCapsResponse> {
    return this.points.caps(user.id);
  }
}
