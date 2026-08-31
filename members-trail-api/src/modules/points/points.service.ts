import {
  BadRequestException, ConflictException, Injectable, Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Game, PointsLedgerEntry, type PointsSource } from "@/database/entities";
import { LedgerService } from "@/database/ledger/ledger.service";
import { EventBusService, Events } from "@/events";
import { RedisService } from "@/common/redis/redis.service";
import { paginate, safeSort, type Paginated } from "@/common/dto";
import {
  Decimal, clampToHeadroom, dayKey, dec, secondsUntilUtcMidnight, startOfUtcDay,
} from "@/common/utils";
import { EconomyConfigService } from "@/modules/economy-config/economy-config.service";
import type {
  GameCapMeter, PointsCapsResponse, PointsEntryResponse, PointsExportResponse,
  PointsHistoryQuery, PointsSummaryResponse,
} from "./dto/points.dto";

/* ============================================================================
 * Points.
 *
 * `credit()` is the only way Points enter the system, and it is the enforcement
 * point for all three anti-farming ceilings (FRD G-02):
 *
 *   per-session cap   — one session cannot be replayed for unlimited Points
 *   per-game daily    — one title cannot be ground all day
 *   per-user daily    — the global issuance ceiling across every source
 *
 * Two rules that look like details and are not:
 *
 *  1. A credit that would breach a cap is CLAMPED to the remaining headroom, not
 *     rejected. Rejecting would lose the portion the player legitimately earned;
 *     clamping pays exactly what is allowed and records the shortfall.
 *
 *  2. The clamped remainder is NEVER carried over to tomorrow. Carrying it over
 *     turns a daily cap into a deferral, which defeats the emission control the
 *     cap exists to provide.
 *
 * The three sums and the ledger write happen under a per-user Redis lock so two
 * concurrent sessions cannot both read the same headroom and both spend it. The
 * ledger's row lock protects the balance; this lock protects the *decision*.
 * ========================================================================== */

export type CapName = "session" | "game_daily" | "user_daily";

export interface CreditPointsInput {
  userId: string;
  /** Positive integer. Debits go through the ledger directly, not through here. */
  amount: number;
  source: PointsSource;
  /** MUST be derived from the domain (e.g. `session:<id>`), never random. */
  idempotencyKey: string;
  gameId?: string | null;
  gameSessionId?: string | null;
  note?: string | null;
  actorId?: string | null;
  approvedById?: string | null;
}

export interface CapMeter {
  name: CapName;
  limit: number;
  used: number;
  remaining: number;
}

export interface HeadroomSnapshot {
  headroom: number;
  /** Which cap is currently the binding constraint, if any is at zero-ish. */
  binding: CapName;
  meters: CapMeter[];
}

export interface CreditPointsResult {
  requested: number;
  credited: number;
  /** Amount refused by a cap. Never carried over. */
  capped: number;
  cappedBy: CapName | null;
  headroom: number;
  meters: CapMeter[];
  entryRef: string | null;
  runningBalance: number | null;
  replayed: boolean;
}

const HISTORY_SORT_COLUMNS = ["createdAt", "amount", "source"] as const;
const LOCK_TTL_SECONDS = 10;

/**
 * How long a Points credit waits its turn behind another credit for the same
 * account before giving up. Long enough to drain a realistic burst of finished
 * sessions, short enough to stay inside LOCK_TTL_SECONDS so a waiter can never
 * outlive the lock it is waiting for.
 */
const CREDIT_LOCK_WAIT_MS = 8_000;

/** Points are integral by definition; the money helpers work in 18dp strings. */
function toIntPoints(v: string): number {
  return Number(dec(v).toFixed(0, Decimal.ROUND_DOWN));
}

@Injectable()
export class PointsService {
  private readonly log = new Logger(PointsService.name);

  constructor(
    @InjectRepository(PointsLedgerEntry) private readonly entries: Repository<PointsLedgerEntry>,
    @InjectRepository(Game) private readonly games: Repository<Game>,
    private readonly ledger: LedgerService,
    private readonly bus: EventBusService,
    private readonly redis: RedisService,
    private readonly config: EconomyConfigService,
  ) {}

  /* ==================================================================== *
   * Internal API — the entry point every other module calls
   * ==================================================================== */

