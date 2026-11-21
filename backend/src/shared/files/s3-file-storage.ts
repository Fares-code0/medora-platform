import { createHash, randomUUID } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { ConfigService } from '../../config';

import type {
  DownloadOptions,
  FileStoragePort,
  FileUpload,
  StoredFile,
} from './file-storage.types';

/**
 * The S3-compatible object store (RM M25.2, API §17.2).
 *
 * MinIO in development, S3-compatible in production (MG §3.2) — the same
 * client either way, which is the reason `S3_ENDPOINT` and
 * `S3_FORCE_PATH_STYLE` are configuration rather than a code branch.
 *
 * ## The key is opaque, and its shape is still deliberate
 *
 * `<kind>/<yyyy>/<mm>/<uuid><ext>`. The kind prefix makes a lifecycle
 * rule or a bucket policy expressible per kind without reading the
 * database; the date prefix keeps a single prefix from accumulating
 * millions of objects, which is what makes a `ListObjects` sweep
 * tractable for M25.5. The uuid is the whole of the uniqueness — the
 * original filename is **never** part of the key, because filenames
 * collide, carry PHI ("ahmed-hassan-biopsy.pdf") and arrive containing
 * path separators.
 *
 * ## Every failure is a 503, and never carries the provider's words
 *
 * A bucket that is missing, a credential that is wrong and an endpoint
 * that is unreachable are all "storage is not working" to a caller, and
 * that is the answer `/health` already gives for this dependency
 * (ADR-016). The SDK's message can name the bucket, the endpoint and the
 * access key id; none of that belongs in an API response, so it is
 * logged and the response says nothing.
 *
 * This is also what keeps the pre-M25 contract true in an environment
 * with no object store: the routes that answered 503 while
 * `UnconfiguredFileStorage` was bound still answer 503, for a reason
 * that is now accurate rather than a placeholder.
 */
@Injectable()
export class S3FileStorage implements FileStoragePort {
  private readonly logger = new Logger(S3FileStorage.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const { env } = config;

    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      // MinIO and most S3-compatible stores address buckets by path;
      // virtual-host addressing needs DNS per bucket, which a local
      // endpoint does not have.
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  async put(upload: FileUpload): Promise<StoredFile> {
    const id = randomUUID();
    const key = keyFor(upload, id);
    const checksum = createHash('sha256').update(upload.content).digest('base64');

    await this.call('put', key, async () => {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: upload.content,
          ContentType: upload.mimeType,
          // The store verifies the bytes it received against this and
          // refuses the write on a mismatch, so a truncated upload is a
          // failed `put()` rather than a silently corrupt object. The
          // `files` row's own hex checksum is computed separately by the
          // caller over the same buffer.
          ChecksumSHA256: checksum,
        }),
      );
    });

    return {
      id,
      key,
      name: upload.name,
      mimeType: upload.mimeType,
      sizeBytes: upload.content.byteLength,
      // Nothing has scanned it. `pending` is not `clean`, and API §17.2's
      // download gate turns on exactly that difference.
      scanStatus: 'pending',
    };
  }

  /**
   * A presigned GET, with the disposition baked into the signature.
   *
   * `ResponseContentDisposition` is a signed query parameter, so the
   * browser's save dialog is decided by the server that issued the URL
   * and cannot be changed by whoever holds it. The filename is quoted
   * and stripped of quotes and control characters — an unescaped one is
   * a header-injection hole in every S3-compatible store.
   */
  signedDownloadUrl(key: string, ttlSeconds: number, options?: DownloadOptions): Promise<string> {
    const disposition = options?.disposition ?? 'attachment';
    const fileName = sanitizeFileName(options?.fileName);

    return this.call('sign', key, () =>
      getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ResponseContentDisposition:
            fileName === null ? disposition : `${disposition}; filename="${fileName}"`,
        }),
        { expiresIn: ttlSeconds },
      ),
    );
  }

  /**
   * The object's bytes (RM M30.2's scanner).
   *
   * Buffered rather than streamed, and that is a bounded decision rather
   * than a lazy one: `FILE_POLICY` caps every kind at a small number of
   * megabytes at upload, so the largest object this can be asked for is
   * already known and small. A stream would push the same bound onto
   * every caller without removing it.
   */
  async get(key: string): Promise<Buffer> {
    return this.call('get', key, async () => {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      const body = response.Body;

      if (body === undefined) {
        // A 200 with no body is a store that is answering but not
        // serving. Treated as a failure so `call` maps it to the same
        // 503 every other storage fault produces.
        throw new Error('The object store returned no body');
      }

      return Buffer.from(await body.transformToByteArray());
    });
  }

  async remove(key: string): Promise<void> {
    // S3's DELETE is already idempotent — removing an absent key
    // succeeds — which is the contract the port states and what M25.5's
    // sweep relies on when it runs over the same rows twice.
    await this.call('remove', key, async () => {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    });
  }

  /**
   * `HeadBucket`: one signed request that proves the endpoint answers,
   * the credentials are accepted and the bucket exists — the three things
   * every upload needs. Not routed through `call`, whose 503 and error log
   * belong to a client request; the health indicator decides what a
   * failure means and logs it once.
   */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  /** One place where a provider error becomes a 503 and a log line. */
  private async call<T>(operation: string, key: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      // The key is logged and the bucket is not: the key is ours, the
      // bucket name is infrastructure. Neither reaches the response.
      this.logger.error({ err: error, operation, key }, 'Object storage operation failed');

      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, {
        message: 'File storage is unavailable',
        code: 'service_unavailable',
      });
    }
  }
}

/** `<kind>/<yyyy>/<mm>/<uuid><ext>` — see the class header. */
function keyFor(upload: FileUpload, id: string): string {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');

  return `${upload.kind}/${year}/${month}/${id}${extensionOf(upload.name)}`;
}

/**
 * The extension, for humans reading a bucket listing. Bounded and
 * character-restricted: the key is built from client input, and `../`
 * in a key is a path-traversal attempt against any store that maps keys
 * to a filesystem — MinIO does.
 */
function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name);

  return match?.[1] === undefined ? '' : `.${match[1].toLowerCase()}`;
}

/**
 * A filename safe to place inside a quoted header parameter.
 *
 * Quotes, backslashes, CR and LF are removed rather than escaped —
 * escaping is store-specific and this value has one job, which is to
 * suggest a name to a save dialog.
 */
function sanitizeFileName(name: string | undefined): string | null {
  if (name === undefined) return null;

  const cleaned = name.replace(/[\r\n"\\]/g, '').trim().slice(0, 120);

  return cleaned === '' ? null : cleaned;
}
