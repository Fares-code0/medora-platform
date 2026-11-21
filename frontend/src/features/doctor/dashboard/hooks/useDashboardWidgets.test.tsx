import type { ReactNode } from 'react';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AuthProvider, useAuth } from '@/app/providers/AuthProvider';
import { QueryProvider } from '@/app/providers/QueryProvider';
import type { SessionUser } from '@/types/auth';

import { useDashboardWidgets } from './useDashboardWidgets';

/**
 * `useDashboardWidgets` reads `user` from `useAuth()`, which throws outside an
 * `AuthProvider`; `AuthProvider` calls into the query client on logout, so it
 * needs `QueryProvider` above it — the nesting order of `AppProviders`.
 */
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>{children}</AuthProvider>
    </QueryProvider>
  );
}

const ANONYMOUS_KEY = 'medora.anonymous.dashboardWidgets';

const DOCTOR: SessionUser = {
  id: 'doctor-42',
  name: 'Dr Test',
  email: 'doctor@medora.health',
  role: 'doctor',
  permissions: [],
};

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('useDashboardWidgets', () => {
  it('starts empty — no widget is chosen for the doctor', () => {
    const { result } = renderHook(() => useDashboardWidgets(), { wrapper });

    expect(result.current.activeIds).toEqual([]);
  });

  it('adds in order, ignores a second add, and remembers across a remount', () => {
    const { result, unmount } = renderHook(() => useDashboardWidgets(), { wrapper });

    act(() => {
      result.current.add('notifications');
      result.current.add('todays-schedule');
      result.current.add('notifications');
    });
    expect(result.current.activeIds).toEqual(['notifications', 'todays-schedule']);
    expect(result.current.isActive('todays-schedule')).toBe(true);
    expect(result.current.isActive('practice-pulse')).toBe(false);
    unmount();

    const remounted = renderHook(() => useDashboardWidgets(), { wrapper });
    expect(remounted.result.current.activeIds).toEqual(['notifications', 'todays-schedule']);
  });

  it('removes one widget and leaves the rest in order', () => {
    const { result } = renderHook(() => useDashboardWidgets(), { wrapper });

    act(() => {
      result.current.add('notifications');
      result.current.add('practice-pulse');
      result.current.add('quick-actions');
    });
    act(() => {
      result.current.remove('practice-pulse');
    });

    expect(result.current.activeIds).toEqual(['notifications', 'quick-actions']);
    expect(JSON.parse(window.localStorage.getItem(ANONYMOUS_KEY) ?? 'null')).toEqual([
      'notifications',
      'quick-actions',
    ]);
  });

  it('restores a removed widget to its old position, clamped to the list', () => {
    const { result } = renderHook(() => useDashboardWidgets(), { wrapper });

    act(() => {
      result.current.add('notifications');
      result.current.add('practice-pulse');
      result.current.add('quick-actions');
      result.current.remove('practice-pulse');
    });
    act(() => {
      result.current.restore('practice-pulse', 1);
      result.current.restore('ai-assistant', 99);
    });

    expect(result.current.activeIds).toEqual([
      'notifications',
      'practice-pulse',
      'quick-actions',
      'ai-assistant',
    ]);
  });

  it('clears everything', () => {
    const { result } = renderHook(() => useDashboardWidgets(), { wrapper });

    act(() => {
      result.current.add('notifications');
      result.current.add('practice-pulse');
    });
    act(() => {
      result.current.clear();
    });

    expect(result.current.activeIds).toEqual([]);
  });

  it('falls back to empty when the stored value is corrupt or the wrong shape', () => {
    window.localStorage.setItem(ANONYMOUS_KEY, '{not json');
    expect(renderHook(() => useDashboardWidgets(), { wrapper }).result.current.activeIds).toEqual(
      [],
    );

    window.localStorage.setItem(ANONYMOUS_KEY, JSON.stringify({ analytics: true }));
    expect(renderHook(() => useDashboardWidgets(), { wrapper }).result.current.activeIds).toEqual(
      [],
    );
  });

  it('drops ids this build does not ship and collapses duplicates', () => {
    window.localStorage.setItem(
      ANONYMOUS_KEY,
      JSON.stringify(['retired-widget', 'notifications', 42, 'notifications', 'ai-assistant']),
    );

    const { result } = renderHook(() => useDashboardWidgets(), { wrapper });

    expect(result.current.activeIds).toEqual(['notifications', 'ai-assistant']);
  });

  it("namespaces a signed-in doctor's selection under their own key", async () => {
    // The shape AuthProvider's boot restore reads, as `persistSession`
    // writes it on a real login. Inlined because a doctor-feature test may
    // not import the auth feature's session store (import/no-restricted-paths).
    window.localStorage.setItem(
      'medora.session',
      JSON.stringify({
        token: 'test-token',
        user: DOCTOR,
        exp: Date.now() + 60_000,
        rememberMe: true,
      }),
    );

    const { result } = renderHook(
      () => ({ widgets: useDashboardWidgets(), user: useAuth().user }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.user?.id).toBe('doctor-42');
    });

    act(() => {
      result.current.widgets.add('todays-schedule');
    });

    expect(window.localStorage.getItem('medora.doctor-42.dashboardWidgets')).toBe(
      JSON.stringify(['todays-schedule']),
    );
    expect(window.localStorage.getItem(ANONYMOUS_KEY)).toBeNull();
  });
});
