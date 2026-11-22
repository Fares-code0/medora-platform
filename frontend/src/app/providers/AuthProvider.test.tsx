import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '@/api/client';
import { sessionPolicy } from '@/configs/session';
import { authService } from '@/features/auth/service';
import { LEGACY_AI_STORAGE_KEYS } from '@/features/doctor/ai/model/session-storage';
import { readConversations, readSettings, writeSettings } from '@/features/doctor/ai/model/store';
import { DEFAULT_AI_SETTINGS } from '@/features/doctor/ai/model/types';
import { aiService } from '@/features/doctor/ai/service';
import { isAuthError } from '@/types/auth';

import { AuthProvider, useAuth } from './AuthProvider';
import { QueryProvider } from './QueryProvider';

/**
 * `AuthProvider` on the mock path — the DP-04 no-regression guarantee.
 *
 * `vitest.config.ts` sets `VITE_ENABLE_MOCKS=true` for the whole suite, so
 * this file exercises the seeded accounts, the branch flows, the idle
 * auto-lock (A-11) and the session lifecycle. It is the check that moving
 * the provider onto the seam changed the *wiring* and not the behaviour.
 * The opt-in is explicit because `env.ts` has no default for that flag —
 * an unset variable means mocks off, which is what keeps a production build
 * off mock auth.
 *
 * Fake timers throughout, because the mock service adds up to 900 ms of
 * deliberate latency and the idle lock is a ten-minute timeout — both are
 * advanced rather than waited on.
 */

const SEEDED_DOCTOR = 'doctor@medora.health';
const PASSWORD = 'Medora123!';

function wrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryProvider>
        <AuthProvider>{children}</AuthProvider>
      </QueryProvider>
    );
  };
}

/**
 * Renders the provider and drains the boot restore.
 *
 * `waitFor` is deliberately not used anywhere in this file: it polls on
 * real timers, which never advance here. `advanceTimersByTimeAsync`
 * awaits between ticks, so it flushes the restore's microtasks too.
 */
async function boot() {
  const view = renderHook(() => useAuth(), { wrapper: wrapper() });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  return view;
}

/** Renders the provider with no stored session, and asserts it booted signed out. */
async function signedOut() {
  const view = await boot();
  expect(view.result.current.status).toBe('unauthenticated');
  return view;
}

/**
 * Runs `op`, drains the mock service's deliberate latency, then settles
 * exactly as `op` did — so callers can assert on the resolved value or on
 * the rejected `AuthError` itself.
 *
 * The operation's promise is returned rather than re-thrown: the caught
 * value is `unknown`, and re-throwing it would both lose its type and
 * trip `only-throw-error`. The inner `.catch` is a parking handler so
 * that advancing the timers cannot raise an unhandled rejection in the
 * window before the caller attaches its own assertion.
 */
