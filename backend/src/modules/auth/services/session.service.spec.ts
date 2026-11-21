import { describe, expect, it } from 'vitest';

import { ConfigService, type Env } from '../../../config';
import {
  EnvelopeService,
  sessionRefreshSuccessorAad,
  type EnvelopeFormat,
} from '../../../shared/crypto';

import { SecretService } from './secret.service';
import {
  decideRefresh,
  type LockedSessionRow,
  openSuccessor,
  REFRESH_GRACE_WINDOW_SECONDS,
  sealSuccessor,
} from './session.service';

/**
 * ADR-045's decision, over one locked row held in memory.
 *
 * `decideRefresh` is pure: everything time-dependent arrives already
 * decided by the database clock (`live`, `inGraceWindow`), so these specs
 * drive each branch directly — including the parts that need a second
 * `EnvelopeService` (key rotation, AAD). The e2e spec (`auth-refresh`)
 * proves the same rules, the lock and the clock against PostgreSQL.
 */
const KEY_A = Buffer.alloc(32, 3).toString('base64');
const KEY_B = Buffer.alloc(32, 5).toString('base64');
const SESSION_ID = '0b9f6a52-3c1e-4d2a-9f00-5c7d2e8a1b11';
const OTHER_SESSION_ID = '1c0a7b63-4d2f-4e3b-8a11-6d8e3f9b2c22';
const USER_ID = '7c2d1e00-8a9b-4c3d-b1e2-f3a4b5c6d7e8';

function envelopeWith(
  key: string,
  previous: readonly string[] = [],
  format: EnvelopeFormat = 'legacy',
): EnvelopeService {
  return new EnvelopeService(
    new ConfigService({
      DATA_ENCRYPTION_KEY: key,
      DATA_ENCRYPTION_KEY_PREVIOUS: [...previous],
      DATA_ENCRYPTION_WRITE_FORMAT: format,
    } as unknown as Env),
  );
}

const secrets = new SecretService();

/**
 * The row just after `first` was rotated to `second`, inside the window:
 * every grace check passes unless a spec breaks one.
 */
function rotatedRow(envelope: EnvelopeService) {
  const first = secrets.randomToken();
  const second = secrets.randomToken();
  const row: LockedSessionRow = {
    id: SESSION_ID,
    userId: USER_ID,
    refreshTokenHash: secrets.hash(second),
    previousTokenHash: secrets.hash(first),
    rememberMe: false,
    successorTokenCt: sealSuccessor(envelope, {
      v: 1,
      sid: SESSION_ID,
      prev: secrets.hash(first),
      token: second,
    }),
    revoked: false,
    live: true,
    inGraceWindow: true,
    remainingSeconds: 43_000,
    accountActive: true,
  };
  return { first, second, row };
}

function decide(row: LockedSessionRow, presented: string, envelope: EnvelopeService) {
  return decideRefresh(row, secrets.hash(presented), secrets, (ciphertext) =>
    openSuccessor(envelope, ciphertext, row.id),
  );
}

describe('the grace window', () => {
  it('is 30 seconds — the owner-approved bound (ADR-045)', () => {
    expect(REFRESH_GRACE_WINDOW_SECONDS).toBe(30);
  });

  it('re-delivers the successor while the database says the row is inside it', () => {
    const envelope = envelopeWith(KEY_A);
    const { first, second, row } = rotatedRow(envelope);

    expect(decide(row, first, envelope)).toEqual({ kind: 'grace', refreshToken: second });
  });

  it('is reuse once the database says the window has closed — whether or not the sweep ran', () => {
    const envelope = envelopeWith(KEY_A);
    const { first, row } = rotatedRow(envelope);

    // The ciphertext is still on the row (no sweep yet), and still valid.
    expect(decide({ ...row, inGraceWindow: false }, first, envelope)).toEqual({ kind: 'reuse' });
  });
});

describe('the current token', () => {
  it('rotates on a live session of an active account', () => {
    const envelope = envelopeWith(KEY_A);
    const { second, row } = rotatedRow(envelope);
    expect(decide(row, second, envelope)).toEqual({ kind: 'rotate' });
  });

  it('is refused, not reuse, on a revoked or expired session', () => {
    const envelope = envelopeWith(KEY_A);
    const { second, row } = rotatedRow(envelope);
    expect(decide({ ...row, revoked: true }, second, envelope)).toEqual({ kind: 'refuse' });
    expect(decide({ ...row, live: false }, second, envelope)).toEqual({ kind: 'refuse' });
  });

  it('ends the session of an account that is no longer active', () => {
    const envelope = envelopeWith(KEY_A);
    const { second, row } = rotatedRow(envelope);
    expect(decide({ ...row, accountActive: false }, second, envelope)).toEqual({
      kind: 'deactivate',
    });
  });

  it('refuses a hash that is neither current nor previous', () => {
    const envelope = envelopeWith(KEY_A);
    const { row } = rotatedRow(envelope);
    expect(decide(row, 'a-token-nobody-ever-issued', envelope)).toEqual({ kind: 'refuse' });
  });
});

