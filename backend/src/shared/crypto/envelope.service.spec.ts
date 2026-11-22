import { createCipheriv, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ConfigService } from '../../config';
import type { Env } from '../../config';

import { createDecipheriv } from 'node:crypto';

import {
  EnvelopeDecryptError,
  type EnvelopeFormat,
  EnvelopeService,
  fingerprint,
} from './envelope.service';

/**
 * Encryption at rest for the second factor (RM M6.4, DB §10).
 */
const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');

const THIRD_KEY = Buffer.alloc(32, 11).toString('base64');

/**
 * Defaults to the keyed write format: the cases below that predate the
 * write-format phase (review finding F2) were written against keyed
 * writes, and keep testing exactly that. The production default, legacy,
 * has its own block at the end.
 */
function envelopeWith(
  key: string,
  previous: readonly string[] = [],
  format: EnvelopeFormat = 'keyed',
): EnvelopeService {
  return new EnvelopeService(
    new ConfigService({
      DATA_ENCRYPTION_KEY: key,
      DATA_ENCRYPTION_KEY_PREVIOUS: [...previous],
      DATA_ENCRYPTION_WRITE_FORMAT: format,
    } as unknown as Env),
  );
}

/**
 * The envelope every row written before key rotation existed holds:
 * `iv ‖ authTag ‖ ciphertext`, no header, no additional data. Built by
 * hand rather than by the service, because the service no longer writes it.
 */
function legacySeal(key: string, plaintext: string): Uint8Array {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return new Uint8Array(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]));
}

/** Corrupts one byte in place. `readUInt8`/`writeUInt8` rather than
 * indexing, which `noUncheckedIndexedAccess` types as possibly undefined. */
function flipByte(bytes: Uint8Array, index: number): void {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  buffer.writeUInt8(buffer.readUInt8(index) ^ 0xff, index);
}

describe('EnvelopeService', () => {
  const envelope = envelopeWith(KEY);

  it('round-trips a TOTP secret', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    expect(envelope.decrypt(envelope.encrypt(secret))).toBe(secret);
  });

  it('round-trips a multi-line recovery-code block', () => {
    const codes = ['a1b2-c3d4', 'e5f6-g7h8', 'i9j0-k1l2'].join('\n');
    expect(envelope.decrypt(envelope.encrypt(codes))).toBe(codes);
  });

  it('never emits the plaintext in the ciphertext', () => {
    const ciphertext = Buffer.from(envelope.encrypt('JBSWY3DPEHPK3PXP'));
    expect(ciphertext.toString('utf8')).not.toContain('JBSWY3DPEHPK3PXP');
    expect(ciphertext.toString('base64')).not.toContain('JBSWY3DPEHPK3PXP');
  });

  it('produces a different ciphertext each time — the IV is fresh', () => {
    // Reusing an IV under one key is the single fatal misuse of GCM. Two
    // encryptions of the same plaintext colliding would prove it happened.
    const first = envelope.encrypt('same');
    const second = envelope.encrypt('same');
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
    expect(envelope.decrypt(first)).toBe(envelope.decrypt(second));
  });

  it('refuses a payload whose ciphertext was edited', () => {
    const ciphertext = envelope.encrypt('JBSWY3DPEHPK3PXP');
    flipByte(ciphertext, ciphertext.length - 1);
    // GCM authenticates: a tampered row fails to decrypt rather than
    // yielding a different, valid-looking secret.
    expect(() => envelope.decrypt(ciphertext)).toThrow();
  });

  it('refuses a payload whose auth tag was edited', () => {
    const ciphertext = envelope.encrypt('JBSWY3DPEHPK3PXP');
    flipByte(ciphertext, 13);
    expect(() => envelope.decrypt(ciphertext)).toThrow();
  });

  it('refuses a payload encrypted under a different key', () => {
    const ciphertext = envelopeWith(OTHER_KEY).encrypt('JBSWY3DPEHPK3PXP');
    expect(() => envelope.decrypt(ciphertext)).toThrow();
  });

  it('refuses a payload too short to hold an IV and tag', () => {
    expect(() => envelope.decrypt(new Uint8Array(12))).toThrow(/too short/);
  });
});

