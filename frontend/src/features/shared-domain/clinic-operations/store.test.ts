import { afterEach, describe, expect, it } from 'vitest';

import { isNotConnected } from '@/api/http';

import { unconnectedClinicOperationsApi } from './store';

/**
 * The live side of the clinic-operations store (RM M40.5) — the only side a
 * production build contains. Clinic state and the PHI access log are the
 * server's; until a hospital-scoped administration API exists, a live build
 * refuses every read and write instead of keeping them in this browser. So
 * localStorage is never consulted, written, or able to change an answer.
 */

const CLINIC_KEY = 'medora.admin.clinic.v1';

/** Every callable in the API, by dotted path — nested sections included. */
function operations(value: unknown, path = ''): [string, () => Promise<unknown>][] {
  if (typeof value === 'function') {
    return [[path, () => (value as (...args: unknown[]) => Promise<unknown>)({}, {}, {})]];
  }
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) =>
    operations(inner, path === '' ? key : `${path}.${key}`),
  );
}

afterEach(() => {
  window.localStorage.clear();
});

describe('unconnectedClinicOperationsApi', () => {
  const all = operations(unconnectedClinicOperationsApi);

  it('covers the whole API, the PHI access log included', () => {
    const names = all.map(([name]) => name);
    expect(names).toContain('phiAccess.record');
    expect(names).toContain('phiAccess.list');
    expect(names).toContain('staff.create');
    expect(names.length).toBeGreaterThan(40);
  });

  it.each(all)('%s refuses as not connected and writes nothing', async (_name, call) => {
    const failure = await call().then(
      () => null,
      (error: unknown) => error,
    );
    expect(isNotConnected(failure)).toBe(true);
    expect(window.localStorage.length).toBe(0);
  });

  it('ignores clinic state planted in localStorage — it is not a source of truth', async () => {
    window.localStorage.setItem(CLINIC_KEY, JSON.stringify({ phiAccess: [{ id: 'forged' }] }));
    const failure = await unconnectedClinicOperationsApi.phiAccess.list().then(
      () => null,
      (error: unknown) => error,
    );
    expect(isNotConnected(failure)).toBe(true);
    expect(window.localStorage.getItem(CLINIC_KEY)).toBe(
      JSON.stringify({ phiAccess: [{ id: 'forged' }] }),
    );
  });
});
