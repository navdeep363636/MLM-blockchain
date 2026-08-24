import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bullmq";
import { Game, GameSession, Tournament, TournamentEntry, User } from "@/database/entities";
import { Queues } from "@/queues/queue.constants";
import { AuditModule } from "@/modules/audit/audit.module";
import { TreasuryModule } from "@/modules/treasury/treasury.module";
import { TournamentsController } from "./tournaments.controller";
import { TournamentsAdminController } from "./tournaments.admin.controller";
import { TournamentsService } from "./tournaments.service";

/**
 * Tournaments: entry, standings and prize settlement.
 *
 * Imports TreasuryModule because an entry fee is revenue and must be recognised
 * through the same path as every other real-money event — there is exactly one
 * definition of "revenue" in this system.
 *
 * Exported for the settlement job and the lifecycle cron.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Tournament, TournamentEntry, GameSession, Game, User]),
    BullModule.registerQueue({ name: Queues.Commission }),
    AuditModule,
    TreasuryModule,
  ],
  controllers: [TournamentsController, TournamentsAdminController],
  providers: [TournamentsService],
  exports: [TournamentsService],
})
export class TournamentsModule {}
