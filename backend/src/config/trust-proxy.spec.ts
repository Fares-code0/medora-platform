import { describe, expect, it } from 'vitest';

import { parseTrustProxy } from './trust-proxy';

/** The refusal message, or `undefined` when the value parsed. */
function errorOf(raw: string): string | undefined {
  const parsed = parseTrustProxy(raw);
  return typeof parsed === 'object' && 'error' in parsed ? parsed.error : undefined;
}

/** `TRUST_PROXY` (M37.2): trust nothing unless the deployment names its proxies. */
describe('parseTrustProxy', () => {
  it.each(['', '  ', 'false', 'FALSE', '0'])('trusts nothing for %j', (raw) => {
    expect(parseTrustProxy(raw)).toBe(false);
  });

  it('refuses `true`, which would let any client choose its own address', () => {
    expect(errorOf('true')).toContain('must not be `true`');
  });

  it('reads a hop count', () => {
    expect(parseTrustProxy('2')).toBe(2);
  });

  it('reads addresses, CIDR ranges and the named ranges', () => {
    expect(parseTrustProxy('10.0.0.0/8, 192.168.1.10 ,loopback,fd00::/8,::1')).toEqual([
      '10.0.0.0/8',
      '192.168.1.10',
      'loopback',
      'fd00::/8',
      '::1',
    ]);
  });

  it.each(['10.0.0.0/33', 'fd00::/129', 'proxy.internal', '10.0.0.0/8/1', '10.0.0/8', 'anything'])(
    'refuses %j',
    (raw) => {
      expect(errorOf(raw)).toBeDefined();
    },
  );
});
