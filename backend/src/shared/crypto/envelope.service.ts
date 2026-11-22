import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { ConfigService } from '../../config';

/**
 * Application-layer encryption at rest (RM M6.4, DB §10).
 *
 * The TOTP secret and the recovery codes are the only values in the
 * schema that must be **recoverable** rather than merely verifiable: the
 * server has to re-derive the same 6-digit code the user's authenticator
 * shows, so a hash is useless. DB §10 classes them "never in API
 * responses; write-only in the UI", and `user_credentials` stores both
 * as `bytea` — ciphertext, not text, so nothing casts one into a log
 * line by accident.
 *
 * ## Format
 *
 * Two layouts are read, always. Which one is **written** is
 * `DATA_ENCRYPTION_WRITE_FORMAT` — `legacy` unless a deployment says
 * otherwise (see *Rollout* below).
 *
 * - **Legacy:** `iv (12) ‖ authTag (16) ‖ ciphertext`. No header, so
 *   nothing in the bytes says which key sealed it. Every build before key
 *   rotation existed reads and writes only this shape.
 * - **Keyed:** `0x02 ‖ keyId (8) ‖ iv (12) ‖ authTag (16) ‖ ciphertext`.
 *   `keyId` is a fingerprint of the sealing key (see `fingerprint`), and
 *   the 9-byte header is bound as GCM additional data, so a header edited
 *   to point at another key fails authentication instead of being
 *   believed.
 *
 * AES-256-GCM rather than CBC because it authenticates: a row edited in
 * the database fails to decrypt instead of yielding a different,
 * valid-looking secret. The IV is random per encryption and stored
 * alongside — GCM's one fatal misuse is reusing an IV under the same key,
 * and a stored random IV cannot be reused by construction.
 *
 * ## Rollout (two phases — review finding F2)
 *
 * A build older than this one reads only the legacy layout, under one key.
 * A keyed envelope written while such a build is still serving, or before
 * a rollback to one, is a second factor that build cannot open: its user
 * is locked out there. So the keyed layout is never written by default.
 *
 * 1. **Phase 1 (default, `legacy`)** — this build reads both layouts and
 *    writes legacy. Every envelope it writes is one an older build opens,
 *    so a rolling deploy and a rollback are both safe.
 * 2. **Phase 2 (`keyed`, explicit)** — set only once no build older than
 *    this one will serve again. To go back, set `legacy` and run
 *    `npm run crypto:reencrypt`, which rewrites every keyed envelope into
 *    the legacy layout; then an older build can be deployed.
 *
 * Key rotation works in either phase: a legacy envelope carries no key id,
 * but it is still opened by trying each key in the ring.
 *
 * ## Key rotation (M37, PRODUCTION_SETUP §2.1)
 *
 * The service holds a **keyring**: `DATA_ENCRYPTION_KEY` is the current
 * key, the only one that ever encrypts; `DATA_ENCRYPTION_KEY_PREVIOUS` is
 * zero or more other keys that may still decrypt — retired ones during a
 * rotation, or the next one while it is being pre-staged. An envelope is
 * **conforming** when it opens under the current key *and* is in the
 * configured write format; `npm run crypto:reencrypt` rewrites every
 * envelope that is not (`EnvelopeReencryptionService`).
 *
 * Which key opens an envelope is decided by authentication, never by
 * guessing: a keyed envelope names its key, and a legacy one is tried
 * under each key in the ring, current first. A wrong key fails GCM's tag
 * check except with probability 2⁻¹²⁸, so "the first key that
 * authenticates" is the key that sealed it.
 *
 * The key is `DATA_ENCRYPTION_KEY`, deliberately not `JWT_SECRET`: see
 * that variable's own comment for why the two rotate differently.
 */
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEYED_VERSION = 0x02;
const KEY_ID_BYTES = 8;
const KEYED_HEADER_BYTES = 1 + KEY_ID_BYTES;

/**
 * Domain-separated so the fingerprint of a key is not the plain SHA-256
 * of it, which some other system might also publish. It leaks nothing
 * usable: recovering a 256-bit random key from 64 bits of a hash of it is
 * a preimage search over 2²⁵⁶ candidates.
 */
const FINGERPRINT_CONTEXT = 'medora/envelope-key-id/v1\0';

