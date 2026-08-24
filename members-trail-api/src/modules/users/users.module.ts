import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  LegalDocument, LoginHistory, NotificationPreference, Ticket, User,
  VerificationToken,
} from "@/database/entities";
import { AuditModule } from "@/modules/audit/audit.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

/**
 * Profile, preferences and account lifecycle.
 *
 * Imports AuthModule for OtpService and SessionService rather than duplicating
 * the code-issuing and session-teardown logic: a contact change re-verifies
 * with the same OTP rules as registration, and it signs other devices out with
 * the same Redis teardown as logout.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      NotificationPreference,
      LoginHistory,
      VerificationToken,
      Ticket,
      LegalDocument,
    ]),
    AuthModule,
    AuditModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
