import { Writable } from 'node:stream';

import pinoHttp, { type Options } from 'pino-http';
import { describe, expect, it } from 'vitest';

import { describeError, serializeLoggedError } from './error-description';
import { buildLoggerOptions } from './logger.config';

/**
 * What the application logger writes for `{ err }` (MG §11.6, RM M37.3).
 *
 * Driven through pino-http built from the real `buildLoggerOptions`,
 * because pino-http runs its own error serialiser *before* a custom one,
 * and a test of the function alone would not notice if the custom one
 * stopped being reached.
 *
 * The error is the shape `@prisma/adapter-pg` 7.10 produced for a CHECK
 * violation on `login_events`, observed on 2026-10-30: Postgres's
 * `DETAIL` line, with the attempted email in it, sits at
 * `meta.driverAdapterError.cause.detail`.
 */
const EMAIL = 'khaled.nassar@example.com';

function prismaCheckViolation(): Error {
  return Object.assign(
    new Error(
      'Invalid `tx.loginEvent.create()` invocation: new row for relation "login_events" violates check constraint',
    ),
    {
      name: 'PrismaClientKnownRequestError',
      code: 'P2039',
      clientVersion: '7.10.1',
      meta: {
        modelName: 'LoginEvent',
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: {
            originalCode: '23514',
            kind: 'postgres',
            detail: `Failing row contains (496a019a, null, ${EMAIL}, 2026-10-30, failed).`,
          },
        },
      },
    },
  );
}

/** One log line, as JSON, written by a logger configured as production's is. */
function logLine(payload: object): Record<string, unknown> {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString('utf8'));
      done();
    },
  });

  const options = buildLoggerOptions({ appEnv: 'production' }).pinoHttp as Options;
  pinoHttp(options, sink).logger.error(payload, 'probe');

  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0] ?? '') as Record<string, unknown>;
}

describe('the logger never copies an error’s enumerable properties', () => {
  it('keeps the class and the code out of reach of the `name` and `code` redaction', () => {
    // `*.name` and `*.code` are on the redaction list; under those keys
    // every 5xx line read `[redacted]` where the cause should have been.
    expect(JSON.stringify(logLine({ err: prismaCheckViolation() }))).not.toContain('[redacted]');
  });

  it('drops the row a Prisma error carries in its driver metadata', () => {
    const line = logLine({ err: prismaCheckViolation() });

    expect(JSON.stringify(line)).not.toContain('khaled');
    expect(line.err).toMatchObject({ type: 'PrismaClientKnownRequestError', errorCode: 'P2039' });
    expect(line.err).not.toHaveProperty('meta');
    expect(line.err).not.toHaveProperty('message');
    // Still diagnosable: the frames, not the text.
    expect((line.err as { stack?: string }).stack).toContain('error-description.spec.ts');
  });

  it('keeps an ordinary error’s message and stack', () => {
    const line = logLine({ err: new Error('Connection terminated unexpectedly') });

    expect(line.err).toMatchObject({
      type: 'Error',
      message: 'Connection terminated unexpectedly',
    });
    expect((line.err as { stack?: string }).stack).toContain('error-description.spec.ts');
  });

  it('drops the enumerable extras of an ordinary error too', () => {
    // nodemailer, the S3 SDK and pg all hang the server's reply on the
    // error object, and that reply is where a recipient or a row lives.
    const error = Object.assign(new Error('Mail delivery failed'), {
      code: 'EENVELOPE',
      rejected: [EMAIL],
    });

    const line = logLine({ err: error });

    expect(line.err).toEqual(expect.objectContaining({ errorCode: 'EENVELOPE' }));
    expect(line.err).not.toHaveProperty('rejected');
    expect(JSON.stringify(line)).not.toContain('khaled');
  });

  it('passes through a value a call site already reduced', () => {
    // The exception filter logs `describeError(exception)`, a plain
    // object; describing it again would turn it into `{ thrown: 'object' }`.
    const described = describeError(new Error('already described'));

    expect(logLine({ err: described }).err).toMatchObject({
      type: 'Error',
      message: 'already described',
    });
    expect(logLine({ err: 'a string' }).err).toBe('a string');
  });
});

describe('serializeLoggedError', () => {
  it('describes an Error handed to it directly', () => {
    expect(serializeLoggedError(prismaCheckViolation())).not.toHaveProperty('meta');
  });

  it('leaves null and undefined alone', () => {
    expect(serializeLoggedError(null)).toBeNull();
    expect(serializeLoggedError(undefined)).toBeUndefined();
  });
});
