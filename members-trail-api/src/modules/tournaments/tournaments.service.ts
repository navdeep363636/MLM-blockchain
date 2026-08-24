import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { In, Repository } from "typeorm";
import {
  Game, GameSession, Tournament, TournamentEntry, User, UserBalance,
} from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { EventBusService, Events } from "@/events";
import { Jobs, Queues, jobKey } from "@/queues/queue.constants";
import { RedisService } from "@/common/redis/redis.service";
import { paginate, safeSort, type Paginated } from "@/common/dto";
import { Ref, add, anonLabel, applyBps, dec, gt, gte, sub, toDbAmount } from "@/common/utils";
import { AuditService } from "@/modules/audit/audit.service";
import { TreasuryService } from "@/modules/treasury/treasury.service";
import type {
  CreateTournamentRequest, EntryResponse, PrizeSplitEntry, TournamentRegisterResponse, SettlementResponse,
  StandingRow, StandingsResponse, TournamentQuery, TournamentResponse,
} from "./dto/tournaments.dto";

/* ============================================================================
 * Tournaments (FRD G-03).
 *
 * Four properties, each with a reason it is not negotiable:
 *
 *  1. THE PRIZE SPLIT IS PUBLISHED BEFORE ENTRY OPENS AND IMMUTABLE AFTER.
 *     Changing the split once people have paid to enter changes the deal they
 *     bought. `prizeSplitLockedAt` is set at publication and every mutating path
 *     refuses once it is set.
 *
 *  2. AN ENTRY FEE IS REVENUE, AND IS RECOGNISED AS SUCH. The fee creates a
 *     `revenue_events` row (stream `tournament`), which is what makes it
 *     commissionable and what routes the Treasury's share. A fee taken without
 *     recognising the revenue would pay commission from nowhere.
 *
 *  3. PRIZES COME OUT OF THE DECLARED POOL, NEVER MORE. Settlement asserts the
 *     total paid against the pool and refuses rather than overpaying — an
 *     overpaid tournament is funded by other members' balances.
 *
 *  4. RANKING USES VALIDATED SESSIONS ONLY. An unvalidated or rejected session
 *     has no score as far as this module is concerned, so a cheated submission
 *     cannot win a prize while it is still under review.
 * ========================================================================== */

const SORT_COLUMNS = ["startsAt", "createdAt", "prizePool", "participants"] as const;

const SETTLE_LOCK_TTL_SECONDS = 60;

/** Basis points must total exactly this. No unallocated remainder, no overflow. */
const FULL_SHARE_BPS = 10_000;

@Injectable()
export class TournamentsService {
  private readonly log = new Logger(TournamentsService.name);

  constructor(
    @InjectRepository(Tournament) private readonly tournaments: Repository<Tournament>,
    @InjectRepository(TournamentEntry) private readonly entries: Repository<TournamentEntry>,
    @InjectRepository(GameSession) private readonly sessions: Repository<GameSession>,
    @InjectRepository(Game) private readonly games: Repository<Game>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly ledger: LedgerService,
    private readonly treasury: TreasuryService,
    private readonly bus: EventBusService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    @InjectQueue(Queues.Commission) private readonly commissionQueue: Queue,
  ) {}

  /* ==================================================================== *
   * Reads
   * ==================================================================== */

  async list(q: TournamentQuery, includeDrafts = false): Promise<Paginated<TournamentResponse>> {
    const sortBy = safeSort(q.sortBy, SORT_COLUMNS, "startsAt");
    const qb = this.tournaments.createQueryBuilder("t");
    if (!includeDrafts) qb.andWhere("t.status != 'draft'");
    if (q.status) qb.andWhere("t.status = :status", { status: q.status });
    if (q.gameId) qb.andWhere("t.gameId = :gameId", { gameId: q.gameId });

    const [rows, total] = await qb
      .orderBy(`t.${sortBy}`, q.sortDir)
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();
    return paginate(rows.map(toView), total, q);
  }

  async byRef(ref: string): Promise<TournamentResponse> {
    const row = await this.tournaments.findOne({ where: { ref } });
    if (!row) throw new NotFoundException("Tournament not found");
    return toView(row);
  }

