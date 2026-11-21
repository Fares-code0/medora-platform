import { isIP } from 'node:net';

/**
 * `TRUST_PROXY` — which hops' `X-Forwarded-For` the API believes (M37.2).
 *
 * `req.ip` feeds the audit rows' `ip_address`, `login_events`, and the
 * per-client rate limit. Express derives it from `X-Forwarded-For` only
 * for the hops its `trust proxy` setting names; otherwise it is the TCP
 * peer. A header is a claim the client can write, so which hops to
 * believe is a property of the **deployment's network**, not of the code,
 * and it defaults to believing none.
 *
 * Accepted values:
 *
 * - empty / `false` — trust nothing (default). `req.ip` is the socket
 *   address. Correct with no proxy in front; behind one, every client
 *   shares the proxy's address.
 * - a positive integer `N` — trust the nearest N hops (e.g. `1` for one
 *   load balancer that always overwrites the header). Correct only if
 *   every request reaches the API through exactly those N proxies.
 * - a comma-separated list of addresses, CIDR ranges, or Express's named
 *   ranges `loopback`, `linklocal`, `uniquelocal` — trust a hop only when
 *   it is one of these. The safest form when the proxies' addresses are
 *   known.
 *
 * `true` is **refused**: it trusts every hop, so any client can set its
 * own address with one header — a forged audit trail and a rate limit
 * bypassed by rotating a header value.
 */

export type TrustProxySetting = false | number | readonly string[];

const NAMED_RANGES = new Set(['loopback', 'linklocal', 'uniquelocal']);

/** The parsed setting, or a message naming what is wrong. */
export function parseTrustProxy(raw: string): TrustProxySetting | { readonly error: string } {
  const value = raw.trim();

  if (value === '' || value.toLowerCase() === 'false') return false;

  if (value.toLowerCase() === 'true') {
    return {
      error:
        'must not be `true`: that trusts any client-supplied X-Forwarded-For. Name the proxies (addresses or CIDRs) or a hop count',
    };
  }

  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return hops > 0 ? hops : false;
  }

  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of entries) {
    if (!isTrustEntry(entry)) {
      return {
        error: `\`${entry}\` is not an address, a CIDR range, or one of loopback, linklocal, uniquelocal`,
      };
    }
  }

  return entries;
}

function isTrustEntry(entry: string): boolean {
  if (NAMED_RANGES.has(entry)) return true;

  const [address = '', prefix, ...rest] = entry.split('/');
  if (rest.length > 0) return false;

  const version = isIP(address);
  if (version === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;

  return Number(prefix) <= (version === 4 ? 32 : 128);
}
