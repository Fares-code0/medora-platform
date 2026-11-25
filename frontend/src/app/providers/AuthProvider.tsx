import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/api/client';
import { clearSessionMemory } from '@/api/session-memory';
import { sessionPolicy } from '@/configs/session';
import { authService } from '@/features/auth/service';
import {
  clearAiSessionData,
  removeLegacyAiStorage,
} from '@/features/doctor/ai/model/session-storage';
import {
  clearConversationsSession,
  lockConversationsSession,
  removeLegacyConversationsStorage,
  setConversationsOwner,
  unlockConversationsSession,
} from '@/features/shared-domain/conversations/session-boundary';
import { clearUserPreferences } from '@/services/preferences';
import { AuthError } from '@/types/auth';
import type {
  AuthSession,
  AuthStatus,
  Permission,
  PendingSignIn,
  RegisterInput,
  RegisterResult,
  SessionUser,
} from '@/types/auth';

/**
 * Auth provider — session lifecycle over the DP-04 seam.
 *
 * The original login/logout/lock/unlock signatures are preserved so
 * guards, `useCan` and `RootRedirect` are untouched; `login` additionally
 * *returns* the signed-in user, so `LoginPage` can resolve its
 * destination from the real session instead of looking the email up in
 * the mock's seed list.
 *
 * ## What lives here, and what does not
 *
 * Here: session state, the pending-sign-in handoff between login and the
 * OTP/verification screens, the idle auto-lock (A-11), and the
 * registration of `ApiClient`'s 401 refresh handler.
 *
 * Not here: any knowledge of *where* a session comes from. This file
 * imports `@/features/auth/service` — the seam — and nothing from
 * `mock/`. Swapping backends is `VITE_ENABLE_MOCKS`, not an edit.
 *
 * ## No client-only sessions
 *
 * Every session this provider holds was issued by the active auth backend
 * — the live API, or the mock adapter when `VITE_ENABLE_MOCKS` is on. The
 * development demo-doctor button (`features/auth/dev/`) used
 * to mint a session here with no server behind it and an empty bearer
 * token, so against the live API every request it made was a 401. It now
 * signs in through `login` with the seeded demo account instead
 * (`backend/docs/LOCAL_DEMO_ACCOUNTS.md`), and the client-only path is gone.
 */

