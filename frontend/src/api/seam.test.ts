import { describe, expect, it } from 'vitest';

import { selectImplementation } from './seam';

/**
 * The DP-04 seam's selection rule — FRONTEND_CHECKLIST §6.
 *
 * Only the pure half is testable here: `src/api` is a platform layer and
 * may not import a feature (§1.2), so the auth binding is asserted from
 * the feature side, in `features/auth/service.test.ts`.
 */

interface Probe {
  readonly id: string;
}

const MOCK: Probe = { id: 'mock' };
const HTTP: Probe = { id: 'http' };

describe('selectImplementation', () => {
  it('returns the mock adapter when mocks are enabled', () => {
    expect(selectImplementation(true, { mock: MOCK, http: HTTP })).toBe(MOCK);
  });

  it('returns the HTTP adapter when mocks are disabled', () => {
    expect(selectImplementation(false, { mock: MOCK, http: HTTP })).toBe(HTTP);
  });
});