async function settle<T>(op: () => Promise<T>): Promise<T> {
  let operation!: Promise<T>;
  await act(async () => {
    operation = op();
    operation.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(2_000);
    await operation.catch(() => undefined);
  });
  return operation;
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('AuthProvider on the mock path — sign-in', () => {
  it('signs in the seeded doctor and exposes the session', async () => {
    const { result } = await signedOut();

    await settle(() => result.current.login(SEEDED_DOCTOR, PASSWORD));

    expect(result.current.status).toBe('authenticated');
    expect(result.current.user?.name).toBe('Dr. Amelia Chen');
    expect(result.current.user?.role).toBe('doctor');
    expect(result.current.user?.permissions).toContain('patients.view');
  });

  it('returns the signed-in user, so LoginPage can route on a real role', async () => {
    const { result } = await signedOut();

    const user = await settle(() => result.current.login(SEEDED_DOCTOR, PASSWORD));

    expect(user?.role).toBe('doctor');
  });

  it('signs in the seeded admin', async () => {
    const { result } = await signedOut();

    await settle(() => result.current.login('admin@medora.health', PASSWORD));

    expect(result.current.user?.role).toBe('admin');
    expect(result.current.user?.permissions).toContain('logs.view');
  });

  it('rejects a wrong password with invalid_credentials', async () => {
    const { result } = await signedOut();

    await expect(settle(() => result.current.login(SEEDED_DOCTOR, 'nope'))).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    expect(result.current.status).toBe('unauthenticated');
  });

  it('routes an unverified account to email verification', async () => {
    const { result } = await signedOut();

    await expect(
      settle(() => result.current.login('unverified@medora.health', PASSWORD)),
    ).rejects.toMatchObject({ code: 'email_unverified' });
  });

  it('suspends a 2FA sign-in and completes it with the magic code', async () => {
    const { result } = await signedOut();

    await expect(
      settle(() => result.current.login('secure@medora.health', PASSWORD)),
    ).rejects.toMatchObject({ code: 'otp_required' });
    expect(result.current.status).toBe('unauthenticated');

    await settle(() => result.current.verifyOtp('123456'));

    expect(result.current.status).toBe('authenticated');
    expect(result.current.user?.email).toBe('secure@medora.health');
  });

  it('rejects a wrong OTP with otp_invalid', async () => {
    const { result } = await signedOut();
    await expect(
      settle(() => result.current.login('secure@medora.health', PASSWORD)),
    ).rejects.toMatchObject({ code: 'otp_required' });

    await expect(settle(() => result.current.verifyOtp('000000'))).rejects.toSatisfy(isAuthError);
    expect(result.current.status).toBe('unauthenticated');
  });
});

describe('AuthProvider on the mock path — session lifecycle', () => {
  it('persists to sessionStorage without Remember Me, and localStorage with it', async () => {
    const { result } = await signedOut();

    await settle(() => result.current.login(SEEDED_DOCTOR, PASSWORD));
    expect(window.sessionStorage.getItem('medora.session')).not.toBeNull();
    expect(window.localStorage.getItem('medora.session')).toBeNull();

    await settle(() => result.current.logout());
    await settle(() => result.current.login(SEEDED_DOCTOR, PASSWORD, { rememberMe: true }));

    expect(window.localStorage.getItem('medora.session')).not.toBeNull();
    expect(window.sessionStorage.getItem('medora.session')).toBeNull();
  });

  it('restores a persisted session on boot', async () => {
    const first = await signedOut();
    await settle(() => first.result.current.login(SEEDED_DOCTOR, PASSWORD, { rememberMe: true }));
    first.unmount();

    const { result } = await boot();

    expect(result.current.status).toBe('authenticated');
    expect(result.current.user?.email).toBe(SEEDED_DOCTOR);
  });

  it('clears the session on logout', async () => {
    const { result } = await signedOut();
    await settle(() => result.current.login(SEEDED_DOCTOR, PASSWORD, { rememberMe: true }));

    await settle(() => result.current.logout());

    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.user).toBeNull();
    expect(window.localStorage.getItem('medora.session')).toBeNull();
  });

  it('unlocks with the account password and refuses a wrong one (A-07)', async () => {
    const { result } = await signedOut();
    await settle(() => result.current.login(SEEDED_DOCTOR, PASSWORD));

    act(() => {
      result.current.lock();
    });
    expect(result.current.status).toBe('locked');

    await expect(settle(() => result.current.unlock('wrong'))).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    expect(result.current.status).toBe('locked');

    await settle(() => result.current.unlock(PASSWORD));
    expect(result.current.status).toBe('authenticated');
  });
});

describe('AuthProvider — idle auto-lock (A-11)', () => {
  it('locks the session after the idle threshold', async () => {
    const { result } = await signedOut();
    await settle(() => result.current.login(SEEDED_DOCTOR, PASSWORD));
    expect(result.current.status).toBe('authenticated');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(sessionPolicy.idleLockMs + 1_000);
    });

    expect(result.current.status).toBe('locked');
  });

  it('does not lock while the user is active — activity restarts the countdown', async () => {
    const { result } = await signedOut();
    await settle(() => result.current.login(SEEDED_DOCTOR, PASSWORD));

    // Three quarters of the way there, then a keystroke, three times over.
    // Total elapsed time far exceeds the threshold; idle time never does.
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(sessionPolicy.idleLockMs * 0.75);
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      });
    }

    expect(result.current.status).toBe('authenticated');

    // Now go quiet: it locks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(sessionPolicy.idleLockMs + 1_000);
    });
    expect(result.current.status).toBe('locked');
  });

  it('does not arm the timer while unauthenticated', async () => {
    const { result } = await signedOut();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(sessionPolicy.idleLockMs * 3);
    });

    expect(result.current.status).toBe('unauthenticated');
  });
});

/**
 * The query cache is PHI held in memory (FRONTEND_ARCHITECTURE.md §6.3,
 * §12.5): it must not outlive the session that fetched it. Before this was
 * wired, nothing called `clear()` — a second account signing in on the
 * same tab within the stale window was served the first account's patient
 * lists without a request. Ending employment ends the session (OD-12), so
 * the refresh-failure path here is also how a revoked doctor's caches go.
 */
