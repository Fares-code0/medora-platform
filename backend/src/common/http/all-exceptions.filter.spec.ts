import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * The 5xx log line (RM M1.5, MG §11.6).
 *
 * The envelope itself is covered end to end by `transport.e2e-spec.ts`.
 * What is pinned here is the thing that had no test and was silently
 * wrong: **what the log says about an unhandled exception**.
 *
 * Handing a raw `Error` to a logger that serialises own-properties emits
 * `{}`, because `message` and `stack` are non-enumerable — so the one
 * class of failure this filter exists to make investigable recorded a
 * correlation id, a path, and no cause. Found while chasing an
 * intermittent 500 in the suite that the logs could not explain.
 */
interface LoggedError {
  readonly type?: string;
  readonly message?: string;
  readonly errorCode?: string;
  readonly stack?: string;
  readonly thrown?: string;
}

/** Catches what the filter logs, and what it answered. */
function capture(exception: unknown): { logged: LoggedError | undefined; status: number } {
  const filter = new AllExceptionsFilter();
  let logged: LoggedError | undefined;
  let status = 0;

  // The logger is private; replacing it is the only way to read what it
  // was given without asserting against a real log stream.
  Object.defineProperty(filter, 'logger', {
    value: {
      error: (payload: { err: LoggedError }) => {
        logged = payload.err;
      },
      warn: () => undefined,
      log: () => undefined,
    },
  });

  const response = {
    setHeader: () => undefined,
    status: (code: number) => {
      status = code;
      return response;
    },
    json: () => undefined,
  };

  filter.catch(exception, {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url: '/api/v1/doctors', method: 'GET', headers: {} }),
    }),
  } as never);

  return { logged, status };
}

describe('an unhandled exception is logged with a cause', () => {
  it('carries the name, message and stack of an ordinary Error', () => {
    const { logged, status } = capture(new Error('Connection terminated unexpectedly'));

    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    // The assertion that would have caught `{ "err": {} }`.
    expect(logged?.type).toBe('Error');
    expect(logged?.message).toBe('Connection terminated unexpectedly');
    expect(logged?.stack).toContain('all-exceptions.filter.spec.ts');
  });

  it('withholds a Prisma error’s message but keeps its code and stack', () => {
    // A driver message can echo the row it choked on — `Failing row
    // contains (…, 'Khaled Nassar', …)` — and MG §11.6 forbids PHI in
    // logs. The `code` is the diagnostic half.
    const prisma = Object.assign(new Error("Failing row contains ('Khaled Nassar')"), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    });

    const { logged } = capture(prisma);

    expect(logged?.type).toBe('PrismaClientKnownRequestError');
    expect(logged?.errorCode).toBe('P2002');
    expect(logged?.message).toBeUndefined();
    expect(JSON.stringify(logged)).not.toContain('Khaled');
    // The stack still comes through: code paths are not patient data,
    // and without one there is no line number to go to.
    expect(logged?.stack).toBeDefined();
  });

  it('names the type when something threw a non-Error', () => {
    // A rejection with no reason, or a thrown string. Naming the type is
    // what makes it diagnosable at all.
    expect(capture('boom').logged?.thrown).toBe('string');
    expect(capture(undefined).logged?.thrown).toBe('undefined');
  });

  it('logs nothing for a 4xx — the client’s problem is not an incident', () => {
    const { logged, status } = capture(
      new (class extends Error {
        getStatus(): number {
          return 404;
        }
      })('missing'),
    );

    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    // A plain Error is a 500 whatever methods it happens to carry — only
    // a real `HttpException` changes the status, which `transport`
    // covers. What matters here is that the 500 branch logged a cause.
    expect(logged?.type).toBe('Error');
  });
});

/** What the filter answered: the status, the body and the headers it set. */
function answer(exception: unknown): {
  status: number;
  body: Record<string, unknown> | undefined;
  logged: boolean;
} {
  const filter = new AllExceptionsFilter();
  let logged = false;
  let status = 0;
  let body: Record<string, unknown> | undefined;

  Object.defineProperty(filter, 'logger', {
    value: {
      error: () => {
        logged = true;
      },
      warn: () => undefined,
      log: () => undefined,
    },
  });

  const response = {
    setHeader: () => undefined,
    status: (code: number) => {
      status = code;
      return response;
    },
    json: (payload: Record<string, unknown>) => {
      body = payload;
    },
  };

  filter.catch(exception, {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url: '/api/v1/auth/login', method: 'POST', headers: {} }),
    }),
  } as never);

  return { status, body, logged };
}

/** The shape `http-errors` gives body-parser's rejections. */
function httpError(status: number, message: string, expose: boolean): Error {
  return Object.assign(new Error(message), {
    name: 'PayloadTooLargeError',
    status,
    statusCode: status,
    expose,
    type: 'entity.too.large',
  });
}

describe('a body-parser client error keeps its status (AST-G2)', () => {
  it('answers an oversized body 413 payload_too_large, not 500', () => {
    const { status, body, logged } = answer(httpError(413, 'request entity too large', true));

    expect(status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(body).toEqual({ message: 'request entity too large', code: 'payload_too_large' });
    // A client error is not an incident: no error-level log, no `ref`.
    expect(logged).toBe(false);
  });

  it('answers an undecodable charset 415 unsupported_media_type', () => {
    const { status, body } = answer(httpError(415, 'unsupported charset "LATIN1"', true));

    expect(status).toBe(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    expect(body?.code).toBe('unsupported_media_type');
  });

  it('does not trust a status the library did not mark safe to expose', () => {
    // Any error can carry a `status` field. Only `expose: true` — which
    // `http-errors` sets below 500 and nowhere else — is believed.
    const { status, body, logged } = answer(httpError(413, 'row (Khaled Nassar) too large', false));

    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body).toMatchObject({ message: 'Internal server error', code: 'internal_error' });
    expect(logged).toBe(true);
  });

  it('never turns a 5xx into a client error, even when marked exposable', () => {
    const { status, body } = answer(httpError(503, 'upstream message', true));

    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body?.message).toBe('Internal server error');
  });
});

describe('the logged path', () => {
  // MG §11.6: no PHI in URLs — but a client that puts a patient's name in
  // `?q=` must not turn that into a permanent record in the log store. The
  // access log already dropped query strings; this filter logged
  // `request.url` whole until the rule moved to `loggableUrl`.
  it('drops the query string, which can carry a patient’s name', () => {
    const filter = new AllExceptionsFilter();
    let payload: { path?: string } | undefined;
    Object.defineProperty(filter, 'logger', {
      value: {
        error: (logged: { path?: string }) => {
          payload = logged;
        },
        warn: () => undefined,
        log: () => undefined,
      },
    });
    const response = {
      setHeader: () => undefined,
      status: () => response,
      json: () => undefined,
    };

    filter.catch(new Error('boom'), {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          url: '/api/v1/patients?q=Khaled%20Nassar&page=2',
          method: 'GET',
          headers: {},
        }),
      }),
    } as never);

    expect(payload?.path).toBe('/api/v1/patients');
    expect(JSON.stringify(payload)).not.toContain('Khaled');
  });
});