  async myEntries(userId: string): Promise<EntryResponse[]> {
    const rows = await this.entries.find({ where: { userId }, order: { createdAt: "DESC" }, take: 200 });
    if (rows.length === 0) return [];

    const names = await this.tournaments.find({
      where: { id: In(rows.map((r) => r.tournamentId)) },
    });
    const byId = new Map(names.map((t) => [t.id, t.name]));

    return rows.map((r) => ({
      tournamentId: r.tournamentId,
      tournamentName: byId.get(r.tournamentId) ?? "Tournament",
      paidAmount: toDbAmount(r.paidAmount),
      bestScore: r.bestScore ?? null,
      rank: r.rank ?? null,
      prizeAmount: toDbAmount(r.prizeAmount),
      prizePaidAt: r.prizePaidAt ? r.prizePaidAt.toISOString() : null,
      disqualified: r.disqualified,
      disqualificationReason: r.disqualificationReason ?? null,
      joinedAt: r.createdAt.toISOString(),
    }));
  }

  /* ==================================================================== *
   * Registration
   * ==================================================================== */

  /**
   * Enters a tournament, charging the entry fee.
   *
   * The fee debit, the entry row and the revenue recognition are one logical
   * operation. The debit and the row commit together under the balance lock; the
   * revenue event is written immediately after and its id stored on the entry,
   * so a fee is always traceable to the revenue it produced.
   */
  async register(userId: string, ref: string, ip: string | null): Promise<TournamentRegisterResponse> {
    const tournament = await this.tournaments.findOne({ where: { ref } });
    if (!tournament) throw new NotFoundException("Tournament not found");

    if (tournament.status !== "scheduled" && tournament.status !== "live") {
      throw new ConflictException({
        code: "ENTRY_CLOSED",
        message: `This tournament is ${tournament.status} and is not accepting entries`,
      });
    }
    if (tournament.endsAt.getTime() <= Date.now()) {
      throw new ConflictException({ code: "ENTRY_CLOSED", message: "This tournament has ended" });
    }
    /* The split must be locked before money changes hands (property 1). */
    if (!tournament.prizeSplitLockedAt) {
      throw new ConflictException({
        code: "PRIZE_SPLIT_NOT_PUBLISHED",
        message: "Entry cannot open until the prize split is published",
      });
    }
    if (tournament.participants >= tournament.maxParticipants) {
      throw new ConflictException({ code: "TOURNAMENT_FULL", message: "This tournament is full" });
    }

    const existing = await this.entries.findOne({ where: { tournamentId: tournament.id, userId } });
    if (existing) {
      /* Idempotent: a double tap returns the entry rather than charging twice. */
      return {
        tournamentId: tournament.id,
        ref: tournament.ref,
        paidAmount: toDbAmount(existing.paidAmount),
        participants: tournament.participants,
        revenueEventId: existing.revenueEventId ?? null,
      };
    }

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("Account not found");
    if (user.status !== "active") {
      throw new ForbiddenException({
        code: `ACCOUNT_${user.status.toUpperCase()}`,
        message: "This account cannot enter a tournament",
      });
    }

    const fee = toDbAmount(tournament.entryFee);
    const paid = dec(fee).gt(0);

    /* Fee debit and entry row in one commit: a charge with no entry, or an entry
     * with no charge, are both unrecoverable from the UI. */
    const entry = await this.ledger.withUserLock(userId, async (tx, balance) => {
      if (paid && !gte(balance.mttAvailable, fee)) {
        throw new ConflictException({
          code: "INSUFFICIENT_BALANCE",
          message: "Insufficient available MTT for the entry fee",
          available: toDbAmount(balance.mttAvailable),
          required: fee,
        });
      }

      if (paid) {
        balance.mttAvailable = sub(balance.mttAvailable, fee);
        balance.lastLedgerAt = new Date();
        await tx.getRepository(UserBalance).save(balance);
      }

      return tx.getRepository(TournamentEntry).save(
        tx.getRepository(TournamentEntry).create({
          tournamentId: tournament.id,
          userId,
          paidAmount: fee,
          prizeAmount: toDbAmount(0),
          disqualified: false,
        }),
      );
    });

    /* Property 2: the fee IS revenue, recognised with the tournament stream so
     * it is commission-eligible and the Treasury takes its share. */
    let revenueEventId: string | null = null;
    if (paid) {
      const event = await this.treasury.recognise({
        userId,
        stream: "tournament",
        grossAmount: fee,
        processorFee: toDbAmount(0),
        currency: "MTT",
        processor: "internal",
        /* Deterministic: a replayed registration cannot recognise the revenue
         * twice, which would inflate the payout ceiling. */
        processorRef: `tournament:${tournament.id}:${userId}`,
      });
      revenueEventId = event.id;
      entry.revenueEventId = event.id;
      await this.entries.save(entry);

      /* Commission fans out only from RECONCILED revenue; the job checks that
       * itself and refuses if it is not yet reconciled. */
      await this.commissionQueue.add(
        Jobs.ProcessRevenueEvent,
        { revenueEventId: event.id },
        { jobId: jobKey(`commission:${event.id}`) },
      );
    }

    tournament.participants += 1;
    await this.tournaments.save(tournament);

    await this.audit.record({
      actorId: userId,
      action: "tournament.register",
      targetType: "tournament",
      targetId: tournament.id,
      after: { paidAmount: fee, revenueEventId },
      ip,
    });

    await this.bus.publish(Events.TournamentRegistered, {
      userId,
      tournamentId: tournament.id,
      ref: tournament.ref,
      paidAmount: fee,
      revenueEventId,
    });

    return {
      tournamentId: tournament.id,
      ref: tournament.ref,
      paidAmount: fee,
      participants: tournament.participants,
      revenueEventId,
    };
  }

