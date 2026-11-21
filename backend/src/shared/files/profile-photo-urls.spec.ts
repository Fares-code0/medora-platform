import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../database';

import { DOWNLOAD_TTL_SECONDS, type FileStoragePort } from './file-storage.types';
import { ProfilePhotoUrls } from './profile-photo-urls';

/**
 * The one place a stored doctor photo becomes a wire value.
 *
 * Unit rather than e2e for the decision itself: the scan result is a
 * column the M30.2 scanner writes, and the outcome is a pure function of
 * it — so each verdict is supplied rather than staged through a scanner
 * run. `test/profile-photo.e2e-spec.ts` drives the same states through
 * every HTTP response that carries the photo, against the real S3 adapter.
 */

const CLEAN_ID = '44444444-4444-4444-8444-444444444444';
const PENDING_ID = '55555555-5555-4555-8555-555555555555';
const INFECTED_ID = '66666666-6666-4666-8666-666666666666';
const MISSING_ID = '77777777-7777-4777-8777-777777777777';
const KEY = 'profile_photo/2026/10/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png';

const ROWS = [
  { id: CLEAN_ID, storageKey: KEY, scanResult: 'clean' },
  { id: PENDING_ID, storageKey: 'profile_photo/p.png', scanResult: null },
  { id: INFECTED_ID, storageKey: 'profile_photo/i.png', scanResult: 'infected' },
];

function resolverWith(options: { readonly signingFails?: boolean } = {}) {
  const findMany = vi.fn((args: { where: { id: { in: string[] } } }) =>
    Promise.resolve(ROWS.filter((row) => args.where.id.in.includes(row.id))),
  );
  const signedDownloadUrl = vi.fn((key: string) =>
    options.signingFails === true
      ? Promise.reject(new Error('signer unavailable'))
      : Promise.resolve(`https://objects.test/${key}?X-Amz-Signature=abc`),
  );

  const resolver = new ProfilePhotoUrls(
    { file: { findMany } } as unknown as PrismaService,
    { signedDownloadUrl } as unknown as FileStoragePort,
  );

  return { resolver, findMany, signedDownloadUrl };
}

describe('ProfilePhotoUrls', () => {
  it('signs a clean photo inline, for the platform download TTL', async () => {
    const { resolver, signedDownloadUrl } = resolverWith();

    expect(await resolver.resolve(CLEAN_ID)).toBe(`https://objects.test/${KEY}?X-Amz-Signature=abc`);
    expect(signedDownloadUrl).toHaveBeenCalledWith(KEY, DOWNLOAD_TTL_SECONDS, {
      disposition: 'inline',
    });
    expect(DOWNLOAD_TTL_SECONDS).toBe(60);
  });

  it('serves nothing for a photo the scanner has not run on', async () => {
    const { resolver, signedDownloadUrl } = resolverWith();

    expect(await resolver.resolve(PENDING_ID)).toBeNull();
    expect(signedDownloadUrl).not.toHaveBeenCalled();
  });

  it('serves nothing for a photo the scanner marked infected', async () => {
    const { resolver, signedDownloadUrl } = resolverWith();

    expect(await resolver.resolve(INFECTED_ID)).toBeNull();
    expect(signedDownloadUrl).not.toHaveBeenCalled();
  });

  it('serves nothing for an id that names no live profile photo', async () => {
    const { resolver, findMany } = resolverWith();

    expect(await resolver.resolve(MISSING_ID)).toBeNull();
    // Scoped to live profile photos — a `photo_url` pointed at a lab
    // report, or at a deleted photo, finds nothing to sign.
    const where = (findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    expect(where['kind']).toBe('profile_photo');
    expect(where['deletedAt']).toBeNull();
    expect(where['storageKey']).toEqual({ not: '' });
  });

  it('never echoes a legacy bare storage key, and does not query for it', async () => {
    const { resolver, findMany } = resolverWith();

    expect(await resolver.resolve(KEY)).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('passes an absolute https URL through unchanged', async () => {
    const { resolver, findMany } = resolverWith();

    expect(await resolver.resolve('https://cdn.example.test/p.png')).toBe(
      'https://cdn.example.test/p.png',
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('does not pass a plain-http or data URL through', async () => {
    const { resolver } = resolverWith();

    expect(await resolver.resolve('http://cdn.example.test/p.png')).toBeNull();
    expect(await resolver.resolve('data:image/png;base64,AAAA')).toBeNull();
  });

  it('answers null with no query when there is no photo', async () => {
    const { resolver, findMany } = resolverWith();

    expect(await resolver.resolve(null)).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('degrades a signing failure to null rather than throwing', async () => {
    const { resolver } = resolverWith({ signingFails: true });

    expect(await resolver.resolve(CLEAN_ID)).toBeNull();
  });

  it('resolves a whole page with one query, de-duplicated', async () => {
    const { resolver, findMany, signedDownloadUrl } = resolverWith();

    const photo = await resolver.lookup([
      CLEAN_ID,
      CLEAN_ID,
      PENDING_ID,
      INFECTED_ID,
      MISSING_ID,
      KEY,
      null,
      'https://cdn.example.test/p.png',
    ]);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]?.[0].where.id.in).toEqual([
      CLEAN_ID,
      PENDING_ID,
      INFECTED_ID,
      MISSING_ID,
    ]);
    expect(signedDownloadUrl).toHaveBeenCalledTimes(1);

    expect(photo(CLEAN_ID)).toBe(`https://objects.test/${KEY}?X-Amz-Signature=abc`);
    expect(photo(PENDING_ID)).toBeNull();
    expect(photo(INFECTED_ID)).toBeNull();
    expect(photo(MISSING_ID)).toBeNull();
    expect(photo(KEY)).toBeNull();
    expect(photo(null)).toBeNull();
    expect(photo('https://cdn.example.test/p.png')).toBe('https://cdn.example.test/p.png');
    // A value the lookup was never given is not guessed at.
    expect(photo('99999999-9999-4999-8999-999999999999')).toBeNull();
  });
});
