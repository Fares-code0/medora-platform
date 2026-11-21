/**
 * The outbound probe behind `test-connection` (API §19.5, RM M24.4).
 *
 * A port, for the reason the storage and mail kernels are ports: the
 * thing behind it talks to the network, and a test that needed the
 * network would be a test of the network. The default implementation
 * below is a plain `HEAD` with a hard timeout; a spec substitutes a fake
 * and asserts what the service does with each answer.
 *
 * The SSRF guard runs twice, and neither run is behind the token:
 *
 *  1. `IntegrationService` validates the URL and checks every address
 *     the host resolves to **before** probing, so a plainly internal
 *     target is a 422 naming the field. A substituted probe cannot skip
 *     this, which is why it is not in here.
 *  2. The real probe checks again **at connect time**, inside the DNS
 *     lookup the socket itself uses (M37.2). Check 1 alone leaves a
 *     window: the resolver is asked a second time when the connection is
 *     made, and a host whose answer changes between the two — DNS
 *     rebinding, a TTL of zero — passes the check as a public address and
 *     is then dialled as `127.0.0.1` or `169.254.169.254`. Checking in the
 *     socket's own lookup closes it, because the address checked is the
 *     address connected to; there is no second resolution to race.
 */

import { lookup as systemLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { LookupFunction } from 'node:net';

import { isBlockedAddress } from './ssrf-guard';

export interface ProbeResult {
  readonly reachable: boolean;
  /** HTTP status when one came back; `null` when nothing did. */
  readonly status: number | null;
  readonly durationMs: number;
  /** A short reason on failure. Never the response body. */
  readonly detail: string | null;
}

export interface IntegrationProbe {
  probe(url: URL): Promise<ProbeResult>;
}

export const INTEGRATION_PROBE = Symbol('INTEGRATION_PROBE');

/** Beyond this a provider is unreachable as far as an operator cares. */
export const PROBE_TIMEOUT_MS = 5_000;

/** Every address a hostname resolves to. */
export type Resolver = (hostname: string) => Promise<readonly LookupAddress[]>;

const resolveWithSystem: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    systemLookup(hostname, { all: true }, (error, addresses) => {
      if (error === null) resolve(addresses);
      else reject(error);
    });
  });

/** The connection was refused because its address is inside the platform network. */
export class BlockedAddressError extends Error {
  override readonly name = 'BlockedAddressError';

  constructor() {
    super('The resolved address is inside the platform network');
  }
}

/**
 * A `lookup` for `net.connect` that refuses to hand the socket any
 * address the guard blocks.
 *
 * **Every** answer is checked, not only the one the socket will use: a
 * resolver returning one public and one private address is the same
 * trick as rebinding, spread across a single answer, and Node's
 * happy-eyeballs connect (`autoSelectFamily`) may try any of them.
 */
export function guardedLookup(
  resolve: Resolver,
  isBlocked: (address: string) => boolean,
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          callback(
            Object.assign(new Error(`No address for ${hostname}`), { code: 'ENOTFOUND' }),
            '',
          );
          return;
        }
        if (addresses.some((entry) => isBlocked(entry.address))) {
          callback(new BlockedAddressError(), '');
          return;
        }

        const [first] = addresses as [LookupAddress, ...LookupAddress[]];
        if (options.all === true) callback(null, [...addresses]);
        else callback(null, first.address, first.family);
      },
      (error: unknown) => {
        callback(error instanceof Error ? error : new Error('Lookup failed'), '');
      },
    );
  };
}

export interface HttpIntegrationProbeOptions {
  /** The resolver behind the connect-time check. The system's by default. */
  readonly resolve?: Resolver;
  /** The connect-time predicate. The SSRF guard's by default. */
  readonly isBlocked?: (address: string) => boolean;
  readonly timeoutMs?: number;
}

/**
 * The real probe.
 *
 * `HEAD`, not `GET`: the question is whether the endpoint answers, and a
 * `GET` would pull a response body this service has no use for and must
 * not log. Redirects are **not** followed — `node:http` never follows
 * one — because a followed redirect is a second request to an address
 * the guard never saw; the redirect status is reported as the answer.
 *
 * `agent: false` gives every probe its own connection, so no pooled
 * socket from an earlier probe is reused for a later one: each request
 * goes through the guarded lookup.
 */
export class HttpIntegrationProbe implements IntegrationProbe {
  private readonly lookup: LookupFunction;
  private readonly timeoutMs: number;

  constructor(options: HttpIntegrationProbeOptions = {}) {
    this.lookup = guardedLookup(
      options.resolve ?? resolveWithSystem,
      options.isBlocked ?? isBlockedAddress,
    );
    this.timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  }

  async probe(url: URL): Promise<ProbeResult> {
    const started = Date.now();

    try {
      const status = await this.head(url);
      return {
        // "Reachable" is about the socket, not the status: a 404 from
        // the provider still proves the platform can reach it, which is
        // what an administrator is testing.
        reachable: true,
        status,
        durationMs: Date.now() - started,
        detail: null,
      };
    } catch (error) {
      return {
        reachable: false,
        status: null,
        durationMs: Date.now() - started,
        // The error's name only — never the response, and never the
        // URL, which may carry a token in its query string.
        detail: error instanceof Error ? error.name : 'unknown_error',
      };
    }
  }

  private head(url: URL): Promise<number> {
    return new Promise((resolve, reject) => {
      const options: RequestOptions = {
        method: 'HEAD',
        agent: false,
        lookup: this.lookup,
        signal: AbortSignal.timeout(this.timeoutMs),
      };
      const onResponse = (response: IncomingMessage): void => {
        // A HEAD has no body, but a misbehaving server may send one; it
        // is drained and discarded rather than read.
        response.resume();
        resolve(response.statusCode ?? 0);
      };

      const request: ClientRequest =
        url.protocol === 'https:'
          ? httpsRequest(url, options, onResponse)
          : httpRequest(url, options, onResponse);

      request.on('error', reject);
      request.end();
    });
  }
}
