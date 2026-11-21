import { describe, expect, it } from 'vitest';

import { resolveEnableMocks } from './env';

/**
 * The production mock guard.
 *
 * `env` itself is parsed once at import time against a frozen
 * `import.meta.env`, so the cases below drive `resolveEnableMocks` directly
 * — the same reason `api/seam.ts` exposes `selectImplementation` next to
 * `selectService`. The rule under test is a security boundary, not a
 * preference: the mock auth service accepts seeded credentials and never
 * reaches the API, so a production build reaching it means anyone can sign
 * in as `doctor@medora.health`.
 */
describe('resolveEnableMocks — production', () => {
  it('disables mocks when VITE_ENABLE_MOCKS is unset', () => {
    // The original defect. `.default('true')` made a missing variable and a
    // deliberate opt-in indistinguishable, so a deploy that simply forgot to
    // set the flag served mock auth and looked healthy doing it.
    expect(resolveEnableMocks('production', undefined)).toBe(false);
  });

  it('disables mocks when VITE_ENABLE_MOCKS=false', () => {
    expect(resolveEnableMocks('production', 'false')).toBe(false);
  });

  it('rejects the configuration outright when VITE_ENABLE_MOCKS=true', () => {
    // Not "ignore the flag and carry on": that leaves the deployment
    // asserting one thing and doing another. The build must fail to boot.
    expect(() => resolveEnableMocks('production', 'true')).toThrow(
      /VITE_ENABLE_MOCKS=true is not allowed with VITE_APP_ENV=production/,
    );
  });

  it('never returns true for production, whatever the input', () => {
    for (const raw of ['true', 'false', undefined] as const) {
      let enabled: boolean;
      try {
        enabled = resolveEnableMocks('production', raw);
      } catch {
        continue; // Throwing is the other acceptable outcome.
      }
      expect(enabled).toBe(false);
    }
  });
});

describe('resolveEnableMocks — development and staging', () => {
  it('enables mocks in development when explicitly opted in', () => {
    expect(resolveEnableMocks('development', 'true')).toBe(true);
  });

  it('enables mocks in staging when explicitly opted in', () => {
    // Staging is not production, so the guard does not fire — but the
    // opt-in is still explicit, never inherited from an unset variable.
    expect(resolveEnableMocks('staging', 'true')).toBe(true);
  });

  it('leaves mocks off when the variable is unset, rather than defaulting on', () => {
    expect(resolveEnableMocks('development', undefined)).toBe(false);
    expect(resolveEnableMocks('staging', undefined)).toBe(false);
  });

  it('leaves mocks off when explicitly disabled', () => {
    expect(resolveEnableMocks('development', 'false')).toBe(false);
  });
});