  /**
   * Credits Points, clamped to whichever cap has the least headroom.
   *
   * Callers (game validation, quests, ads, tournaments) must pass a
   * domain-derived idempotency key: a retried queue job has to resolve to the
   * same ledger row, not a second credit.
   */
  async credit(input: CreditPointsInput): Promise<CreditPointsResult> {
    if (!Number.isInteger(input.amount)) {
      throw new BadRequestException("Points must be an integer — there are no fractional Points");
    }
    if (input.amount <= 0) {
      throw new BadRequestException("credit() only issues Points; use the ledger directly for debits");
    }

    /* Serialise the read-decide-write per user. Without this, two sessions
     * finishing at the same instant both see full headroom and both credit.
     *
     * Waiting for the lock rather than failing on it: contention here is the
     * NORMAL case — a member finishes three rounds in a minute and all three
     * validations land together — and each holder finishes in milliseconds. With
     * no wait, the losers threw, consumed the validation job's retry budget and
     * ended in a final failure, so a session the server had accepted never paid
     * out its Points. The wait comfortably exceeds the work under the lock while
     * staying well inside the lock's own TTL. */
    const result = await this.redis.withLock(
      `points:credit:${input.userId}`,
      LOCK_TTL_SECONDS,
      () => this.creditUnderLock(input),
      { waitMs: CREDIT_LOCK_WAIT_MS },
    );

    if (result === null) {
      throw new ConflictException({
        message: "Another Points credit is in flight for this account — retry shortly",
        code: "POINTS_CREDIT_BUSY",
      });
    }
    return result;
  }

  private async creditUnderLock(input: CreditPointsInput): Promise<CreditPointsResult> {
    const snapshot = await this.headroom(input.userId, input.gameId ?? null, input.gameSessionId ?? null);

    /* clampToHeadroom is the shared cap primitive — same helper the commission
     * engine uses, so "capped" means the same thing everywhere. */
    const { payable, capped } = clampToHeadroom(input.amount, snapshot.headroom);
    const credited = toIntPoints(payable);
    const refused = toIntPoints(capped);

    const base: CreditPointsResult = {
      requested: input.amount,
      credited: 0,
      capped: refused,
      cappedBy: refused > 0 ? snapshot.binding : null,
      headroom: snapshot.headroom,
      meters: snapshot.meters,
      entryRef: null,
      runningBalance: null,
      replayed: false,
    };

    if (credited <= 0) {
      /* Fully capped. No ledger row is written at all — a zero-value entry
       * would pollute the ledger and the ledger rejects it anyway. */
      await this.announceCap(input, snapshot, refused);
      return base;
    }

    const { row, replayed } = await this.ledger.mutatePoints({
      userId: input.userId,
      amount: credited,
      source: input.source,
      idempotencyKey: input.idempotencyKey,
      gameId: input.gameId ?? null,
      gameSessionId: input.gameSessionId ?? null,
      note: input.note ?? null,
      actorId: input.actorId ?? null,
      approvedById: input.approvedById ?? null,
    });

    if (!replayed) {
      await this.bus.publish(Events.PointsCredited, {
        userId: input.userId,
        ref: row.ref,
        amount: credited,
        source: input.source,
        gameId: input.gameId ?? null,
        gameSessionId: input.gameSessionId ?? null,
        runningBalance: row.runningBalance,
      });
    }

    if (refused > 0) await this.announceCap(input, snapshot, refused);

    return {
      ...base,
      credited,
      entryRef: row.ref,
      runningBalance: row.runningBalance,
      replayed,
    };
  }

  private async announceCap(
    input: CreditPointsInput,
    snapshot: HeadroomSnapshot,
    refused: number,
  ): Promise<void> {
    this.log.debug(
      `cap ${snapshot.binding} clamped ${refused} Points for ${input.userId} (headroom ${snapshot.headroom})`,
    );
    await this.bus.publish(Events.PointsCapReached, {
      userId: input.userId,
      cap: snapshot.binding,
      requested: input.amount,
      refused,
      headroom: snapshot.headroom,
      gameId: input.gameId ?? null,
      gameSessionId: input.gameSessionId ?? null,
      day: dayKey(),
      /* Explicit so no consumer invents a carry-over feature later. */
      carriedOver: false,
    });
  }

