import type { LookupAddress } from 'node:dns';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BlockedAddressError,
  guardedLookup,
  HttpIntegrationProbe,
  type Resolver,
} from './integration-probe';
import { isBlockedAddress } from './ssrf-guard';

/**
 * The connect-time half of the SSRF guard (M37.2).
 *
 * `IntegrationService` checks every address a host resolves to before it
 * probes. Before this, the probe then called `fetch`, which asked the
 * resolver **again** — so a host answering with a public address the
 * first time and `127.0.0.1` the second passed the check and was dialled
 * at loopback. These cases drive real requests at a real local server;
 * only the resolver is substituted, because rebinding is a property of
 * the resolver's answers and nothing else.
 */

const PUBLIC = '93.184.216.34';

const answers =
  (...addresses: string[]): Resolver =>
  () =>
    Promise.resolve(addresses.map((address): LookupAddress => ({ address, family: 4 })));

interface Recorded {
  readonly method: string | undefined;
  readonly host: string | undefined;
}

const servers: Server[] = [];

async function serve(
  handler: (
    request: IncomingMessage,
    reply: (status: number, headers?: Record<string, string>) => void,
  ) => void,
) {
  const received: Recorded[] = [];
  const server = createServer((request, response) => {
    received.push({ method: request.method, host: request.headers.host });
    handler(request, (status, headers = {}) => {
      response.writeHead(status, headers).end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { port, received };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe('guardedLookup', () => {
  function run(resolve: Resolver, all: boolean) {
    return new Promise<{ error: Error | null; address: unknown; family: unknown }>((done) => {
      guardedLookup(resolve, isBlockedAddress)(
        'provider.example',
        { all },
        (error, address, family) => {
          done({ error, address, family });
        },
      );
    });
  }

  it('hands the socket a public address', async () => {
    expect(await run(answers(PUBLIC), false)).toEqual({ error: null, address: PUBLIC, family: 4 });
  });

  it('answers the happy-eyeballs form with every address when asked for all', async () => {
    const result = await run(answers(PUBLIC, '93.184.216.35'), true);
    expect(result.error).toBeNull();
    expect(result.address).toEqual([
      { address: PUBLIC, family: 4 },
      { address: '93.184.216.35', family: 4 },
    ]);
  });

  it('refuses loopback, private and metadata answers', async () => {
    for (const address of ['127.0.0.1', '10.0.0.5', '169.254.169.254']) {
      expect((await run(answers(address), false)).error).toBeInstanceOf(BlockedAddressError);
    }
  });

  it('refuses an answer that mixes a public address with a private one', async () => {
    expect((await run(answers(PUBLIC, '127.0.0.1'), true)).error).toBeInstanceOf(
      BlockedAddressError,
    );
  });

  it('refuses an empty answer as not found', async () => {
    const { error } = await run(answers(), false);
    expect(error).toMatchObject({ code: 'ENOTFOUND' });
  });

  it('passes a resolver failure through rather than connecting', async () => {
    const failing: Resolver = () => Promise.reject(new Error('SERVFAIL'));
    expect((await run(failing, false)).error?.message).toBe('SERVFAIL');
  });
});

describe('HttpIntegrationProbe', () => {
  it('does not connect when the host resolves to loopback at connect time', async () => {
    const target = await serve((_request, reply) => reply(200));
    // What a rebinding host answers on the second resolution: the
    // address of something inside the platform — here, a live server.
    const probe = new HttpIntegrationProbe({ resolve: answers('127.0.0.1') });

    const result = await probe.probe(
      new URL(`http://provider.example:${String(target.port)}/health`),
    );

    expect(result).toMatchObject({ reachable: false, status: null, detail: 'BlockedAddressError' });
    expect(target.received).toEqual([]);
  });

  it('applies the same connect-time check to https', async () => {
    const probe = new HttpIntegrationProbe({ resolve: answers('169.254.169.254') });

    const result = await probe.probe(new URL('https://provider.example/latest/meta-data/'));

    expect(result).toMatchObject({ reachable: false, detail: 'BlockedAddressError' });
  });

  it('sends one HEAD, with the original Host, to the address it checked', async () => {
    const target = await serve((_request, reply) => reply(204));
    // The predicate is opened only so a local server can stand in for a
    // public one; the address the socket dials is still the resolver's.
    const probe = new HttpIntegrationProbe({
      resolve: answers('127.0.0.1'),
      isBlocked: () => false,
    });

    const result = await probe.probe(new URL(`http://provider.example:${String(target.port)}/`));

    expect(result).toMatchObject({ reachable: true, status: 204, detail: null });
    expect(target.received).toEqual([
      { method: 'HEAD', host: `provider.example:${String(target.port)}` },
    ]);
  });

  it('reports a redirect instead of following it', async () => {
    const elsewhere = await serve((_request, reply) => reply(200));
    const target = await serve((_request, reply) =>
      reply(302, { location: `http://127.0.0.1:${String(elsewhere.port)}/` }),
    );
    const probe = new HttpIntegrationProbe({
      resolve: answers('127.0.0.1'),
      isBlocked: () => false,
    });

    const result = await probe.probe(new URL(`http://provider.example:${String(target.port)}/`));

    expect(result).toMatchObject({ reachable: true, status: 302 });
    expect(elsewhere.received).toEqual([]);
  });

  it('gives up on a server that never answers', async () => {
    const target = await serve(() => {
      /* never replies */
    });
    const probe = new HttpIntegrationProbe({
      resolve: answers('127.0.0.1'),
      isBlocked: () => false,
      timeoutMs: 150,
    });

    const result = await probe.probe(new URL(`http://provider.example:${String(target.port)}/`));

    expect(result.reachable).toBe(false);
    expect(result.status).toBeNull();
    expect(result.detail).toBe('AbortError');
  });
});
