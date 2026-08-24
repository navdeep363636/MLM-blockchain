import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bullmq";
import { Game, GameSession, PointsRule, User } from "@/database/entities";
import { Queues } from "@/queues/queue.constants";
import { AuditModule } from "@/modules/audit/audit.module";
import { PointsModule } from "@/modules/points/points.module";
import { GamesController } from "./games.controller";
import { GamesAdminController } from "./games.admin.controller";
import { GamesService } from "./games.service";

/**
 * Gameplay and server-side session validation.
 *
 * Exported because the GameValidation queue processor calls validateSession() —
 * the replay is deliberately off the request path, and no HTTP route can assert
 * a score is valid.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Game, GameSession, PointsRule, User]),
    BullModule.registerQueue({ name: Queues.GameValidation }),
    AuditModule,
    PointsModule,
  ],
  controllers: [GamesController, GamesAdminController],
  providers: [GamesService],
  exports: [GamesService],
})
export class GamesModule {}
