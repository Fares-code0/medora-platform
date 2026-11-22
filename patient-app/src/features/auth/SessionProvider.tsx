import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';

import { apiClient } from '@/api/client';
import { normalizeCancellationError } from '@/api/errors';
import { clearPhiCache } from '@/api/query-client';
import { clearRecentDoctors } from '@/features/doctors/recent';
import { isApiError } from '@/types/api';
import { logger } from '@/utils/logger';

import {
  isBiometricUnlockEnabled as defaultIsBiometricUnlockEnabled,
  shouldLockOnForeground,
} from './biometrics';
import {
  decideOnForeground,
  sessionLockPolicy as defaultLockPolicy,
  type SessionLockPolicy,
} from './lock-policy';
import type {
  AuthService,
  LoginInput,
  SessionEndReason,
  SessionState,
  SignInResult,
} from './model/types';
import { isSessionRejection } from './refresh-outcome';
import { authService as defaultAuthService } from './service';
import { tokenStorage as defaultTokenStorage, type TokenStorage } from './storage';

/**
 * The session.
 *
 * ── Cold start ───────────────────────────────────────────────────────
 * `booting` -> read the refresh token from the keychain -> exchange it
 * for a pair -> `authenticated`. A missing or rejected token lands in
 * `unauthenticated` without a visible flash of the login screen
 * (checklist D-05).
 *
 * "Rejected" means the server answered 401, which is how `/auth/refresh`
 * refuses a token. Anything else — no signal, a timeout, a 5xx, a 403 from
 * something in front of the API — lands in `unconfirmed` instead, with the
 * token still in the keychain and a way to try again (`retryRestore`).
 * Deleting the token because a phone was in a lift signed patients out for
 * good; `refresh-outcome.ts` draws the line.
 *
 * ── Ordering ─────────────────────────────────────────────────────────
 * Every keychain and state change goes through one queue, and `epoch`
 * names the current signed-in lifetime. Ending a session moves the epoch
 * on, so a refresh or retry that started before a sign-out is discarded
 * when it lands instead of signing the patient back in. A new session is
 * written to the keychain before anything else about it exists, so a
 * keychain that refuses it leaves nothing half-installed.
 *
 * ── Session loss ─────────────────────────────────────────────────────
 * `ApiClient` calls `setSessionLostHandler` exactly once per failed
 * refresh, however many requests raced it, so the patient sees one
 * "please sign in again" rather than N (checklist D-12, T-05). The state
 * carries `reason: 'session-expired'` so the login screen can say why —
 * a silent bounce to a login form reads as a crash.
 *
 * ── Background timeout ───────────────────────────────────────────────
 * PHI is memory-only, and memory survives backgrounding. A phone left on
 * a table with Medora in the app switcher still holds a records screen.
 * Two graded thresholds answer that — a cache sweep first, then a full
 * end of session requiring the patient to sign in again (checklist
 * T-11). Both are configured in the environment; the reasoning and the
 * table are in `lock-policy.ts`, which owns the decision so that it is
 * testable without an `AppState` transition.
 *
 * ── Logout ───────────────────────────────────────────────────────────
 * Revoke server-side, clear the keychain, clear the access token, clear
 * the query cache. In that order, and all four unconditionally: a
 * server-side revocation that fails must not leave the token on the
 * device (checklist D-11, T-08). With no access token (`unconfirmed`)
 * the server cannot be asked at all — `/auth/logout` revokes the session
 * an access token names — so the sign-out is this phone's only, and the
 * screen offering it says so.
 */

