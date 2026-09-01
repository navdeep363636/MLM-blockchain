import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { Repository } from "typeorm";
import { randomBytes } from "node:crypto";
import { Game, GameSession, PointsRule, User } from "@/database/entities";
import type { GameScoringConfig } from "@/database/entities/game.entity";
import { EventBusService, Events } from "@/events";
import { Jobs, Queues, jobKey } from "@/queues/queue.constants";
import { CryptoService } from "@/common/crypto/crypto.service";
import { paginate, safeSort, type Paginated } from "@/common/dto";
import { Ref, addDays, dayKey } from "@/common/utils";
import { AuditService } from "@/modules/audit/audit.service";
import { PointsService } from "@/modules/points/points.service";
import type {
  AdminSessionQuery, GameQuery, GameResponse, SessionQuery, SessionResponse,
  StartSessionRequest, StartSessionResponse, SubmitSessionRequest, SubmitSessionResponse,
  TelemetryFrame, UpsertGameRequest, ValidationOutcomeResponse,
} from "./dto/games.dto";

/* ============================================================================
 * Gameplay (FRD G-01, G-02).
 *
 * The trust model, which is the whole point of this module:
 *
 *   THE CLIENT REPORTS. THE SERVER DECIDES.
 *
 * A session is started server-side with a deterministic `seed` and a one-time
 * `sessionSecret`. The client plays, then submits its claimed score together
 * with the telemetry stream. The server REPLAYS that telemetry against the
 * game's scoring config to compute `serverScore`, and Points are credited from
 * `serverScore` only (conventions §8). `clientScore` is stored beside it — not
 * because it is useful for crediting, but because a discrepancy is evidence.
 *
 * Why each control exists:
 *
 *  • ONE-TIME SESSION TOKEN. Without it, anyone with a session id can submit a
 *    score for it, including for someone else's session.
 *  • TELEMETRY REPLAY. A score with no supporting frames is a bare assertion. If
 *    the frames do not produce the score, the frames win.
 *  • SUBMIT-ONCE. A session that has already been submitted cannot be resubmitted
 *    with a better score.
 *  • DURATION AND RATE SANITY. A 400-point score in 900ms is not a good player.
 *  • FLAG, DON'T ALWAYS REJECT. Heuristics record `anomalyFlags` and only refuse
 *    when the evidence is conclusive; a false positive that silently steals a
 *    legitimate player's Points is its own kind of failure.
 * ========================================================================== */

const GAME_SORT = ["title", "createdAt", "players30d", "rating"] as const;
const SESSION_SORT = ["createdAt", "serverScore", "pointsAwarded"] as const;

/** A session left open longer than this is abandoned, not submittable. */
const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1_000;

/** Below this, a "session" is too short to have been played. */
const MIN_PLAUSIBLE_DURATION_MS = 1_500;

/** Window the catalogue's "players (30 days)" figure is counted over. */
const POPULARITY_WINDOW_DAYS = 30;

/** Frames per second above which input is not human. */
const MAX_HUMAN_FRAMES_PER_SECOND = 40;

/** Tolerance between the client's claim and the server's replay before the
 *  discrepancy is treated as evidence rather than rounding. */
const SCORE_DISCREPANCY_TOLERANCE_BPS = 500; // 5%

/** Distinct accounts sharing one device fingerprint before it is suspicious. */
const MAX_ACCOUNTS_PER_DEVICE = 3;

/* The shape lives with the column it is stored in. */
type ScoringConfig = GameScoringConfig;

@Injectable()
export class GamesService {
  private readonly log = new Logger(GamesService.name);

  constructor(
    @InjectRepository(Game) private readonly games: Repository<Game>,
    @InjectRepository(GameSession) private readonly sessions: Repository<GameSession>,
    @InjectRepository(PointsRule) private readonly rules: Repository<PointsRule>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly points: PointsService,
    private readonly crypto: CryptoService,
    private readonly bus: EventBusService,
    private readonly audit: AuditService,
    @InjectQueue(Queues.GameValidation) private readonly queue: Queue,
  ) {}