describe('AuthProvider — the query cache does not outlive the session', () => {
  const CACHED = ['patients', 'list'] as const;

  async function bootWithClient() {
    const client = new QueryClient();
    const view = renderHook(() => useAuth(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <AuthProvider>{children}</AuthProvider>
        </QueryClientProvider>
      ),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(view.result.current.status).toBe('unauthenticated');
    return { ...view, client };
  }

  it('empties the cache on logout', async () => {
    const { result, client } = await bootWithClient();
    await settle(() => result.current.login(SEEDED_DOCTOR, PASSWORD));
    client.setQueryData(CACHED, ['PT-1001']);

    await settle(() => result.current.logout());

    expect(client.getQueryData(CACHED)).toBeUndefined();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it('empties the cache when the session locks', async () => {
    const { result, client } = await bootWithClient();
    await settle(() => result.current.login(SEEDED_DOCTOR, PASSWORD));
    client.setQueryData(CACHED, ['PT-1001']);

    act(() => {
      result.current.lock();
    });

    expect(result.current.status).toBe('locked');
    expect(client.getQueryData(CACHED)).toBeUndefined();
  });

  it('does not let one account read another account’s cache', async () => {
    const { result, client } = await bootWithClient();
    await settle(() => result.current.login(SEEDED_DOCTOR, PASSWORD));
    client.setQueryData(CACHED, ['PT-1001']);
    await settle(() => result.current.logout());

    await settle(() => result.current.login('admin@medora.health', PASSWORD));

    expect(result.current.user?.role).toBe('admin');
    expect(client.getQueryData(CACHED)).toBeUndefined();
  });

  it('keeps the cache while the session simply continues', async () => {
    const { result, client } = await bootWithClient();
    await settle(() => result.current.login(SEEDED_DOCTOR, PASSWORD));
    client.setQueryData(CACHED, ['PT-1001']);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(client.getQueryData(CACHED)).toEqual(['PT-1001']);
  });
});

/**
 * A session the server ends — a refused refresh: expired, revoked from
 * another device, a suspended account — used to drop the user on the sign-in
 * page with nothing to say why. The provider now remembers that the session
 * ended unasked, and the sign-in page says so (`LoginPage.test.tsx`).
 */
describe('AuthProvider — a session the server ended', () => {
  async function signedInWithCapturedHandler() {
    let handler: (() => Promise<string | null>) | null = null;
    const register = apiClient.setUnauthorizedHandler.bind(apiClient);
    vi.spyOn(apiClient, 'setUnauthorizedHandler').mockImplementation((next) => {
      if (next) handler = next;
      register(next);
    });
    const view = await signedOut();
    await settle(() => view.result.current.login(SEEDED_DOCTOR, PASSWORD));
    expect(view.result.current.status).toBe('authenticated');
    if (handler === null) throw new Error('no unauthorized handler registered');
    return { ...view, refresh: handler as () => Promise<string | null> };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is flagged when a refresh is refused, and not before', async () => {
    const { result, refresh } = await signedInWithCapturedHandler();
    expect(result.current.sessionEnded).toBe(false);

    vi.spyOn(authService, 'restore').mockResolvedValue(null);
    await settle(() => refresh());

    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.sessionEnded).toBe(true);
  });

  it('is cleared by the next sign-in', async () => {
    const { result, refresh } = await signedInWithCapturedHandler();
    const restore = vi.spyOn(authService, 'restore').mockResolvedValue(null);
    await settle(() => refresh());
    restore.mockRestore();

    await settle(() => result.current.login(SEEDED_DOCTOR, PASSWORD));

    expect(result.current.sessionEnded).toBe(false);
  });

  it('is never set by a logout the user asked for', async () => {
    const { result } = await signedInWithCapturedHandler();

    await settle(() => result.current.logout());

    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.sessionEnded).toBe(false);
  });
});

/**
 * MED-SEC-014 review — an account switched underneath this tab.
 *
 * The refresh cookie is shared by every tab, so after another tab signs out
 * and in as someone else, this tab's next 401 → refresh comes back with a
 * session for a DIFFERENT account. Adopting it would carry the first
 * account's cached patient data (a lab worklist, say) into the second
 * account's session, and replay the failed request under the new token. The
 * provider ends this tab's session instead — fail closed.
 */