interface SessionContextValue {
  readonly state: SessionState;
  /**
   * True while the biometric gate is up (D-15). Separate from `state`
   * on purpose: the session has NOT ended, so nothing about it should
   * change shape. Only what is on the screen does.
   */
  readonly locked: boolean;
  /** Called by the lock screen once the OS has confirmed the patient. */
  unlock: () => void;
  /**
   * From `unconfirmed` only: exchange the stored refresh token again.
   * A no-op in any other state, so a stray call cannot restart a session
   * that is already up or bring back one that was ended.
   *
   * `until`, when given, holds the outcome — signed in, or sent to sign in
   * — until it resolves, so the screen can wait for the patient to come
   * back from Emergency (audit M4). The rotated token is stored at once.
   *
   * Resolves `skipped` when it did nothing (not `unconfirmed`, or a retry
   * is already running), `no-answer` when the server did not answer again,
   * and `settled` when the session moved on.
   */
  retryRestore: (options?: {
    readonly until?: () => Promise<void>;
  }) => Promise<'skipped' | 'no-answer' | 'settled'>;
  login: (input: LoginInput) => Promise<'authenticated' | 'otp-required'>;
  /** Completes a login that ended in a step-up. */
  completeOtp: (code: string) => Promise<void>;
  /** Completes the same step-up with a recovery code (owner decision R1). */
  completeWithRecoveryCode: (recoveryCode: string) => Promise<void>;
  resendOtp: () => Promise<void>;
  /** Non-null only while a step-up is outstanding. */
  readonly pendingOtpToken: string | null;
  adoptSession: (result: SignInResult) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * The keychain refused a new session, so it was not kept (audit M2). By
 * the time this is thrown the session has already been ended: nothing was
 * left half-installed.
 */
export class SessionStorageError extends Error {
  constructor() {
    super('This phone could not store the sign-in securely.');
    this.name = 'SessionStorageError';
  }
}

export interface SessionProviderProps {
  readonly children: ReactNode;
  /** Test seams. Production uses the real service and the keychain. */
  readonly authService?: AuthService;
  readonly tokenStorage?: TokenStorage;
  /** Defaults to the configured policy; a test supplies its own thresholds. */
  readonly lockPolicy?: SessionLockPolicy;
  /** Test seam for the D-15 opt-in. Production reads the preference. */
  readonly isBiometricUnlockEnabled?: () => boolean;
}

export function SessionProvider({
  children,
  authService = defaultAuthService,
  tokenStorage = defaultTokenStorage,
  lockPolicy = defaultLockPolicy,
  isBiometricUnlockEnabled = defaultIsBiometricUnlockEnabled,
}: SessionProviderProps) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>({ status: 'booting' });
  const [pendingOtpToken, setPendingOtpToken] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  /**
   * Which signed-in lifetime this is. `endSessionNow` moves it on, so the
   * outcome of anything that started under an earlier one — a retry, a
   * refresh — is discarded when it lands, rather than signing a patient
   * back in after they signed out (audit M5).
   */
  const epoch = useRef(0);

  /**
   * Keychain and session-state changes happen one at a time, in order.
   * Without it, a sign-out could clear the keychain while an adoption was
   * halfway through writing to it, and the late write would win.
   *
   * Tasks queued here must call the `…Now` helpers, never another queued
   * function: a task that queued behind itself would wait for ever.
   */
  const queue = useRef<Promise<void>>(Promise.resolve());
  const serialized = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(task, task);
    queue.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  /** Tears a session down, in one place. Never partially. Queue-only. */
  const endSessionNow = useCallback(
    async (reason: SessionEndReason) => {
      epoch.current += 1;
      apiClient.setAccessToken(null);
      try {
        await tokenStorage.clear();
      } catch {
        // The rest of the teardown must still happen: a keychain that
        // refuses one call must not leave a session on the screen.
        logger.warn('The keychain could not be cleared while ending a session');
      }
      clearPhiCache(queryClient);
      // Which specialists this patient looked at is an inference about
      // their health, so it goes when the clinical cache goes (G-10).
      clearRecentDoctors();
      setPendingOtpToken(null);
      // Whatever ends a session also takes the lock down with it. A lock
      // left standing over the login screen would ask for a fingerprint
      // to reach a password field.
      setLocked(false);
      setState({ status: 'unauthenticated', reason });
    },
    [queryClient, tokenStorage],
  );

  const endSession = useCallback(
    (reason: SessionEndReason) => serialized(() => endSessionNow(reason)),
    [endSessionNow, serialized],
  );

  /**
   * Stores the rotated refresh token — first, before anything else about
   * the new session exists (audit M2). Queue-only.
   *
   * - `stale`: the lifetime it belongs to has ended; nothing is written.
   * - `unstorable`: the keychain refused it. The session is ended on the
   *   spot: no access token was installed, and clearing the keychain
   *   removes the superseded token too, so it is never presented again —
   *   the server would read that as a replay (ADR-026).
   */
  const persistNow = useCallback(
    async (
      result: SignInResult,
      expectedEpoch: number | null,
    ): Promise<'persisted' | 'stale' | 'unstorable'> => {
      if (expectedEpoch !== null && expectedEpoch !== epoch.current) return 'stale';
      try {
        await tokenStorage.writeRefreshToken(result.tokens.refreshToken);
        return 'persisted';
      } catch {
        logger.error('The keychain refused the new session; ending it');
        await endSessionNow('session-expired');
        return 'unstorable';
      }
    },
    [endSessionNow, tokenStorage],
  );

