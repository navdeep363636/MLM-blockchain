import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import { Game, GameSession, Tournament, TournamentEntry, User } from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { EventBusService } from "@/events";
import { Queues } from "@/queues/queue.constants";
import { RedisService } from "@/common/redis/redis.service";
import { AuditService } from "@/modules/audit/audit.service";
import { TreasuryService } from "@/modules/treasury/treasury.service";
import {
  TournamentsService, assertSplitTotals, normaliseSplit, prizeForRank,
} from "./tournaments.service";

/* ============================================================================
 * Four properties under test, each protecting money or a promise:
 *
 *  1  the prize split is published before entry and IMMUTABLE after
 *  2  an entry fee is recognised as revenue, so it can fund commission
 *  3  settlement never pays more than the declared pool
 *  4  ranking uses server-VALIDATED scores only
 * ========================================================================== */

const HOUR = 3_600_000;

function repo() {
  return {
    findOne: jest.fn(),
    find: jest.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
    save: jest.fn(async (x: unknown) => x),
    create: jest.fn((x: unknown) => x),
    update: jest.fn(),
    count: jest.fn(async () => 0),
    createQueryBuilder: jest.fn(),
  };
}

function qb(rawMany: Record<string, unknown>[]) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "addSelect", "where", "andWhere", "groupBy", "orderBy", "skip", "take"]) {
    b[m] = jest.fn(() => b);
  }
  b.getRawMany = jest.fn(async () => rawMany);
  b.getRawOne = jest.fn(async () => rawMany[0] ?? {});
  b.getManyAndCount = jest.fn(async () => [[], 0]);
  return b;
}

/** Winner takes 50%, second 30%, places 3-4 share 20% (10% each). */
const SPLIT = [
  { place: "1", share: 5_000 },
  { place: "2", share: 3_000 },
  { place: "3-4", share: 2_000 },
];

const LIVE = {
  id: "trn-1",
  ref: "TRN-ABC",
  gameId: "game-1",
  name: "Friday Cup",
  startsAt: new Date(Date.now() - HOUR),
  endsAt: new Date(Date.now() + HOUR),
  entryFee: "10.000000000000000000",
  prizePool: "1000.000000000000000000",
  participants: 3,
  maxParticipants: 100,
  status: "live" as const,
  format: "best of 3",
  prizeSplit: SPLIT,
  prizeSplitLockedAt: new Date(Date.now() - 2 * HOUR),
  rules: null,
  settledAt: null as Date | null,
};

