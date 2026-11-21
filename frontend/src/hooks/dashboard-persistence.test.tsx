import type { ReactNode } from 'react';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from '@/app/providers/AuthProvider';
import { QueryProvider } from '@/app/providers/QueryProvider';
import { clearUserPreferences, getPreference, setPreference } from '@/services/preferences';

import { useDashboardWidgetSelection } from './useDashboardWidgetSelection';

/**
 * A composed dashboard is the user's, and it was being thrown away: logout
 * wiped the user's whole preference namespace, widget selection included,
 * so every sign-in opened on the empty Overview. These pin that the
 * selection survives a full logout → login on the real auth provider, that
 * it stays with the account that made it, and that logout still wipes what
 * it is meant to.
 */

const PASSWORD = 'Medora123!';
const DOCTOR = 'doctor@medora.health';
const ADMIN = 'admin@medora.health';

type WidgetId = 'a' | 'b' | 'c';
const isWidgetId = (value: unknown): value is WidgetId =>
  value === 'a' || value === 'b' || value === 'c';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>{children}</AuthProvider>
    </QueryProvider>
  );
}

async function settle(op: () => Promise<unknown>) {
  await act(async () => {
    const operation = op();
    operation.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(2_000);
    await operation.catch(() => undefined);
  });
}

async function boot() {
  const view = renderHook(
    () => ({
      auth: useAuth(),
      widgets: useDashboardWidgetSelection('dashboardWidgets', isWidgetId),
    }),
    { wrapper },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  return view;
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

describe('dashboard widget persistence', () => {
  it('keeps the selection across logout and the next login', async () => {
    const { result } = await boot();
    await settle(() => result.current.auth.login(DOCTOR, PASSWORD));

    let saved = false;
    act(() => {
      saved = result.current.widgets.replace(['b', 'a']);
    });
    expect(saved).toBe(true);

    await settle(() => result.current.auth.logout());
    expect(result.current.auth.user).toBeNull();

    await settle(() => result.current.auth.login(DOCTOR, PASSWORD));
    expect(result.current.widgets.activeIds).toEqual(['b', 'a']);
  });

  it('keeps it across a reload — a fresh mount reads it back', async () => {
    const first = await boot();
    await settle(() => first.result.current.auth.login(DOCTOR, PASSWORD, { rememberMe: true }));
    act(() => {
      first.result.current.widgets.replace(['c']);
    });
    first.unmount();

    const second = await boot();
    expect(second.result.current.auth.user?.email).toBe(DOCTOR);
    expect(second.result.current.widgets.activeIds).toEqual(['c']);
  });

  it("never shows one account another account's selection", async () => {
    const { result } = await boot();
    await settle(() => result.current.auth.login(DOCTOR, PASSWORD));
    act(() => {
      result.current.widgets.replace(['a', 'b']);
    });
    await settle(() => result.current.auth.logout());

    await settle(() => result.current.auth.login(ADMIN, PASSWORD));
    expect(result.current.widgets.activeIds).toEqual([]);
    act(() => {
      result.current.widgets.replace(['c']);
    });
    await settle(() => result.current.auth.logout());

    await settle(() => result.current.auth.login(DOCTOR, PASSWORD));
    expect(result.current.widgets.activeIds).toEqual(['a', 'b']);
  });
});

describe('clearUserPreferences', () => {
  it('keeps the dashboard selections and wipes the rest of the namespace', () => {
    setPreference('dashboardWidgets', ['a'], 'u1');
    setPreference('adminDashboardWidgets', ['x'], 'u1');
    setPreference('sidebarCollapsed', true, 'u1');
    setPreference('dashboardWidgets', ['b'], 'u2');

    clearUserPreferences('u1');

    expect(getPreference('dashboardWidgets', 'u1')).toEqual(['a']);
    expect(getPreference('adminDashboardWidgets', 'u1')).toEqual(['x']);
    expect(getPreference('sidebarCollapsed', 'u1')).toBeNull();
    // Another user's namespace is untouched either way.
    expect(getPreference('dashboardWidgets', 'u2')).toEqual(['b']);
  });
});
