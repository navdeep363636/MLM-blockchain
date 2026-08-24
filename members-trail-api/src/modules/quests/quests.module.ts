import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Achievement, GameSession, Quest, UserAchievement, UserQuest,
} from "@/database/entities";
import { AuditModule } from "@/modules/audit/audit.module";
import { PointsModule } from "@/modules/points/points.module";
import { QuestsController } from "./quests.controller";
import { QuestsAdminController } from "./quests.admin.controller";
import { QuestsService } from "./quests.service";

/**
 * Quests and achievements.
 *
 * Exported because the domain-event listener calls onSessionValidated() and the
 * daily cron calls expireStale(). Progress is never advanced by a client route,
 * which is why there is no such route in the controller.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Quest, UserQuest, Achievement, UserAchievement, GameSession]),
    AuditModule,
    PointsModule,
  ],
  controllers: [QuestsController, QuestsAdminController],
  providers: [QuestsService],
  exports: [QuestsService],
})
export class QuestsModule {}