  /* ==================================================================== *
   * Catalogue
   * ==================================================================== */

  async list(q: GameQuery, includeInactive = false): Promise<Paginated<GameResponse>> {
    const sortBy = safeSort(q.sortBy, GAME_SORT, "title");
    const qb = this.games.createQueryBuilder("g");
    if (!includeInactive) qb.andWhere("g.active = true");
    if (q.genre) qb.andWhere("g.genre = :genre", { genre: q.genre });
    if (q.entryType) qb.andWhere("g.entryType = :entryType", { entryType: q.entryType });
    if (q.q) qb.andWhere("(g.title LIKE :s OR g.slug LIKE :s)", { s: `%${q.q}%` });

    const [rows, total] = await qb
      .orderBy(`g.${sortBy}`, q.sortDir)
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();

    const players = await this.playersByGame(rows.map((r) => r.id));
    return paginate(
      rows.map((r) => toGameView(r, players.get(r.id) ?? 0)),
      total,
      q,
    );
  }

  async bySlug(slug: string): Promise<GameResponse> {
    const row = await this.games.findOne({ where: { slug } });
    if (!row) throw new NotFoundException("Game not found");
    const players = await this.playersByGame([row.id]);
    return toGameView(row, players.get(row.id) ?? 0);
  }

  /**
   * Distinct members who have completed a validated session per game, over the
   * popularity window.
   *
   * Counted on read rather than kept in a column. `games.players30d` is a
   * denormalised counter that nothing in the codebase ever wrote, so it sat at
   * zero forever - which made the lobby's default "Most played (30 days)" sort a
   * no-op and printed "0 players" under every title in a live catalogue. A
   * thirty-day window over an indexed session table is cheap, and there is no
   * counter left to drift out of step with the sessions it claims to count.
   */
  private async playersByGame(gameIds: string[]): Promise<Map<string, number>> {
    if (gameIds.length === 0) return new Map();
    const since = new Date(Date.now() - POPULARITY_WINDOW_DAYS * 86_400_000);
    const rows = await this.sessions
      .createQueryBuilder("s")
      .select("s.gameId", "gameId")
      .addSelect("COUNT(DISTINCT s.userId)", "players")
      .where("s.gameId IN (:...gameIds)", { gameIds })
      .andWhere("s.status = :status", { status: "validated" })
      .andWhere("s.createdAt >= :since", { since })
      .groupBy("s.gameId")
      .getRawMany<{ gameId: string; players: string }>();
    return new Map(rows.map((r) => [r.gameId, Number(r.players) || 0]));
  }

  async genres(): Promise<string[]> {
    const rows = await this.games
      .createQueryBuilder("g")
      .select("DISTINCT g.genre", "genre")
      .where("g.active = true")
      .orderBy("genre", "ASC")
      .getRawMany<{ genre: string }>();
    return rows.map((r) => r.genre);
  }

  /* ==================================================================== *
   * Session start
   * ==================================================================== */

