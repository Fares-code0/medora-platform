import { describe, expect, it } from 'vitest';

import { AppException } from '../../../common/errors/app.exception';

import { isBlockedAddress, parseProbeTarget } from './ssrf-guard';

/**
 * The SSRF guard behind `test-connection` (RM M24.4, API §19.5).
 *
 * > ✅ Verify: test-connection is SSRF-guarded — private/link-local/
 * > metadata addresses rejected (M37.2 re-tests this).
 *
 * A pure spec, deliberately. The guard is the part of `test-connection`
 * that must not depend on a network, a database or a booted
 * application: every one of those is a reason a security test gets
 * skipped, and a skipped SSRF test is how the metadata endpoint ends up
 * reachable.
 *
 * The cases below are written as the attacker writes them — the same
 * address spelled five ways — because a guard that only rejects the
 * obvious spelling rejects nothing.
 */
const FIELD = 'config.baseUrl';

function refusal(raw: string): AppException {
  try {
    parseProbeTarget(raw, FIELD);
  } catch (error) {
    if (error instanceof AppException) return error;
    throw error;
  }

  throw new Error(`Expected ${raw} to be refused`);
}

describe('addresses inside the platform network are blocked', () => {
  it.each([
    ['169.254.169.254', 'the cloud instance metadata service'],
    ['169.254.0.1', 'link-local'],
    ['127.0.0.1', 'loopback — the API itself'],
    ['127.1.2.3', 'the rest of 127/8, not just .0.1'],
    ['10.0.0.5', 'RFC 1918 class A'],
    ['172.16.0.1', 'RFC 1918 class B, low edge'],
    ['172.31.255.254', 'RFC 1918 class B, high edge'],
    ['192.168.1.1', 'RFC 1918 class C'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['0.0.0.0', 'every local interface'],
    ['192.0.0.1', 'IETF protocol assignments'],
    ['198.18.0.1', 'benchmarking'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['::1', 'IPv6 loopback'],
    ['::', 'IPv6 unspecified'],
    ['fd00::1', 'IPv6 unique-local'],
    ['fe80::1', 'IPv6 link-local'],
    ['ff02::1', 'IPv6 multicast'],
    ['::ffff:169.254.169.254', 'the metadata service, v4-mapped in dotted form'],
    ['::ffff:a9fe:a9fe', 'the metadata service, v4-mapped in hex'],
    ['::ffff:127.0.0.1', 'loopback, v4-mapped'],
    ['64:ff9b::10.0.0.1', 'RFC 1918 through NAT64'],
  ])('rejects %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([['93.184.216.34'], ['8.8.8.8'], ['172.32.0.1'], ['2606:4700::1111']])(
    'allows the public address %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );

  it('refuses anything it cannot parse as an address', () => {
    // "I could not tell" is not "it is safe". A guard that defaulted the
    // other way would pass every malformed value straight through.
    expect(isBlockedAddress('not-an-address')).toBe(true);
    expect(isBlockedAddress('10.0.0')).toBe(true);
    expect(isBlockedAddress('999.1.1.1')).toBe(true);
  });
});

describe('the probe URL is validated before anything is fetched', () => {
  it('rejects a literal private address with a 422 naming the field', () => {
    const error = refusal('http://10.0.0.5/health');

    expect(error.getStatus()).toBe(422);
    expect(error.fieldErrors?.[FIELD]?.[0]).toContain('inside the platform network');
  });

  it('rejects the metadata service written as a bracketed IPv6 literal', () => {
    expect(refusal('http://[::ffff:a9fe:a9fe]/latest/meta-data/').getStatus()).toBe(422);
  });

  it.each([['localhost'], ['api.localhost'], ['LOCALHOST']])(
    'rejects %s without consulting a resolver',
    (host) => {
      // A resolver that answered with a public address for `localhost`
      // would be the attack, so the name is refused on sight.
      expect(refusal(`http://${host}:5432/`).getStatus()).toBe(422);
    },
  );

  it('rejects a non-http scheme', () => {
    // `file:///etc/passwd` is the other half of the SSRF toolkit: it
    // reads the container's disk rather than reaching the network.
    expect(refusal('file:///etc/passwd').fieldErrors?.[FIELD]?.[0]).toContain('http and https');
    expect(refusal('gopher://10.0.0.5:6379/_FLUSHALL').getStatus()).toBe(422);
  });

  it('rejects credentials embedded in the URL', () => {
    // They would be sent to whatever the host resolves to, and would
    // land in any log that records the target.
    expect(refusal('https://user:secret@example.com/').fieldErrors?.[FIELD]?.[0]).toContain(
      'credentials',
    );
  });

  it('rejects a value that is not a URL at all', () => {
    expect(refusal('example.com/health').fieldErrors?.[FIELD]?.[0]).toContain('absolute');
  });

  it('accepts a public literal and reports it so no resolver is consulted', () => {
    const target = parseProbeTarget('https://93.184.216.34:8443/status', FIELD);

    expect(target.literalAddress).toBe('93.184.216.34');
    expect(target.url.port).toBe('8443');
  });

  it('accepts a hostname and defers it to the caller to resolve', () => {
    // `null` is the instruction: the service resolves the name and
    // checks **every** answer, which a hostname blocklist cannot do.
    expect(parseProbeTarget('https://provider.example.com/api', FIELD).literalAddress).toBeNull();
  });
});
