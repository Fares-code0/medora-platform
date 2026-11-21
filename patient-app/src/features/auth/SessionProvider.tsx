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
import { clearPhiCache } from '@/api/query-client';
import { clearRecentDoctors } from '@/features/doctors/recent';
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
 * device (checklist D-11, T-08).
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

  /** Installs a session everywhere it has to exist, in one place. */
  const adoptSession = useCallback(
    async (result: SignInResult) => {
      apiClient.setAccessToken(result.tokens.accessToken);
      await tokenStorage.writeRefreshToken(result.tokens.refreshToken);
      setPendingOtpToken(null);
      setLocked(false);
      setState({ status: 'authenticated', identity: result.identity });
    },
    [tokenStorage],
  );

  /** Tears one down, in one place. Never partially. */
  const endSession = useCallback(
    async (reason: SessionEndReason) => {
      apiClient.setAccessToken(null);
      await tokenStorage.clear();
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

  // Cold-start restore.
  useEffect(() => {
    let active = true;
    void (async () => {
      const refreshToken = await tokenStorage.readRefreshToken();
      if (refreshToken === null) {
        if (active) setState({ status: 'unauthenticated' });
        return;
      }
      try {
        const result = await authService.refresh(refreshToken);
        if (active) await adoptSession(result);
      } catch {
        // A rejected token on a cold start is the ordinary "you were
        // away too long" case, not an incident.
        logger.info('Stored session could not be restored');
        if (active) await endSession('session-expired');
      }
    })();
    return () => {
      active = false;
    };
  }, [adoptSession, authService, endSession, tokenStorage]);

  // Wire the transport's refresh and session-loss hooks to this session.
  useEffect(() => {
    apiClient.setRefreshHandler(async () => {
      const refreshToken = await tokenStorage.readRefreshToken();
      if (refreshToken === null) return null;
      try {
        const result = await authService.refresh(refreshToken);
        await adoptSession(result);
        return result.tokens.accessToken;
      } catch {
        return null;
      }
    });
    apiClient.setSessionLostHandler(() => {
      void endSession('session-expired');
    });
    return () => {
      apiClient.setRefreshHandler(null);
      apiClient.setSessionLostHandler(null);
    };
  }, [adoptSession, authService, endSession, tokenStorage]);

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
    try {
      await authService.logout();
    } catch {
      // The local sweep happens regardless. A network failure must never
      // leave a refresh token on the device.
      logger.warn('Server-side logout did not complete; clearing locally anyway');
    }
    await endSession('signed-out');
  }, [authService, endSession]);

  const unlock = useCallback(() => setLocked(false), []);

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      locked,
      unlock,
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