  /** Installs a stored session in memory and on screen. Queue-only. */
  const activateNow = useCallback(
    (result: SignInResult, expectedEpoch: number | null): 'active' | 'stale' => {
      if (expectedEpoch !== null && expectedEpoch !== epoch.current) return 'stale';
      apiClient.setAccessToken(result.tokens.accessToken);
      setPendingOtpToken(null);
      // No `setLocked(false)` here: a mid-session refresh lands through this
      // too, and renewing tokens is not the patient proving who they are.
      // Only a sign-in drops the lock (`adoptSession`).
      setState({ status: 'authenticated', identity: result.identity });
      return 'active';
    },
    [],
  );

  /**
   * Installs a session everywhere it has to exist, in one place. A sign-in
   * the patient just completed belongs to no earlier lifetime, so it is
   * never stale; a keychain that refuses it is reported, with the session
   * already ended.
   */
  const adoptSession = useCallback(
    (result: SignInResult) =>
      serialized(async () => {
        if ((await persistNow(result, null)) === 'unstorable') {
          throw new SessionStorageError();
        }
        setLocked(false);
        activateNow(result, null);
      }),
    [activateNow, persistNow, serialized],
  );

  /**
   * Exchanges the stored refresh token. The network call stays outside the
   * queue; only what it decides goes through it.
   *
   * `settle` is awaited after the token is stored and before the screen
   * changes — the patient's own pace, so a retry never moves them off a
   * screen they are reading (audit M4). The new token is written at once
   * regardless: the server has already rotated it.
   *
   * `no-answer` is the only outcome that leaves the session where it was;
   * every other one has moved it (or found it already moved).
   *
   * **Known limitation — backend-owned (audit M1).** "No answer" cannot
   * tell "the request never arrived" from "the server rotated the token
   * and the response was lost". In the second case the keychain still
   * holds the superseded token; the next retry presents it, the backend
   * reads a replay (`refresh.service.ts` `handlePossibleReplay`), revokes
   * the session and logs `auth.refresh_reuse_detected`. The session ends
   * correctly — but a security alarm fires for a dropped packet. A client
   * cannot fix this without guessing at server state, so it does not try:
   * no grace period is invented here. The fix is server-side idempotent
   * rotation; see the patient-app checklist, D-12.
   */
  const exchangeStoredToken = useCallback(
    async (settle: () => Promise<void>): Promise<'no-answer' | 'settled'> => {
      const started = epoch.current;
      let refreshToken: string | null;
      try {
        refreshToken = await tokenStorage.readRefreshToken();
      } catch {
        // A keychain that throws on read (a Keystore key invalidated, an
        // entry it cannot decrypt) holds no token this app can use: signed
        // out, not stuck on the boot screen. The entry is not deleted — a
        // read that failed once may succeed on the next launch, and a
        // sign-in overwrites it either way. Never the token in the log.
        logger.warn('The keychain could not be read while restoring a session');
        refreshToken = null;
      }
      if (refreshToken === null) {
        await serialized(async () => {
          if (started === epoch.current) setState({ status: 'unauthenticated' });
        });
        return 'settled';
      }

      let result: SignInResult;
      try {
        result = await authService.refresh(refreshToken);
      } catch (error) {
        if (isSessionRejection(error)) {
          // A rejected token is the ordinary "you were away too long"
          // case, not an incident.
          logger.info('Stored session could not be restored');
          await settle();
          await serialized(async () => {
            if (started === epoch.current) await endSessionNow('session-expired');
          });
          return 'settled';
        }
        // No answer about the token, so the token stays. The kind only —
        // never the token, never an identifier.
        logger.warn('Stored session could not be confirmed; keeping it', {
          kind: isApiError(error) ? error.kind : 'unknown',
        });
        return 'no-answer';
      }

      if ((await serialized(() => persistNow(result, started))) !== 'persisted') return 'settled';
      await settle();
      await serialized(async () => {
        activateNow(result, started);
      });
      return 'settled';
    },
    [activateNow, authService, endSessionNow, persistNow, serialized, tokenStorage],
  );