  /**
   * Opens a session.
   *
   * The seed and the secret are generated here, server-side. A client-supplied
   * seed would let a player search for a favourable one; a client-supplied
   * secret would prove nothing.
   */
  async startSession(
    userId: string,
    dto: StartSessionRequest,
    ip: string | null,
  ): Promise<StartSessionResponse> {
    const game = await this.games.findOne({ where: { id: dto.gameId } });
    if (!game) throw new NotFoundException("Game not found");
    if (!game.active) {
      throw new ConflictException({ code: "GAME_INACTIVE", message: "This game is not available" });
    }

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("Account not found");
    if (user.status === "suspended" || user.status === "closed") {
      throw new ForbiddenException({
        code: `ACCOUNT_${user.status.toUpperCase()}`,
        message: "This account cannot start a session",
      });
    }

    if (dto.mode === "tournament" && !dto.tournamentId) {
      throw new BadRequestException({
        code: "TOURNAMENT_REQUIRED",
        message: "A tournament id is required for a tournament session",
      });
    }

    /* One open session per member per game. Otherwise a player can farm several
     * in parallel and submit only the best. */
    const open = await this.sessions.findOne({
      where: { userId, gameId: dto.gameId, status: "open" },
      order: { createdAt: "DESC" },
    });
    if (open) {
      if (Date.now() - open.startedAt.getTime() < SESSION_MAX_AGE_MS) {
        throw new ConflictException({
          code: "SESSION_ALREADY_OPEN",
          message: "Finish or abandon your open session for this game first",
          /* In `details`, which is the field the error contract actually carries
           * through to the client — a top-level key here was dropped by the
           * exception filter, so the UI knew a session was open but not which
           * one, and could not offer to abandon it. */
          details: { ref: open.ref },
        });
      }
      open.status = "abandoned";
      open.rejectionReason = "Expired without submission";
      await this.sessions.save(open);
    }

    /* The raw token goes to the client once; only its HMAC is stored, so a
     * database leak does not let anyone submit scores. */
    const token = randomBytes(24).toString("base64url");
    const seed = randomBytes(16).toString("hex");

    const row = await this.sessions.save(
      this.sessions.create({
        ref: Ref.gameSession(),
        userId,
        gameId: dto.gameId,
        tournamentId: dto.tournamentId ?? null,
        mode: dto.mode,
        seed,
        sessionSecret: this.crypto.hmac(token),
        startedAt: new Date(),
        status: "open",
        pointsAwarded: 0,
        telemetryFrames: 0,
        ip,
        deviceFingerprint: dto.deviceFingerprint ?? null,
      }),
    );

    /* Headroom is shown up front so a player is never surprised by a cap after
     * playing (FRD G-02). */
    const headroom = await this.points.headroom(userId, dto.gameId, row.id);

    await this.bus.publish(Events.GameSessionStarted, {
      userId,
      ref: row.ref,
      gameId: dto.gameId,
      mode: dto.mode,
      tournamentId: dto.tournamentId ?? null,
    });

    return {
      ref: row.ref,
      sessionId: row.id,
      seed,
      sessionToken: token,
      startedAt: row.startedAt.toISOString(),
      pointsHeadroom: headroom.headroom,
      sessionCap: game.sessionPointsCap,
    };
  }

  /* ==================================================================== *
   * Session submit
   * ==================================================================== */

  /**
   * Accepts a submission and queues validation.
   *
   * Nothing is credited here. Validation runs on the queue so a slow replay
   * cannot hold an HTTP connection, and so a burst of submissions is absorbed
   * rather than dropped.
   */
  /**
   * Gives up an open session without submitting it.
   *
   * `startSession` refuses a second open session on the same title and tells the
   * member to "finish or abandon" the first — advice with nowhere to act on it
   * until this existed. Closing a tab mid-game left the title locked for the
   * full six-hour expiry window, and the only instruction on screen was one the
   * API would not honour.
   *
   * Abandoning FORFEITS the session: nothing is scored and nothing is credited,
   * so this is not a way to retry a bad run for free — it costs the run. That is
   * what keeps the one-open-session rule doing its job, which is to stop a member
   * holding several sessions open and submitting only the best.
   */
  async abandonSession(userId: string, ref: string): Promise<SessionResponse> {
    const session = await this.sessions.findOne({ where: { ref } });
    if (!session || session.userId !== userId) {
      throw new NotFoundException("Session not found");
    }
    if (session.status !== "open") {
      /* Already finished, expired or submitted. Idempotent on purpose: two
       * clicks on "abandon" must not turn into an error the player has to read. */
      return toSessionView(session);
    }
    session.status = "abandoned";
    session.endedAt = new Date();
    session.rejectionReason = "Abandoned by the player";
    await this.sessions.save(session);
    this.log.log(`session ${session.ref} abandoned by its owner`);
    return toSessionView(session);
  }