describe('EnvelopeService — keyed format', () => {
  const envelope = envelopeWith(KEY);

  it("writes a version byte and the current key's fingerprint", () => {
    const sealed = Buffer.from(envelope.encrypt('JBSWY3DPEHPK3PXP'));
    expect(sealed.readUInt8(0)).toBe(0x02);
    expect(sealed.subarray(1, 9).equals(fingerprint(Buffer.from(KEY, 'base64')))).toBe(true);
    // header 9 + iv 12 + tag 16 + 16 bytes of plaintext
    expect(sealed.length).toBe(9 + 12 + 16 + 16);
  });

  it('fingerprints different keys differently and the same key the same', () => {
    const a = fingerprint(Buffer.from(KEY, 'base64'));
    expect(a.equals(fingerprint(Buffer.from(KEY, 'base64')))).toBe(true);
    expect(a.equals(fingerprint(Buffer.from(OTHER_KEY, 'base64')))).toBe(false);
    expect(a.length).toBe(8);
  });

  it('refuses a key id edited to name another key of the ring', () => {
    // Both keys are in the ring, so the edited header names a key this
    // instance holds; it is tried under that key and refused, then tried
    // as a legacy envelope under every key and refused again.
    const ring = envelopeWith(KEY, [OTHER_KEY]);
    const sealed = ring.encrypt('JBSWY3DPEHPK3PXP');
    fingerprint(Buffer.from(OTHER_KEY, 'base64')).copy(Buffer.from(sealed.buffer), 1);
    expect(() => ring.decrypt(sealed)).toThrow(EnvelopeDecryptError);
  });

  it('refuses an edited version byte', () => {
    const sealed = envelope.encrypt('JBSWY3DPEHPK3PXP');
    flipByte(sealed, 0);
    expect(() => envelope.decrypt(sealed)).toThrow(EnvelopeDecryptError);
  });

  it('round-trips the empty string, the shortest keyed envelope', () => {
    expect(envelope.decrypt(envelope.encrypt(''))).toBe('');
  });

  it('reports a fresh envelope as current, with nothing to re-seal', () => {
    const sealed = envelope.encrypt('x');
    expect(envelope.inspect(sealed)).toEqual({ current: true, keyIndex: 0, format: 'keyed' });
    expect(envelope.reseal(sealed)).toBeNull();
  });
});

describe('EnvelopeService — legacy envelopes', () => {
  it('still opens an envelope written before the keyed format', () => {
    const envelope = envelopeWith(KEY);
    const sealed = legacySeal(KEY, 'JBSWY3DPEHPK3PXP');
    expect(envelope.decrypt(sealed)).toBe('JBSWY3DPEHPK3PXP');
    expect(envelope.inspect(sealed)).toEqual({ current: false, keyIndex: 0, format: 'legacy' });
  });

  it('re-seals a legacy envelope into the keyed format under the current key', () => {
    const envelope = envelopeWith(KEY);
    const resealed = envelope.reseal(legacySeal(KEY, 'JBSWY3DPEHPK3PXP'));
    expect(resealed).not.toBeNull();
    if (resealed === null) return;
    expect(envelope.decrypt(resealed)).toBe('JBSWY3DPEHPK3PXP');
    expect(envelope.inspect(resealed).current).toBe(true);
  });

  it('opens a legacy envelope whose random IV happens to look like a keyed header', () => {
    // The 2⁻⁷² case, forced: a legacy IV beginning 0x02 ‖ fingerprint(KEY).
    // The keyed reading fails authentication; the legacy reading opens it.
    const key = Buffer.from(KEY, 'base64');
    const iv = Buffer.concat([Buffer.of(0x02), fingerprint(key), randomBytes(3)]);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update('collision', 'utf8'), cipher.final()]);
    const sealed = new Uint8Array(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]));

    const envelope = envelopeWith(KEY);
    expect(envelope.decrypt(sealed)).toBe('collision');
    expect(envelope.inspect(sealed).format).toBe('legacy');
  });
});

