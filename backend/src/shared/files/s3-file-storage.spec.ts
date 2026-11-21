import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppException } from '../../common/errors/app.exception';
import { ConfigService } from '../../config';
import type { Env } from '../../config';

import { S3FileStorage } from './s3-file-storage';

/**
 * The S3-compatible adapter (RM M25.2, API §17.2).
 *
 * > ✅ Verify: URL expires (test with clock).
 *
 * ## What this proves, and what it cannot
 *
 * There is **no object store reachable from this environment**. Docker
 * has no daemon here and `dl.min.io` is refused by the egress policy, so
 * the roadmap's "green against MinIO" is not runnable — recorded as
 * **RA-M25.1** rather than pretended.
 *
 * What is runnable is everything short of a real bucket, and it is more
 * than a mock would give: the requests below are formed by the **real**
 * AWS SDK and sent over a **real socket** to a server that records what
 * arrived. So the key layout, the path-style addressing, the content
 * type, the integrity header and the error mapping are all asserted
 * against bytes on the wire rather than against a stub's expectations.
 * What is not asserted is that a real S3 accepts them.
 *
 * Presigned URLs never touch the network at all — the signature is
 * computed locally and the expiry is *encoded in the URL* — so the
 * expiry assertion here is exact rather than approximate. The half that
 * needs a server is the rejection of an expired URL, which is S3's
 * behaviour and not this code's.
 */
interface Captured {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: Buffer;
}

let server: Server;
let captured: Captured[] = [];
let respond: (res: ServerResponse) => void = (res) => {
  res.writeHead(200).end();
};

function storageOn(port: number): S3FileStorage {
  return new S3FileStorage(
    new ConfigService({
      S3_ENDPOINT: `http://127.0.0.1:${String(port)}`,
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'medora-files-test',
      S3_ACCESS_KEY_ID: 'test-access-key',
      S3_SECRET_ACCESS_KEY: 'test-secret-key',
      S3_FORCE_PATH_STYLE: true,
    } as unknown as Env),
  );
}

let storage: S3FileStorage;

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      captured.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      respond(res);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  storage = storageOn((server.address() as AddressInfo).port);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
});

const content = Buffer.from('a scanned referral letter');

