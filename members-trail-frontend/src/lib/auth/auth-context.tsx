"use client";

/* ============================================================================
 * Who is signed in, for the whole app.
 *
 * The session has three resting positions, and conflating any two of them
 * produces a bug people notice:
 *
 *   "loading"        — we have not yet asked the server. On a fresh page load
 *                      this is the honest answer for a few hundred milliseconds,
 *                      and a guard that treats it as "signed out" bounces a
 *                      signed-in member to the login page on every reload.
 *   "anonymous"      — asked, and there is no session.
 *   "authenticated"  — asked, and there is one, with a profile.
 *
 * The access token is NOT in this context. It lives in the api client's module
 * state, in memory. Putting it in a context value means it ends up in the
 * server-rendered payload, in devtools, and in every component that reads the
 * context — and the whole point of not using localStorage was to keep it out of
 * reach of injected script.
 * ========================================================================== */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  adoptHeadProfile, api, bootstrapSession, clearSession, onSessionChange, setSession,
} from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import type { MeResponse } from "@/lib/api/types";

export type AuthPhase = "loading" | "anonymous" | "authenticated";

export interface LoginResult {
  /** True when tokens were issued. False means a second factor is outstanding. */
  authenticated: boolean;
  /**
   * Whether the account that just signed in is staff.
   *
   * Returned from the call rather than read off the context, because the context
   * value the caller is holding was captured before this login and will not show
   * the new user until the next render — so a form that redirected on it would
   * send every operator to the player app on their first sign-in.
   */
  isStaff?: boolean;
  challengeId?: string;
  twoFaMethod?: "sms" | "totp";
  challengeExpiresIn?: number;
  legalReacceptanceRequired?: boolean;
  status?: string;
}

interface AuthValue {
  phase: AuthPhase;
  user: MeResponse | null;
  /** True for a staff account. The server still authorises every admin call. */
  isStaff: boolean;
  login: (identifier: string, password: string) => Promise<LoginResult>;
  completeTwoFa: (challengeId: string, code: string, recoveryCode?: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  /** Re-reads the profile. Call after anything that changes status or KYC tier. */
  reload: () => Promise<void>;
  /**
   * A usable access token exists. True BEFORE the profile has loaded.
   *
   * Data queries need a bearer token, not a profile — so gating them on `phase`
   * made every authenticated screen wait out a `/users/me` round trip and the
   * re-render that follows it, for information none of them were asking for.
   * `phase` still governs anything that depends on WHO the member is: KYC gates,
   * the display name, the account status.
   */
  sessionReady: boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

interface TokenEnvelope {
  authenticated: boolean;
  tokens?: { accessToken: string; refreshToken: string; expiresIn: number };
  challengeId?: string;
  twoFaMethod?: "sms" | "totp";
  challengeExpiresIn?: number;
  legalReacceptanceRequired?: boolean;
  status?: string;
  kycTier?: number;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<AuthPhase>("loading");
  const [user, setUser] = useState<MeResponse | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const queryClient = useQueryClient();

  const loadProfile = useCallback(async (): Promise<MeResponse | null> => {
    try {
      /* The document head chains /users/me onto the session restore, so on a
       * cold load the answer is usually already here. Measured on a 4x-throttled
       * /admin, that request finished at ~250ms against ~1280ms when it waited
       * for hydration — and the route guards hold the page until it lands. A
       * miss (anonymous visitor, failed request, or a later reload) falls
       * through to the normal call. */
      const head = (await adoptHeadProfile()) as MeResponse | null;
      const me = head ?? (await api.get<MeResponse>("/users/me"));
      setUser(me);
      setPhase("authenticated");
      return me;
    } catch (err) {
      /* A 401 means the token we just obtained is not usable. Anything else — a
       * 500, a dropped connection — is NOT a reason to sign someone out: the
       * session is probably fine and the next render can try again. Signing out
       * on a transient server error is how a deploy logs everyone out. */
      if (isApiError(err) && err.isAuthFailure) {
        clearSession();
        setUser(null);
        setPhase("anonymous");
      } else {
        setPhase("authenticated");
      }
      return null;
    }
  }, []);

  /* On mount: adopt the session restore that the api client already started.
   *
   * `bootstrapSession()` fires when that module evaluates, which is while React
   * is still hydrating — so by the time this effect runs the request is usually
   * already in flight or done. Awaiting the SAME promise rather than calling
   * `restoreSession()` again matters: refresh tokens are single-use, and a
   * second call after the first resolved would rotate one for nothing.
   *
   * `sessionReady` flips as soon as the token lands, so the data layer can start
   * fetching WHILE the profile is still loading rather than after it. For an
   * anonymous visitor the restore fails quietly and settles on "anonymous". */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const restored = await bootstrapSession();
      if (cancelled) return;
      if (!restored) {
        setSessionReady(false);
        setPhase("anonymous");
        setUser(null);
        return;
      }
      setSessionReady(true);
      await loadProfile();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProfile]);

  /* The api client clears the session on its own when a refresh fails mid-flight.
   * Without this subscription the app keeps rendering a signed-in shell around
   * 401s until the next navigation. */
  useEffect(
    () =>
      onSessionChange((authenticated) => {
        if (!authenticated) {
          setUser(null);
          setSessionReady(false);
          setPhase("anonymous");
          /* Drop every cached query. Leaving them would show the previous
           * member's balances to whoever signs in next on a shared machine. */
          queryClient.clear();
        }
      }),
    [queryClient],
  );

  const adopt = useCallback(
    async (res: TokenEnvelope): Promise<LoginResult> => {
      let profile: MeResponse | null = null;
      if (res.authenticated && res.tokens) {
        setSession(res.tokens.accessToken, res.tokens.expiresIn);
        /* Clear before loading: any cache on this tab belongs to whoever was
         * signed in a moment ago. */
        queryClient.clear();
        profile = await loadProfile();
      }
      return {
        authenticated: res.authenticated,
        isStaff: profile?.isStaff ?? false,
        challengeId: res.challengeId,
        twoFaMethod: res.twoFaMethod,
        challengeExpiresIn: res.challengeExpiresIn,
        legalReacceptanceRequired: res.legalReacceptanceRequired,
        status: res.status,
      };
    },
    [loadProfile, queryClient],
  );

  const login = useCallback(
    async (identifier: string, password: string) => {
      const res = await api.post<TokenEnvelope>("/auth/login", {
        identifier: identifier.trim(),
        password,
      });
      return adopt(res);
    },
    [adopt],
  );

  const completeTwoFa = useCallback(
    async (challengeId: string, code: string, recoveryCode?: string) => {
      const res = await api.post<TokenEnvelope>("/auth/login/2fa", {
        challengeId,
        ...(recoveryCode ? { recoveryCode } : { code }),
      });
      return adopt(res);
    },
    [adopt],
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      /* Swallowed on purpose. If the call fails the local session must still go:
       * a "sign out" that leaves someone signed in because the network blipped is
       * the worst possible outcome of pressing that button. The server-side
       * session expires on its own. */
    }
    clearSession();
    setUser(null);
    setPhase("anonymous");
    queryClient.clear();
  }, [queryClient]);

  const reload = useCallback(async () => {
    await loadProfile();
  }, [loadProfile]);

  const value = useMemo<AuthValue>(
    () => ({
      phase,
      sessionReady,
      user,
      isStaff: user?.isStaff ?? false,
      login,
      completeTwoFa,
      logout,
      reload,
    }),
    [phase, sessionReady, user, login, completeTwoFa, logout, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
