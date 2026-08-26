import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Public } from "@/common/decorators";
import { PublicService } from "./public.service";
import { PublicConfigResponse, PublicStatsResponse } from "./dto/public.dto";

@ApiTags("public")
@Controller("public")
export class PublicController {
  constructor(private readonly stats: PublicService) {}

  @Get("stats")
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: "Live platform statistics for the landing page",
    description:
      "Unauthenticated and cached. Every figure is measured — the FRD forbids " +
      "hard-coded marketing numbers — and any figure the ledger cannot " +
      "substantiate comes back null rather than as a flattering default.",
  })
  @ApiOkResponse({ type: PublicStatsResponse })
  get(): Promise<PublicStatsResponse> {
    return this.stats.stats();
  }

  @Get("config")
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: "Registration policy: restricted jurisdictions, ages, password rules",
    description:
      "Published so a client shows the same rules the server enforces. These were " +
      "constants in the frontend bundle, which is how a browser ends up accepting " +
      "a registration the API will refuse — or blocking one it would allow.",
  })
  @ApiOkResponse({ type: PublicConfigResponse })
  config(): Promise<PublicConfigResponse> {
    return this.stats.config();
  }
}