  async submitSession(
    userId: string,
    ref: string,
    dto: SubmitSessionRequest,
  ): Promise<SubmitSessionResponse> {
    const session = await this.sessions.findOne({
      where: { userId, ref },
      select: {
        id: true, ref: true, userId: true, gameId: true, tournamentId: true, mode: true,
        seed: true, sessionSecret: true, startedAt: true, status: true, pointsAwarded: true,
        telemetryFrames: true, clientScore: true, serverScore: true, deviceFingerprint: true,
      },
    });
    if (!session) throw new NotFoundException("Session not found");

    /* Submit-once. Re-submitting is how a player keeps rolling for a better
     * validated score. */
    if (session.status !== "open") {
      throw new ConflictException({
        code: "SESSION_NOT_OPEN",
        message: `This session is ${session.status} and cannot be submitted again`,
      });
    }

    if (!this.crypto.safeEqual(this.crypto.hmac(dto.sessionToken), session.sessionSecret)) {
      /* Wrong token: either the session belongs to someone else or the
       * submission was fabricated. Neither deserves a helpful error. */
      this.log.warn(`session ${session.ref}: token mismatch on submit`);
      throw new ForbiddenException({
        code: "SESSION_TOKEN_INVALID",
        message: "This submission does not belong to the session",
      });
    }

    if (Date.now() - session.startedAt.getTime() > SESSION_MAX_AGE_MS) {
      session.status = "abandoned";
      session.rejectionReason = "Submitted after the session expired";
      await this.sessions.save(session);
      throw new ConflictException({
        code: "SESSION_EXPIRED",
        message: "This session expired before it was submitted",
      });
    }

    session.status = "submitted";
    session.clientScore = dto.clientScore;
    session.durationMs = dto.durationMs;
    session.endedAt = new Date();
    session.telemetryFrames = dto.telemetry.length;
    /* Tamper evidence: the digest is computed here, from the frames we actually
     * received, so a later dispute can be settled against what was submitted. */
    session.telemetryHash = this.crypto.hmac(JSON.stringify(dto.telemetry)).slice(0, 64);
    await this.sessions.save(session);

    await this.queue.add(
      Jobs.ValidateSession,
      { sessionId: session.id, telemetry: dto.telemetry, clientScore: dto.clientScore, durationMs: dto.durationMs },
      /* Deterministic id: a client retrying the same submission must not queue
       * two validations of one session. */
      { jobId: jobKey(`validate:${session.id}`) },
    );

    return {
      ref: session.ref,
      status: session.status,
      queued: true,
      clientScore: dto.clientScore,
    };
  }

  /* ==================================================================== *
   * Validation — the queue processor's entry point
   * ==================================================================== */