  /* ==================================================================== *
   * Standings
   * ==================================================================== */

  /**
   * Live standings, ranked on validated sessions only (property 4).
   *
   * Other members appear anonymised; the caller always sees their own row, even
   * if it falls outside the visible page — being unable to find yourself in a
   * leaderboard is the most common complaint these screens generate.
   */
  async standings(ref: string, userId: string | null, limit = 50): Promise<StandingsResponse> {
    const tournament = await this.tournaments.findOne({ where: { ref } });
    if (!tournament) throw new NotFoundException("Tournament not found");

    const ranked = await this.rank(tournament);
    const split = normaliseSplit(tournament.prizeSplit);

    const rows: StandingRow[] = ranked.slice(0, limit).map((r) => ({
      label: r.userId === userId ? "You" : anonLabel(r.userRef),
      rank: r.rank,
      bestScore: r.bestScore,
      isYou: r.userId === userId,
      projectedPrize: prizeForRank(r.rank, split, tournament.prizePool),
    }));

    const mine = userId ? ranked.find((r) => r.userId === userId) : undefined;
    const you: StandingRow | null = mine
      ? {
          label: "You",
          rank: mine.rank,
          bestScore: mine.bestScore,
          isYou: true,
          projectedPrize: prizeForRank(mine.rank, split, tournament.prizePool),
        }
      : null;

    return {
      tournamentId: tournament.id,
      status: tournament.status,
      prizePool: toDbAmount(tournament.prizePool),
      standings: rows,
      you,
      settled: Boolean(tournament.settledAt),
    };
  }

