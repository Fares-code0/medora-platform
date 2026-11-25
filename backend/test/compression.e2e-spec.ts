import { get, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  registrationBody,
  testEmail,
  makeClinicalDoctor,
} from './support/auth-app';

/**
 * Response compression over HTTP (RM M32.3 — "compression + ETags
 * verified"). Bodies are read as raw bytes and decoded here, so the test
 * sees what is on the wire rather than what the client library decoded.
 */
let harness: AuthHarness;
let token = '';

const ENUMS = '/api/v1/meta/enums'; // authenticated, and comfortably over 1 KB

interface RawResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

/**
 * A GET through `node:http`, which — unlike supertest — never decodes a
 * body, so the bytes asserted on are the bytes that were sent.
 */
function raw(
  path: string,
  encoding: string,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  const { port } = harness.server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = get(
      {
        host: '127.0.0.1',
        port,
        path,
        headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': encoding, ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
  });
}

async function expectStatus(pending: Promise<RawResponse>, status: number): Promise<RawResponse> {
  const response = await pending;
  expect(response.status).toBe(status);
  return response;
}

beforeAll(async () => {
  harness = await createAuthHarness('compression-m323');
  const email = testEmail('gzip');
  await request(harness.server).post('/api/v1/auth/register').send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  // Clinical standing (F-09): outside it, this route is refused.
  await makeClinicalDoctor(harness.prisma, email);
  token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Medora123!', rememberMe: false }),
  ).accessToken;
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.reset();
  await harness.close();
});

describe('negotiation', () => {
  it('serves the identity body to a client that offers no encoding', async () => {
    const response = await expectStatus(raw(ENUMS, 'identity'), 200);

    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.headers['vary']).toMatch(/Accept-Encoding/i);
    expect(JSON.parse(response.body.toString('utf8'))).toHaveProperty('data');
  });

  it('gzips for a gzip client, and the decoded body is the identity body', async () => {
    const plain = (await expectStatus(raw(ENUMS, 'identity'), 200)).body;
    const response = await expectStatus(raw(ENUMS, 'gzip'), 200);

    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.headers['vary']).toMatch(/Accept-Encoding/i);
    const decoded = gunzipSync(response.body);
    expect(decoded.equals(plain)).toBe(true);
    expect(response.body.length).toBeLessThan(plain.length);
  });

  it('prefers brotli when the client offers both', async () => {
    const plain = (await expectStatus(raw(ENUMS, 'identity'), 200)).body;
    const response = await expectStatus(raw(ENUMS, 'gzip, deflate, br'), 200);

    expect(response.headers['content-encoding']).toBe('br');
    expect(brotliDecompressSync(response.body).equals(plain)).toBe(true);
  });

  it('leaves a body under the threshold alone (the badge poll)', async () => {
    const response = await expectStatus(raw('/api/v1/notifications/badge-counts', 'gzip, br'), 200);

    expect(response.headers['content-encoding']).toBeUndefined();
  });

  it('does not compress an auth response, which carries tokens', async () => {
    const response = await request(harness.server)
      .post('/api/v1/auth/login')
      .set('Accept-Encoding', 'gzip, br')
      .send({ email: testEmail('gzip'), password: 'Medora123!', rememberMe: false })
      .expect(200);

    expect(response.headers['content-encoding']).toBeUndefined();
  });
});

describe('ETags under compression', () => {
  it('answers 304 to a matching If-None-Match, whichever encoding asked', async () => {
    const first = await expectStatus(raw(ENUMS, 'gzip'), 200);
    const etag = first.headers['etag'] as string;
    expect(etag).toBeTruthy();

    await expectStatus(raw(ENUMS, 'gzip', { 'If-None-Match': etag }), 304);
    await expectStatus(raw(ENUMS, 'identity', { 'If-None-Match': etag }), 304);
  });
});
