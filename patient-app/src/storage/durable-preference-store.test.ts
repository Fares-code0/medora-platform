import {
  createDurablePreferenceStore,
  type AsyncKeyValueStore,
} from './durable-preference-store';

/**
 * Preferences that survive a cold start — checklist E-02 and P-07.
 *
 * The rows were 🟨 for one reason each and it was the same reason: the
 * store was a `Map`, so "never shown twice" held within a run and the
 * theme forgot itself overnight. These tests are about the three things
 * that had to become true — the value comes back, the read is
 * synchronous once hydrated, and a device that refuses to write does not
 * take the app down with it.
 */

const KEYS = ['medora.theme-mode', 'medora.locale', 'medora.onboarding-seen'];

/** A device, as a Map, with the failure modes a real one has. */
function fakeDevice(seed: Record<string, string> = {}) {
  const disk = new Map(Object.entries(seed));
  const failures = { multiGet: false, setItem: false, removeItem: false };

  const backend: AsyncKeyValueStore = {
    multiGet: (keys) =>
      failures.multiGet
        ? Promise.reject(new Error('storage unavailable'))
        : Promise.resolve(keys.map((key) => [key, disk.get(key) ?? null] as const)),
    setItem: (key, value) => {
      if (failures.setItem) return Promise.reject(new Error('disk full'));
      disk.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      if (failures.removeItem) return Promise.reject(new Error('disk full'));
      disk.delete(key);
      return Promise.resolve();
    },
  };

  return { backend, disk, failures };
}

function store(device: ReturnType<typeof fakeDevice>) {
  return createDurablePreferenceStore({ keys: KEYS, backend: device.backend });
}

describe('surviving a cold start', () => {
  it('reads the device once, at hydration', async () => {
    const device = fakeDevice({ 'medora.theme-mode': 'dark' });
    const preferences = store(device);

    // Before hydration it holds nothing. This is why the gate exists.
    expect(preferences.get('medora.theme-mode')).toBeNull();

    await preferences.hydrate();

    expect(preferences.get('medora.theme-mode')).toBe('dark');
  });

  it('serves every read after that from memory, synchronously', async () => {
    // The port is synchronous because the theme must resolve before the
    // first paint. A `get` that returned a promise would reintroduce the
    // flash the whole arrangement exists to prevent.
    const device = fakeDevice({ 'medora.locale': 'ar' });
    const preferences = store(device);
    await preferences.hydrate();

    const value: string | null = preferences.get('medora.locale');
    expect(value).toBe('ar');
  });

  it('writes through to the device', async () => {
    const device = fakeDevice();
    const preferences = store(device);
    await preferences.hydrate();

    preferences.set('medora.onboarding-seen', 'true');

    expect(preferences.get('medora.onboarding-seen')).toBe('true');
    await Promise.resolve();
    expect(device.disk.get('medora.onboarding-seen')).toBe('true');
  });

  it('gives the next cold start what the last run stored', async () => {
    // The whole of E-02: an app told "skip" must not ask again tomorrow.
    const device = fakeDevice();
    const firstRun = store(device);
    await firstRun.hydrate();
    firstRun.set('medora.onboarding-seen', 'true');
    await Promise.resolve();

    const secondRun = store(device);
    await secondRun.hydrate();

    expect(secondRun.get('medora.onboarding-seen')).toBe('true');
  });

  it('removes from the device as well as from memory', async () => {
    const device = fakeDevice({ 'medora.locale': 'ar' });
    const preferences = store(device);
    await preferences.hydrate();

    preferences.remove('medora.locale');

    expect(preferences.get('medora.locale')).toBeNull();
    await Promise.resolve();
    expect(device.disk.has('medora.locale')).toBe(false);
  });
});

describe('the key vocabulary is closed', () => {
  it('never reads a key this app does not define', async () => {
    // `multiGet` of the vocabulary, not `getAllKeys`. A key left by an
    // older build or another library cannot enter the mirror, so
    // `keys()` — which the logout sweep's assertion walks — cannot come
    // to report something `PREFERENCE_KEYS` does not define.
    const device = fakeDevice({
      'medora.locale': 'ar',
      'some.other.library': 'whatever it wants',
    });
    const preferences = store(device);
    await preferences.hydrate();

    expect(preferences.keys()).toEqual(['medora.locale']);
    expect(preferences.get('some.other.library')).toBeNull();
  });

  it('reports only the keys that actually held a value', async () => {
    const device = fakeDevice({ 'medora.theme-mode': 'light' });
    const preferences = store(device);
    await preferences.hydrate();

    expect(preferences.keys()).toEqual(['medora.theme-mode']);
  });
});

describe('a device that will not cooperate', () => {
  it('starts on the defaults when the store cannot be read', async () => {
    // An unreadable store is an empty one. There is no path where the
    // gate above this stays closed.
    const device = fakeDevice({ 'medora.theme-mode': 'dark' });
    device.failures.multiGet = true;
    const preferences = store(device);

    await expect(preferences.hydrate()).resolves.toBeUndefined();
    expect(preferences.isHydrated).toBe(true);
    expect(preferences.get('medora.theme-mode')).toBeNull();
  });

  it('keeps the choice for this run when the write fails', async () => {
    // Storage full. The app must behave correctly now and forget the
    // choice on the next cold start — not crash, and not ignore the tap.
    const device = fakeDevice();
    device.failures.setItem = true;
    const preferences = store(device);
    await preferences.hydrate();

    expect(() => preferences.set('medora.theme-mode', 'dark')).not.toThrow();
    expect(preferences.get('medora.theme-mode')).toBe('dark');

    await Promise.resolve();
    expect(device.disk.has('medora.theme-mode')).toBe(false);
  });

  it('does not throw when a removal fails either', async () => {
    const device = fakeDevice({ 'medora.locale': 'ar' });
    device.failures.removeItem = true;
    const preferences = store(device);
    await preferences.hydrate();

    expect(() => preferences.remove('medora.locale')).not.toThrow();
    expect(preferences.get('medora.locale')).toBeNull();
  });
});

describe('hydration is idempotent', () => {
  it('reads the device once however many times it is called', async () => {
    const device = fakeDevice({ 'medora.locale': 'ar' });
    const multiGet = jest.spyOn(device.backend, 'multiGet');
    const preferences = store(device);

    await Promise.all([preferences.hydrate(), preferences.hydrate()]);
    await preferences.hydrate();

    expect(multiGet).toHaveBeenCalledTimes(1);
  });

  it('does not undo a value written before a second call', async () => {
    // A re-mounted gate must not reload the device over a choice the
    // patient made in between.
    const device = fakeDevice();
    const preferences = store(device);
    await preferences.hydrate();

    preferences.set('medora.theme-mode', 'dark');
    await preferences.hydrate();

    expect(preferences.get('medora.theme-mode')).toBe('dark');
  });
});
