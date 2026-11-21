import { Writable } from 'node:stream';

import pinoHttp, { type Options } from 'pino-http';
import { describe, expect, it, vi } from 'vitest';

import { buildLoggerOptions } from '../../../common/logging/logger.config';
import { Prisma } from '../../../generated/prisma/client';
import { LoginResult } from '../../../generated/prisma/enums';
import type { PrismaService } from '../../../shared/database';

import { LoginEventService } from './login-event.service';

/**
 * A login-history row that cannot be written (RM M8.5, M37.3).
 *
 * `record` is called on every sign-in attempt, successful or not. If the
 * insert fails, the sign-in it describes must still answer as it would
 * have — a history outage must not become a login outage — and the log
 * line that replaces the row must not carry what the row would have:
 * the attempted address. That was a real leak until 2026-10-30. A failed
 * insert carried Postgres's `Failing row contains (…, <address>, …)` at
 * `meta.driverAdapterError.cause.detail`, and this service's catch block
 * was where it was observed (`error-description.ts`).
 */
const ADDRESS = 'khaled.nassar@example.com';

/** The shape `@prisma/adapter-pg` 7.10 gives a refused `login_events` insert. */
function refusedInsert(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Invalid `prisma.loginEvent.create()` invocation: violates check constraint',
    {
      code: 'P2039',
      clientVersion: '7.10.1',
      meta: {
        modelName: 'LoginEvent',
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: { originalCode: '23514', detail: `Failing row contains (…, ${ADDRESS}, …).` },
        },
      },
    },
  );
}

function serviceWith(create: (args: unknown) => Promise<unknown>) {
  const prisma = { db: { loginEvent: { create } } } as unknown as PrismaService;
  const service = new LoginEventService(prisma);
  const logged: object[] = [];
  // The logger is private; replacing it is the only way to read what it
  // was given without asserting against a real log stream.
  Object.defineProperty(service, 'logger', {
    value: { error: (payload: object) => logged.push(payload) },
  });
  return { service, logged };
}

/** One line, as pino configured for production would write it. */
function throughProductionLogger(payload: object): string {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString('utf8'));
      done();
    },
  });
  const options = buildLoggerOptions({ appEnv: 'production' }).pinoHttp as Options;
  pinoHttp(options, sink).logger.error(payload, 'Could not record a login attempt');
  return lines[0] ?? '';
}

describe('LoginEventService.record', () => {
  it('writes the attempt, with the optional fields only when present', async () => {
    const create = vi.fn().mockResolvedValue({});
    const { service } = serviceWith(create);

    await service.record({ attemptedEmail: ADDRESS, result: LoginResult.FAILED });

    expect(create).toHaveBeenCalledWith({
      data: { attemptedEmail: ADDRESS, result: LoginResult.FAILED },
    });

    const full = {
      attemptedEmail: ADDRESS,
      userId: '7a1d3a5e-0f5c-4d2b-9f0e-1b2c3d4e5f60',
      result: LoginResult.SUCCESS,
      failureCode: 'otp_invalid',
      device: 'Firefox on Linux',
      ipAddress: '203.0.113.7',
    };
    await service.record(full);

    // `location` is never written: no geo-IP provider is configured.
    expect(create).toHaveBeenLastCalledWith({ data: full });
  });

  it('does not fail the sign-in when the row cannot be written', async () => {
    const { service, logged } = serviceWith(() => Promise.reject(refusedInsert()));

    await expect(
      service.record({
        attemptedEmail: ADDRESS,
        result: LoginResult.FAILED,
        failureCode: 'invalid_credentials',
        ipAddress: '203.0.113.7',
      }),
    ).resolves.toBeUndefined();

    expect(logged).toHaveLength(1);
  });

  it('logs the failure without the attempted address', async () => {
    const { service, logged } = serviceWith(() => Promise.reject(refusedInsert()));

    await service.record({ attemptedEmail: ADDRESS, result: LoginResult.FAILED });

    const line = throughProductionLogger(logged[0] ?? {});
    expect(line).not.toContain('khaled');
    // Still diagnosable: which error, and its code.
    expect(line).toContain('"type":"PrismaClientKnownRequestError"');
    expect(line).toContain('"errorCode":"P2039"');
  });
});
