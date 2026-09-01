/* ============================================================================
 * The telemetry stream — the only thing the server will pay Points for.
 *
 * The contract, from GamesService.replay:
 *
 *   serverScore = Σ (frame.v × scorePerUnit) for frames where e === scoreEvent,
 *                 bounded by maxScore
 *
 * with three rules that a game has to respect or its session is flagged rather
 * than credited:
 *
 *   • `clientScore` must be within 5% of that sum. We emit one frame per scoring
 *     event and report the sum of exactly those frames, so the two agree to the
 *     unit rather than to a tolerance.
 *   • Frames must arrive in non-decreasing `t` order. Out-of-order frames are
 *     DROPPED by the replay, not reordered — a stream that jitters silently
 *     scores less than it earned, so `t` is clamped monotonic here.
 *   • Fewer than 40 frames per second, and at least 1.5s of play. Emitting per
 *     animation frame would trip the first of those; emitting per *score* keeps
 *     a busy minute of play in the low hundreds of frames.
 *
 * A frame is never written for a zero or negative delta: the replay ignores
 * those, so sending them only inflates the frame count that the anti-cheat
 * heuristics divide by.
 * ========================================================================== */

/** Event codes. The server reads `scoreEvent` from the title's scoring config. */
export const SCORE_EVENT = 2;

export interface TelemetryFrame {
  t: number;
  e: number;
  v: number;
}

/** Ceiling the server enforces on a single frame's value. */
const MAX_FRAME_VALUE = 1_000_000;

/** Beyond this the payload is large and the extra frames buy nothing. */
const MAX_FRAMES = 2_000;

export class TelemetryRecorder {
  private frames: TelemetryFrame[] = [];
  private total = 0;
  private startedAt: number | null = null;
  private lastT = 0;
  private endedAt: number | null = null;

  start(): void {
    this.frames = [];
    this.total = 0;
    this.lastT = 0;
    this.endedAt = null;
    this.startedAt = performance.now();
  }

  /** Records one scoring event. Returns the running total. */
  score(delta: number): number {
    const v = Math.floor(delta);
    if (this.startedAt === null || v <= 0) return this.total;
    if (this.frames.length >= MAX_FRAMES) {
      /* Out of frame budget: keep scoring the session, stop describing it. The
       * replay would disagree with the claim, so the claim stops growing too. */
      return this.total;
    }
    /* Monotonic by construction: performance.now() can be non-decreasing across
     * a tab throttle, and a frame that goes backwards is a frame thrown away. */
    const t = Math.max(this.lastT, Math.round(performance.now() - this.startedAt));
    this.lastT = t;
    this.frames.push({ t, e: SCORE_EVENT, v: Math.min(v, MAX_FRAME_VALUE) });
    this.total += Math.min(v, MAX_FRAME_VALUE);
    return this.total;
  }

  stop(): void {
    if (this.startedAt !== null && this.endedAt === null) {
      this.endedAt = performance.now();
    }
  }

  get score_(): number {
    return this.total;
  }

  get durationMs(): number {
    if (this.startedAt === null) return 0;
    const end = this.endedAt ?? performance.now();
    return Math.max(0, Math.round(end - this.startedAt));
  }

  /**
   * The submission payload.
   *
   * `durationMs` is floored at the last frame's timestamp: a session whose
   * duration is shorter than the frames inside it is exactly what the replay
   * treats as forged, and clock drift on a throttled tab can produce that
   * honestly.
   */
  payload(): { clientScore: number; durationMs: number; telemetry: TelemetryFrame[] } {
    return {
      clientScore: this.total,
      durationMs: Math.max(this.durationMs, this.lastT),
      telemetry: this.frames,
    };
  }
}