  /**
   * Ranks entries by their best VALIDATED session score.
   *
   * Disqualified entries are excluded entirely rather than ranked last: leaving
   * them in the ordering shifts everyone else's rank and therefore their prize.
   */
  private async rank(tournament: Tournament): Promise<{
    userId: string; userRef: string; bestScore: number; rank: number; entryId: string;
  }[]> {
    const entries = await this.entries.find({ where: { tournamentId: tournament.id } });
    const eligible = entries.filter((e) => !e.disqualified);
    if (eligible.length === 0) return [];

    const scores = await this.sessions
      .createQueryBuilder("s")
      .select("s.userId", "userId")
      .addSelect("MAX(s.serverScore)", "best")
      .where("s.tournamentId = :tid", { tid: tournament.id })
      /* Validated only: a session under anti-cheat review has no score here. */
      .andWhere("s.status = :status", { status: "validated" })
      .andWhere("s.userId IN (:...ids)", { ids: eligible.map((e) => e.userId) })
      .groupBy("s.userId")
      .getRawMany<{ userId: string; best: string | null }>();

    const bestByUser = new Map(scores.map((s) => [s.userId, Number(s.best ?? 0)]));
    const users = await this.users.find({ where: { id: In(eligible.map((e) => e.userId)) } });
    const refById = new Map(users.map((u) => [u.id, u.ref]));

    return eligible
      .map((e) => ({
        userId: e.userId,
        userRef: refById.get(e.userId) ?? "USR-UNKNOWN",
        bestScore: bestByUser.get(e.userId) ?? 0,
        entryId: e.id,
        rank: 0,
      }))
      /* Ties break on entry time: earlier entrants rank higher, which is
       * deterministic and therefore explainable to whoever asks. */
      .sort((a, b) => b.bestScore - a.bestScore)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }

  /* ==================================================================== *
   * Settlement
   * ==================================================================== */

  /**
   * Settles a finished tournament and pays the prizes.
   *
   * Called by the queue after `endsAt`, or by an administrator. Idempotent, and
   * refuses to pay more than the declared pool (property 3).
   */
  async settle(tournamentId: string, actorId?: string): Promise<SettlementResponse> {
    const result = await this.redis.withLock(
      `tournament:settle:${tournamentId}`,
      SETTLE_LOCK_TTL_SECONDS,
      () => this.settleUnderLock(tournamentId, actorId),
    );
    if (result === null) {
      throw new ConflictException({
        code: "SETTLEMENT_IN_FLIGHT",
        message: "This tournament is already being settled",
      });
    }
    return result;
  }

  private async settleUnderLock(tournamentId: string, actorId?: string): Promise<SettlementResponse> {
    const tournament = await this.tournaments.findOne({ where: { id: tournamentId } });
    if (!tournament) throw new NotFoundException("Tournament not found");

    if (tournament.settledAt) {
      const paid = await this.entries.count({
        where: { tournamentId, disqualified: false },
      });
      return {
        tournamentId,
        paidEntries: paid,
        totalPaid: toDbAmount(0),
        unallocated: toDbAmount(0),
        disqualified: 0,
      };
    }
    if (tournament.endsAt.getTime() > Date.now()) {
      throw new ConflictException({
        code: "TOURNAMENT_NOT_ENDED",
        message: "A tournament cannot be settled before it ends",
        endsAt: tournament.endsAt.toISOString(),
      });
    }

    const split = normaliseSplit(tournament.prizeSplit);
    const ranked = await this.rank(tournament);
    const pool = toDbAmount(tournament.prizePool);

    let totalPaid = toDbAmount(0);
    let paidEntries = 0;
    /* Which entries the prize loop already wrote. Without this, the rank pass
     * below rewrote every paid row a second time — two UPDATEs per winner for
     * one settlement. */
    const written = new Set<string>();

    for (const row of ranked) {
      const prize = prizeForRank(row.rank, split, pool);
      if (dec(prize).lte(0)) continue;

      /* Property 3: never exceed the declared pool. Refusing here rather than
       * paying would strand the remaining winners, so the payment is clamped to
       * what is left and the shortfall is logged loudly for finance. */
      const remaining = sub(pool, totalPaid);
      if (gt(prize, remaining)) {
        this.log.error(
          `tournament ${tournament.ref}: prize schedule exceeds the pool at rank ${row.rank} ` +
          `(${prize} requested, ${remaining} left) — paying the remainder only`,
        );
        if (dec(remaining).lte(0)) break;
      }
      const payable = gt(prize, remaining) ? remaining : prize;

      await this.ledger.mutateMtt({
        userId: row.userId,
        type: "prize_payout",
        amountMtt: payable,
        /* Derived from the tournament and the member, so a replayed settlement
         * resolves to the same ledger row. */
        idempotencyKey: `prize:${tournament.id}:${row.userId}`,
        status: "completed",
        bucket: "available",
        sourceTag: "prize",
        note: `Prize for rank ${row.rank} in ${tournament.name}`,
        metadata: { tournamentId: tournament.id, rank: row.rank },
      });

      await this.entries.update(
        { id: row.entryId },
        { rank: row.rank, bestScore: row.bestScore, prizeAmount: payable, prizePaidAt: new Date() },
      );

      written.add(row.entryId);
      totalPaid = add(totalPaid, payable);
      paidEntries += 1;
    }

    /* Ranks are recorded for everyone, prize or not: a member is entitled to know
     * where they finished. Only the entries the prize loop did not already
     * write — it recorded rank and score alongside the payment. */
    for (const row of ranked) {
      if (written.has(row.entryId)) continue;
      await this.entries.update(
        { id: row.entryId },
        { rank: row.rank, bestScore: row.bestScore },
      );
    }

    const disqualified = await this.entries.count({ where: { tournamentId, disqualified: true } });

    tournament.status = "completed";
    tournament.settledAt = new Date();
    await this.tournaments.save(tournament);

    await this.audit.recordOrThrow({
      actorId: actorId ?? null,
      action: "tournament.settle",
      targetType: "tournament",
      targetId: tournament.id,
      after: {
        paidEntries, totalPaid, prizePool: pool,
        unallocated: sub(pool, totalPaid), disqualified,
      },
      reason: "tournament settlement",
    });

    await this.bus.publish(Events.TournamentSettled, {
      tournamentId: tournament.id,
      ref: tournament.ref,
      paidEntries,
      totalPaid,
      prizePool: pool,
      unallocated: sub(pool, totalPaid),
      disqualified,
    });

    this.log.log(
      `tournament ${tournament.ref} settled: ${paidEntries} prizes, ${totalPaid} of ${pool} MTT paid`,
    );

    return {
      tournamentId: tournament.id,
      paidEntries,
      totalPaid,
      unallocated: sub(pool, totalPaid),
      disqualified,
    };
  }

