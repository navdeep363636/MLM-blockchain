"use client";

/* ============================================================================
 * The socket connection, and what the app does with what arrives on it.
 *
 * The governing rule comes from the server itself, which says it in the payload
 * of its own handshake: *realtime events are hints; the HTTP API remains the
 * source of truth*. So nothing here writes a value into the cache. An event
 * INVALIDATES the queries it affects and react-query refetches them.
 *
 * That is not defensive pedantry, it is the only correct design here:
 *
 *  - A push carries what the server knew at emit time. A balance is read live
 *    from the ledger. Patching a balance from a push means showing a figure that
 *    was already stale when it left the building.
 *  - Sockets drop. A tab that misses three events must not end up with a wrong
 *    balance permanently; invalidation-on-reconnect fixes that for free.
 *  - Event payloads are the smallest thing that identifies the change. They are
 *    not DTOs and were never meant to be rendered.
 *
 * The connection is authenticated with the in-memory access token. When it
 * rotates, the socket is rebuilt — a socket authenticated with a dead token is
 * refused at the handshake, and the alternative (a long-lived socket credential)
 * is a second auth system to get wrong.
 * ========================================================================== */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { API_ORIGIN, currentAccessToken, onSessionChange } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import { useAuth } from "@/lib/auth/auth-context";

/* ------------------------------- event names ------------------------------ */

/**
 * Every event the gateway emits, and the queries it makes stale.
 *
 * Kept as data rather than a switch so the mapping is reviewable in one screen:
 * "what does a withdrawal approval change?" is answerable by reading one line.
 * An event not in this table still surfaces to subscribers — it just does not
 * invalidate anything, which is the right default for something we did not plan
 * for.
 */
type Invalidator = (qc: QueryClient) => void;

const invalidate = (...keys: readonly (readonly unknown[])[]): Invalidator => (qc) => {
  for (const key of keys) void qc.invalidateQueries({ queryKey: key });
};

const EVENTS: Record<string, Invalidator> = {
  /* money in */
  "deposit.completed": invalidate(qk.wallet(), qk.notifications()),
  "conversion.completed": invalidate(qk.wallet(), qk.points(), qk.conversion(), qk.notifications()),
  "points.credited": invalidate(qk.points(), qk.balance(), qk.quests()),

  /* money out */
  "withdrawal.approved": invalidate(qk.wallet(), qk.notifications()),
  "withdrawal.completed": invalidate(qk.wallet(), qk.notifications()),
  "withdrawal.rejected": invalidate(qk.wallet(), qk.notifications()),

  /* staking */
  "staking.staked": invalidate(qk.staking(), qk.balance(), qk.transactions()),
  "staking.unstaked": invalidate(qk.staking(), qk.balance(), qk.transactions()),
  "staking.reward_claimed": invalidate(qk.staking(), qk.balance(), qk.transactions()),

  /* referral */
  "commission.calculated": invalidate(qk.referral(), qk.notifications()),
  "commission.released": invalidate(qk.referral(), qk.balance(), qk.notifications()),

  /* play */
  "quest.completed": invalidate(qk.quests(), qk.points()),
  "achievement.unlocked": invalidate(qk.achievements(), qk.notifications()),
  /**
   * A GAMEPLAY session finished validating — the server replayed it and decided
   * what it was worth.
   *
   * This used to invalidate `qk.sessions()`, the list of active LOGIN sessions on
   * the security screen, on the strength of the name alone. Two unrelated things
   * are called a session, and the one the gateway means is the one that awards
   * points: it carries `serverScore`, `pointsAwarded` and `pointsCapped`. So the
   * points ledger, the balance, the quest progress it advances and the board it
   * ranks on are what go stale here — and none of them were being refetched.
   */
  "session.validated": invalidate(qk.points(), qk.balance(), qk.quests(), qk.leaderboard()),

  /* identity */
  "kyc.approved": invalidate(qk.me(), qk.kycMine(), qk.withdrawalLimits(), qk.notifications()),
  "kyc.rejected": invalidate(qk.me(), qk.kycMine(), qk.notifications()),
  /* A status change can revoke what the member may do, so the profile AND the
   * things gated on it have to be re-read, not just the banner. */
  "account.status_changed": invalidate(qk.me(), qk.wallet(), qk.notifications()),
  "account.frozen": invalidate(qk.me(), qk.wallet(), qk.notifications()),

  /* staff room — these arrive only on a staff socket, never a member's */
  "approval.requested": invalidate(qk.adminApprovals(), qk.adminKpis()),
  "fraud.alert": invalidate(qk.adminFraudAlerts(), qk.adminKpis()),
  "treasury.payout_ratio_breach": invalidate(qk.adminKpis(), qk.analytics()),
  "chain.reorg": invalidate(qk.adminChainStatus()),
  /**
   * Settlement is a STAFF event. The gateway emits it to `staff:ops` only, with
   * the entry count and the total paid — a member never receives it, and each
   * winner learns their own result from their prize transaction instead.
   *
   * It was listed among the member events, invalidating a player's balance and
   * marked as worth interrupting them for, which described a push that cannot
   * reach them. The tournament list is what an operator is looking at when this
   * lands.
   */
  "tournament.settled": invalidate(qk.adminTournaments(), qk.tournaments(), qk.adminKpis()),
};

