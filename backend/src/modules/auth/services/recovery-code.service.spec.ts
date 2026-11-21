import { describe, expect, it } from 'vitest';

import { ConfigService } from '../../../config';
import type { Env } from '../../../config';
import { EnvelopeService } from '../../../shared/crypto';

import { RecoveryCodeService, normalize } from './recovery-code.service';

/**
 * Recovery-code storage (owner decisions R1 and R5).
 *
 * Pure: no database. The e2e suite (`test/auth-recovery-code.e2e-spec.ts`)
 * drives the same service through the redemption route.
 */
const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const CODES = ['0a1b2-c3d4e', 'f5a6b-7c8d9', '01234-56789'];

function servicesWith(key: string): { codes: RecoveryCodeService; envelope: EnvelopeService } {
  const config = new ConfigService({ DATA_ENCRYPTION_KEY: key } as Env);
  const envelope = new EnvelopeService(config);
  return { codes: new RecoveryCodeService(config, envelope), envelope };
}

describe('RecoveryCodeService', () => {
  const { codes, envelope } = servicesWith(KEY);

  it('stores digests, never the codes, inside the envelope', () => {
    const sealed = codes.seal(CODES);
    const plaintext = envelope.decrypt(sealed);

    for (const code of CODES) {
      expect(plaintext).not.toContain(code);
      expect(plaintext).not.toContain(code.replace('-', ''));
    }
    expect(JSON.parse(plaintext)).toMatchObject({ v: 2 });
    // And the ciphertext itself carries neither.
    expect(Buffer.from(sealed).toString('utf8')).not.toContain(CODES[0]);
  });

  it('matches each issued code, and only that one', () => {
    const stored = codes.open(codes.seal(CODES));

    expect(stored).not.toBeNull();
    expect(stored!.digests).toHaveLength(3);
    expect(codes.match(stored!, CODES[0]!)).toBe(0);
    expect(codes.match(stored!, CODES[2]!)).toBe(2);
    expect(codes.match(stored!, 'aaaaa-bbbbb')).toBe(-1);
  });

  it('ignores case, spaces and the dash', () => {
    const stored = codes.open(codes.seal(CODES))!;

    expect(codes.match(stored, '0A1B2C3D4E')).toBe(0);
    expect(codes.match(stored, ' 0a1b2 c3d4e ')).toBe(0);
  });

  it('matches nothing that is not shaped like a code', () => {
    const stored = codes.open(codes.seal(CODES))!;

    for (const value of ['', '0a1b2', '0a1b2-c3d4e-ff', 'zzzzz-zzzzz', '123456']) {
      expect(codes.match(stored, value)).toBe(-1);
    }
    expect(normalize('123456')).toBeNull();
  });

  it('keys the digest, so a different deployment key matches nothing', () => {
    const other = servicesWith(OTHER_KEY).codes;
    const stored = codes.open(codes.seal(CODES))!;
    // The same plaintext digested under another key is a different value.
    const foreign = other.open(other.seal(CODES))!;

    expect(foreign.digests[0]).not.toBe(stored.digests[0]);
  });

  it('reads the legacy format (codes in the clear inside the envelope)', () => {
    const legacy = envelope.encrypt(JSON.stringify(CODES));
    const stored = codes.open(legacy)!;

    expect(stored.digests).toHaveLength(3);
    expect(codes.match(stored, CODES[1]!)).toBe(1);
  });

  it('writes back a reduced set that still matches the rest', () => {
    const stored = codes.open(codes.seal(CODES))!;
    const remaining = stored.digests.filter((_, index) => index !== 0);
    const rewritten = codes.open(codes.sealDigests(remaining))!;

    expect(rewritten.digests).toHaveLength(2);
    expect(codes.match(rewritten, CODES[0]!)).toBe(-1);
    expect(codes.match(rewritten, CODES[1]!)).toBe(0);
  });

  it('treats an absent, tampered or unrecognised payload as no codes', () => {
    const sealed = codes.seal(CODES);
    const tampered = new Uint8Array(sealed);
    tampered.set([(tampered.at(-1) ?? 0) ^ 0xff], tampered.length - 1);

    expect(codes.open(null)).toBeNull();
    expect(codes.open(tampered)).toBeNull();
    expect(codes.open(envelope.encrypt('{"v":3,"h":[]}'))).toBeNull();
    expect(codes.open(envelope.encrypt('not json'))).toBeNull();
  });
});