describe('AuthProvider — an account switched in another tab', () => {
  const CACHED = ['doctor-labs', 'list'] as const;

  async function signedInWithClientAndHandler() {
    let handler: (() => Promise<string | null>) | null = null;
    const register = apiClient.setUnauthorizedHandler.bind(apiClient);
    vi.spyOn(apiClient, 'setUnauthorizedHandler').mockImplementation((next) => {
      if (next) handler = next;
      register(next);
    });
    const client = new QueryClient();
    const view = renderHook(() => useAuth(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <AuthProvider>{children}</AuthProvider>
        </QueryClientProvider>
      ),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    await settle(() => view.result.current.login(SEEDED_DOCTOR, PASSWORD));
    expect(view.result.current.status).toBe('authenticated');
    if (handler === null) throw new Error('no unauthorized handler registered');
    const user = view.result.current.user;
    if (user === null) throw new Error('no signed-in user');
    client.setQueryData(CACHED, [{ id: 'LAB-1', patient: { name: 'Synthetic Patient A' } }]);
    return { ...view, client, user, refresh: handler as () => Promise<string | null> };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ends this tab’s session when the refresh answers for a different account', async () => {
    const { result, client, user, refresh } = await signedInWithClientAndHandler();
    vi.spyOn(authService, 'restore').mockResolvedValue({
      user: { ...user, id: `${user.id}-someone-else`, email: 'colleague@medora.health' },
      accessToken: 'token-for-the-other-account',
      expiresIn: 900,
    });

    const token = await settle(() => refresh());

    // Nothing is replayed under the other account's token…
    expect(token).toBeNull();
    // …this tab does not become that account…
    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.user).toBeNull();
    expect(result.current.sessionEnded).toBe(true);
    // …and the previous account's cached patient data is gone.
    expect(client.getQueryData(CACHED)).toBeUndefined();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it('keeps the session and its cache when the refresh answers for the same account', async () => {
    const { result, client, user, refresh } = await signedInWithClientAndHandler();
    vi.spyOn(authService, 'restore').mockResolvedValue({
      user,
      accessToken: 'rotated-token',
      expiresIn: 900,
    });

    const token = await settle(() => refresh());

    expect(token).toBe('rotated-token');
    expect(result.current.status).toBe('authenticated');
    expect(result.current.user?.id).toBe(user.id);
    expect(client.getQueryData(CACHED)).toBeDefined();
  });

  it('drops a laboratory read still in flight when the session ends — it never lands afterwards', async () => {
    const { result, client } = await signedInWithClientAndHandler();
    let answer!: (rows: unknown) => void;
    const inFlight = client.fetchQuery({
      queryKey: ['doctor-labs', 'list', 'in-flight'],
      queryFn: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    inFlight.catch(() => undefined);

    await settle(() => result.current.logout());
    // The previous session's response arrives after the session has ended.
    await act(async () => {
      answer([{ id: 'LAB-LATE', patient: { name: 'Synthetic Patient Late' } }]);
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(result.current.status).toBe('unauthenticated');
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it('starts every sign-in from an empty cache', async () => {
    const client = new QueryClient();
    const view = renderHook(() => useAuth(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <AuthProvider>{children}</AuthProvider>
        </QueryClientProvider>
      ),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    // Whatever a previous holder of the tab left behind, by any path.
    client.setQueryData(CACHED, [{ id: 'LAB-1', patient: { name: 'Synthetic Patient A' } }]);

    await settle(() => view.result.current.login(SEEDED_DOCTOR, PASSWORD));

    expect(view.result.current.status).toBe('authenticated');
    expect(client.getQueryData(CACHED)).toBeUndefined();
  });
});

/**
 * S1 — the assistant's conversations are PHI. A patient-context chat carries
 * the directory patient's name (context, title, greeting), and it used to
 * persist under a global `medora.ai.*` key that no logout cleared, so the
 * next account on the browser read it. Conversations are now in memory
 * only, and end on every path that clears the query cache.
 */
describe('AuthProvider — the AI assistant’s session data (S1)', () => {
  const PATIENT_NAME = 'Omar Saleh';
  const PATIENT_CONTEXT = {
    mode: 'patient',
    patientId: 'PT-1001',
    patientName: PATIENT_NAME,
    refId: null,
  } as const;

  function createPatientChat() {
    return aiService.createConversation({
      context: PATIENT_CONTEXT,
      title: `Current patient · ${PATIENT_NAME}`,
      seedGreeting: true,
    });
  }

  function storageText(): string {
    const entries: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i) ?? '';
      entries.push(`${key}=${window.localStorage.getItem(key) ?? ''}`);
    }
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i) ?? '';
      entries.push(`${key}=${window.sessionStorage.getItem(key) ?? ''}`);
    }
    return entries.join('\n');
  }

  function holdsChat(id: string): boolean {
    return readConversations().some((conversation) => conversation.id === id);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hands user B none of user A’s patient chat after A logs out', async () => {
    const { result } = await signedOut();
    await settle(() => result.current.login(SEEDED_DOCTOR, PASSWORD, { rememberMe: true }));
    const doctorId = result.current.user?.id ?? '';
    const chat = createPatientChat();
    writeSettings({ ...DEFAULT_AI_SETTINGS, temperature: 0.9 }, doctorId);
    expect(holdsChat(chat.id)).toBe(true);

    await settle(() => result.current.logout());
    await settle(() => result.current.login('admin@medora.health', PASSWORD));

    expect(result.current.user?.role).toBe('admin');
    expect(holdsChat(chat.id)).toBe(false);
    expect(JSON.stringify(readConversations())).not.toContain(PATIENT_NAME);
    // B reads its own (default) settings; A's, which hold no PHI, are kept
    // for A in A's namespace (F2), as a composed dashboard is.
    expect(readSettings(result.current.user?.id ?? null)).toStrictEqual(DEFAULT_AI_SETTINGS);
    expect(readSettings(doctorId).temperature).toBe(0.9);
    expect(storageText()).not.toContain(PATIENT_NAME);
  });

  it('never writes a patient name, or a medora.ai.* key, to browser storage', async () => {
    const { result } = await signedOut();
    await settle(() => result.current.login(SEEDED_DOCTOR, PASSWORD, { rememberMe: true }));
    const doctorId = result.current.user?.id ?? '';

    createPatientChat();
    writeSettings(DEFAULT_AI_SETTINGS, doctorId);

    expect(storageText()).not.toContain(PATIENT_NAME);
    expect(storageText()).not.toContain('PT-1001');
    expect(storageText()).not.toMatch(/^medora\.ai\./m);
    for (const key of LEGACY_AI_STORAGE_KEYS) {
      expect(window.localStorage.getItem(key)).toBeNull();
    }
  });

  it('drops the chats when the session locks', async () => {
    const { result } = await signedOut();
    await settle(() => result.current.login(SEEDED_DOCTOR, PASSWORD));
    const chat = createPatientChat();

    act(() => {
      result.current.lock();
    });

    expect(result.current.status).toBe('locked');
    expect(holdsChat(chat.id)).toBe(false);
  });

  it('drops the chats on a sign-in that no session end preceded', async () => {
    // `finalize` clears on its own: a sign-in over a live tab (or the unlock
    // fallback that comes back with a fresh session) never passes through
    // `endSession`, and must still start from no chats.
    const { result } = await signedOut();
    await settle(() => result.current.login(SEEDED_DOCTOR, PASSWORD));
    const chat = createPatientChat();
    expect(holdsChat(chat.id)).toBe(true);

    await settle(() => result.current.login('admin@medora.health', PASSWORD));

    expect(result.current.user?.role).toBe('admin');
    expect(holdsChat(chat.id)).toBe(false);
  });

  it('drops the chats when the server refuses a refresh', async () => {
    let handler: (() => Promise<string | null>) | null = null;
    const register = apiClient.setUnauthorizedHandler.bind(apiClient);
    vi.spyOn(apiClient, 'setUnauthorizedHandler').mockImplementation((next) => {
      if (next) handler = next;
      register(next);
    });
    const { result } = await signedOut();
    await settle(() => result.current.login(SEEDED_DOCTOR, PASSWORD));
    const chat = createPatientChat();
    if (handler === null) throw new Error('no unauthorized handler registered');
    const refresh = handler as () => Promise<string | null>;

    vi.spyOn(authService, 'restore').mockResolvedValue(null);
    await settle(() => refresh());

    expect(result.current.status).toBe('unauthenticated');
    expect(holdsChat(chat.id)).toBe(false);
  });

  it('removes the legacy global keys on first load', async () => {
    window.localStorage.setItem(
      'medora.ai.conversations.v1',
      JSON.stringify([{ id: 'c1', title: `Current patient · ${PATIENT_NAME}`, messages: [] }]),
    );
    window.localStorage.setItem('medora.ai.settings.v1', JSON.stringify(DEFAULT_AI_SETTINGS));

    await signedOut();

    for (const key of LEGACY_AI_STORAGE_KEYS) {
      expect(window.localStorage.getItem(key)).toBeNull();
    }
    expect(storageText()).not.toContain(PATIENT_NAME);
  });
});