interface AuthContextValue {
  readonly status: AuthStatus;
  readonly user: SessionUser | null;
  /**
   * The last session ended without the user asking: a refresh the server
   * refused (expired, revoked from another device, a suspended account).
   * The sign-in page says so instead of appearing out of nowhere. Cleared by
   * the next sign-in and by an explicit logout.
   */
  readonly sessionEnded: boolean;
  /**
   * The account whose session last ended in this tab, by any path — kept
   * across the session end so a `returnTo` captured for that account is not
   * honoured for a different one (A-W1, `resolveDestination`). Null until a
   * session ends here: a fresh load knows no previous account.
   */
  readonly previousUserId: string | null;
  /**
   * The last session in this tab ended because its user signed out, so the
   * sign-in page is reached with no `returnTo` (A-W1, `RequireAuth`).
   */
  readonly signedOut: boolean;
  readonly login: (
    email: string,
    password: string,
    opts?: { rememberMe?: boolean },
  ) => Promise<SessionUser | null>;
  readonly logout: () => Promise<void>;
  readonly lock: () => void;
  readonly unlock: (password: string) => Promise<void>;
  readonly register: (input: RegisterInput) => Promise<RegisterResult>;
  readonly forgotPassword: (email: string) => Promise<void>;
  readonly resetPassword: (token: string, password: string) => Promise<void>;
  readonly verifyEmail: (token: string) => Promise<void>;
  readonly verifyOtp: (code: string) => Promise<void>;
  /** Completes the pending two-factor sign-in with a recovery code (R1). */
  readonly redeemRecoveryCode: (recoveryCode: string) => Promise<void>;
  readonly resendOtp: () => Promise<void>;
  readonly resendVerification: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;

/** Order-insensitive: the server owes no particular order of permissions. */
function samePermissionSet(a: readonly Permission[], b: readonly Permission[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((permission) => right.has(permission));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('booting');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [previousUserId, setPreviousUserId] = useState<string | null>(null);
  const pendingRef = useRef<PendingSignIn | null>(null);
  /** Remember Me for the live session, so a refresh can re-persist it. */
  const rememberRef = useRef(false);
  /**
   * Who this tab's session belongs to, for the 401 handler below — which is
   * registered once and so cannot read `user` from its closure.
   */
  const userIdRef = useRef<string | null>(null);
  /** The whole user, for the same handler's role/permission comparison. */
  const userRef = useRef<SessionUser | null>(null);
  useEffect(() => {
    userIdRef.current = user?.id ?? null;
    userRef.current = user;
  }, [user]);
  /**
   * The query cache is PHI held in memory, so it ends with the session that
   * fetched it (FRONTEND_ARCHITECTURE.md §6.3, §12.5) — on logout, on a
   * refresh the server refuses (which is also how an ended employment
   * reaches this tab, OD-12), and on lock, so a walked-away workstation
   * holds nothing behind the lock screen. Without it a second account
   * signing in on the same tab was served the first one's cached lists.
   */
  const queryClient = useQueryClient();

  // ── Session lifecycle helpers ───────────────────────────────────────────
  const finalize = useCallback(
    (session: AuthSession, rememberMe: boolean, opts?: { resumingLock?: boolean }): SessionUser => {
      // A sign-in starts from an empty cache, whoever held the tab before: the
      // cached lists are another session's patient data, never this one's.
      queryClient.clear();
      clearAiSessionData();
      // Unsaved drafts survive a lock for the user who locked, and no one else.
      if (!opts?.resumingLock || session.user.id !== userIdRef.current) clearSessionMemory();
      if (opts?.resumingLock) {
        // An unlock through the `/auth/login` fallback: the user who locked
        // gets their own mock messaging back; anyone else starts fresh.
        unlockConversationsSession(session.user.id);
      } else {
        // Mock messaging is per user: the previous holder's copy goes, and the
        // store is pointed at this session's user.
        clearConversationsSession();
        setConversationsOwner(session.user.id);
      }
      authService.persist(session, rememberMe);
      pendingRef.current = null;
      rememberRef.current = rememberMe;
      setSessionEnded(false);
      setUser(session.user);
      setStatus('authenticated');
      return session.user;
    },
    [queryClient],
  );

  const endSession = useCallback(() => {
    const endingUserId = userIdRef.current;
    if (endingUserId !== null) setPreviousUserId(endingUserId);
    authService.clear();
    queryClient.clear();
    // The assistant's conversations are PHI held in memory too (S1).
    clearAiSessionData();
    // So are the live adapters' unsaved drafts.
    clearSessionMemory();
    clearConversationsSession();
    pendingRef.current = null;
    setUser(null);
    setStatus('unauthenticated');
  }, [queryClient]);

  // Boot: restore whatever the active backend can restore — the persisted
  // snapshot on the mock path, a silent `POST /auth/refresh` against the
  // httpOnly cookie on the HTTP one. Either way an absent or expired
  // session lands on login rather than hanging on the splash.
  useEffect(() => {
    // Pre-S1 builds kept assistant chats under global keys no logout
    // cleared; whatever a browser still holds there goes on first load.
    removeLegacyAiStorage();
    removeLegacyConversationsStorage();
    let cancelled = false;

    void authService
      .restore()
      .then((session) => {
        if (cancelled) return;
        if (session) {
          setConversationsOwner(session.user.id);
          setUser(session.user);
          setStatus('authenticated');
        } else {
          setStatus('unauthenticated');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── The 401 → refresh → replay handler (F-07, backend M6.3) ─────────────
  // Registered once, for the lifetime of the provider. `ApiClient` owns the
  // single-flight guarantee; this only supplies the exchange and decides
  // what a failed one means. That guarantee is not a nicety here: the
  // backend rotates the refresh token on every use and treats a replay of
  // the previous one as theft, revoking the whole session family. Two
  // concurrent refreshes would present the same token twice and log the
  // user out — so the shared promise is what keeps a burst of parallel
  // 401s from destroying the session it is trying to save.
  useEffect(() => {
    apiClient.setUnauthorizedHandler(async () => {
      const session = await authService.restore();
      if (!session) {
        // Refresh failed: the session is gone (expired, revoked, or a
        // detected reuse). Terminal by contract — hard log out, and say so.
        setSessionEnded(true);
        endSession();
        return null;
      }
      if (userIdRef.current !== null && session.user.id !== userIdRef.current) {
        // The refresh cookie is shared by every tab, so it now belongs to an
        // account signed in from another one. This tab's session — and the
        // patient data it cached and still shows — was the previous
        // account's: end it here, fail closed, rather than carry that data
        // into the new account or replay the request under its token (the
        // MED-SEC-014 review). The other tab's session is untouched:
        // `endSession` drops only this tab's token and cache.
        setSessionEnded(true);
        endSession();
        return null;
      }
      const current = userRef.current;
      if (
        current !== null &&
        (session.user.role !== current.role ||
          !samePermissionSet(session.user.permissions, current.permissions))
      ) {
        // The same account, with a different role or capabilities — an
        // administrator changed them mid-session, which reaches this tab here
        // because the server refuses a token whose role claim is stale
        // (ADR-046). What was cached was fetched under the old grant, so it
        // goes, as on a sign-in; the session itself is still valid, so it is
        // adopted rather than ended. The guards re-read the new user.
        queryClient.clear();
        clearAiSessionData();
        clearSessionMemory();
      }
      authService.persist(session, rememberRef.current);
      setUser(session.user);
      return session.accessToken;
    });
    return () => {
      apiClient.setUnauthorizedHandler(null);
    };
  }, [endSession, queryClient]);

  // ── Auth operations ─────────────────────────────────────────────────────
  const login = useCallback(
    async (email: string, password: string, opts?: { rememberMe?: boolean }) => {
      const rememberMe = opts?.rememberMe ?? false;
      pendingRef.current = null;
      try {
        const outcome = await authService.login({ email, password, rememberMe });

        if (outcome.kind === 'otp') {
          // A second factor is a suspended sign-in, not a failure — but
          // the pages branch on a thrown code, so the outcome becomes one
          // here. The challenge handle rides along for `verifyOtp`.
          pendingRef.current = { email, rememberMe, otpToken: outcome.otpToken || null };
          throw new AuthError('otp_required');
        }

        return finalize(outcome.session, rememberMe);
      } catch (error) {
        if (
          error instanceof AuthError &&
          (error.code === 'otp_required' || error.code === 'email_unverified')
        ) {
          // Stash the in-flight sign-in so verifyOtp/verifyEmail can
          // complete it. `otp_required` already set it above, with a token.
          pendingRef.current ??= { email, rememberMe, otpToken: null };
        }
        throw error;
      }
    },
    [finalize],
  );

  const logout = useCallback(async () => {
    const currentId = user?.id;
    try {
      await authService.logout();
    } finally {
      // Always end the session locally, even if the server call failed —
      // a user who pressed "Log out" must not stay signed in.
      setSessionEnded(false);
      endSession();
      if (currentId) clearUserPreferences(currentId);
    }
  }, [user, endSession]);

  const lock = useCallback(() => {
    // The lock screen replaces the routed tree, so nothing mounted still
    // reads what this drops; unlocking refetches what the next page needs.
    queryClient.clear();
    clearAiSessionData();
    // Mock messaging is taken off disk and held in memory, not wiped: only the
    // same user's unlock in this tab puts it back; logout, another user or a
    // closed tab loses it.
    lockConversationsSession();
    setStatus((prev) => (prev === 'authenticated' ? 'locked' : prev));
  }, [queryClient]);

  const unlock = useCallback(
    async (password: string) => {
      if (!user) throw new AuthError('invalid_credentials');
      const session = await authService.reauthenticate(user.email, password);
      // `null` — the server verified the password for the held session
      // (`/me/password/verify`, or the mock) — and it simply resumes. A
      // session comes back only from the `/auth/login` fallback against an
      // API without the verify route.
      if (session) finalize(session, rememberRef.current, { resumingLock: true });
      else {
        unlockConversationsSession(user.id);
        setStatus('authenticated');
      }
    },
    [user, finalize],
  );

  const register = useCallback(async (input: RegisterInput) => {
    pendingRef.current = null;
    const result = await authService.register(input);
    // Registration does not sign anyone in, but the address it returns is
    // what a later resend-verification needs.
    pendingRef.current = { email: result.email, rememberMe: false, otpToken: null };
    return result;
  }, []);

  const forgotPassword = useCallback((email: string) => authService.forgotPassword(email), []);

  const resetPassword = useCallback(
    (token: string, password: string) => authService.resetPassword(token, password),
    [],
  );

  const verifyEmail = useCallback(
    async (token: string) => {
      const session = await authService.verifyEmail(token, pendingRef.current);
      // Only the mock signs the user straight in; the backend requires a
      // fresh sign-in afterwards and returns no session.
      if (session) finalize(session, pendingRef.current?.rememberMe ?? false);
    },
    [finalize],
  );

  const verifyOtp = useCallback(
    async (code: string) => {
      const pending = pendingRef.current;
      const session = await authService.verifyOtp(code, pending);
      if (session) finalize(session, pending?.rememberMe ?? false);
    },
    [finalize],
  );

  const redeemRecoveryCode = useCallback(
    async (recoveryCode: string) => {
      const pending = pendingRef.current;
      const session = await authService.redeemRecoveryCode(recoveryCode, pending);
      if (session) finalize(session, pending?.rememberMe ?? false);
    },
    [finalize],
  );

  const resendOtp = useCallback(() => authService.resendOtp(pendingRef.current), []);
  const resendVerification = useCallback(
    () => authService.resendVerification(pendingRef.current),
    [],
  );

  // ── Idle auto-lock ──────────────────────────────────────────────────────
  // Only armed while authenticated; any user activity resets the countdown.
  useEffect(() => {
    if (status !== 'authenticated') return;

    let timer = window.setTimeout(function trip() {
      lock();
    }, sessionPolicy.idleLockMs);

    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => lock(), sessionPolicy.idleLockMs);
    };

    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [status, lock]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      sessionEnded,
      previousUserId,
      // `logout` clears `sessionEnded`; every other end of a session sets it.
      signedOut: previousUserId !== null && !sessionEnded,
      login,
      logout,
      lock,
      unlock,
      register,
      forgotPassword,
      resetPassword,
      verifyEmail,
      verifyOtp,
      redeemRecoveryCode,
      resendOtp,
      resendVerification,
    }),
    [
      status,
      user,
      sessionEnded,
      previousUserId,
      login,
      logout,
      lock,
      unlock,
      register,
      forgotPassword,
      resetPassword,
      verifyEmail,
      verifyOtp,
      redeemRecoveryCode,
      resendOtp,
      resendVerification,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** Capability check — FRONTEND_ARCHITECTURE.md §6.5. */
export function useCan(): (permission: Permission) => boolean {
  const { user } = useAuth();
  return useCallback(
    (permission: Permission) => user?.permissions.includes(permission) ?? false,
    [user],
  );
}