/** One key of the ring, with the identifier keyed envelopes carry. */
interface RingKey {
  readonly key: Buffer;
  readonly id: Buffer;
}

export const ENVELOPE_FORMATS = ['legacy', 'keyed'] as const;
export type EnvelopeFormat = (typeof ENVELOPE_FORMATS)[number];

/** Which key and layout opened an envelope. */
export interface EnvelopeInspection {
  /**
   * `true` when the envelope is conforming — under the current key, in the
   * configured write format — so there is nothing to re-seal.
   */
  readonly current: boolean;
  /** `0` is the current key; `1…` are the previous keys, in configured order. */
  readonly keyIndex: number;
  readonly format: EnvelopeFormat;
}

/**
 * No configured key authenticates the payload: it was edited, truncated,
 * or sealed under a key that is not in the ring.
 */
export class EnvelopeDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeDecryptError';
  }
}

/** The 8-byte identifier a keyed envelope carries for `key`. */
export function fingerprint(key: Buffer): Buffer {
  return createHash('sha256')
    .update(FINGERPRINT_CONTEXT, 'utf8')
    .update(key)
    .digest()
    .subarray(0, KEY_ID_BYTES);
}

@Injectable()
export class EnvelopeService {
  /** The current key. The only one that encrypts. */
  private readonly current: RingKey;
  /** `[current, ...previous]` — every key that may decrypt. */
  private readonly ring: readonly RingKey[];
  /** The layout `encrypt` writes (`DATA_ENCRYPTION_WRITE_FORMAT`). */
  readonly writeFormat: EnvelopeFormat;

  constructor(config: ConfigService) {
    const toRingKey = (encoded: string): RingKey => {
      const key = Buffer.from(encoded, 'base64');
      return { key, id: fingerprint(key) };
    };

    this.current = toRingKey(config.env.DATA_ENCRYPTION_KEY);
    this.ring = [this.current, ...(config.env.DATA_ENCRYPTION_KEY_PREVIOUS ?? []).map(toRingKey)];
    // `?? 'legacy'`: a partial `Env` built by hand (tests, tooling) gets
    // the safe phase, as the schema's default does.
    this.writeFormat = config.env.DATA_ENCRYPTION_WRITE_FORMAT ?? 'legacy';
  }

  /** How many non-current keys this instance can decrypt with. */
  get previousKeyCount(): number {
    return this.ring.length - 1;
  }

  /** Hex fingerprint of the current key — names it without revealing it. */
  get currentKeyId(): string {
    return this.current.id.toString('hex');
  }

  /**
   * Under the current key, in the configured write format.
   *
   * Returns a plain `Uint8Array`, not a `Buffer`.
   *
   * Prisma's `Bytes` input is typed `Uint8Array<ArrayBuffer>`, and a
   * Node `Buffer` is `Buffer<ArrayBufferLike>` — which includes
   * `SharedArrayBuffer` and therefore does not satisfy it. Copying into
   * a fresh view is one allocation and keeps the boundary honest,
   * instead of an assertion that would hide the difference.
   *
   * `aad` is optional caller context (ADR-045): bound as GCM additional
   * data, never stored, and required verbatim to open the envelope again.
   * Omitted, the bytes are exactly what this method wrote before the
   * parameter existed — every existing caller and stored envelope is
   * unchanged. In the keyed layout it is bound after the header.
   */
  encrypt(plaintext: string, aad?: string): Uint8Array<ArrayBuffer> {
    const keyed = this.writeFormat === 'keyed';
    const header = keyed
      ? Buffer.concat([Buffer.of(KEYED_VERSION), this.current.id])
      : Buffer.alloc(0);
    const iv = randomBytes(IV_BYTES);

    const cipher = createCipheriv('aes-256-gcm', this.current.key, iv);
    const bound = additionalData(keyed ? header : null, aad);
    if (bound !== null) cipher.setAAD(bound);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const envelope = Buffer.concat([header, iv, cipher.getAuthTag(), ciphertext]);

    const copy = new ArrayBuffer(envelope.byteLength);
    const view = new Uint8Array(copy);
    view.set(envelope);
    return view;
  }

