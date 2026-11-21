import { describe, expect, it } from 'vitest';

import { ConfigService } from '../src/config';
import { loadEnv } from '../src/config/env';
import { S3FileStorage } from '../src/shared/files/s3-file-storage';

/**
 * The S3 adapter against a **real** S3-compatible store (RM M25.2, M25.4,
 * RA-M25.1). **Opt-in**: skipped unless `S3_LIVE_ENDPOINT` is set, because
 * neither CI nor the development container has an object store.
 *
 * What the always-on `s3-file-storage.spec.ts` cannot show, and this does:
 * that a real store **accepts** the adapter's requests (path-style
 * addressing, the integrity header, the key layout), serves a presigned
 * URL with the signed `Content-Disposition`, and **rejects** one once it
 * has expired.
 *
 * Run against MinIO (`docs/EXTERNAL_INTEGRATIONS.md` has the commands):
 *
 *   S3_LIVE_ENDPOINT=http://127.0.0.1:9000 S3_LIVE_BUCKET=medora-live \
 *   S3_LIVE_ACCESS_KEY_ID=minioadmin S3_LIVE_SECRET_ACCESS_KEY=minioadmin \
 *   npx vitest run test/s3-live.e2e-spec.ts
 *
 * The bucket must exist; this spec never creates or deletes a bucket, only
 * the objects it writes, under `patient_document/`.
 */

const LIVE = process.env['S3_LIVE_ENDPOINT'];

function liveStorage(bucket = process.env['S3_LIVE_BUCKET'] ?? ''): S3FileStorage {
  return new S3FileStorage(
    new ConfigService({
      ...loadEnv(),
      S3_ENDPOINT: LIVE ?? '',
      S3_BUCKET: bucket,
      S3_REGION: process.env['S3_LIVE_REGION'] ?? 'us-east-1',
      S3_ACCESS_KEY_ID: process.env['S3_LIVE_ACCESS_KEY_ID'] ?? '',
      S3_SECRET_ACCESS_KEY: process.env['S3_LIVE_SECRET_ACCESS_KEY'] ?? '',
      S3_FORCE_PATH_STYLE: (process.env['S3_LIVE_FORCE_PATH_STYLE'] ?? 'true') === 'true',
    }),
  );
}

describe.skipIf(LIVE === undefined)('S3FileStorage against a live store', () => {
  const content = Buffer.from(`%PDF-1.7 live round trip ${String(Date.now())}`);

  it('stores an object, reads it back, and removes it idempotently', async () => {
    const storage = liveStorage();
    const stored = await storage.put({
      kind: 'patient_document',
      name: 'live-check.pdf',
      mimeType: 'application/pdf',
      content,
    });

    expect(await storage.get(stored.key)).toEqual(content);

    await storage.remove(stored.key);
    await storage.remove(stored.key);
    await expect(storage.get(stored.key)).rejects.toBeDefined();
  }, 30_000);

  it('serves a presigned URL with the signed disposition, and refuses it once expired', async () => {
    const storage = liveStorage();
    const stored = await storage.put({
      kind: 'patient_document',
      name: 'live-check.pdf',
      mimeType: 'application/pdf',
      content,
    });

    try {
      const url = await storage.signedDownloadUrl(stored.key, 60, { fileName: 'referral.pdf' });
      const response = await fetch(url);

      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(content);
      expect(response.headers.get('content-disposition')).toContain('attachment');
      expect(response.headers.get('content-disposition')).toContain('referral.pdf');

      const shortLived = await storage.signedDownloadUrl(stored.key, 1);
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      expect((await fetch(shortLived)).status).toBe(403);
    } finally {
      await storage.remove(stored.key);
    }
  }, 30_000);

  it('answers the health probe for its bucket, and refuses one that does not exist', async () => {
    await expect(liveStorage().ping()).resolves.toBeUndefined();

    const missing = liveStorage(`medora-missing-${String(Date.now())}`);
    await expect(missing.ping()).rejects.toBeDefined();
  }, 30_000);
});
