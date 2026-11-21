import { render, screen, waitFor } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import * as preferences from '@/storage/preference-store';

import { PreferenceGate } from './PreferenceGate';

/**
 * The boot gate — checklist E-02, P-07.
 *
 * `ThemeProvider` and `LocaleProvider` read the preference store in a
 * `useState` initialiser, which runs once at mount. So the guarantee
 * this gate has to make is not "the preferences load" — it is "nothing
 * below me mounts until they have". A child that renders early would
 * paint the system palette and the default language and then correct
 * itself, which is the flash the synchronous port exists to prevent.
 *
 * Hydration is held open here rather than raced, so the assertion is
 * about the ordering and not about who wins a microtask.
 */

function Child() {
  return (
    <RNText testID="gated-child">
      {preferences.preferenceStore.get(preferences.PREFERENCE_KEYS.locale) ?? '—'}
    </RNText>
  );
}

/** A hydration this test opens and closes by hand. */
function heldHydration() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = jest.spyOn(preferences, 'hydratePreferences').mockReturnValue(promise);
  return { promise, release, spy };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('holding the first paint', () => {
  it('renders nothing while the preferences are still being read', () => {
    // Not a spinner: `ThemeProvider` is BELOW this, so a spinner here
    // would be a hard-coded colour that is wrong in one of the palettes.
    // `null` keeps the platform splash, which is still on screen.
    const hydration = heldHydration();

    render(
      <PreferenceGate>
        <Child />
      </PreferenceGate>,
    );

    expect(screen.queryByTestId('gated-child')).toBeNull();

    hydration.release();
  });

  it('renders the tree once they are in memory, with the stored value readable', async () => {
    const hydration = heldHydration();
    preferences.preferenceStore.set(preferences.PREFERENCE_KEYS.locale, 'ar');

    render(
      <PreferenceGate>
        <Child />
      </PreferenceGate>,
    );

    hydration.release();

    const child = await screen.findByTestId('gated-child');
    expect(child.children).toEqual(['ar']);
  });

  it('reads the store once, not on every render', async () => {
    const hydration = heldHydration();

    const view = render(
      <PreferenceGate>
        <Child />
      </PreferenceGate>,
    );
    hydration.release();
    await screen.findByTestId('gated-child');

    view.rerender(
      <PreferenceGate>
        <Child />
      </PreferenceGate>,
    );

    expect(hydration.spy).toHaveBeenCalledTimes(1);
  });

  it('opens on the real store, which resolves even when the device refuses', async () => {
    // `hydrate()` swallows a failed read and resolves anyway (asserted
    // in `durable-preference-store.test.ts`), so there is no path where
    // the app never starts.
    render(
      <PreferenceGate>
        <Child />
      </PreferenceGate>,
    );

    await waitFor(() => expect(screen.getByTestId('gated-child')).toBeTruthy());
  });
});
