import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The auth seam's binding — FRONTEND_CHECKLIST §2 A-12 / §6 DP-04.
 *
 * `env` is parsed once at import time, so each case resets the module
 * registry and re-imports with `enableMocks` forced. This is the check
 * that the flag actually selects the adapter, rather than the seam
 * quietly resolving to whichever one was imported last.
 */

afterEach(() => {
  vi.doUnmock('@/configs/env');
  vi.resetModules();
});

/** Re-imports the seam with `env.enableMocks` forced to `value`. */
async function seamWithMocks(value: boolean) {
  vi.resetModules();
  vi.doMock('@/configs/env', () => ({
    env: {
      apiBaseUrl: 'https://api.test/api/v1',
      appEnv: 'development',
      enableMocks: value,
      isDev: true,
    },
  }));
  const [{ authService }, { mockAuthService }, { httpAuthService }] = await Promise.all([
    import('./service'),
    import('./mock/mock-auth-service'),
    import('@/api/endpoints/auth'),
  ]);
  return { authService, mockAuthService, httpAuthService };
}

describe('authService selection', () => {
  it('resolves to the mock service with VITE_ENABLE_MOCKS=true', async () => {
    const { authService, mockAuthService } = await seamWithMocks(true);
    expect(authService).toBe(mockAuthService);
  });

  it('resolves to the HTTP service with VITE_ENABLE_MOCKS=false', async () => {
    const { authService, httpAuthService } = await seamWithMocks(false);
    expect(authService).toBe(httpAuthService);
  });

  it('keeps both adapters implementing the same surface, so neither rots behind the flag', async () => {
    const { mockAuthService, httpAuthService } = await seamWithMocks(true);
    // A method added to one adapter and forgotten on the other is the
    // failure this seam exists to prevent, and typecheck alone would not
    // catch a *missing* key on an object literal typed as the interface.
    expect(Object.keys(httpAuthService).sort()).toEqual(Object.keys(mockAuthService).sort());
  });
});