  /* ==================================================================== *
   * Headroom
   * ==================================================================== */

  /**
   * Remaining issuance allowance for this credit, as the minimum of every cap
   * that applies. The binding cap is reported so the player can be told which
   * meter stopped them.
   */
  async headroom(
    userId: string,
    gameId: string | null,
    gameSessionId: string | null,
  ): Promise<HeadroomSnapshot> {
    const caps = await this.config.pointsCaps();
    const game = gameId ? await this.games.findOne({ where: { id: gameId } }) : null;
    const dayStart = startOfUtcDay();

    const meters: CapMeter[] = [];

    const globalUsed = await this.sumIssued({ userId, since: dayStart });
    meters.push(this.meter("user_daily", caps.dailyGlobal, globalUsed));

    if (gameId) {
      const gameCap = game?.dailyPointsCap ?? caps.perGameDailyDefault;
      const gameUsed = await this.sumIssued({ userId, gameId, since: dayStart });
      meters.push(this.meter("game_daily", gameCap, gameUsed));
    }

    if (gameSessionId) {
      const sessionCap = game?.sessionPointsCap ?? caps.perSessionDefault;
      const sessionUsed = await this.sumIssued({ userId, gameSessionId });
      meters.push(this.meter("session", sessionCap, sessionUsed));
    }

    /* The tightest cap wins. Ties resolve to the first in insertion order,
     * which is deterministic and therefore testable. */
    let binding = meters[0];
    for (const m of meters) if (m.remaining < binding.remaining) binding = m;

    return {
      headroom: Math.max(0, binding.remaining),
      binding: binding.name,
      meters,
    };
  }

  private meter(name: CapName, limit: number, used: number): CapMeter {
    return { name, limit, used, remaining: Math.max(0, limit - used) };
  }

  /**
   * Sum of Points ISSUED (positive rows only) in a window.
   *
   * Debits are excluded on purpose: converting Points to MTT must not hand back
   * daily issuance headroom, or a user could farm the cap twice a day by
   * converting in between.
   */
  private async sumIssued(filter: {
    userId: string;
    gameId?: string;
    gameSessionId?: string;
    since?: Date;
  }): Promise<number> {
    const qb = this.entries
      .createQueryBuilder("e")
      .select("COALESCE(SUM(e.amount), 0)", "sum")
      .where("e.userId = :userId", { userId: filter.userId })
      .andWhere("e.amount > 0");

    if (filter.gameId) qb.andWhere("e.gameId = :gameId", { gameId: filter.gameId });
    if (filter.gameSessionId) {
      qb.andWhere("e.gameSessionId = :sessionId", { sessionId: filter.gameSessionId });
    }
    if (filter.since) qb.andWhere("e.createdAt >= :since", { since: filter.since });

    const raw = await qb.getRawOne<{ sum: string | null }>();
    return Number(raw?.sum ?? 0);
  }

  /* ==================================================================== *
   * Player reads
   * ==================================================================== */

  async history(userId: string, q: PointsHistoryQuery): Promise<Paginated<PointsEntryResponse>> {
    const [rows, total] = await this.historyQuery(userId, q)
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();
    return paginate(rows.map(toEntryView), total, q);
  }

  /**
   * The same filtered ledger, shaped for a CSV/PDF statement (FRD W-05).
   * Capped at a generous but finite row count — an unbounded export is a way to
   * take the database down from an authenticated account.
   */
  async export(userId: string, q: PointsHistoryQuery): Promise<PointsExportResponse> {
    const rows = await this.historyQuery(userId, q).take(10_000).getMany();
    return {
      filename: `points-statement-${dayKey()}.csv`,
      columns: ["Reference", "Date (UTC)", "Source", "Amount", "Balance after", "Game session", "Note"],
      rows: rows.map((r) => [
        r.ref,
        r.createdAt.toISOString(),
        r.source,
        String(r.amount),
        String(r.runningBalance),
        r.gameSessionId ?? "",
        (r.note ?? "").replace(/[\r\n]+/g, " "),
      ]),
      rowCount: rows.length,
      generatedAt: new Date().toISOString(),
    };
  }

