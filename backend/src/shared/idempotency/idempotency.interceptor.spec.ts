import { describe, expect, it } from 'vitest';

import { fingerprintOf } from './idempotency.interceptor';

describe('fingerprintOf', () => {
  it('is a SHA-256 hex digest', () => {
    expect(fingerprintOf({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores key order at every depth', () => {
    expect(fingerprintOf({ a: 1, b: { c: 2, d: [1, { e: 3, f: 4 }] } })).toBe(
      fingerprintOf({ b: { d: [1, { f: 4, e: 3 }], c: 2 }, a: 1 }),
    );
  });

  it('keeps array order — a reordered list is a different request', () => {
    expect(fingerprintOf({ ids: [1, 2] })).not.toBe(fingerprintOf({ ids: [2, 1] }));
  });

  it('distinguishes values and types', () => {
    expect(fingerprintOf({ quantity: 21 })).not.toBe(fingerprintOf({ quantity: 42 }));
    expect(fingerprintOf({ quantity: 21 })).not.toBe(fingerprintOf({ quantity: '21' }));
  });

  it('treats an absent body, an empty-valued key and null alike only where JSON does', () => {
    expect(fingerprintOf(undefined)).toBe(fingerprintOf(null));
    expect(fingerprintOf({ a: undefined })).toBe(fingerprintOf({}));
    expect(fingerprintOf({ a: null })).not.toBe(fingerprintOf({}));
  });
});