describe('EnvelopeService — rotation', () => {
  it('decrypts under a previous key and encrypts only under the current one', () => {
    const before = envelopeWith(OTHER_KEY);
    const keyed = before.encrypt('sealed-before-rotation');
    const legacy = legacySeal(OTHER_KEY, 'legacy-before-rotation');

    const after = envelopeWith(KEY, [OTHER_KEY]);
    expect(after.previousKeyCount).toBe(1);
    expect(after.decrypt(keyed)).toBe('sealed-before-rotation');
    expect(after.decrypt(legacy)).toBe('legacy-before-rotation');
    expect(after.inspect(keyed)).toEqual({ current: false, keyIndex: 1, format: 'keyed' });
    expect(after.inspect(legacy)).toEqual({ current: false, keyIndex: 1, format: 'legacy' });

    // What it writes, the retired key cannot read.
    expect(() => before.decrypt(after.encrypt('new'))).toThrow(EnvelopeDecryptError);
  });

  it('re-seals an envelope from a previous key so the current key alone opens it', () => {
    const sealed = envelopeWith(OTHER_KEY).encrypt('JBSWY3DPEHPK3PXP');
    const rotating = envelopeWith(KEY, [OTHER_KEY]);

    const resealed = rotating.reseal(sealed);
    expect(resealed).not.toBeNull();
    if (resealed === null) return;

    // The step that ends a rotation: the previous key is removed.
    const rotated = envelopeWith(KEY);
    expect(rotated.decrypt(resealed)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => rotated.decrypt(sealed)).toThrow(EnvelopeDecryptError);
  });

  it('tries every previous key, in order', () => {
    const sealed = envelopeWith(THIRD_KEY).encrypt('oldest');
    const ring = envelopeWith(KEY, [OTHER_KEY, THIRD_KEY]);
    expect(ring.decrypt(sealed)).toBe('oldest');
    expect(ring.inspect(sealed).keyIndex).toBe(2);
  });

  it('refuses an envelope sealed under a key that has left the ring', () => {
    const sealed = envelopeWith(THIRD_KEY).encrypt('x');
    const ring = envelopeWith(KEY, [OTHER_KEY]);
    expect(() => ring.decrypt(sealed)).toThrow(EnvelopeDecryptError);
    expect(() => ring.reseal(sealed)).toThrow(EnvelopeDecryptError);
    expect(() => ring.decrypt(legacySeal(THIRD_KEY, 'x'))).toThrow(EnvelopeDecryptError);
  });

  it('refuses a tampered envelope even when a previous key is configured', () => {
    const ring = envelopeWith(KEY, [OTHER_KEY]);
    const sealed = envelopeWith(OTHER_KEY).encrypt('JBSWY3DPEHPK3PXP');
    flipByte(sealed, sealed.length - 1);
    expect(() => ring.decrypt(sealed)).toThrow(EnvelopeDecryptError);
  });
});

/**
 * What a build from before the keyring does to an envelope, transcribed
 * from `envelope.service.ts` at `origin/backend` `bbb5377`: one key, the
 * legacy layout, no additional data, and anything of 28 bytes or fewer
 * refused. If this opens a value, an older instance serving during a
 * rolling deploy or after a rollback opens it too.
 */
function preKeyringDecrypt(key: string, payload: Uint8Array): string {
  const buffer = Buffer.from(payload);
  if (buffer.length <= 28) throw new Error('too short');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'base64'),
    buffer.subarray(0, 12),
  );
  decipher.setAuthTag(buffer.subarray(12, 28));
  return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
}