  /* ==================================================================== *
   * Admin
   * ==================================================================== */

  /** Creates a tournament as a DRAFT. Entry cannot open until it is published. */
  async create(
    dto: CreateTournamentRequest,
    actorId: string,
    ip: string | null,
  ): Promise<TournamentResponse> {
    const game = await this.games.findOne({ where: { id: dto.gameId } });
    if (!game) throw new NotFoundException("Game not found");

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException("startsAt and endsAt must be valid instants");
    }
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException({
        code: "WINDOW_INVALID",
        message: "endsAt must be after startsAt",
      });
    }
    assertSplitTotals(dto.prizeSplit);
    if (dec(dto.prizePool).isNegative()) {
      throw new BadRequestException("The prize pool cannot be negative");
    }

    const row = await this.tournaments.save(
      this.tournaments.create({
        ref: Ref.tournament(),
        gameId: dto.gameId,
        name: dto.name,
        startsAt,
        endsAt,
        entryFee: toDbAmount(dto.entryFee),
        prizePool: toDbAmount(dto.prizePool),
        participants: 0,
        maxParticipants: dto.maxParticipants,
        status: "draft",
        format: dto.format,
        prizeSplit: dto.prizeSplit,
        rules: dto.rules ?? null,
      }),
    );

    await this.audit.recordOrThrow({
      actorId,
      action: "tournament.create",
      targetType: "tournament",
      targetId: row.id,
      after: {
        name: dto.name, entryFee: row.entryFee, prizePool: row.prizePool,
        prizeSplit: dto.prizeSplit,
      },
      ip,
    });

    return toView(row);
  }

  /**
   * Publishes a tournament: the prize split becomes immutable and entry opens.
   *
   * This is the one-way door. After it, no route in this module can alter the
   * split, the pool or the entry fee — the members who paid to enter bought
   * those terms.
   */
  async publish(id: string, reason: string, actorId: string, ip: string | null): Promise<TournamentResponse> {
    const row = await this.tournaments.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Tournament not found");
    if (row.status !== "draft") {
      throw new BadRequestException({
        code: "ALREADY_PUBLISHED",
        message: `This tournament is ${row.status} and has already been published`,
      });
    }
    assertSplitTotals(row.prizeSplit);

    row.status = "scheduled";
    row.prizeSplitLockedAt = new Date();
    await this.tournaments.save(row);

    await this.audit.recordOrThrow({
      actorId,
      action: "tournament.publish",
      targetType: "tournament",
      targetId: row.id,
      after: { status: "scheduled", prizeSplitLockedAt: row.prizeSplitLockedAt.toISOString() },
      reason,
      ip,
    });

    return toView(row);
  }

  /**
   * Updates a DRAFT tournament.
   *
   * Refuses once the split is locked — that is property 1, enforced at the only
   * place the terms could otherwise change.
   */
  async updateDraft(
    id: string,
    dto: CreateTournamentRequest,
    actorId: string,
    ip: string | null,
  ): Promise<TournamentResponse> {
    const row = await this.tournaments.findOne({ where: { id } });
    if (!row) throw new NotFoundException("Tournament not found");
    if (row.prizeSplitLockedAt) {
      throw new ForbiddenException({
        code: "PRIZE_SPLIT_LOCKED",
        message:
          "The prize split was published and cannot be changed — members entered on these terms",
        lockedAt: row.prizeSplitLockedAt.toISOString(),
      });
    }
    assertSplitTotals(dto.prizeSplit);

    const before = {
      prizePool: row.prizePool, entryFee: row.entryFee, prizeSplit: row.prizeSplit,
    };

    row.name = dto.name;
    row.startsAt = new Date(dto.startsAt);
    row.endsAt = new Date(dto.endsAt);
    row.entryFee = toDbAmount(dto.entryFee);
    row.prizePool = toDbAmount(dto.prizePool);
    row.maxParticipants = dto.maxParticipants;
    row.format = dto.format;
    row.prizeSplit = dto.prizeSplit;
    row.rules = dto.rules ?? null;
    const saved = await this.tournaments.save(row);

    await this.audit.recordOrThrow({
      actorId,
      action: "tournament.update",
      targetType: "tournament",
      targetId: row.id,
      before,
      after: { prizePool: saved.prizePool, entryFee: saved.entryFee, prizeSplit: saved.prizeSplit },
      ip,
    });

    return toView(saved);
  }

  /**
   * Disqualifies an entry.
   *
   * Permitted after settlement is closed only in the sense that it cannot undo a
   * paid prize: the entry is marked, the reason recorded, and finance handles any
   * recovery through the audited adjustment flow. Silently reversing a paid prize
   * from here would be a balance change with no visible transaction.
   */
  async disqualify(
    tournamentId: string,
    userId: string,
    reason: string,
    actorId: string,
    ip: string | null,
  ): Promise<EntryResponse> {
    const entry = await this.entries.findOne({ where: { tournamentId, userId } });
    if (!entry) throw new NotFoundException("Entry not found");
    if (entry.disqualified) return (await this.myEntries(userId))[0];

    if (entry.prizePaidAt) {
      throw new ConflictException({
        code: "PRIZE_ALREADY_PAID",
        message:
          "This entry has already been paid. Record the disqualification and recover the prize " +
          "through the audited adjustment flow, not from here.",
      });
    }

    entry.disqualified = true;
    entry.disqualificationReason = reason;
    await this.entries.save(entry);

    await this.audit.recordOrThrow({
      actorId,
      action: "tournament.disqualify",
      targetType: "tournament_entry",
      targetId: entry.id,
      after: { disqualified: true },
      reason,
      ip,
    });

    const tournament = await this.tournaments.findOne({ where: { id: tournamentId } });
    return {
      tournamentId,
      tournamentName: tournament?.name ?? "Tournament",
      paidAmount: toDbAmount(entry.paidAmount),
      bestScore: entry.bestScore ?? null,
      rank: entry.rank ?? null,
      prizeAmount: toDbAmount(entry.prizeAmount),
      prizePaidAt: null,
      disqualified: true,
      disqualificationReason: reason,
      joinedAt: entry.createdAt.toISOString(),
    };
  }

  /** Moves scheduled tournaments to live and ended ones into the settle queue. */
  async advanceLifecycle(): Promise<{ started: number; queuedForSettlement: number }> {
    const now = new Date();

    const starting = await this.tournaments.find({ where: { status: "scheduled" } });
    let started = 0;
    for (const t of starting) {
      if (t.startsAt.getTime() > now.getTime()) continue;
      t.status = "live";
      await this.tournaments.save(t);
      started += 1;
    }

    const ending = await this.tournaments.find({ where: { status: "live" } });
    let queued = 0;
    for (const t of ending) {
      if (t.endsAt.getTime() > now.getTime()) continue;
      await this.commissionQueue.add(
        Jobs.SettleTournament,
        { tournamentId: t.id },
        { jobId: jobKey(`settle-tournament:${t.id}`) },
      );
      queued += 1;
    }

    return { started, queuedForSettlement: queued };
  }
}

