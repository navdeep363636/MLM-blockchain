import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConflictException } from "@nestjs/common";
import {
  LegalDocument, LoginHistory, NotificationPreference, Ticket, User,
  VerificationToken,
} from "@/database/entities";
import { CryptoService } from "@/common/crypto/crypto.service";
import { EventBusService, Events } from "@/events";
import { AuditService } from "@/modules/audit/audit.service";
import { OtpService } from "@/modules/auth/otp.service";
import { SessionService } from "@/modules/auth/session.service";
import { UsersService } from "./users.service";
import { TwoFactorService } from "@/modules/auth/two-factor.service";

/* ============================================================================
 * Preference immutability and the contact re-verification flow (FRD D-02).
 * ========================================================================== */

function repoMock<T extends object>(rows: T[] = []) {
  return {
    rows,
    create: jest.fn((x: unknown) => ({ ...(x as object) })),
    save: jest.fn(async (x: unknown) => {
      const item = x as Record<string, unknown>;
      if (!item.id) item.id = `id-${rows.length + 1}`;
      const i = rows.findIndex((r) => (r as Record<string, unknown>).id === item.id);
      if (i >= 0) rows[i] = item as T;
      else rows.push(item as T);
      return item;
    }),
    findOne: jest.fn(async (): Promise<T | null> => null),
    find: jest.fn(async (): Promise<T[]> => []),
    findAndCount: jest.fn(async (): Promise<[T[], number]> => [[], 0]),
    exists: jest.fn(async () => false),
    delete: jest.fn(async () => ({ affected: 1 })),
  };
}

