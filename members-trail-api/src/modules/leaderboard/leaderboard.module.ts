import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LeaderboardSnapshot, User } from "@/database/entities";
import { LeaderboardController } from "./leaderboard.controller";
import { LeaderboardService } from "./leaderboard.service";

/**
 * Leaderboards: a Redis index for live reads, a table for the record.
 *
 * Exported because the domain-event listener records scores and the snapshot
 * cron persists and prunes them. Nothing writes a score from a client route.
 */
@Module({
  imports: [TypeOrmModule.forFeature([LeaderboardSnapshot, User])],
  controllers: [LeaderboardController],
  providers: [LeaderboardService],
  exports: [LeaderboardService],
})
export class LeaderboardModule {}
