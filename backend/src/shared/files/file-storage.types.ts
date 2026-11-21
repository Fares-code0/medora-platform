/**
 * The object-storage port (RM M2.3, implemented at M25, API §17).
 *
 * Storage is the clearest case for a port. Six attachment surfaces reach
 * for it — profile photos, patient documents, record and lab
 * attachments, message attachments, verification documents, branding
 * assets (API §17.1) — and each of them lands in a different milestone,
 * all of them before or alongside M25. Without a port they would each
 * grow their own S3 client.
 *
 * The interface is deliberately S3-shaped but not S3-specific: MinIO in
 * development, S3-compatible in production (MG §3.2). Nothing here
 * mentions a bucket, because which bucket a `kind` writes to is M25's
 * decision, not the caller's.
 */

/** The upload kinds of API §17.1, which drive per-kind size/type rules. */
export const FILE_KINDS = [
  'profile_photo',
  'patient_document',
  'record_attachment',
  'lab_attachment',
  'message_attachment',
  'verification_document',
  'branding_asset',
] as const;

export type FileKind = (typeof FILE_KINDS)[number];

/**
 * Malware-scan state. API §17.2 requires download to answer 403
 * `scan_pending` until a file is `clean`, so the state is part of the
 * stored object's identity rather than a detail of the scanner.
 */
export type FileScanStatus = 'pending' | 'clean' | 'infected';

export interface StoredFile {
  readonly id: string;
  /** Storage key. Opaque to callers — never build one by hand. */
  readonly key: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly scanStatus: FileScanStatus;
}

export interface FileUpload {
  readonly kind: FileKind;
  readonly name: string;
  readonly mimeType: string;
  readonly content: Buffer;
}

/**
 * How the browser should present the downloaded object.
 *
 * Added at M25.2, because API §17.2 requires `Content-Disposition` to be
 * set and a bare key cannot carry a filename. Optional so the M19 call
 * site that predates it keeps compiling; a download with no name is
 * still a download, it just arrives named after its storage key.
 */
export interface DownloadOptions {
  readonly fileName?: string;
  /** `attachment` forces a save dialog; `inline` lets the browser render. */
  readonly disposition?: 'attachment' | 'inline';
}

export interface FileStoragePort {
  put(upload: FileUpload): Promise<StoredFile>;
  /**
   * A short-TTL signed URL, not the bytes. Streaming every attachment
   * through the API turns the app into a file server and puts PHI in
   * application logs' response timings for no benefit.
   */
  signedDownloadUrl(
    key: string,
    ttlSeconds: number,
    options?: DownloadOptions,
  ): Promise<string>;
  /**
   * The bytes back, for a caller inside the platform (RM M30.2).
   *
   * Deliberately added last and deliberately narrow. Every *client* read
   * goes through `signedDownloadUrl` — streaming attachments through the
   * API turns it into a file server and puts PHI in response timings —
   * and that stays true: this exists for the malware scanner, which has
   * to hand an engine the actual object and cannot be sent a URL it
   * would then have to fetch as an anonymous client.
   *
   * No caller under `src/modules/**` may use it to serve a download; the
   * two download surfaces are unchanged and still sign.
   */
  get(key: string): Promise<Buffer>;
  /**
   * Storage-side removal. The soft delete of API §17.3 is the `files`
   * row; this is the object, and M25.5's sweep is what calls it.
   *
   * Idempotent by contract: removing an object that is not there
   * succeeds. The sweep runs repeatedly over the same rows and must not
   * fail on the second pass.
   */
  remove(key: string): Promise<void>;
  /**
   * Reachability, for `GET /health`'s `storage` key (ADR-016 §4: "M25
   * storage"). Resolves when the bucket answers; rejects otherwise.
   *
   * Optional by design: an adapter that cannot say whether it is reachable
   * — the test doubles, or the unconfigured binding — omits it, and health
   * reports `unconfigured` for it rather than a guess.
   */
  ping?(): Promise<void>;
}

/**
 * How long a signed download URL lives (API §17.2's "short-TTL").
 *
 * One constant in the kernel rather than one per module, and that is a
 * correction rather than a tidy-up: M20.4 chose 60 seconds and M25
 * independently wrote 300, so the platform had two answers to "how long
 * is a leaked link dangerous for" and no way to notice. The stricter of
 * the two wins — 60 seconds is long enough for a click to become a fetch
 * and short enough that a URL in a browser history is dead before anyone
 * finds it.
 */
export const DOWNLOAD_TTL_SECONDS = 60;

/** DI token — inject the interface, never a concrete class. */
export const FILE_STORAGE = Symbol('FILE_STORAGE');