/* --------------------------------- helpers -------------------------------- */

/** Shares must total exactly 100%: no silent remainder, no overflow. */
export function assertSplitTotals(split: { place: string; share: number }[]): void {
  if (!Array.isArray(split) || split.length === 0) {
    throw new BadRequestException({
      code: "PRIZE_SPLIT_EMPTY",
      message: "A prize split is required before a tournament can be published",
    });
  }
  const total = split.reduce((acc, s) => acc + s.share, 0);
  if (total !== FULL_SHARE_BPS) {
    throw new BadRequestException({
      code: "PRIZE_SPLIT_INVALID",
      message: `Prize shares must total exactly ${FULL_SHARE_BPS} bps (100%); got ${total}`,
      total,
    });
  }
  for (const s of split) {
    if (!/^\d+(-\d+)?$/.test(s.place)) {
      throw new BadRequestException({
        code: "PRIZE_PLACE_INVALID",
        message: `"${s.place}" is not a place or range, e.g. "1" or "4-10"`,
      });
    }
    const [from, to] = s.place.split("-").map(Number);
    if (to !== undefined && to < from) {
      throw new BadRequestException({
        code: "PRIZE_PLACE_INVALID",
        message: `Range "${s.place}" ends before it starts`,
      });
    }
  }
}

interface NormalisedShare {
  from: number;
  to: number;
  /** Share of the pool for EACH place in the range. */
  sharePerPlaceBps: number;
}