describe('EnvelopeService — the write-format phase (review finding F2)', () => {
  it('writes the legacy layout when DATA_ENCRYPTION_WRITE_FORMAT is not set at all', () => {
    const unset = new EnvelopeService(
      new ConfigService({ DATA_ENCRYPTION_KEY: KEY } as unknown as Env),
    );
    expect(unset.writeFormat).toBe('legacy');
    const sealed = unset.encrypt('JBSWY3DPEHPK3PXP');
    expect(sealed.length).toBe(12 + 16 + 16);
    expect(unset.inspect(sealed)).toEqual({ current: true, keyIndex: 0, format: 'legacy' });
  });

  it('phase 1: everything it writes, a pre-keyring build opens', () => {
    const phase1 = envelopeWith(KEY, [], 'legacy');
    for (const plaintext of ['JBSWY3DPEHPK3PXP', '{"v":2,"h":["a","b"]}', 'é ✓ multi-byte']) {
      expect(preKeyringDecrypt(KEY, phase1.encrypt(plaintext))).toBe(plaintext);
    }
  });

  it('phase 2 output is exactly what a pre-keyring build cannot open — why it is opt-in', () => {
    const phase2 = envelopeWith(KEY, [], 'keyed');
    expect(() => preKeyringDecrypt(KEY, phase2.encrypt('JBSWY3DPEHPK3PXP'))).toThrow();
  });

  it('phase 1 still reads what phase 2 wrote, and calls it non-conforming', () => {
    const keyed = envelopeWith(KEY, [], 'keyed').encrypt('written-in-phase-2');
    const phase1 = envelopeWith(KEY, [], 'legacy');
    expect(phase1.decrypt(keyed)).toBe('written-in-phase-2');
    expect(phase1.inspect(keyed)).toEqual({ current: false, keyIndex: 0, format: 'keyed' });
  });

  it('going back from phase 2: a legacy re-seal of a keyed envelope opens on a pre-keyring build', () => {
    const keyed = envelopeWith(KEY, [], 'keyed').encrypt('JBSWY3DPEHPK3PXP');
    const resealed = envelopeWith(KEY, [], 'legacy').reseal(keyed);
    expect(resealed).not.toBeNull();
    if (resealed === null) return;
    expect(preKeyringDecrypt(KEY, resealed)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('rotates in the legacy format: an old build given only the new key reads every re-sealed value', () => {
    const before = legacySeal(OTHER_KEY, 'sealed-under-the-old-key');
    const rotating = envelopeWith(KEY, [OTHER_KEY], 'legacy');
    expect(rotating.inspect(before)).toEqual({ current: false, keyIndex: 1, format: 'legacy' });

    const resealed = rotating.reseal(before);
    expect(resealed).not.toBeNull();
    if (resealed === null) return;
    expect(rotating.inspect(resealed)).toEqual({ current: true, keyIndex: 0, format: 'legacy' });
    expect(preKeyringDecrypt(KEY, resealed)).toBe('sealed-under-the-old-key');
    expect(rotating.reseal(resealed)).toBeNull();
  });

  it('keeps an empty value readable when a keyed one is re-sealed into the legacy layout', () => {
    // 28 bytes: IV and tag only. Builds before this one refused that
    // length, so a keyed '' would have become unreadable on the way back.
    const keyed = envelopeWith(KEY, [], 'keyed').encrypt('');
    const resealed = envelopeWith(KEY, [], 'legacy').reseal(keyed);
    expect(resealed?.length).toBe(28);
    if (resealed === null) return;
    expect(envelopeWith(KEY, [], 'legacy').decrypt(resealed)).toBe('');
  });

  it('names the current key by its fingerprint', () => {
    expect(envelopeWith(KEY).currentKeyId).toBe(
      fingerprint(Buffer.from(KEY, 'base64')).toString('hex'),
    );
  });
});

/**
 * Optional caller AAD (ADR-045). Omitted, nothing changes: the same bytes
 * open, and an envelope written before the parameter existed opens.
 * Given, it is required verbatim to open, re-seal or inspect.
 */
describe('caller-supplied additional data', () => {
  it.each<EnvelopeFormat>(['legacy', 'keyed'])(
    'round-trips under the same AAD and refuses any other, or none (%s)',
    (format) => {
      const envelope = envelopeWith(KEY, [], format);
      const sealed = envelope.encrypt('payload', 'context:a');

      expect(envelope.decrypt(sealed, 'context:a')).toBe('payload');
      expect(() => envelope.decrypt(sealed, 'context:b')).toThrow(EnvelopeDecryptError);
      expect(() => envelope.decrypt(sealed)).toThrow(EnvelopeDecryptError);
      expect(() => envelope.inspect(sealed)).toThrow(EnvelopeDecryptError);
    },
  );

  it('leaves AAD-less envelopes exactly as they were: an unbound seal opens with no AAD only', () => {
    const envelope = envelopeWith(KEY, [], 'keyed');
    const sealed = envelope.encrypt('payload');

    expect(envelope.decrypt(sealed)).toBe('payload');
    expect(() => envelope.decrypt(sealed, 'context:a')).toThrow(EnvelopeDecryptError);
    // A pre-keyring legacy envelope, too.
    expect(envelope.decrypt(legacySeal(KEY, 'old'))).toBe('old');
  });

  it('opens under a previous key with the AAD, and re-seals under the current key keeping it', () => {
    const before = envelopeWith(KEY, [], 'keyed');
    const sealed = before.encrypt('payload', 'context:a');
    const during = envelopeWith(OTHER_KEY, [KEY], 'keyed');

    expect(during.decrypt(sealed, 'context:a')).toBe('payload');
    expect(during.inspect(sealed, 'context:a').current).toBe(false);
    const resealed = during.reseal(sealed, 'context:a');
    expect(resealed).not.toBeNull();

    const after = envelopeWith(OTHER_KEY, [], 'keyed');
    expect(after.decrypt(resealed ?? new Uint8Array(), 'context:a')).toBe('payload');
    expect(after.inspect(resealed ?? new Uint8Array(), 'context:a').current).toBe(true);
    expect(() => after.decrypt(resealed ?? new Uint8Array())).toThrow(EnvelopeDecryptError);
  });
});