/**
 * Events a member should be told about, not merely have refetched behind them.
 *
 * Member-facing only. `tournament.settled` used to be here and is not a member
 * event at all — it goes to the staff room — so it could only ever have toasted
 * at an operator, about a settlement they were already looking at.
 */
const TOASTWORTHY = new Set([
  "deposit.completed",
  "withdrawal.approved",
  "withdrawal.completed",
  "withdrawal.rejected",
  "commission.released",
  "kyc.approved",
  "kyc.rejected",
  "account.frozen",
  "account.status_changed",
  "achievement.unlocked",
]);

/* --------------------------------- context -------------------------------- */

export type SocketStatus = "idle" | "connecting" | "connected" | "offline";

export interface RealtimeEvent {
  name: string;
  payload: Record<string, unknown>;
  at: string;
}

interface RealtimeValue {
  status: SocketStatus;
  /** The most recent event, for components that want to react directly. */
  last: RealtimeEvent | null;
  /** Subscribe to one event name. Returns an unsubscribe function. */
  subscribe: (event: string, fn: (payload: Record<string, unknown>) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeValue | null>(null);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { phase } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SocketStatus>("idle");
  const [last, setLast] = useState<RealtimeEvent | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const subscribers = useRef(new Map<string, Set<(p: Record<string, unknown>) => void>>());
  /* Bumped whenever the access token rotates, to force a reconnect with the new
   * credential. Kept as state, not a ref, so the effect below actually re-runs. */
  const [epoch, setEpoch] = useState(0);

  useEffect(() => onSessionChange(() => setEpoch((n) => n + 1)), []);

  useEffect(() => {
    if (phase !== "authenticated") {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setStatus("idle");
      return;
    }

    const token = currentAccessToken();
    if (!token) return;

    setStatus("connecting");
    const socket = io(`${API_ORIGIN}/realtime`, {
      auth: { token },
      transports: ["websocket"],
      /* Let socket.io back off on its own rather than hammering a server that is
       * down. The cap matters: without it the delay grows past the point where a
       * user would rather reload the page. */
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 15_000,
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => setStatus("connected"));

    socket.on("ready", () => {
      setStatus("connected");
      /* Anything could have happened while we were disconnected, and the socket
       * has no replay. Re-reading everything the user is looking at is cheap and
       * is the only way a reconnected tab is trustworthy. */
      void queryClient.invalidateQueries();
    });

    socket.on("disconnect", () => setStatus("offline"));
    socket.on("connect_error", () => setStatus("offline"));

    socket.on("unauthorized", () => {
      /* The token was rejected. Do not retry with it — an auth failure is not a
       * transient one, and reconnecting in a loop with a dead credential looks
       * like an attack from the server's side. */
      setStatus("offline");
      socket.disconnect();
    });

    socket.onAny((name: string, payload: unknown) => {
      if (name === "ready" || name === "unauthorized") return;

      const data = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
      const at = typeof data.at === "string" ? data.at : new Date().toISOString();

      EVENTS[name]?.(queryClient);
      setLast({ name, payload: data, at });

      const fns = subscribers.current.get(name);
      if (fns) for (const fn of fns) fn(data);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [phase, epoch, queryClient]);

  const value = useMemo<RealtimeValue>(
    () => ({
      status,
      last,
      subscribe: (event, fn) => {
        const set = subscribers.current.get(event) ?? new Set();
        set.add(fn);
        subscribers.current.set(event, set);
        return () => {
          set.delete(fn);
        };
      },
    }),
    [status, last],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

/**
 * Realtime state. Safe to call outside the provider — it reports "idle" rather
 * than throwing, so a public page that renders a connection dot does not have to
 * know whether it is inside the authenticated tree.
 */
export function useRealtime(): RealtimeValue {
  return (
    useContext(RealtimeContext) ?? {
      status: "idle" as SocketStatus,
      last: null,
      subscribe: () => () => undefined,
    }
  );
}

/** Subscribe to one event for the lifetime of a component. */
export function useRealtimeEvent(
  event: string,
  handler: (payload: Record<string, unknown>) => void,
): void {
  const { subscribe } = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe(event, (p) => ref.current(p)), [event, subscribe]);
}

/** Whether an event is one worth interrupting the member for. */
export function isToastworthy(event: string): boolean {
  return TOASTWORTHY.has(event);
}