  /**
   * Replays a submitted session and credits Points from the SERVER score.
   *
   * This is the only place Points are created from gameplay. It is idempotent:
   * a session already validated or rejected returns its recorded outcome, and
   * the Points credit itself is keyed on the session id.
   */
  async validateSession(params: {
    sessionId: string;
    telemetry: TelemetryFrame[];
    clientScore: number;
    durationMs: number;
  }): Promise<ValidationOutcomeResponse> {
    const session = await this.sessions.findOne({ where: { id: params.sessionId } });
    if (!session) throw new NotFoundException("Session not found");

    if (session.status === "validated" || session.status === "rejected") {
      return {
        ref: session.ref,
        userId: session.userId,
        gameId: session.gameId,
        status: session.status,
        serverScore: session.serverScore ?? null,
        pointsAwarded: session.pointsAwarded,
        pointsCapped: 0,
        cappedBy: null,
        anomalyFlags: session.anomalyFlags ?? [],
        rejectionReason: session.rejectionReason ?? null,
      };
    }

    const game = await this.games.findOne({ where: { id: session.gameId } });
    if (!game) throw new NotFoundException("Game not found");

    const config = (game.scoringConfig ?? {}) as ScoringConfig;
    const replay = this.replay(params.telemetry, params.durationMs, config);
    const flags = this.detect({
      session,
      game,
      clientScore: params.clientScore,
      serverScore: replay.score,
      durationMs: params.durationMs,
      frames: params.telemetry.length,
    });

    const deviceFlag = await this.deviceSharingFlag(session);
    if (deviceFlag) flags.push(deviceFlag);

    /* Conclusive evidence refuses the session outright. Everything else is
     * flagged and paid — a false positive that steals a real player's Points is
     * also a failure. */
    const fatal = flags.find((f) => FATAL_FLAGS.has(f));

    if (fatal) {
      session.status = "rejected";
      session.serverScore = replay.score;
      session.anomalyFlags = flags;
      session.rejectionReason = FATAL_REASONS[fatal] ?? "Session failed validation";
      session.pointsAwarded = 0;
      await this.sessions.save(session);

      await this.bus.publish(Events.GameSessionRejected, {
        userId: session.userId,
        ref: session.ref,
        gameId: session.gameId,
        reason: fatal,
        clientScore: params.clientScore,
        serverScore: replay.score,
        flags,
      });

      this.log.warn(`session ${session.ref} rejected: ${fatal}`);
      return {
        ref: session.ref,
        userId: session.userId,
        gameId: session.gameId,
        status: "rejected",
        serverScore: replay.score,
        pointsAwarded: 0,
        pointsCapped: 0,
        cappedBy: null,
        anomalyFlags: flags,
        rejectionReason: session.rejectionReason,
      };
    }

    /* Points from serverScore. clientScore is not an input here at all. */
    const desired = this.pointsFor(replay.score, game, config);

    let credited = 0;
    let capped = 0;
    let cappedBy: string | null = null;

    if (desired > 0) {
      const result = await this.points.credit({
        userId: session.userId,
        amount: desired,
        source: "gameplay",
        /* Domain-derived: a retried job resolves to the same ledger row. */
        idempotencyKey: `session:${session.id}`,
        gameId: session.gameId,
        gameSessionId: session.id,
        note: `Server score ${replay.score} in ${game.title}`,
      });
      credited = result.credited;
      capped = result.capped;
      cappedBy = result.cappedBy;
    }

    session.status = "validated";
    session.serverScore = replay.score;
    session.pointsAwarded = credited;
    session.anomalyFlags = flags.length > 0 ? flags : null;
    session.rejectionReason = credited === 0 ? this.zeroReason(desired, capped) : null;
    await this.sessions.save(session);

    await this.bus.publish(Events.GameSessionValidated, {
      userId: session.userId,
      ref: session.ref,
      gameId: session.gameId,
      tournamentId: session.tournamentId ?? null,
      mode: session.mode,
      serverScore: replay.score,
      clientScore: params.clientScore,
      pointsAwarded: credited,
      pointsCapped: capped,
      flags,
      /* Stated on the event so no consumer ever reaches for clientScore. */
      creditedFrom: "serverScore",
    });

    return {
      ref: session.ref,
      userId: session.userId,
      gameId: session.gameId,
      status: "validated",
      serverScore: replay.score,
      pointsAwarded: credited,
      pointsCapped: capped,
      cappedBy,
      anomalyFlags: flags,
      rejectionReason: session.rejectionReason,
    };
  }