  /**
   * Throws `EnvelopeDecryptError` on a tampered or truncated payload, or
   * one no key in the ring opens. Callers treat that as "this account has
   * no usable second factor" rather than swallowing it: silently
   * continuing would let a corrupted secret disable 2FA without anyone
   * noticing.
   *
   * `aad` must be what `encrypt` was given; any other value — including
   * omitting it — fails authentication like a tampered payload.
   */
  decrypt(payload: Uint8Array, aad?: string): string {
    return this.open(payload, aad).plaintext;
  }

  /** Which key and layout opened the envelope. Throws as `decrypt` does. */
  inspect(payload: Uint8Array, aad?: string): EnvelopeInspection {
    const { keyIndex, format } = this.open(payload, aad);
    return { current: this.conforms(keyIndex, format), keyIndex, format };
  }

  /**
   * The same plaintext sealed under the current key in the configured
   * write format, or `null` when the envelope already is. Throws as
   * `decrypt` does: a payload that cannot be opened cannot be re-sealed,
   * and must not be overwritten either. The re-sealed envelope is bound
   * to the same `aad` it was opened with.
   */
  reseal(payload: Uint8Array, aad?: string): Uint8Array<ArrayBuffer> | null {
    const opened = this.open(payload, aad);
    if (this.conforms(opened.keyIndex, opened.format)) return null;
    return this.encrypt(opened.plaintext, aad);
  }

  private conforms(keyIndex: number, format: EnvelopeFormat): boolean {
    return keyIndex === 0 && format === this.writeFormat;
  }

  private open(
    payload: Uint8Array,
    aad?: string,
  ): {
    plaintext: string;
    keyIndex: number;
    format: EnvelopeFormat;
  } {
    const buffer = Buffer.from(payload);

    // Exactly IV + tag is a legacy envelope of the empty string. Refusing
    // it (as builds before this one did) would make a keyed envelope of ''
    // unreadable once re-sealed into the legacy layout. No writer seals ''.
    if (buffer.length < IV_BYTES + AUTH_TAG_BYTES) {
      throw new EnvelopeDecryptError(
        'Encrypted payload is too short to contain an IV and auth tag',
      );
    }

    // A keyed envelope names its key. A legacy envelope begins with a
    // random IV, so it looks keyed under some ring key only by chance
    // (2⁻⁷² per key) — and even then GCM refuses the keyed reading and
    // the legacy loop below still opens it.
    if (
      buffer.length >= KEYED_HEADER_BYTES + IV_BYTES + AUTH_TAG_BYTES &&
      buffer.readUInt8(0) === KEYED_VERSION
    ) {
      const header = buffer.subarray(0, KEYED_HEADER_BYTES);
      const id = header.subarray(1);
      const keyIndex = this.ring.findIndex((entry) => entry.id.equals(id));
      const entry = this.ring[keyIndex];
      if (entry !== undefined) {
        const plaintext = tryOpen(
          entry.key,
          buffer.subarray(KEYED_HEADER_BYTES),
          additionalData(header, aad),
        );
        if (plaintext !== null) return { plaintext, keyIndex, format: 'keyed' };
      }
    }

    for (const [keyIndex, entry] of this.ring.entries()) {
      const plaintext = tryOpen(entry.key, buffer, additionalData(null, aad));
      if (plaintext !== null) return { plaintext, keyIndex, format: 'legacy' };
    }

    throw new EnvelopeDecryptError(
      'No configured encryption key opens this payload: it was edited, truncated, or sealed under a key in neither DATA_ENCRYPTION_KEY nor DATA_ENCRYPTION_KEY_PREVIOUS',
    );
  }
}

/**
 * The GCM additional data: the keyed header (a fixed 9 bytes, so the
 * concatenation is unambiguous) followed by the caller's context — or
 * `null` when there is neither, which is the layout every envelope sealed
 * before caller context existed used.
 */
function additionalData(header: Buffer | null, aad: string | undefined): Buffer | null {
  if (aad === undefined) return header;
  const context = Buffer.from(aad, 'utf8');
  return header === null ? context : Buffer.concat([header, context]);
}

/** `iv ‖ authTag ‖ ciphertext` under one key, or `null` if GCM refuses it. */
function tryOpen(key: Buffer, body: Buffer, aad: Buffer | null): string | null {
  const iv = body.subarray(0, IV_BYTES);
  const authTag = body.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = body.subarray(IV_BYTES + AUTH_TAG_BYTES);

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    if (aad !== null) decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