describe('put', () => {
  it('writes to a kind- and date-prefixed key that never carries the filename', async () => {
    captured = [];

    const stored = await storage.put({
      kind: 'patient_document',
      name: 'ahmed-hassan-biopsy.pdf',
      mimeType: 'application/pdf',
      content,
    });

    // The filename is PHI and filenames collide; the uuid is the whole
    // of the uniqueness. The extension survives for a human reading a
    // bucket listing.
    expect(stored.key).toMatch(/^patient_document\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
    expect(stored.key).not.toContain('ahmed');
    expect(stored.sizeBytes).toBe(content.byteLength);
    // Nothing has scanned it, and `pending` is not `clean` — API §17.2's
    // gate turns on exactly that difference.
    expect(stored.scanStatus).toBe('pending');

    const request = captured[0];
    expect(request?.method).toBe('PUT');
    // Path-style addressing: the bucket is in the path, because a local
    // endpoint has no per-bucket DNS.
    // `?x-id=PutObject` is the SDK's own operation marker; the path is
    // what addresses the object.
    expect(request?.url.split('?')[0]).toBe(`/medora-files-test/${stored.key}`);
    expect(request?.headers['content-type']).toBe('application/pdf');
    expect(request?.body.equals(content)).toBe(true);
  });

  it('sends the checksum so a truncated upload is refused by the store', async () => {
    captured = [];
    await storage.put({
      kind: 'lab_attachment',
      name: 'result.pdf',
      mimeType: 'application/pdf',
      content,
    });

    expect(captured[0]?.headers['x-amz-checksum-sha256']).toBe(
      createHash('sha256').update(content).digest('base64'),
    );
  });

  it('strips a traversal attempt out of the extension', async () => {
    captured = [];
    const stored = await storage.put({
      kind: 'patient_document',
      name: '../../etc/passwd',
      mimeType: 'application/pdf',
      content,
    });

    // MinIO maps keys onto a filesystem, so `../` in a key is a real
    // path-traversal attempt rather than a cosmetic problem.
    expect(stored.key).not.toContain('..');
    expect(stored.key).not.toContain('passwd');
  });

  it('answers 503 without repeating the provider’s words', async () => {
    const unreachable = storageOn(1);

    let thrown: unknown;
    try {
      await unreachable.put({
        kind: 'record_attachment',
        name: 'x.pdf',
        mimeType: 'application/pdf',
        content,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppException);
    expect((thrown as AppException).getStatus()).toBe(503);
    expect((thrown as AppException).code).toBe('service_unavailable');
    // The SDK's message names the bucket, the endpoint and the access
    // key id. None of that belongs in an API response.
    expect((thrown as AppException).message).not.toContain('medora-files-test');
    expect((thrown as AppException).message).not.toContain('test-access-key');
  });

  it('maps a store that answers an error to the same 503', async () => {
    respond = (res) => res.writeHead(500).end('<Error><Code>InternalError</Code></Error>');

    await expect(
      storage.put({
        kind: 'record_attachment',
        name: 'x.pdf',
        mimeType: 'application/pdf',
        content,
      }),
    ).rejects.toBeInstanceOf(AppException);

    respond = (res) => {
      res.writeHead(200).end();
    };
  });
});

describe('signedDownloadUrl', () => {
  it('encodes exactly the TTL it was given, from the current clock', async () => {
    const before = Math.floor(Date.now() / 1000);
    const url = new URL(await storage.signedDownloadUrl('patient_document/2026/09/x.pdf', 300));
    const after = Math.floor(Date.now() / 1000);

    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);

    // The expiry is a property of the URL, not of a server's memory:
    // signed-at plus TTL, and after that instant the URL is dead
    // wherever it is presented. Asserted against the clock that signed
    // it rather than against a constant.
    const signedAt = Date.parse(
      (url.searchParams.get('X-Amz-Date') ?? '').replace(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
        '$1-$2-$3T$4:$5:$6Z',
      ),
    ) / 1000;

    expect(signedAt).toBeGreaterThanOrEqual(before);
    expect(signedAt).toBeLessThanOrEqual(after);
    expect(signedAt + 300).toBeLessThanOrEqual(after + 300);
  });

  it('signs a different window for a different TTL', async () => {
    const short = new URL(await storage.signedDownloadUrl('k', 60));
    const long = new URL(await storage.signedDownloadUrl('k', 3600));

    expect(short.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(long.searchParams.get('X-Amz-Expires')).toBe('3600');
    // Different windows must not sign identically, or the TTL is
    // decorative.
    expect(short.searchParams.get('X-Amz-Signature')).not.toBe(
      long.searchParams.get('X-Amz-Signature'),
    );
  });

  it('bakes Content-Disposition into the signature', async () => {
    const url = new URL(
      await storage.signedDownloadUrl('k', 300, { fileName: 'referral.pdf' }),
    );

    // Signed, so whoever holds the URL cannot turn an attachment into an
    // inline render — the server that issued it decided.
    expect(url.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="referral.pdf"',
    );
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBeDefined();
  });

  it('refuses to let a filename inject a header', async () => {
    const url = new URL(
      await storage.signedDownloadUrl('k', 300, {
        fileName: 'evil"\r\nX-Injected: 1.pdf',
      }),
    );
    const disposition = url.searchParams.get('response-content-disposition') ?? '';

    expect(disposition).not.toContain('"evil"');
    expect(disposition).not.toContain('\r');
    expect(disposition).not.toContain('\n');
  });

  it('omits the filename rather than emitting an empty one', async () => {
    const url = new URL(await storage.signedDownloadUrl('k', 300, { fileName: '   ' }));

    expect(url.searchParams.get('response-content-disposition')).toBe('attachment');
  });
});

describe('remove', () => {
  it('deletes the object by key', async () => {
    captured = [];
    await storage.remove('patient_document/2026/09/gone.pdf');

    expect(captured[0]?.method).toBe('DELETE');
    expect(captured[0]?.url.split('?')[0]).toBe(
      '/medora-files-test/patient_document/2026/09/gone.pdf',
    );
  });

  it('succeeds on an object that is not there', async () => {
    // The port's contract, and what M25.5's sweep relies on when it runs
    // over the same rows twice.
    respond = (res) => {
      res.writeHead(204).end();
    };

    await expect(storage.remove('never/existed')).resolves.toBeUndefined();
  });
});
