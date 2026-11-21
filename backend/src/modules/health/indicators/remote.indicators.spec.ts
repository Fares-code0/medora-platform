import { describe, expect, it, vi } from 'vitest';

import type { FileStoragePort } from '../../../shared/files';
import type { Mailer } from '../../../shared/mail';

import { MailHealthIndicator } from './mail.indicator';
import { StorageHealthIndicator } from './storage.indicator';

function storage(ping?: () => Promise<void>): FileStoragePort {
  return {
    put: vi.fn(),
    signedDownloadUrl: vi.fn(),
    get: vi.fn(),
    remove: vi.fn(),
    ...(ping === undefined ? {} : { ping }),
  };
}

function mailer(verify?: () => Promise<void>): Mailer {
  return {
    send: vi.fn(),
    trySend: vi.fn(),
    ...(verify === undefined ? {} : { verify }),
  };
}

describe('StorageHealthIndicator', () => {
  it('is unconfigured for an adapter that cannot ping', async () => {
    expect(await new StorageHealthIndicator(storage()).check()).toBe('unconfigured');
  });

  it('is up when the bucket answers and down when it does not', async () => {
    expect(await new StorageHealthIndicator(storage(() => Promise.resolve())).check()).toBe('up');
    expect(
      await new StorageHealthIndicator(
        storage(() => Promise.reject(new Error('NoSuchBucket'))),
      ).check(),
    ).toBe('down');
  });

  it('does not ping on every poll', async () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    const indicator = new StorageHealthIndicator(storage(ping));

    await indicator.check();
    await indicator.check();

    expect(ping).toHaveBeenCalledTimes(1);
  });
});

describe('MailHealthIndicator', () => {
  it('is unconfigured for a mailer that cannot verify', async () => {
    expect(await new MailHealthIndicator(mailer()).check()).toBe('unconfigured');
  });

  it('is up when the relay greets and down when it refuses', async () => {
    expect(await new MailHealthIndicator(mailer(() => Promise.resolve())).check()).toBe('up');
    expect(
      await new MailHealthIndicator(
        mailer(() => Promise.reject(new Error('ECONNREFUSED'))),
      ).check(),
    ).toBe('down');
  });
});
