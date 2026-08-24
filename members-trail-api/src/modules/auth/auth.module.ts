import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  FraudAlert, LoginHistory, NotificationPreference, ReferralEdge, RolePermission,
  User, UserBalance, UserSession, VerificationToken,
} from "@/database/entities";
import { QueuesModule } from "@/queues/queues.module";
import { AuditModule } from "@/modules/audit/audit.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { OtpService } from "./otp.service";
import { SessionService } from "./session.service";
import { TwoFactorService } from "./two-factor.service";

/**
 * Authentication, sessions and 2FA.
 *
 * Crypto, Redis, Database, JWT and Events are already global, so the only
 * imports here are the entities this module reads and the queue registry it
 * hands outbound codes to.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserSession,
      LoginHistory,
      VerificationToken,
      NotificationPreference,
      UserBalance,
      ReferralEdge,
      RolePermission,
      FraudAlert,
    ]),
    /* Queue producers come from the shared registry rather than being
     * re-registered here, so there is one connection per queue process-wide. */
    QueuesModule,
    AuditModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpService, SessionService, TwoFactorService],
  /* SessionService is exported so other modules can revoke a session when they
   * suspend or freeze an account, without reimplementing the Redis teardown. */
  exports: [AuthService, SessionService, OtpService, TwoFactorService],
})
export class AuthModule {}