  private historyQuery(userId: string, q: PointsHistoryQuery) {
    const sortBy = safeSort(q.sortBy, HISTORY_SORT_COLUMNS, "createdAt");
    const qb = this.entries.createQueryBuilder("e").where("e.userId = :userId", { userId });

    if (q.source) qb.andWhere("e.source = :source", { source: q.source });
    if (q.gameId) qb.andWhere("e.gameId = :gameId", { gameId: q.gameId });
    if (q.from) qb.andWhere("e.createdAt >= :from", { from: q.from });
    if (q.to) qb.andWhere("e.createdAt <= :to", { to: q.to });
    if (q.q) qb.andWhere("e.ref LIKE :ref", { ref: `%${q.q}%` });

    /* sortBy comes from the allowlist above — never interpolated from input. */
    return qb.orderBy(`e.${sortBy}`, q.sortDir);
  }

  async summary(userId: string): Promise<PointsSummaryResponse> {
    const totals = await this.entries
      .createQueryBuilder("e")
      .select("COALESCE(SUM(CASE WHEN e.amount > 0 THEN e.amount ELSE 0 END), 0)", "earned")
      .addSelect(
        "COALESCE(SUM(CASE WHEN e.source = 'conversion' AND e.amount < 0 THEN -e.amount ELSE 0 END), 0)",
        "convertedOut",
      )
      .addSelect("COALESCE(SUM(e.amount), 0)", "net")
      .addSelect("MIN(e.createdAt)", "firstAt")
      .where("e.userId = :userId", { userId })
      .getRawOne<{ earned: string; convertedOut: string; net: string; firstAt: Date | null }>();

    const best = await this.entries
      .createQueryBuilder("e")
      .select("DATE(e.createdAt)", "day")
      .addSelect("SUM(e.amount)", "earned")
      .where("e.userId = :userId", { userId })
      .andWhere("e.amount > 0")
      .groupBy("DATE(e.createdAt)")
      .orderBy("earned", "DESC")
      .limit(1)
      .getRawOne<{ day: string | Date; earned: string }>();

    const earnedToday = await this.sumIssued({ userId, since: startOfUtcDay() });
    const balance = await this.ledger.getBalance(userId);

    return {
      earned: Number(totals?.earned ?? 0),
      convertedOut: Number(totals?.convertedOut ?? 0),
      net: Number(totals?.net ?? 0),
      currentBalance: balance.points,
      bestDay: best
        ? {
            day: best.day instanceof Date ? dayKey(best.day) : String(best.day).slice(0, 10),
            earned: Number(best.earned ?? 0),
          }
        : null,
      earnedToday,
      firstEntryAt: totals?.firstAt ? new Date(totals.firstAt).toISOString() : null,
    };
  }

  /** Today's issuance headroom, per game and overall — the frontend's cap meters. */
  async caps(userId: string): Promise<PointsCapsResponse> {
    const config = await this.config.pointsCaps();
    const dayStart = startOfUtcDay();

    const globalIssued = await this.sumIssued({ userId, since: dayStart });
    const games = await this.games.find({ where: { active: true }, order: { title: "ASC" } });

    const meters: GameCapMeter[] = [];
    for (const game of games) {
      const cap = game.dailyPointsCap ?? config.perGameDailyDefault;
      const issued = await this.sumIssued({ userId, gameId: game.id, since: dayStart });
      meters.push({
        gameId: game.id,
        gameTitle: game.title,
        cap,
        issued,
        /* Never advertise more headroom than the global cap can honour, or the
         * meter promises Points the player cannot actually earn. */
        remaining: Math.max(0, Math.min(cap - issued, config.dailyGlobal - globalIssued)),
        sessionCap: game.sessionPointsCap ?? config.perSessionDefault,
      });
    }

    return {
      day: dayKey(),
      globalCap: config.dailyGlobal,
      globalIssued,
      globalRemaining: Math.max(0, config.dailyGlobal - globalIssued),
      games: meters,
      resetsInSeconds: secondsUntilUtcMidnight(),
    };
  }
}

function toEntryView(e: PointsLedgerEntry): PointsEntryResponse {
  return {
    ref: e.ref,
    createdAt: e.createdAt.toISOString(),
    source: e.source,
    amount: e.amount,
    runningBalance: e.runningBalance,
    gameId: e.gameId ?? null,
    gameSessionId: e.gameSessionId ?? null,
    note: e.note ?? null,
  };
}
