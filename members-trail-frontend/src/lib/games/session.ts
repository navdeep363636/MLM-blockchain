"use client";

/* ============================================================================
 * The session lifecycle, which is where the Points actually come from.
 *
 * Before this existed, the play screen ran a local timer, incremented a number
 * on screen and called it a score. Nothing was ever sent, so no session was ever
 * validated, so no Points were ever credited from gameplay — which is also why
 * the leaderboards, the quest counters and the catalogue's "players (30 days)"
 * were all empty. One missing call, five empty screens.
 *
 * The real flow, and every step of it is server-authoritative:
 *
 *   POST /games/sessions            → ref, seed, one-time token, cap headroom
 *   ...play, recording telemetry...
 *   POST /games/sessions/:ref/submit → 202 Accepted; validation is queued
 *   GET  /games/sessions/:ref        → poll until it leaves "submitted"
 *
 * The client never reports Points and is never asked to. It reports what it
 * claims to have scored and the stream that produced it; the server replays the
 * stream, scores it itself, and credits from ITS number.
 * ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { TelemetryRecorder } from "./telemetry";

export type SessionStage =
  | "idle"
  | "starting"
  | "ready"
  | "playing"
  | "submitting"
  | "validating"
  | "settled"
  | "error";

interface StartResponse {
  ref: string;
  seed: string;
  sessionToken: string;
  pointsHeadroom: number;
  sessionCap: number;
}

interface SessionRow {
  ref: string;
  status: string;
  serverScore: number | null;
  pointsAwarded: number;
  flags?: string[] | null;
}

export interface Settlement {
  status: string;
  serverScore: number | null;
  pointsAwarded: number;
  flags: string[];
}

/** How long to wait for the validation queue before saying so plainly. */
const POLL_INTERVAL_MS = 1_200;
const POLL_TIMEOUT_MS = 30_000;

export interface GameSessionState {
  stage: SessionStage;
  /**
   * Set when the server refused to open a session because one is already open on
   * this title. It carries the open session's ref, which is what `abandonAndStart`
   * needs — so the UI can offer the one action that resolves it instead of a
   * dead end.
   */
  blockedByOpenRef: string | null;
  /** The board seed. Undefined until a session is open. */
  seed: string | null;
  /** Points the server says are still issuable today for this title. */
  headroom: number | null;
  sessionCap: number | null;
  score: number;
  settlement: Settlement | null;
  error: string | null;
  begin: () => Promise<void>;
  /** Forfeits the open session named by `blockedByOpenRef`, then starts fresh. */
  abandonAndStart: () => Promise<void>;
  /** Record one scoring event. Returns the running score. */
  addScore: (delta: number) => number;
  finish: () => Promise<void>;
  reset: () => void;
}

/** The member's currently-open session on one title, if the error did not say. */
async function openSessionRef(gameId: string): Promise<string | null> {
  try {
    const res = await api.get<{ data?: { ref: string }[] } | { ref: string }[]>(
      "/games/sessions",
      { query: { gameId, status: "open", limit: 1 } },
    );
    const rows = Array.isArray(res) ? res : (res.data ?? []);
    return rows[0]?.ref ?? null;
  } catch {
    return null;
  }
}

