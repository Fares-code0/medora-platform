import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CORRELATION_ID_HEADER } from '../src/common/logging/correlation';
import { type AuthHarness, createAuthHarness, errorBody } from './support/auth-app';

/**
 * Request body limits (AST-G2, RM M37.1 "JSON limits", MG §11.7).
 *
 * > AST-G2 — "An oversized body is refused with a stable code before any
 * > handler runs."
 *
 * Before this, the limit was body-parser's implicit 100 kB default and an
 * oversized body answered **500 `internal_error`**: the parser's
 * `PayloadTooLargeError` reached the global filter as an unknown
 * throwable, so a client mistake was logged as an unhandled server
 * exception. The harness registers the parsers through the same
 * `applyBodyLimits` that `main.ts` calls, so these assertions are about
 * the configuration that ships.
 */
let harness: AuthHarness;

const LOGIN = '/api/v1/auth/login';
/** A guarded route: the refusal must come before authentication. */
const BOOK = '/api/v1/appointments';

/** A JSON body of roughly `bytes` bytes. */
function jsonOfSize(bytes: number): string {
  return JSON.stringify({ email: 'limit@m6.test', password: 'x'.repeat(bytes) });
}

beforeAll(async () => {
  harness = await createAuthHarness('request-limits');
});

afterAll(async () => {
  await harness.close();
});

describe('an oversized body is refused before any handler runs', () => {
  it('answers 413 payload_too_large in the error envelope', async () => {
    const response = await request(harness.server)
      .post(LOGIN)
      .set('Content-Type', 'application/json')
      .send(jsonOfSize(200 * 1024));

    expect(response.status).toBe(413);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(errorBody(response)).toEqual({
      message: 'request entity too large',
      code: 'payload_too_large',
    });
    // Still a traceable request, like every other error response.
    expect(response.headers[CORRELATION_ID_HEADER]).toBeDefined();
  });

  it('refuses it on a guarded route before authentication, not with a 401', async () => {
    const response = await request(harness.server)
      .post(BOOK)
      .set('Content-Type', 'application/json')
      .send(jsonOfSize(200 * 1024));

    expect(response.status).toBe(413);
    expect(errorBody(response).code).toBe('payload_too_large');
  });

  it('applies the same limit to URL-encoded bodies', async () => {
    const response = await request(harness.server)
      .post(LOGIN)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`email=limit%40m6.test&password=${'x'.repeat(200 * 1024)}`);

    expect(response.status).toBe(413);
    expect(errorBody(response).code).toBe('payload_too_large');
  });

  it('answers an undecodable charset 415 unsupported_media_type', async () => {
    const response = await request(harness.server)
      .post(LOGIN)
      .set('Content-Type', 'application/json; charset=latin1')
      .send('{}');

    expect(response.status).toBe(415);
    expect(errorBody(response).code).toBe('unsupported_media_type');
  });
});

describe('what the limit does not change', () => {
  it('lets a body under the limit through to validation', async () => {
    // ~90 kB: under the 100 kB that has always applied. It reaches the
    // route, whose own validation decides — anything but a 413.
    const response = await request(harness.server)
      .post(LOGIN)
      .set('Content-Type', 'application/json')
      .send(jsonOfSize(90 * 1024));

    expect(response.status).not.toBe(413);
    expect(response.status).toBeLessThan(500);
  });

  it('still answers malformed JSON 400 validation_failed', async () => {
    const response = await request(harness.server)
      .post(LOGIN)
      .set('Content-Type', 'application/json')
      .send('{"email":');

    expect(response.status).toBe(400);
    expect(errorBody(response).code).toBe('validation_failed');
  });
});