describe("UsersService", () => {
  let service: UsersService;
  let users: ReturnType<typeof repoMock<User>>;
  let prefs: ReturnType<typeof repoMock<NotificationPreference>>;
  let tokens: ReturnType<typeof repoMock<VerificationToken>>;
  let tickets: ReturnType<typeof repoMock<Ticket>>;
  let bus: { publish: jest.Mock };
  let otp: { issue: jest.Mock; verify: jest.Mock };
  let sessions: { revokeAll: jest.Mock; listActive: jest.Mock };

  const crypto = {
    hmac: jest.fn((v: string) => `hmac(${v})`),
    /* Contact changes re-authenticate now, so the fixture needs a password
       verifier. The refusal tests override it per case. */
    verifyPassword: jest.fn(async () => true),
  };
  const twoFa = { verifyForSensitiveAction: jest.fn(async () => true) };
  /** Valid re-auth for the happy paths; the refusal tests stub the verifier. */
  const REAUTH = { password: "correct-horse-battery" };
  const ctx = { ip: "1.2.3.4", userAgent: "jest", sessionJti: "jti-current" };

  const account = (overrides: Partial<User> = {}): User => ({
    id: "u1",
    ref: "USR-MEMBER",
    email: "ada@example.com",
    emailHash: "hmac(ada@example.com)",
    phone: "+441632960961",
    phoneHash: "hmac(+441632960961)",
    twoFaMethod: "none",
    country: "GB",
    locale: "en",
    timezone: "UTC",
    status: "active",
    kycTier: 1,
    role: "player",
    fullName: "Ada Lovelace",
    displayName: "Ada",
    referralCode: "MTT-ABC234",
    referralDepth: 0,
    createdAt: new Date(),
    ...overrides,
  }) as User;

  beforeEach(async () => {
    users = repoMock<User>([]);
    prefs = repoMock<NotificationPreference>([]);
    tokens = repoMock<VerificationToken>([]);
    tickets = repoMock<Ticket>([]);
    bus = { publish: jest.fn(async () => undefined) };
    otp = {
      issue: jest.fn(async () => ({ resendAfter: 60, sentTo: "n•••@example.com" })),
      verify: jest.fn(async () => ({ id: "vt-1" })),
    };
    sessions = { revokeAll: jest.fn(async () => 2), listActive: jest.fn(async () => []) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(NotificationPreference), useValue: prefs },
        { provide: getRepositoryToken(LoginHistory), useValue: repoMock<LoginHistory>([]) },
        { provide: getRepositoryToken(VerificationToken), useValue: tokens },
        { provide: getRepositoryToken(Ticket), useValue: tickets },
        { provide: getRepositoryToken(LegalDocument), useValue: repoMock<LegalDocument>([]) },
        { provide: CryptoService, useValue: crypto },
        { provide: EventBusService, useValue: bus },
        {
          provide: AuditService,
          useValue: { record: jest.fn(async () => undefined), recordOrThrow: jest.fn(async () => undefined) },
        },
        { provide: OtpService, useValue: otp },
        { provide: SessionService, useValue: sessions },
        { provide: TwoFactorService, useValue: twoFa },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  /* ==================================================================== *
   * Notification preferences
   * ==================================================================== */

  describe("notification preferences", () => {
    beforeEach(() => {
      prefs.findOne.mockResolvedValue({
        id: "np-1",
        userId: "u1",
        channels: {
          transaction: { email: true, sms: false, push: true },
          promo: { email: false, sms: false, push: false },
          /* A legacy row that somehow acquired a security key. */
          security: { email: true, sms: true, push: true },
        },
        marketingOptIn: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it("never exposes security as a configurable category", async () => {
      const res = await service.notificationPreferences("u1");

      expect(res.channels).not.toHaveProperty("security");
      expect(res.alwaysOn).toEqual(["security"]);
    });

    it("strips a security key on write, so it can never become mutable", async () => {
      const res = await service.updateNotificationPreferences(
        "u1",
        { promo: { email: true, sms: false, push: true } },
        ctx,
      );

      expect(res.channels.promo).toEqual({ email: true, sms: false, push: true });
      expect(res.channels).not.toHaveProperty("security");
      expect(prefs.rows[0].channels).not.toHaveProperty("security");
    });

    it("leaves untouched categories alone", async () => {
      const res = await service.updateNotificationPreferences(
        "u1",
        { promo: { email: true, sms: true, push: true } },
        ctx,
      );

      expect(res.channels.transaction).toEqual({ email: true, sms: false, push: true });
    });

    it("backfills defaults for an account with no preference row", async () => {
      prefs.findOne.mockResolvedValue(null);

      const res = await service.notificationPreferences("u1");

      expect(Object.keys(res.channels)).toContain("transaction");
      expect(res.channels).not.toHaveProperty("security");
    });
  });

  /* ==================================================================== *
   * Contact change
   * ==================================================================== */

  describe("email change", () => {
    it("does not touch the account until the new address is proven", async () => {
      const user = account();
      users.findOne.mockResolvedValue(user);

      const res = await service.startEmailChange("u1", "New@Example.com", REAUTH, ctx);

      expect(res.pending).toBe(true);
      expect(user.email).toBe("ada@example.com");
      expect(users.save).not.toHaveBeenCalled();
      expect(otp.issue).toHaveBeenCalledWith(
        expect.objectContaining({ target: "new@example.com", purpose: "email_change" }),
      );
    });

    it("refuses an address that is already registered", async () => {
      users.findOne.mockResolvedValue(account());
      users.exists.mockResolvedValue(true);

      await expect(
        service.startEmailChange("u1", "taken@example.com", REAUTH, ctx),
      ).rejects.toThrow(ConflictException);

      expect(otp.issue).not.toHaveBeenCalled();
    });

    it("refuses the address the account already has", async () => {
      users.findOne.mockResolvedValue(account());

      await expect(
        service.startEmailChange("u1", "ada@example.com", REAUTH, ctx),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "EMAIL_UNCHANGED" }),
      });
    });

    it("applies the change on confirmation and signs other devices out", async () => {
      const user = account();
      users.findOne.mockResolvedValue(user);
      tokens.findOne.mockResolvedValue({
        id: "vt-1", userId: "u1", purpose: "email_change", target: "new@example.com",
      } as VerificationToken);

      const res = await service.confirmEmailChange("u1", "123456", ctx);

      expect(res.email).toBe("new@example.com");
      expect(user.emailHash).toBe("hmac(new@example.com)");
      expect(user.emailVerifiedAt).toBeInstanceOf(Date);
      /* Changing a recovery channel is a security event. */
      expect(sessions.revokeAll).toHaveBeenCalledWith("u1", "email_changed", "jti-current");
    });

    it("refuses a confirmation with nothing pending", async () => {
      users.findOne.mockResolvedValue(account());
      tokens.findOne.mockResolvedValue(null);

      await expect(service.confirmEmailChange("u1", "123456", ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "NO_PENDING_CHANGE" }),
      });
    });
  });

  describe("phone change", () => {
    it("signs other devices out when the number was the 2FA destination", async () => {
      const user = account({ twoFaMethod: "sms" });
      users.findOne.mockResolvedValue(user);
      tokens.findOne.mockResolvedValue({
        id: "vt-1", userId: "u1", purpose: "phone_verify", target: "+441632960999",
      } as VerificationToken);

      await service.confirmPhoneChange("u1", "123456", ctx);

      expect(user.phone).toBe("+441632960999");
      expect(sessions.revokeAll).toHaveBeenCalledWith(
        "u1", "two_fa_destination_changed", "jti-current",
      );
    });
  });

  /* ==================================================================== *
   * Data-subject requests
   * ==================================================================== */

  describe("data-subject requests", () => {
    it("records an export request and publishes rather than acting inline", async () => {
      users.findOne.mockResolvedValue(account());
      tickets.findOne.mockResolvedValue(null);

      const res = await service.requestDataExport("u1", { format: "json" }, ctx);

      expect(res.ok).toBe(true);
      expect(tickets.rows).toHaveLength(1);
      expect(tickets.rows[0]).toMatchObject({ disputedRef: "data_export", status: "open" });
      expect(bus.publish).toHaveBeenCalledWith(
        Events.TicketCreated,
        expect.objectContaining({ kind: "data_export" }),
        expect.anything(),
      );
    });

    it("refuses a duplicate export request", async () => {
      users.findOne.mockResolvedValue(account());
      tickets.findOne.mockResolvedValue({ id: "t-1", ref: "TK-EXISTING" } as Ticket);

      await expect(
        service.requestDataExport("u1", {}, ctx),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "EXPORT_ALREADY_REQUESTED" }),
      });
    });

    it("requires explicit confirmation before recording a deletion request", async () => {
      await expect(
        service.requestAccountDeletion("u1", { confirm: false }, ctx),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "CONFIRMATION_REQUIRED" }),
      });

      expect(tickets.rows).toHaveLength(0);
    });

    it("routes a deletion request as a financial matter and does not delete anything", async () => {
      const user = account();
      users.findOne.mockResolvedValue(user);
      tickets.findOne.mockResolvedValue(null);

      const res = await service.requestAccountDeletion("u1", { confirm: true }, ctx);

      expect(res.ok).toBe(true);
      expect(tickets.rows[0]).toMatchObject({
        disputedRef: "account_deletion",
        financialDispute: true,
        priority: "high",
      });
      /* Nothing about the account itself changes synchronously. */
      expect(user.status).toBe("active");
      expect(bus.publish).toHaveBeenCalledWith(
        Events.TicketCreated,
        expect.objectContaining({ kind: "account_deletion" }),
        expect.anything(),
      );
    });
  });

  /* ==================================================================== *
   * Re-authentication on contact change
   *
   * The takeover this closes: one stolen access token moved the phone (so 2FA
   * codes went to the attacker), then the email, then triggered a reset to the
   * new address — and the revokeAll that follows an email change signed out the
   * real owner while the attacker kept their session. Four requests, fifteen
   * minutes, no password ever needed.
   * ==================================================================== */

  describe("contact change re-authentication", () => {
    it("refuses an email change without the correct password", async () => {
      users.findOne.mockResolvedValue(account());
      crypto.verifyPassword.mockResolvedValue(false);

      await expect(
        service.startEmailChange("u1", "attacker@evil.com", { password: "wrong" }, ctx),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "REAUTH_FAILED" }) });

      expect(otp.issue).not.toHaveBeenCalled();
    });

    it("refuses a phone change without the correct password", async () => {
      users.findOne.mockResolvedValue(account());
      crypto.verifyPassword.mockResolvedValue(false);

      await expect(
        service.startPhoneChange("u1", "+15550001111", { password: "wrong" }, ctx),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "REAUTH_FAILED" }) });

      expect(otp.issue).not.toHaveBeenCalled();
    });

    it("demands a second factor when the account has one enrolled", async () => {
      users.findOne.mockResolvedValue({ ...account(), twoFaEnabledAt: new Date() });
      crypto.verifyPassword.mockResolvedValue(true);

      await expect(
        service.startEmailChange("u1", "new@example.com", { password: "right" }, ctx),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "TWO_FA_REQUIRED" }) });

      expect(otp.issue).not.toHaveBeenCalled();
    });

    it("refuses a wrong second factor even with the right password", async () => {
      users.findOne.mockResolvedValue({ ...account(), twoFaEnabledAt: new Date() });
      crypto.verifyPassword.mockResolvedValue(true);
      twoFa.verifyForSensitiveAction.mockResolvedValue(false);

      await expect(
        service.startEmailChange("u1", "new@example.com", { password: "right", twoFaCode: "000000" }, ctx),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "TWO_FA_INVALID" }) });

      expect(otp.issue).not.toHaveBeenCalled();
    });
  });

});