export function useGameSession(gameId: string | null, mode: "free" | "paid" = "free"): GameSessionState {
  const qc = useQueryClient();
  const [stage, setStage] = useState<SessionStage>("idle");
  const [seed, setSeed] = useState<string | null>(null);
  const [headroom, setHeadroom] = useState<number | null>(null);
  const [sessionCap, setSessionCap] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockedByOpenRef, setBlockedByOpenRef] = useState<string | null>(null);

  const recorder = useRef(new TelemetryRecorder());
  const open = useRef<{ ref: string; token: string } | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reset = useCallback(() => {
    open.current = null;
    setStage("idle");
    setSeed(null);
    setScore(0);
    setSettlement(null);
    setError(null);
    setBlockedByOpenRef(null);
  }, []);

  /* A change of title invalidates everything about the open session. */
  useEffect(() => {
    reset();
  }, [gameId, reset]);

  const begin = useCallback(async () => {
    if (!gameId) return;
    setStage("starting");
    setError(null);
    setSettlement(null);
    setBlockedByOpenRef(null);
    setScore(0);
    try {
      const res = await api.post<StartResponse>("/games/sessions", { gameId, mode });
      if (!alive.current) return;
      open.current = { ref: res.ref, token: res.sessionToken };
      setSeed(res.seed);
      setHeadroom(res.pointsHeadroom);
      setSessionCap(res.sessionCap);
      recorder.current.start();
      setStage("playing");
    } catch (e) {
      if (!alive.current) return;
      /* One open session per title is the anti-farming rule and it is correct.
       * What was missing is the way out of it: a player who closed the tab
       * mid-game was told to "finish or abandon" with nothing on screen that
       * could do either. The ref comes back in the error, so hold onto it. */
      if (e instanceof ApiError && e.code === "SESSION_ALREADY_OPEN") {
        const fromError = (e.details as { ref?: string } | undefined)?.ref ?? null;
        /* The error normally names the session. If a deployment predates that,
         * ask for it — one request beats leaving the player stuck for six hours
         * because a field was missing. */
        setBlockedByOpenRef(fromError ?? (await openSessionRef(gameId)));
      }
      setError(e instanceof Error ? e.message : "Could not open a session");
      setStage("error");
    }
  }, [gameId, mode]);

  const abandonAndStart = useCallback(async () => {
    const ref = blockedByOpenRef;
    if (!ref) return;
    setStage("starting");
    try {
      await api.post(`/games/sessions/${ref}/abandon`);
    } catch {
      /* Already closed, or gone. Either way the block it caused is gone with it,
       * so fall through and try to start rather than reporting a second error. */
    }
    if (!alive.current) return;
    setBlockedByOpenRef(null);
    await begin();
  }, [blockedByOpenRef, begin]);

  const addScore = useCallback((delta: number) => {
    const total = recorder.current.score(delta);
    setScore(total);
    return total;
  }, []);

  const finish = useCallback(async () => {
    const session = open.current;
    if (!session) return;
    recorder.current.stop();
    setStage("submitting");

    const payload = recorder.current.payload();
    try {
      await api.post(`/games/sessions/${session.ref}/submit`, {
        sessionToken: session.token,
        ...payload,
      });
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : "Could not submit the session");
      setStage("error");
      return;
    }
    /* The token is single-use and now spent. Dropping it here means a double
     * click on "finish" cannot re-submit and read as a replay attempt. */
    open.current = null;

    if (!alive.current) return;
    setStage("validating");

    /* Poll rather than assume. The submit returns 202 — Points are credited by
     * the queue after the server has replayed the stream, and telling the player
     * a figure before that has happened would be inventing one. */
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (!alive.current) return;
      let row: SessionRow;
      try {
        row = await api.get<SessionRow>(`/games/sessions/${session.ref}`);
      } catch {
        /* A read failure is not a verdict. Keep asking until the deadline. */
        if (Date.now() > deadline) break;
        continue;
      }
      if (row.status !== "submitted") {
        setSettlement({
          status: row.status,
          serverScore: row.serverScore,
          pointsAwarded: row.pointsAwarded,
          flags: row.flags ?? [],
        });
        setStage("settled");
        /* Everything a validated session moves: the balance, the ledger, the
         * quest counters, the board, and the catalogue's own play counts. */
        for (const key of [
          qk.balance(), qk.points(), qk.pointsSummary(), qk.quests(),
          qk.achievements(), qk.leaderboard(), qk.games(), qk.sessions(),
        ]) {
          void qc.invalidateQueries({ queryKey: key });
        }
        return;
      }
      if (Date.now() > deadline) break;
    }

    if (!alive.current) return;
    /* Still queued. That is a real state, not an error: the credit lands without
     * the player watching, and saying so is more honest than a spinner. */
    setSettlement({ status: "submitted", serverScore: null, pointsAwarded: 0, flags: [] });
    setStage("settled");
  }, [qc]);

  return {
    stage, seed, headroom, sessionCap, score, settlement, error, blockedByOpenRef,
    begin, abandonAndStart, addScore, finish, reset,
  };
}
