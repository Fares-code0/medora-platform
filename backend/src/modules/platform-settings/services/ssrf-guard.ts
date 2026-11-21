/**
 * The outbound-request guard for §19.5's `test-connection` (RM M24.4).
 *
 * > ✅ Verify: test-connection is SSRF-guarded — private/link-local/
 * > metadata addresses rejected (M37.2 re-tests this).
 *
 * ## The threat this closes
 *
 * `test-connection` is an administrator-supplied URL that the **server**
 * fetches. Without a guard it is a request forgery primitive pointed at
 * everything the API can reach and the internet cannot: the database on
 * `127.0.0.1`, other services on the private network, and — the reason
 * `169.254.169.254` is named explicitly below — the cloud instance
 * metadata endpoint, which on an unhardened instance hands out the
 * machine's credentials to anything that asks.
 *
 * ## Why the check is on the resolved address, not the hostname
 *
 * A blocklist of hostnames is defeated by DNS: `internal.example.com`
 * resolving to `10.0.0.5` is the same request as typing `10.0.0.5`. So
 * the caller resolves the host first and passes every address here. A
 * literal IP in the URL skips the resolver and is checked directly.
 *
 * ## What it deliberately does not claim
 *
 * This is not a complete SSRF defence and the codebase should not
 * pretend otherwise. On its own it removes the whole class of *direct*
 * internal reachability, which is what M24.4's verify step asks for.
 * DNS rebinding — an address that passes this check and then resolves
 * differently for the socket — is closed by the probe running
 * `isBlockedAddress` again inside the socket's own lookup (M37.2,
 * `integration-probe.ts`), so the address checked is the address dialled.
 * What remains outside both is anything reachable at a public address
 * that should not be — that is a network-egress policy, not this code's.
 */

import { isIP } from 'node:net';

import { AppException } from '../../../common/errors/app.exception';

/** The metadata service every major cloud exposes at a fixed address. */
const IPV4_METADATA = '169.254.169.254';

/**
 * Blocked IPv4 ranges, as `[firstOctetMatch, predicate]` pairs.
 *
 * Written as arithmetic on the octets rather than as CIDR strings so
 * there is no parser to get wrong, and so each range can carry the
 * reason it is here.
 */
function isBlockedIpv4(octets: readonly number[]): boolean {
  const [a = 0, b = 0, c = 0, d = 0] = octets;

  // 0.0.0.0/8 — "this network"; 0.0.0.0 also means "every local
  // interface" to a connect() on most stacks.
  if (a === 0) return true;
  // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 — RFC 1918 private.
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8 — loopback. The database, Redis and the API itself.
  if (a === 127) return true;
  // 100.64.0.0/10 — carrier-grade NAT, routable inside a provider.
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 169.254.0.0/16 — link-local, and the cloud metadata service inside
  // it. This is the single most valuable target of an SSRF.
  if (a === 169 && b === 254) return true;
  // 192.0.0.0/24 — IETF protocol assignments.
  if (a === 192 && b === 0 && c === 0) return true;
  // 198.18.0.0/15 — benchmarking, routed on some internal networks.
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved, which includes
  // 255.255.255.255 broadcast.
  if (a >= 224) return true;

  return d === 255 && a === 0;
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;

  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : -1));

  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

/**
 * IPv6, including the two embeddings that smuggle an IPv4 address
 * through a v6 literal: `::ffff:10.0.0.1` (v4-mapped) and the same value
 * written in hex. Both reach the same host, so both are decoded and
 * checked as IPv4 rather than being waved through as "not v4".
 */
function isBlockedIpv6(address: string): boolean {
  const lower = address.toLowerCase().replace(/^\[|]$/g, '').split('%')[0] ?? '';

  // Unspecified and loopback.
  if (lower === '::' || lower === '::1') return true;
  // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast.
  if (/^f[cd]/.test(lower)) return true;
  if (/^fe[89ab]/.test(lower)) return true;
  if (/^ff/.test(lower)) return true;
  // 2001:db8::/32 — documentation, but a resolver may still answer it.
  if (lower.startsWith('2001:db8')) return true;

  const embedded = embeddedIpv4(lower);
  if (embedded !== null) return isBlockedIpv4(embedded);

  return false;
}

/** The IPv4 inside `::ffff:a.b.c.d`, `::ffff:0a00:0001` or `64:ff9b::…`. */
function embeddedIpv4(lower: string): number[] | null {
  const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (dotted?.[1] !== undefined && /(^::ffff:|^64:ff9b::)/.test(lower)) {
    return parseIpv4(dotted[1]);
  }

  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex?.[1] === undefined || hex[2] === undefined) return null;

  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);

  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

/** Is this literal address one the server must not be pointed at? */
export function isBlockedAddress(address: string): boolean {
  if (address === IPV4_METADATA) return true;

  const version = isIP(address);
  if (version === 4) {
    const octets = parseIpv4(address);
    return octets === null ? true : isBlockedIpv4(octets);
  }
  if (version === 6) return isBlockedIpv6(address);

  // Not an address at all. The caller resolves hostnames before asking,
  // so reaching here means something unparseable got through — refused,
  // because "I could not tell" is not "it is safe".
  return true;
}

export interface ProbeTarget {
  readonly url: URL;
  /** A literal address when the URL carried one; `null` means resolve it. */
  readonly literalAddress: string | null;
}

/**
 * Validates the *shape* of a probe URL and reports whether the host still
 * needs resolving. Throws a 422 naming the field, never a 500.
 */
export function parseProbeTarget(raw: string, field: string): ProbeTarget {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw AppException.validation({ [field]: ['Expected an absolute http(s) URL'] });
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    // `file:`, `gopher:` and friends are the other half of the SSRF
    // toolkit — a `file:///etc/passwd` probe reads the container's disk.
    throw AppException.validation({ [field]: ['Only http and https URLs can be probed'] });
  }

  if (url.username !== '' || url.password !== '') {
    // Credentials in a probe URL would be sent to whatever the host
    // resolves to, and would land in any log that records the target.
    throw AppException.validation({ [field]: ['A probe URL must not carry credentials'] });
  }

  const host = url.hostname.replace(/^\[|]$/g, '');

  if (isIP(host) !== 0) {
    if (isBlockedAddress(host)) throw blocked(field);
    return { url, literalAddress: host };
  }

  // `localhost` and anything under it are refused without asking a
  // resolver: a resolver that answered otherwise would be the attack.
  if (host === 'localhost' || host.endsWith('.localhost')) throw blocked(field);

  return { url, literalAddress: null };
}

/** The refusal, worded so an administrator knows it is not a typo. */
export function blocked(field: string): AppException {
  return AppException.validation({
    [field]: [
      'That address is inside the platform network. Integrations are probed over the public internet only.',
    ],
  });
}