describe("TournamentsService", () => {
  let svc: TournamentsService;
  let tournaments: ReturnType<typeof repo>;
  let entries: ReturnType<typeof repo>;
  let sessions: ReturnType<typeof repo>;
  let games: ReturnType<typeof repo>;
  let users: ReturnType<typeof repo>;
  let ledger: { withUserLock: jest.Mock; mutateMtt: jest.Mock; getBalance: jest.Mock };
  let treasury: { recognise: jest.Mock };
  let bus: { publish: jest.Mock };
  let redis: { withLock: jest.Mock };
  let audit: { record: jest.Mock; recordOrThrow: jest.Mock };
  let queue: { add: jest.Mock };

  let balance: Record<string, unknown>;
  let written: { entity: string; row: Record<string, unknown> }[];

  beforeEach(async () => {
    tournaments = repo();
    entries = repo();
    sessions = repo();
    games = repo();
    users = repo();
    written = [];
    balance = { mttAvailable: "500.000000000000000000", lastLedgerAt: null };

    ledger = {
      getBalance: jest.fn(async () => balance),
      mutateMtt: jest.fn(async () => ({ row: { ref: "TX-1" }, replayed: false })),
      withUserLock: jest.fn(async (_u: string, fn: (tx: unknown, b: unknown) => Promise<unknown>) => {
        const tx = {
          getRepository: (entity: { name: string }) => ({
            create: (row: Record<string, unknown>) => row,
            save: async (row: Record<string, unknown>) => {
              written.push({ entity: entity.name, row });
              return { createdAt: new Date("2026-02-01T00:00:00Z"), ...row, id: "entry-1" };
            },
          }),
        };
        return fn(tx, balance);
      }),
    };
    treasury = { recognise: jest.fn(async () => ({ id: "rev-1", ref: "RE-1" })) };
    bus = { publish: jest.fn() };
    redis = { withLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()) };
    audit = { record: jest.fn(), recordOrThrow: jest.fn() };
    queue = { add: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        TournamentsService,
        { provide: getRepositoryToken(Tournament), useValue: tournaments },
        { provide: getRepositoryToken(TournamentEntry), useValue: entries },
        { provide: getRepositoryToken(GameSession), useValue: sessions },
        { provide: getRepositoryToken(Game), useValue: games },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: LedgerService, useValue: ledger },
        { provide: TreasuryService, useValue: treasury },
        { provide: EventBusService, useValue: bus },
        { provide: RedisService, useValue: redis },
        { provide: AuditService, useValue: audit },
        { provide: getQueueToken(Queues.Commission), useValue: queue },
      ],
    }).compile();

    svc = mod.get(TournamentsService);
    tournaments.findOne.mockResolvedValue({ ...LIVE });
    entries.findOne.mockResolvedValue(null);
    users.findOne.mockResolvedValue({ id: "u1", ref: "USR-AAA111", status: "active" });
    sessions.createQueryBuilder.mockImplementation(() => qb([]));
    games.findOne.mockResolvedValue({ id: "game-1" });
  });

  /* ==================================================================== *
   * Property 1 — the split is a promise
   * ==================================================================== */

  describe("prize split integrity", () => {
    it("REFUSES a split that does not total exactly 100%", () => {
      expect(() => assertSplitTotals([{ place: "1", share: 6_000 }]))
        .toThrow(BadRequestException);
      expect(() => assertSplitTotals([{ place: "1", share: 11_000 }]))
        .toThrow(BadRequestException);
    });

    it("accepts a split totalling exactly 10000 bps", () => {
      expect(() => assertSplitTotals(SPLIT)).not.toThrow();
    });

    it("REFUSES an empty split — a tournament with no declared prizes cannot open", () => {
      expect(() => assertSplitTotals([])).toThrow(BadRequestException);
    });

    it("REFUSES a malformed place, so a share can never be unassignable", () => {
      expect(() => assertSplitTotals([{ place: "winner", share: 10_000 }]))
        .toThrow(BadRequestException);
      expect(() => assertSplitTotals([{ place: "10-4", share: 10_000 }]))
        .toThrow(BadRequestException);
    });

    it("splits a range equally per place, truncating rather than favouring anyone", () => {
      const normalised = normaliseSplit([{ place: "3-4", share: 2_000 }]);
      expect(normalised[0].sharePerPlaceBps).toBe(1_000);

      /* 1000 bps over 3 places = 333 each; the remaining 1 bps stays in the pool. */
      const odd = normaliseSplit([{ place: "5-7", share: 1_000 }]);
      expect(odd[0].sharePerPlaceBps).toBe(333);
    });

    it("pays nothing to a rank outside the declared split", () => {
      const s = normaliseSplit(SPLIT);
      expect(prizeForRank(9, s, "1000")).toBe("0.000000000000000000");
    });

    it("computes each rank's prize from the pool", () => {
      const s = normaliseSplit(SPLIT);
      expect(prizeForRank(1, s, "1000")).toBe("500.000000000000000000");
      expect(prizeForRank(2, s, "1000")).toBe("300.000000000000000000");
      expect(prizeForRank(3, s, "1000")).toBe("100.000000000000000000");
      expect(prizeForRank(4, s, "1000")).toBe("100.000000000000000000");
    });

    it("REFUSES to change a published tournament's terms", async () => {
      await expect(
        svc.updateDraft(
          "trn-1",
          {
            gameId: "game-1", name: "Friday Cup", startsAt: new Date().toISOString(),
            endsAt: new Date(Date.now() + HOUR).toISOString(), entryFee: "1",
            prizePool: "5000", maxParticipants: 100, format: "x",
            prizeSplit: [{ place: "1", share: 10_000 }],
          },
          "admin-1",
          null,
        ),
      ).rejects.toMatchObject({ response: { code: "PRIZE_SPLIT_LOCKED" } });
    });

    it("locks the split at publication and opens entry", async () => {
      tournaments.findOne.mockResolvedValue({ ...LIVE, status: "draft", prizeSplitLockedAt: null });
      const r = await svc.publish("trn-1", "ready to go", "admin-1", null);
      expect(r.status).toBe("scheduled");
      expect(r.prizeSplitLockedAt).not.toBeNull();
    });

    it("refuses to publish a tournament whose split does not total 100%", async () => {
      tournaments.findOne.mockResolvedValue({
        ...LIVE, status: "draft", prizeSplitLockedAt: null,
        prizeSplit: [{ place: "1", share: 9_000 }],
      });
      await expect(svc.publish("trn-1", "ship it", "admin-1", null))
        .rejects.toMatchObject({ response: { code: "PRIZE_SPLIT_INVALID" } });
    });

    it("creates tournaments as drafts, so entry cannot open by accident", async () => {
      const r = await svc.create(
        {
          gameId: "game-1", name: "Cup", startsAt: new Date(Date.now() + HOUR).toISOString(),
          endsAt: new Date(Date.now() + 2 * HOUR).toISOString(), entryFee: "10",
          prizePool: "1000", maxParticipants: 50, format: "best of 3", prizeSplit: SPLIT,
        },
        "admin-1",
        null,
      );
      expect(r.status).toBe("draft");
      expect(r.entryOpen).toBe(false);
    });

    it("refuses a window that ends before it starts", async () => {
      await expect(
        svc.create(
          {
            gameId: "game-1", name: "Cup", startsAt: new Date(Date.now() + 2 * HOUR).toISOString(),
            endsAt: new Date(Date.now() + HOUR).toISOString(), entryFee: "10",
            prizePool: "1000", maxParticipants: 50, format: "x", prizeSplit: SPLIT,
          },
          "admin-1",
          null,
        ),
      ).rejects.toMatchObject({ response: { code: "WINDOW_INVALID" } });
    });
  });

  /* ==================================================================== *
   * Property 2 — an entry fee is revenue
   * ==================================================================== */

  describe("register", () => {
    it("charges the fee and RECOGNISES it as tournament revenue", async () => {
      const r = await svc.register("u1", "TRN-ABC", "1.2.3.4");

      expect(balance.mttAvailable).toBe("490.000000000000000000");
      expect(treasury.recognise).toHaveBeenCalledWith(
        expect.objectContaining({ stream: "tournament", grossAmount: "10.000000000000000000" }),
      );
      expect(r.revenueEventId).toBe("rev-1");
    });

    it("uses a deterministic processor reference, so a replay cannot double-count revenue", async () => {
      await svc.register("u1", "TRN-ABC", null);
      expect(treasury.recognise).toHaveBeenCalledWith(
        expect.objectContaining({ processorRef: "tournament:trn-1:u1" }),
      );
    });

    it("queues the commission fan-out for the fee", async () => {
      await svc.register("u1", "TRN-ABC", null);
      expect(queue.add).toHaveBeenCalledWith(
        "process-revenue-event", { revenueEventId: "rev-1" }, { jobId: "commission-rev-1" },
      );
    });

    it("charges the fee and writes the entry in ONE commit", async () => {
      await svc.register("u1", "TRN-ABC", null);
      expect(ledger.withUserLock).toHaveBeenCalledTimes(1);
      expect(written.some((w) => w.entity === "TournamentEntry")).toBe(true);
    });

    it("REFUSES entry with an insufficient balance, charging nothing", async () => {
      balance.mttAvailable = "5.000000000000000000";
      await expect(svc.register("u1", "TRN-ABC", null))
        .rejects.toMatchObject({ response: { code: "INSUFFICIENT_BALANCE" } });
      expect(treasury.recognise).not.toHaveBeenCalled();
    });

    it("REFUSES entry before the prize split is published", async () => {
      tournaments.findOne.mockResolvedValue({ ...LIVE, prizeSplitLockedAt: null });
      await expect(svc.register("u1", "TRN-ABC", null))
        .rejects.toMatchObject({ response: { code: "PRIZE_SPLIT_NOT_PUBLISHED" } });
    });

    it("REFUSES entry to a full tournament", async () => {
      tournaments.findOne.mockResolvedValue({ ...LIVE, participants: 100 });
      await expect(svc.register("u1", "TRN-ABC", null))
        .rejects.toMatchObject({ response: { code: "TOURNAMENT_FULL" } });
    });

    it("REFUSES entry once the tournament has ended", async () => {
      tournaments.findOne.mockResolvedValue({ ...LIVE, endsAt: new Date(Date.now() - HOUR) });
      await expect(svc.register("u1", "TRN-ABC", null))
        .rejects.toMatchObject({ response: { code: "ENTRY_CLOSED" } });
    });

    it("REFUSES entry from a frozen account", async () => {
      users.findOne.mockResolvedValue({ id: "u1", ref: "USR-A", status: "frozen" });
      await expect(svc.register("u1", "TRN-ABC", null)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("is idempotent: a second registration returns the entry without charging again", async () => {
      entries.findOne.mockResolvedValue({
        id: "entry-1", paidAmount: "10.000000000000000000", revenueEventId: "rev-1",
      });
      const r = await svc.register("u1", "TRN-ABC", null);
      expect(r.revenueEventId).toBe("rev-1");
      expect(ledger.withUserLock).not.toHaveBeenCalled();
    });

    it("recognises no revenue for a free tournament, but still records the entry", async () => {
      tournaments.findOne.mockResolvedValue({ ...LIVE, entryFee: "0" });
      const r = await svc.register("u1", "TRN-ABC", null);
      expect(treasury.recognise).not.toHaveBeenCalled();
      expect(r.revenueEventId).toBeNull();
      expect(written.some((w) => w.entity === "TournamentEntry")).toBe(true);
    });
  });

  /* ==================================================================== *
   * Property 4 — validated scores only
   * ==================================================================== */

  describe("standings", () => {
    beforeEach(() => {
      entries.find.mockResolvedValue([
        { id: "e1", tournamentId: "trn-1", userId: "u1", disqualified: false },
        { id: "e2", tournamentId: "trn-1", userId: "u2", disqualified: false },
      ]);
      users.find.mockResolvedValue([
        { id: "u1", ref: "USR-AAA111" },
        { id: "u2", ref: "USR-BBB222" },
      ]);
      sessions.createQueryBuilder.mockImplementation(() =>
        qb([{ userId: "u2", best: "900" }, { userId: "u1", best: "500" }]),
      );
    });

    it("ranks on the best VALIDATED session score", async () => {
      const builder = qb([{ userId: "u2", best: "900" }]);
      sessions.createQueryBuilder.mockReturnValue(builder);

      await svc.standings("TRN-ABC", "u1");

      const statusFilter = (builder.andWhere as jest.Mock).mock.calls.find(
        (c) => typeof c[0] === "string" && (c[0]).includes("s.status"),
      );
      expect(statusFilter?.[1]).toEqual({ status: "validated" });
    });

    it("anonymises other players and labels the caller", async () => {
      const s = await svc.standings("TRN-ABC", "u1");
      const you = s.standings.find((r) => r.isYou);
      const other = s.standings.find((r) => !r.isYou);

      expect(you?.label).toBe("You");
      expect(other?.label).toMatch(/^Member #/);
      expect(JSON.stringify(s)).not.toContain("u2");
    });

    it("projects the prize each standing would currently win", async () => {
      const s = await svc.standings("TRN-ABC", "u1");
      expect(s.standings[0].rank).toBe(1);
      expect(s.standings[0].projectedPrize).toBe("500.000000000000000000");
      expect(s.standings[1].projectedPrize).toBe("300.000000000000000000");
    });

    it("always returns the caller's own row", async () => {
      const s = await svc.standings("TRN-ABC", "u1");
      expect(s.you).not.toBeNull();
      expect(s.you?.isYou).toBe(true);
    });

    it("EXCLUDES a disqualified entry entirely rather than ranking it last", async () => {
      entries.find.mockResolvedValue([
        { id: "e1", tournamentId: "trn-1", userId: "u1", disqualified: false },
        { id: "e2", tournamentId: "trn-1", userId: "u2", disqualified: true },
      ]);
      const s = await svc.standings("TRN-ABC", "u1");
      /* u1 is now rank 1, not rank 2 behind a disqualified entry. */
      expect(s.standings).toHaveLength(1);
      expect(s.you?.rank).toBe(1);
    });

    it("treats a member with no validated session as zero, not absent", async () => {
      sessions.createQueryBuilder.mockImplementation(() => qb([{ userId: "u2", best: "900" }]));
      const s = await svc.standings("TRN-ABC", "u1");
      expect(s.you?.bestScore).toBe(0);
      expect(s.you?.rank).toBe(2);
    });
  });

  /* ==================================================================== *
   * Property 3 — never overpay the pool
   * ==================================================================== */

  describe("settle", () => {
    const ended = { ...LIVE, endsAt: new Date(Date.now() - HOUR) };

    beforeEach(() => {
      tournaments.findOne.mockResolvedValue({ ...ended });
      entries.find.mockResolvedValue([
        { id: "e1", tournamentId: "trn-1", userId: "u1", disqualified: false },
        { id: "e2", tournamentId: "trn-1", userId: "u2", disqualified: false },
      ]);
      users.find.mockResolvedValue([
        { id: "u1", ref: "USR-AAA111" },
        { id: "u2", ref: "USR-BBB222" },
      ]);
      sessions.createQueryBuilder.mockImplementation(() =>
        qb([{ userId: "u1", best: "900" }, { userId: "u2", best: "500" }]),
      );
    });

    it("pays each rank its declared share, and no more than the pool", async () => {
      const r = await svc.settle("trn-1", "admin-1");

      expect(r.paidEntries).toBe(2);
      expect(r.totalPaid).toBe("800.000000000000000000");
      /* 20% was allocated to places 3-4, which nobody filled: it stays unpaid. */
      expect(r.unallocated).toBe("200.000000000000000000");
    });

    it("REFUSES to settle before the tournament has ended", async () => {
      tournaments.findOne.mockResolvedValue({ ...LIVE });
      await expect(svc.settle("trn-1"))
        .rejects.toMatchObject({ response: { code: "TOURNAMENT_NOT_ENDED" } });
      expect(ledger.mutateMtt).not.toHaveBeenCalled();
    });

    it("keys each prize payment on the tournament and member, so a replay cannot pay twice", async () => {
      await svc.settle("trn-1");
      expect(ledger.mutateMtt).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: "prize:trn-1:u1", type: "prize_payout", sourceTag: "prize",
        }),
      );
    });

    it("is idempotent: settling an already settled tournament pays nothing more", async () => {
      tournaments.findOne.mockResolvedValue({ ...ended, settledAt: new Date() });
      await svc.settle("trn-1");
      expect(ledger.mutateMtt).not.toHaveBeenCalled();
    });

    it("shares are proportional, so a valid schedule can never exceed the pool", async () => {
      tournaments.findOne.mockResolvedValue({ ...ended, prizePool: "600" });

      const r = await svc.settle("trn-1");

      /* 50% and 30% of 600. Because shares are bps of the pool and are validated
       * to total 10000, overdrawing is arithmetically impossible for a valid
       * split — the clamp below exists for a corrupted one. */
      expect(r.totalPaid).toBe("480.000000000000000000");
    });

    it("CLAMPS payment at the pool when a stored split is corrupt and over-allocates", async () => {
      /* A split totalling 16000 bps could only exist if it was written before
       * validation, or by a bug. The pool is still the hard ceiling. */
      tournaments.findOne.mockResolvedValue({
        ...ended,
        prizePool: "1000",
        prizeSplit: [{ place: "1", share: 8_000 }, { place: "2", share: 8_000 }],
      });

      const r = await svc.settle("trn-1");

      expect(r.totalPaid).toBe("1000.000000000000000000");
      const amounts = ledger.mutateMtt.mock.calls.map(
        (c) => (c[0] as { amountMtt: string }).amountMtt,
      );
      expect(amounts).toEqual(["800.000000000000000000", "200.000000000000000000"]);
    });

    it("records everyone's rank, prize or not", async () => {
      await svc.settle("trn-1");
      const rankUpdates = entries.update.mock.calls.filter(
        (c) => (c[1] as Record<string, unknown>).rank !== undefined,
      );
      expect(rankUpdates.length).toBeGreaterThanOrEqual(2);
    });

    it("writes each entry ONCE — the rank pass skips rows the prize pass wrote", async () => {
      /* Both winners were paid, and the payment already recorded rank and score.
       * The rank pass used to rewrite every ranked entry regardless, so a
       * settlement cost two UPDATEs per winner. */
      await svc.settle("trn-1");

      const updatedIds = entries.update.mock.calls.map((c) => (c[0] as { id: string }).id);
      expect(updatedIds).toEqual(["e1", "e2"]);
      expect(new Set(updatedIds).size).toBe(updatedIds.length);
    });

    it("marks the tournament completed and publishes the settlement", async () => {
      await svc.settle("trn-1");
      expect(tournaments.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: "completed", settledAt: expect.any(Date) }),
      );
      const settled = (bus.publish.mock.calls as [string, Record<string, unknown>][])
        .find(([n]) => n === "tournament.settled");
      expect(settled?.[1].totalPaid).toBe("800.000000000000000000");
    });

    it("serialises settlement so two operators cannot both pay the prizes", async () => {
      redis.withLock.mockResolvedValue(null);
      await expect(svc.settle("trn-1"))
        .rejects.toMatchObject({ response: { code: "SETTLEMENT_IN_FLIGHT" } });
    });
  });

  /* ==================================================================== *
   * Disqualification
   * ==================================================================== */

  describe("disqualify", () => {
    it("REFUSES to disqualify after a prize has been paid", async () => {
      entries.findOne.mockResolvedValue({
        id: "e1", tournamentId: "trn-1", userId: "u1",
        disqualified: false, prizePaidAt: new Date(),
      });
      await expect(svc.disqualify("trn-1", "u1", "cheating", "admin-1", null))
        .rejects.toMatchObject({ response: { code: "PRIZE_ALREADY_PAID" } });
    });

    it("records the reason so the member can be told why", async () => {
      entries.findOne.mockResolvedValue({
        id: "e1", tournamentId: "trn-1", userId: "u1", disqualified: false,
        prizePaidAt: null, paidAmount: "10", prizeAmount: "0",
        createdAt: new Date("2026-02-01T00:00:00Z"),
      });

      const r = await svc.disqualify("trn-1", "u1", "modified client detected", "admin-1", "1.2.3.4");

      expect(r.disqualified).toBe(true);
      expect(r.disqualificationReason).toBe("modified client detected");
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ action: "tournament.disqualify" }),
      );
    });
  });

  describe("advanceLifecycle", () => {
    it("starts scheduled tournaments whose time has come", async () => {
      tournaments.find.mockImplementation(async (...args: unknown[]) => {
        const where = (args[0] as { where: { status: string } }).where;
        return where.status === "scheduled"
          ? [{ id: "t1", status: "scheduled", startsAt: new Date(Date.now() - 1_000) }]
          : [];
      });

      const r = await svc.advanceLifecycle();
      expect(r.started).toBe(1);
    });

    it("queues ended tournaments for settlement with a deterministic job id", async () => {
      tournaments.find.mockImplementation(async (...args: unknown[]) => {
        const where = (args[0] as { where: { status: string } }).where;
        return where.status === "live"
          ? [{ id: "t1", status: "live", endsAt: new Date(Date.now() - 1_000) }]
          : [];
      });

      const r = await svc.advanceLifecycle();
      expect(r.queuedForSettlement).toBe(1);
      expect(queue.add).toHaveBeenCalledWith(
        "settle-tournament", { tournamentId: "t1" }, { jobId: "settle-tournament-t1" },
      );
    });

    it("leaves a tournament that has not started or ended alone", async () => {
      tournaments.find.mockResolvedValue([
        { id: "t1", status: "scheduled", startsAt: new Date(Date.now() + HOUR), endsAt: new Date(Date.now() + 2 * HOUR) },
      ]);
      const r = await svc.advanceLifecycle();
      expect(r.started).toBe(0);
      expect(ConflictException).toBeDefined();
    });
  });
});