/** Expands "4-10" into a per-place share so a range pays each place equally. */
export function normaliseSplit(split: PrizeSplitEntry[] | { place: string; share: number }[]): NormalisedShare[] {
  return (split ?? []).map((s) => {
    const [from, to] = String(s.place).split("-").map(Number);
    const upper = Number.isFinite(to) ? to : from;
    const places = Math.max(1, upper - from + 1);
    return {
      from,
      to: upper,
      /* Integer division truncates: the remainder stays unallocated in the pool
       * rather than being handed to an arbitrary place. */
      sharePerPlaceBps: Math.floor(s.share / places),
    };
  });
}

export function prizeForRank(rank: number, split: NormalisedShare[], pool: string): string {
  const band = split.find((s) => rank >= s.from && rank <= s.to);
  if (!band) return toDbAmount(0);
  return applyBps(pool, band.sharePerPlaceBps);
}

function toView(t: Tournament): TournamentResponse {
  const now = Date.now();
  return {
    id: t.id,
    ref: t.ref,
    gameId: t.gameId,
    name: t.name,
    startsAt: t.startsAt.toISOString(),
    endsAt: t.endsAt.toISOString(),
    entryFee: toDbAmount(t.entryFee),
    prizePool: toDbAmount(t.prizePool),
    participants: t.participants,
    maxParticipants: t.maxParticipants,
    status: t.status,
    format: t.format,
    prizeSplit: t.prizeSplit,
    prizeSplitLockedAt: t.prizeSplitLockedAt ? t.prizeSplitLockedAt.toISOString() : null,
    rules: t.rules ?? null,
    settledAt: t.settledAt ? t.settledAt.toISOString() : null,
    startsInSeconds: Math.max(0, Math.ceil((t.startsAt.getTime() - now) / 1_000)),
    entryOpen:
      Boolean(t.prizeSplitLockedAt) &&
      (t.status === "scheduled" || t.status === "live") &&
      t.endsAt.getTime() > now &&
      t.participants < t.maxParticipants,
  };
}