  // Cold-start restore. Nothing to wait for: there is no screen yet.
  useEffect(() => {
    void (async () => {
      if ((await exchangeStoredToken(() => Promise.resolve())) === 'no-answer') {
        await serialized(async () => {
          // Booting, unless a sign-in landed first (it cannot today, but a
          // state that is not ours to replace is left alone).
          setState((current) =>
            current.status === 'booting' ? { status: 'unconfirmed' } : current,
          );
        });
      }
    })();
  }, [exchangeStoredToken, serialized]);

  // A ref, not a dependency: the callback must not change identity every
  // time the state does, or every consumer re-renders with it. Synced
  // after commit rather than during render, which React may discard;
  // every caller is a tap or a reconnect, so it always runs after one.
  const statusRef = useRef(state.status);
  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);
  const restoring = useRef(false);

  const retryRestore = useCallback<SessionContextValue['retryRestore']>(
    async (options) => {
      // Single-flight: a Retry tap racing the reconnect retry must not
      // present the same refresh token twice, which the backend reads as
      // a replay and answers by revoking the session family (ADR-026).
      if (statusRef.current !== 'unconfirmed' || restoring.current) return 'skipped';
      restoring.current = true;
      try {
        // Already `unconfirmed`; no answer again changes nothing.
        return await exchangeStoredToken(options?.until ?? (() => Promise.resolve()));
      } finally {
        restoring.current = false;
      }
    },
    [exchangeStoredToken],
  );

  // Wire the transport's refresh and session-loss hooks to this session.
  useEffect(() => {
    apiClient.setRefreshHandler(async () => {
      // Only a signed-in session refreshes here. Signed out, a late 401 has
      // no session to end (and must not rewrite why the last one ended);
      // unconfirmed, `retryRestore` owns the stored token, and a second
      // exchange of it would be a replay that skips the Emergency hold.
      //
      // The access token as well as the status: `endSessionNow` clears it in
      // the same tick that moves the epoch on, while `statusRef` only follows
      // after the keychain is cleared and React commits. A 401 landing in
      // that gap would otherwise start under the NEW epoch, read the token
      // the clear has not removed yet, and sign the patient back in.
      if (statusRef.current !== 'authenticated' || !apiClient.hasAccessToken()) {
        throw normalizeCancellationError();
      }
      const started = epoch.current;
      let refreshToken: string | null;
      try {
        refreshToken = await tokenStorage.readRefreshToken();
      } catch {
        // No answer about the token, as on a cold start: returning null
        // here would end the session as "expired" and clear an entry the
        // next read may well return. An `ApiError` is rethrown by
        // `refreshOnce` without a session loss, so the waiting requests
        // stop quietly and the session and the entry both stay.
        logger.warn('The keychain could not be read for a mid-session refresh');
        throw normalizeCancellationError();
      }
      if (refreshToken === null) {
        if (started !== epoch.current) throw normalizeCancellationError();
        return null;
      }

      let result: SignInResult;
      try {
        result = await authService.refresh(refreshToken);
      } catch (error) {
        if (!isSessionRejection(error)) {
          // A rethrow does not end the session; null would. A refresh that
          // got no answer reaches the screen as the transport error it was
          // ("can't reach Medora", with Retry) and the session stays.
          throw error;
        }
        // Refused. Null ends the session — but only this lifetime's: a
        // refusal arriving after a sign-out must not end the next one.
        if (started !== epoch.current) throw normalizeCancellationError();
        return null;
      }

      const installed = await serialized(async () => {
        if ((await persistNow(result, started)) !== 'persisted') return false;
        return activateNow(result, started) === 'active';
      });
      // Signed out meanwhile, or the keychain refused it and the session is
      // already ended: either way the waiting requests just stop, quietly.
      if (!installed) throw normalizeCancellationError();
      return result.tokens.accessToken;
    });
    apiClient.setSessionLostHandler(() => {
      void endSession('session-expired');
    });
    return () => {
      apiClient.setRefreshHandler(null);
      apiClient.setSessionLostHandler(null);
    };
  }, [activateNow, authService, endSession, persistNow, serialized, tokenStorage]);

  // Background timeout (checklist T-11). `lock-policy.ts` decides; this
  // effect only measures the absence and carries the decision out.
  const status = state.status;
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        // `??=`, not `=`: iOS reports `inactive` on the way to
        // `background` and again on the way back, and restarting the
        // clock on the second one would reset every absence to zero.
        backgroundedAt.current ??= Date.now();
        return;
      }
      if (next !== 'active') return;

      const since = backgroundedAt.current;
      backgroundedAt.current = null;
      // Nothing to protect when there was no absence, or no session.
      if (since === null || status !== 'authenticated') return;

      const action = decideOnForeground(Date.now() - since, lockPolicy);
      switch (action) {
        case 'reauthenticate':
          logger.info('Session ended after a background timeout; re-authentication required');
          void endSession('locked');
          break;
        case 'sweep-phi':
          clearPhiCache(queryClient);
          logger.info('Cleared cached clinical data after a background timeout');
          break;
        case 'none':
          break;
      }

      // D-15, layered on top of the above rather than replacing any of
      // it. `shouldLockOnForeground` decides; this only carries it out.
      if (shouldLockOnForeground(action, isBiometricUnlockEnabled())) {
        logger.info('Biometric unlock required after a background timeout');
        setLocked(true);
      }
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, [endSession, isBiometricUnlockEnabled, lockPolicy, queryClient, status]);

  const login = useCallback<SessionContextValue['login']>(
    async (input) => {
      const outcome = await authService.login(input);
      if (outcome.kind === 'otp-required') {
        setPendingOtpToken(outcome.otpToken);
        return 'otp-required';
      }
      await adoptSession(outcome.result);
      return 'authenticated';
    },
    [adoptSession, authService],
  );

  const completeOtp = useCallback<SessionContextValue['completeOtp']>(
    async (code) => {
      if (pendingOtpToken === null) {
        throw new Error('No verification is in progress.');
      }
      const result = await authService.verifyOtp({ otpToken: pendingOtpToken, code });
      await adoptSession(result);
    },
    [adoptSession, authService, pendingOtpToken],
  );

  const completeWithRecoveryCode = useCallback<SessionContextValue['completeWithRecoveryCode']>(
    async (recoveryCode) => {
      if (pendingOtpToken === null) {
        throw new Error('No verification is in progress.');
      }
      const result = await authService.redeemRecoveryCode({
        otpToken: pendingOtpToken,
        recoveryCode,
      });
      await adoptSession(result);
    },
    [adoptSession, authService, pendingOtpToken],
  );

  const resendOtp = useCallback(async () => {
    if (pendingOtpToken === null) return;
    await authService.resendOtp(pendingOtpToken);
  }, [authService, pendingOtpToken]);

  const logout = useCallback(async () => {
    // `POST /auth/logout` revokes the session the ACCESS token names
    // (`@Authenticated()`); there is no route that revokes by refresh
    // token. With no access token — the `unconfirmed` state — there is
    // nothing the server could act on, so it is not asked, and the screen
    // says the sign-out is this phone's only.
    if (apiClient.hasAccessToken()) {
      try {
        await authService.logout();
      } catch {
        // The local sweep happens regardless. A network failure must never
        // leave a refresh token on the device.
        logger.warn('Server-side logout did not complete; clearing locally anyway');
      }
    } else {
      logger.info('Signed out on this device only; the server could not be told');
    }
    // Moves the epoch on, so a retry or refresh still in flight cannot
    // bring this session back when it lands (audit M5).
    await endSession('signed-out');
  }, [authService, endSession]);

  const unlock = useCallback(() => setLocked(false), []);

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      locked,
      unlock,
      retryRestore,
      login,
      completeOtp,
      completeWithRecoveryCode,
      resendOtp,
      pendingOtpToken,
      adoptSession,
      logout,
    }),
    [
      state,
      locked,
      unlock,
      retryRestore,
      login,
      completeOtp,
      completeWithRecoveryCode,
      resendOtp,
      pendingOtpToken,
      adoptSession,
      logout,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * The session, when there is a provider above — and `null` when there is
 * not, instead of throwing.
 *
 * For the Emergency screen and nothing else. That screen renders in the
 * signed-out stack, and `emergency.test.tsx` mounts it with **no
 * providers at all** deliberately: the test that proves the screen has
 * no session dependency is a test that would fail if any part of it
 * called `useSession`. A section that merely *enhances* the screen when
 * a patient is signed in (N-08's contacts) has to be able to ask
 * without turning that guarantee into an exception.
 */
export function useOptionalSession(): SessionContextValue | null {
  return useContext(SessionContext) ?? null;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>.');
  return value;
}

/**
 * The identity, when there is one.
 *
 * Returns null rather than throwing when signed out, because Emergency
 * renders in both stacks and must not depend on a session existing.
 */
export function useIdentity() {
  const { state } = useSession();
  return state.status === 'authenticated' ? state.identity : null;
}
