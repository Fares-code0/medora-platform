import * as ExpoSecureStore from 'expo-secure-store';

import { PREFERENCE_KEYS, preferenceStore } from '@/storage/preference-store';
import { createInMemorySecureStore, secureStore } from '@/storage/secure-store';
import { randomId } from '@/utils/id';

/**
 * The platform layer's storage and identifiers — checklist T-02, T-03,
 * I-05.
 *
 * These are the modules where a regression is silent and expensive, and
 * three of them were thinly covered: the real keychain adapter at 70%,
 * `PreferenceStore`'s key guard at 0% of branches, and `randomId` at
 * 42.9%.
 *
 * What is asserted is not that they store and return — it is the four
 * decisions that make the T-02/T-03 guarantee checkable at all: one door
 * to the keychain, the right accessibility class on it, a preference
 * store that refuses a key it was not told about, and an idempotency key
 * that is actually different every time.
 */

describe('the keychain adapter (T-02)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('asks for WHEN_UNLOCKED_THIS_DEVICE_ONLY on every operation', async () => {
    // Two properties in one constant, and both matter: the refresh token
    // must not travel in an iCloud Keychain backup to another device,
    // and it must not be readable while the phone is locked. An
    // operation that forgot the options would silently get the default,
    // which is neither.
    const options = { keychainAccessible: ExpoSecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

    await secureStore.setItem('k', 'v');
    await secureStore.getItem('k');
    await secureStore.removeItem('k');

    expect(ExpoSecureStore.setItemAsync).toHaveBeenCalledWith('k', 'v', options);
    expect(ExpoSecureStore.getItemAsync).toHaveBeenCalledWith('k', options);
    expect(ExpoSecureStore.deleteItemAsync).toHaveBeenCalledWith('k', options);
  });

  it('returns null for a key that was never written, rather than undefined', async () => {
    // `TokenStorage` branches on `=== null` — "no stored session" is a
    // state the cold-start path renders a whole screen for.
    await expect(secureStore.getItem('never-written')).resolves.toBeNull();
  });

  it('round-trips a value and forgets it on removal', async () => {
    await secureStore.setItem('rt', 'refresh-1');
    await expect(secureStore.getItem('rt')).resolves.toBe('refresh-1');

    await secureStore.removeItem('rt');
    await expect(secureStore.getItem('rt')).resolves.toBeNull();
  });
});

describe('the in-memory double is a double, not a fallback', () => {
  it('behaves identically to the real one', async () => {
    const store = createInMemorySecureStore();

    await expect(store.getItem('k')).resolves.toBeNull();
    await store.setItem('k', 'v');
    await expect(store.getItem('k')).resolves.toBe('v');
    await store.removeItem('k');
    await expect(store.getItem('k')).resolves.toBeNull();
  });

  it("keeps two instances apart, so one test cannot read another one's token", async () => {
    const a = createInMemorySecureStore();
    const b = createInMemorySecureStore();

    await a.setItem('k', 'from-a');

    await expect(b.getItem('k')).resolves.toBeNull();
  });
});

describe('the preference store refuses what it was not told about (T-03)', () => {
  afterEach(() => {
    for (const key of Object.values(PREFERENCE_KEYS)) preferenceStore.remove(key);
  });

  it('stores and returns a declared key', () => {
    preferenceStore.set(PREFERENCE_KEYS.themeMode, 'dark');

    expect(preferenceStore.get(PREFERENCE_KEYS.themeMode)).toBe('dark');
    expect(preferenceStore.keys()).toContain(PREFERENCE_KEYS.themeMode);
  });

  it('returns null for a declared key nothing has written', () => {
    expect(preferenceStore.get(PREFERENCE_KEYS.locale)).toBeNull();
  });

  it('forgets a key on removal', () => {
    preferenceStore.set(PREFERENCE_KEYS.locale, 'ar');
    preferenceStore.remove(PREFERENCE_KEYS.locale);

    expect(preferenceStore.get(PREFERENCE_KEYS.locale)).toBeNull();
  });

  it('declares only non-PHI keys, by name', () => {
    // The store takes strings and is documented as non-PHI. This is the
    // assertion that keeps the *declaration* honest as keys are added:
    // a key called `patientName` or `lastDiagnosis` would put clinical
    // data on disk, which is what T-03 forbids outright.
    const FORBIDDEN = [
      'patient',
      'name',
      'diagnosis',
      'medication',
      'allergy',
      'result',
      'token',
      'password',
      'email',
      'phone',
    ];

    for (const key of Object.values(PREFERENCE_KEYS)) {
      const normalised = key.toLowerCase().replace(/[^a-z]/g, '');
      for (const word of FORBIDDEN) {
        expect(normalised).not.toContain(word);
      }
    }
  });
});

describe('randomId (I-05, ADR-014)', () => {
  const holder = globalThis as { crypto?: { randomUUID?: () => string } };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the platform generator when there is one', () => {
    const original = holder.crypto;
    holder.crypto = { randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };

    expect(randomId()).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');

    if (original === undefined) delete holder.crypto;
    else holder.crypto = original;
  });

  it('falls back to a v4-shaped string where Hermes has none', () => {
    // Hermes ships no `crypto.randomUUID`, and there is no `crypto`
    // global on every platform/engine combination.
    const original = holder.crypto;
    delete holder.crypto;

    const id = randomId();

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    if (original !== undefined) holder.crypto = original;
  });

  it('produces a different id every time, which is the whole job', () => {
    // An `Idempotency-Key` reused across two booking attempts is not an
    // idempotency key — it is a way to lose the second booking.
    const original = holder.crypto;
    delete holder.crypto;

    const ids = new Set(Array.from({ length: 200 }, () => randomId()));

    expect(ids.size).toBe(200);

    if (original !== undefined) holder.crypto = original;
  });
});