describe('the successor survives a DATA_ENCRYPTION_KEY rotation', () => {
  it.each<EnvelopeFormat>(['legacy', 'keyed'])(
    'opens a %s envelope sealed under the key now in DATA_ENCRYPTION_KEY_PREVIOUS',
    (format) => {
      const { first, second, row } = rotatedRow(envelopeWith(KEY_A, [], format));
      // The deployment moved KEY_A to the previous ring and made KEY_B current.
      const afterRotation = envelopeWith(KEY_B, [KEY_A], format);

      expect(decide(row, first, afterRotation)).toEqual({ kind: 'grace', refreshToken: second });
    },
  );

  it('re-sealed with the same AAD (as the re-encryption tool does), it opens under the new key alone', () => {
    const { first, second, row } = rotatedRow(envelopeWith(KEY_A));
    const afterRotation = envelopeWith(KEY_B, [KEY_A], 'keyed');
    const resealed = afterRotation.reseal(
      row.successorTokenCt ?? new Uint8Array(),
      sessionRefreshSuccessorAad(SESSION_ID),
    );
    expect(resealed).not.toBeNull();

    // Now under KEY_B alone: the old key can be retired.
    const keyBOnly = envelopeWith(KEY_B, [], 'keyed');
    expect(decide({ ...row, successorTokenCt: resealed }, first, keyBOnly)).toEqual({
      kind: 'grace',
      refreshToken: second,
    });
  });

  it('fails closed — reuse, no throw — once the sealing key has left the ring', () => {
    const { first, row } = rotatedRow(envelopeWith(KEY_A));
    expect(decide(row, first, envelopeWith(KEY_B))).toEqual({ kind: 'reuse' });
  });
});

describe('the AAD binds the ciphertext to its session and purpose', () => {
  it('does not open without the AAD, nor under another session id', () => {
    const envelope = envelopeWith(KEY_A);
    const { row } = rotatedRow(envelope);
    const ciphertext = row.successorTokenCt ?? new Uint8Array();

    expect(() => envelope.decrypt(ciphertext)).toThrow();
    expect(() =>
      envelope.decrypt(ciphertext, sessionRefreshSuccessorAad(OTHER_SESSION_ID)),
    ).toThrow();
    expect(openSuccessor(envelope, ciphertext, OTHER_SESSION_ID)).toBeNull();
    expect(openSuccessor(envelope, ciphertext, SESSION_ID)?.sid).toBe(SESSION_ID);
  });

  it('is reuse when a valid ciphertext sealed for another session is copied onto this row', () => {
    const envelope = envelopeWith(KEY_A);
    const { first, second, row } = rotatedRow(envelope);
    // Even with this row's retired hash and successor inside it: the AAD
    // names the other session, so GCM refuses it here.
    const copied = sealSuccessor(envelope, {
      v: 1,
      sid: OTHER_SESSION_ID,
      prev: secrets.hash(first),
      token: second,
    });

    expect(decide({ ...row, successorTokenCt: copied }, first, envelope)).toEqual({
      kind: 'reuse',
    });
  });

  it('is reuse for an envelope sealed without the AAD (the pre-review format)', () => {
    const envelope = envelopeWith(KEY_A);
    const { first, second, row } = rotatedRow(envelope);
    const unbound = envelope.encrypt(
      JSON.stringify({ v: 1, sid: SESSION_ID, prev: secrets.hash(first), token: second }),
    );

    expect(decide({ ...row, successorTokenCt: unbound }, first, envelope)).toEqual({
      kind: 'reuse',
    });
  });
});

describe('every other grace check fails closed', () => {
  it('is reuse once the successor is no longer the current token (never a stale successor)', () => {
    const envelope = envelopeWith(KEY_A);
    const { first, row } = rotatedRow(envelope);
    // The successor moved on; this ciphertext still names the old one.
    const moved = { ...row, refreshTokenHash: secrets.hash(secrets.randomToken()) };

    expect(decide(moved, first, envelope)).toEqual({ kind: 'reuse' });
  });

  it('is reuse for a revoked session', () => {
    const envelope = envelopeWith(KEY_A);
    const { first, row } = rotatedRow(envelope);
    expect(decide({ ...row, revoked: true }, first, envelope)).toEqual({ kind: 'reuse' });
  });

  it('is reuse for an expired session', () => {
    const envelope = envelopeWith(KEY_A);
    const { first, row } = rotatedRow(envelope);
    expect(decide({ ...row, live: false }, first, envelope)).toEqual({ kind: 'reuse' });
  });

  it('is reuse when the envelope names another retired hash', () => {
    const envelope = envelopeWith(KEY_A);
    const { first, second, row } = rotatedRow(envelope);
    const wrongPrev = sealSuccessor(envelope, {
      v: 1,
      sid: SESSION_ID,
      prev: '0'.repeat(64),
      token: second,
    });
    expect(decide({ ...row, successorTokenCt: wrongPrev }, first, envelope)).toEqual({
      kind: 'reuse',
    });
  });

  it('is reuse when the ciphertext is missing, tampered with, or not an envelope', () => {
    const envelope = envelopeWith(KEY_A);
    const { first, row } = rotatedRow(envelope);
    const tampered = Uint8Array.from(row.successorTokenCt ?? []);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0x01;
    const garbage = envelope.encrypt('not json at all', sessionRefreshSuccessorAad(SESSION_ID));

    for (const successorTokenCt of [null, tampered, garbage]) {
      expect(decide({ ...row, successorTokenCt }, first, envelope)).toEqual({ kind: 'reuse' });
    }
  });

  it('ends the session of an inactive account even inside the window, without a reuse verdict', () => {
    const envelope = envelopeWith(KEY_A);
    const { first, row } = rotatedRow(envelope);
    expect(decide({ ...row, accountActive: false }, first, envelope)).toEqual({
      kind: 'deactivate',
    });
  });
});
