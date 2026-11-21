import type { ReactNode } from 'react';

import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from '@/app/providers/AuthProvider';
import { QueryProvider } from '@/app/providers/QueryProvider';
import { sessionPolicy } from '@/configs/session';
import { authService } from '@/features/auth/service';
import { LocaleProvider } from '@/i18n';
import { AuthError, type SessionUser } from '@/types/auth';

import { DemoAccessPanel } from './DemoAccessPanel';

/**
 * The development demo sign-in, through the provider that owns sessions.
 *
 * The contract: the "Continue as Demo Doctor" button is a **real sign-in**
 * with the seeded demo account — it goes through `login` and the active
 * auth backend, exactly as the form does — and nothing in the app can mint
 * a session without a backend any more. It used to: a client-only fixture
 * session with an empty bearer token, which against the live API made
 * every request a 401.
 *
 * The suite runs on the mock backend (`vitest.config.ts`), whose doctor is
 * the same address and password the backend seed provisions; that the
 * live API accepts them is `backend/test/demo-accounts.e2e-spec.ts`.
 *
 * Production safety is deliberately NOT asserted here and cannot be:
 * `import.meta.env.DEV` is `true` under vitest. The production guarantee
 * is a property of the emitted bundle — `scripts/demo-access-boundary.ts`.
 *
 * Fake timers throughout, matching `AuthProvider.test.tsx`: the mock
 * service adds deliberate latency and the idle lock is a timeout.
 */

const LEGACY_DEMO_SESSION_KEY = 'medora.dev-demo-session';

/** The documented local demo doctor (`backend/docs/LOCAL_DEMO_ACCOUNTS.md`). */
const DEMO_DOCTOR_ACCOUNT = { email: 'doctor@medora.health', password: 'Medora123!' } as const;

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <LocaleProvider>
          <MemoryRouter>{children}</MemoryRouter>
        </LocaleProvider>
      </AuthProvider>
    </QueryProvider>
  );
}

/** The panel plus a probe of the provider state beside it. */
function renderPanel(onSignedIn: (user: SessionUser) => void = () => undefined) {
  let auth!: ReturnType<typeof useAuth>;
  function Probe() {
    auth = useAuth();
    return null;
  }
  render(
    <Providers>
      <Probe />
      <DemoAccessPanel onSignedIn={onSignedIn} />
    </Providers>,
  );
  return { current: () => auth };
}

async function drain(ms = 2_000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function clickDemo() {
  fireEvent.click(screen.getByRole('button', { name: /Continue as Demo Doctor/ }));
  await drain();
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('Continue as Demo Doctor', () => {
  it('signs in through the active auth service, with the documented demo credentials', async () => {
    const login = vi.spyOn(authService, 'login');
    const onSignedIn = vi.fn();
    const auth = renderPanel(onSignedIn);
    await drain(50);

    await clickDemo();

    expect(login).toHaveBeenCalledTimes(1);
    expect(login.mock.calls[0]?.[0]).toMatchObject({
      email: DEMO_DOCTOR_ACCOUNT.email,
      password: DEMO_DOCTOR_ACCOUNT.password,
    });
    expect(auth.current().status).toBe('authenticated');
    expect(auth.current().user?.email).toBe(DEMO_DOCTOR_ACCOUNT.email);
    expect(auth.current().user?.role).toBe('doctor');
    expect(onSignedIn).toHaveBeenCalledWith(expect.objectContaining({ role: 'doctor' }));
  });

  it('writes no client-only session flag', async () => {
    renderPanel();
    await drain(50);

    await clickDemo();

    expect(window.localStorage.getItem(LEGACY_DEMO_SESSION_KEY)).toBeNull();
  });

  it('says the account is not provisioned when the backend refuses the credentials', async () => {
    vi.spyOn(authService, 'login').mockRejectedValue(new AuthError('invalid_credentials'));
    const onSignedIn = vi.fn();
    const auth = renderPanel(onSignedIn);
    await drain(50);

    await clickDemo();

    expect(screen.getByRole('alert')).toHaveTextContent(/not provisioned on this API/);
    expect(auth.current().status).toBe('unauthenticated');
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('names the backend it signs in through, so mock mode is never presented as the API', async () => {
    renderPanel();
    await drain(50);

    expect(screen.getByText(/through the mock backend \(no API\)/)).toBeInTheDocument();
  });
});

describe('no session without a backend', () => {
  it('ignores a client-only demo flag left in storage by the retired button', async () => {
    window.localStorage.setItem(
      LEGACY_DEMO_SESSION_KEY,
      JSON.stringify({ exp: Date.now() + 60_000 }),
    );

    const view = renderHook(() => useAuth(), { wrapper: Providers });
    await drain(50);

    expect(view.result.current.status).toBe('unauthenticated');
    expect(view.result.current.user).toBeNull();
  });

  it('no longer offers a provider-level demo sign-in', async () => {
    const view = renderHook(() => useAuth(), { wrapper: Providers });
    await drain(50);

    expect('signInAsDemo' in view.result.current).toBe(false);
  });

  it('locks a demo sign-in like any other, and unlocks only with its real password', async () => {
    const auth = renderPanel();
    await drain(50);
    await clickDemo();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(sessionPolicy.idleLockMs + 1_000);
    });
    expect(auth.current().status).toBe('locked');

    let refused: unknown;
    await act(async () => {
      const op = auth.current().unlock('anything');
      op.catch((error: unknown) => {
        refused = error;
      });
      await vi.advanceTimersByTimeAsync(2_000);
      await op.catch(() => undefined);
    });
    expect(refused).toMatchObject({ code: 'invalid_credentials' });
    expect(auth.current().status).toBe('locked');

    await act(async () => {
      const op = auth.current().unlock(DEMO_DOCTOR_ACCOUNT.password);
      await vi.advanceTimersByTimeAsync(2_000);
      await op;
    });
    expect(auth.current().status).toBe('authenticated');
  });
});

describe('the real authentication path', () => {
  it('is unchanged: a wrong password for the demo account is still rejected', async () => {
    const view = renderHook(() => useAuth(), { wrapper: Providers });
    await drain(50);

    let refused: unknown;
    await act(async () => {
      const op = view.result.current.login(DEMO_DOCTOR_ACCOUNT.email, 'wrong-password');
      op.catch((error: unknown) => {
        refused = error;
      });
      await vi.advanceTimersByTimeAsync(2_000);
      await op.catch(() => undefined);
    });

    expect(refused).toMatchObject({ code: 'invalid_credentials' });
    expect(view.result.current.status).toBe('unauthenticated');
  });
});