  /**
   * Recomputes the score from the telemetry stream.
   *
   * Deliberately simple and total: every game's score is a function of its
   * scoring frames and its duration, bounded by the title's declared maximum.
   * A game whose config is missing scores zero rather than defaulting to the
   * client's claim — a missing config is a deployment error, not a licence to
   * trust the client.
   */
  private replay(
    telemetry: TelemetryFrame[],
    durationMs: number,
    config: ScoringConfig,
  ): { score: number; scoringFrames: number } {
    const scoreEvent = config.scoreEvent ?? 2;
    const perUnit = config.scorePerUnit ?? 1;
    const perSecond = config.scorePerSecond ?? 0;

    let score = 0;
    let scoringFrames = 0;
    let lastT = -1;

    for (const frame of telemetry) {
      /* Out-of-order frames are not replayable; they are dropped rather than
       * reordered, because reordering would invent a stream nobody submitted. */
      if (frame.t < lastT) continue;
      lastT = frame.t;
      if (frame.t > durationMs) continue;
      if (frame.e !== scoreEvent) continue;
      if (frame.v <= 0) continue;
      score += frame.v * perUnit;
      scoringFrames += 1;
    }

    if (perSecond > 0) score += Math.floor(durationMs / 1_000) * perSecond;

    const max = config.maxScore ?? Number.MAX_SAFE_INTEGER;
    return { score: Math.max(0, Math.min(Math.floor(score), max)), scoringFrames };
  }

  /** Points the server score is worth, bounded by the title's declared band. */
  private pointsFor(serverScore: number, game: Game, config: ScoringConfig): number {
    const perScore = config.pointsPerScore ?? 0.1;
    const raw = Math.floor(serverScore * perScore);
    if (raw <= 0) return 0;
    /* The title's own band is the first ceiling; PointsService then applies the
     * per-session, per-game and per-day caps. */
    return Math.min(Math.max(raw, game.pointsPerSessionMin), game.pointsPerSessionMax);
  }

  /** Anti-cheat heuristics. Returns the flags that fired, in severity order. */
  private detect(input: {
    session: GameSession;
    game: Game;
    clientScore: number;
    serverScore: number;
    durationMs: number;
    frames: number;
  }): string[] {
    const flags: string[] = [];
    const { clientScore, serverScore, durationMs, frames, game } = input;

    if (frames === 0 && serverScore > 0) flags.push("score_without_telemetry");
    if (clientScore > 0 && frames === 0) flags.push("claim_without_telemetry");

    if (durationMs < MIN_PLAUSIBLE_DURATION_MS && (clientScore > 0 || serverScore > 0)) {
      flags.push("duration_implausible");
    }

    if (durationMs > 0) {
      const fps = frames / (durationMs / 1_000);
      if (fps > MAX_HUMAN_FRAMES_PER_SECOND) flags.push("input_rate_superhuman");
    }

    /* A claim far above what the frames support is the signature of a modified
     * client reporting a score it did not earn. */
    if (clientScore > 0) {
      const tolerance = Math.ceil((clientScore * SCORE_DISCREPANCY_TOLERANCE_BPS) / 10_000);
      if (clientScore - serverScore > tolerance) flags.push("score_discrepancy");
    }

    const cap = game.sessionPointsCap;
    if (cap > 0 && serverScore > cap * 100) flags.push("score_far_above_band");

    return flags;
  }

  /** Flags a fingerprint shared by several accounts — the shape of a farm. */
  private async deviceSharingFlag(session: GameSession): Promise<string | null> {
    if (!session.deviceFingerprint) return null;
    const raw = await this.sessions
      .createQueryBuilder("s")
      .select("COUNT(DISTINCT s.userId)", "count")
      .where("s.deviceFingerprint = :fp", { fp: session.deviceFingerprint })
      .andWhere("s.createdAt >= :since", { since: addDays(new Date(), -30) })
      .getRawOne<{ count: string }>();
    const accounts = Number(raw?.count ?? 0);
    return accounts > MAX_ACCOUNTS_PER_DEVICE ? "device_shared_by_many_accounts" : null;
  }

