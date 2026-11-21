import { describe, expect, it } from 'vitest';

import { PasswordService } from './password.service';

/**
 * Argon2id, as MG §11.1 requires (RM M6.1).
 */
describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('verifies the password it hashed and rejects a near miss', async () => {
    const stored = await passwords.hash('Medora123!');
    expect(await passwords.verify(stored, 'Medora123!')).toBe(true);
    expect(await passwords.verify(stored, 'Medora123')).toBe(false);
    expect(await passwords.verify(stored, 'medora123!')).toBe(false);
  });

  it('emits an argon2id hash carrying its own parameters', async () => {
    const stored = await passwords.hash('Medora123!');
    // The prefix is what lets a later milestone raise the cost without
    // invalidating hashes written today.
    expect(stored.startsWith('$argon2id$')).toBe(true);
    expect(stored).toContain('m=19456');
    expect(stored).toContain('t=2');
    expect(stored).toContain('p=1');
  });

  it('salts — two hashes of one password differ', async () => {
    const [first, second] = await Promise.all([
      passwords.hash('Medora123!'),
      passwords.hash('Medora123!'),
    ]);
    expect(first).not.toBe(second);
    expect(await passwords.verify(second, 'Medora123!')).toBe(true);
  });

  it('never stores the plaintext', async () => {
    expect(await passwords.hash('Medora123!')).not.toContain('Medora123!');
  });

  it('answers false for an unparseable stored hash rather than throwing', async () => {
    // One corrupt row must not turn login into a 500 — the endpoint's
    // contract is that every failure looks the same (API §1.2).
    expect(await passwords.verify('not-a-hash', 'Medora123!')).toBe(false);
    expect(await passwords.verify('', 'Medora123!')).toBe(false);
  });
});