  private zeroReason(desired: number, capped: number): string {
    if (desired <= 0) return "The replayed score did not reach the minimum for a Points award";
    if (capped > 0) return "Your daily Points cap for this game is already reached";
    return "No Points were awarded for this session";
  }

  /* ==================================================================== *
   * Reads
   * ==================================================================== */

  async mySessions(userId: string, q: SessionQuery): Promise<Paginated<SessionResponse>> {
    const sortBy = safeSort(q.sortBy, SESSION_SORT, "createdAt");
    const qb = this.sessions.createQueryBuilder("s").where("s.userId = :userId", { userId });
    if (q.gameId) qb.andWhere("s.gameId = :gameId", { gameId: q.gameId });
    if (q.status) qb.andWhere("s.status = :status", { status: q.status });
    if (q.from) qb.andWhere("s.createdAt >= :from", { from: q.from });
    if (q.to) qb.andWhere("s.createdAt <= :to", { to: q.to });

    const [rows, total] = await qb
      .orderBy(`s.${sortBy}`, q.sortDir)
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();
    return paginate(rows.map(toSessionView), total, q);
  }

  async session(userId: string, ref: string): Promise<SessionResponse> {
    const row = await this.sessions.findOne({ where: { userId, ref } });
    if (!row) throw new NotFoundException("Session not found");
    return toSessionView(row);
  }

  /** Today's play summary for the member's dashboard. */
  async todaySummary(userId: string): Promise<{
    day: string; sessions: number; validated: number; rejected: number; pointsEarned: number;
  }> {
    const raw = await this.sessions
      .createQueryBuilder("s")
      .select("COUNT(*)", "sessions")
      .addSelect("SUM(CASE WHEN s.status = 'validated' THEN 1 ELSE 0 END)", "validated")
      .addSelect("SUM(CASE WHEN s.status = 'rejected' THEN 1 ELSE 0 END)", "rejected")
      .addSelect("COALESCE(SUM(s.pointsAwarded), 0)", "points")
      .where("s.userId = :userId", { userId })
      .andWhere("DATE(s.createdAt) = DATE(:now)", { now: new Date() })
      .getRawOne<{ sessions: string; validated: string; rejected: string; points: string }>();

    return {
      day: dayKey(),
      sessions: Number(raw?.sessions ?? 0),
      validated: Number(raw?.validated ?? 0),
      rejected: Number(raw?.rejected ?? 0),
      pointsEarned: Number(raw?.points ?? 0),
    };
  }

  /* ==================================================================== *
   * Admin
   * ==================================================================== */

  async adminSessions(q: AdminSessionQuery): Promise<Paginated<SessionResponse & { userId: string }>> {
    const sortBy = safeSort(q.sortBy, SESSION_SORT, "createdAt");
    const qb = this.sessions.createQueryBuilder("s");
    if (q.userId) qb.andWhere("s.userId = :userId", { userId: q.userId });
    if (q.gameId) qb.andWhere("s.gameId = :gameId", { gameId: q.gameId });
    if (q.status) qb.andWhere("s.status = :status", { status: q.status });
    if (q.flaggedOnly) qb.andWhere("s.anomalyFlags IS NOT NULL");
    if (q.from) qb.andWhere("s.createdAt >= :from", { from: q.from });
    if (q.to) qb.andWhere("s.createdAt <= :to", { to: q.to });

    const [rows, total] = await qb
      .orderBy(`s.${sortBy}`, q.sortDir)
      .skip(q.skip)
      .take(q.limit)
      .getManyAndCount();

    return paginate(rows.map((r) => ({ ...toSessionView(r), userId: r.userId })), total, q);
  }

  async upsertGame(dto: UpsertGameRequest, actorId: string, ip: string | null): Promise<GameResponse> {
    if (dto.pointsPerSessionMin > dto.pointsPerSessionMax) {
      throw new BadRequestException({
        code: "POINTS_BAND_INVERTED",
        message: "pointsPerSessionMin cannot exceed pointsPerSessionMax",
      });
    }
    if (dto.sessionPointsCap > dto.dailyPointsCap && dto.dailyPointsCap > 0) {
      throw new BadRequestException({
        code: "CAPS_INCONSISTENT",
        message: "A single session cannot be allowed to earn more than the whole day",
      });
    }

    const existing = await this.games.findOne({ where: { slug: dto.slug } });
    const before = existing
      ? {
          title: existing.title, dailyPointsCap: existing.dailyPointsCap,
          sessionPointsCap: existing.sessionPointsCap, active: existing.active,
        }
      : null;

    const row = existing ?? this.games.create({ slug: dto.slug });
    row.title = dto.title;
    row.genre = dto.genre;
    row.blurb = dto.blurb;
    row.thumbnailHue = dto.thumbnailHue;
    row.pointsPerSessionMin = dto.pointsPerSessionMin;
    row.pointsPerSessionMax = dto.pointsPerSessionMax;
    row.entryType = dto.entryType;
    row.entryFee = dto.entryFee;
    row.dailyPointsCap = dto.dailyPointsCap;
    row.sessionPointsCap = dto.sessionPointsCap;
    row.active = dto.active;
    const saved = await this.games.save(row);

    await this.audit.recordOrThrow({
      actorId,
      action: existing ? "game.update" : "game.create",
      targetType: "game",
      targetId: saved.id,
      before,
      after: {
        slug: dto.slug, title: dto.title,
        dailyPointsCap: dto.dailyPointsCap, sessionPointsCap: dto.sessionPointsCap,
        active: dto.active,
      },
      reason: dto.reason,
      ip,
    });

    /* An admin upsert response: the popularity figure is a read-model concern
     * and a freshly created title has no sessions, so it is resolved the same
     * way the catalogue resolves it. */
    const players = await this.playersByGame([saved.id]);
    return toGameView(saved, players.get(saved.id) ?? 0);
  }

  /** Points rules for a game, newest version first. */
  async pointsRules(gameId?: string): Promise<PointsRule[]> {
    return this.rules.find({
      where: gameId ? { gameId } : {},
      order: { version: "DESC" },
      take: 200,
    });
  }
}

/* --------------------------------- helpers -------------------------------- */

/** Flags conclusive enough to refuse the session outright. */
const FATAL_FLAGS = new Set([
  "claim_without_telemetry",
  "duration_implausible",
  "input_rate_superhuman",
  "score_discrepancy",
]);

const FATAL_REASONS: Record<string, string> = {
  claim_without_telemetry: "A score was reported with no gameplay data to support it",
  duration_implausible: "The session was too short to have produced this result",
  input_rate_superhuman: "The input rate is not achievable by a human player",
  score_discrepancy: "The reported score does not match the replayed gameplay",
};

function toGameView(g: Game, players30d: number): GameResponse {
  return {
    id: g.id,
    slug: g.slug,
    title: g.title,
    genre: g.genre,
    blurb: g.blurb,
    thumbnailHue: g.thumbnailHue,
    pointsPerSessionMin: g.pointsPerSessionMin,
    pointsPerSessionMax: g.pointsPerSessionMax,
    entryType: g.entryType,
    entryFee: g.entryFee,
    dailyPointsCap: g.dailyPointsCap,
    sessionPointsCap: g.sessionPointsCap,
    active: g.active,
    rating: g.rating,
    players30d,
  };
}

function toSessionView(s: GameSession): SessionResponse {
  return {
    ref: s.ref,
    gameId: s.gameId,
    mode: s.mode,
    status: s.status,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    durationMs: s.durationMs ?? null,
    clientScore: s.clientScore ?? null,
    serverScore: s.serverScore ?? null,
    pointsAwarded: s.pointsAwarded,
    rejectionReason: s.rejectionReason ?? null,
    anomalyFlags: s.anomalyFlags ?? null,
  };
}
