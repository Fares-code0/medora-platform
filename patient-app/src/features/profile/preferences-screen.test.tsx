import { act, fireEvent } from '@testing-library/react-native';
import { I18nManager } from 'react-native';

import { catalogues, LOCALES } from '@/i18n';
import { PREFERENCE_KEYS, preferenceStore } from '@/storage/preference-store';
import { renderWithProviders } from '@/test/render';
import { ThemeProvider } from '@/theme';

import { PreferencesScreen } from './screens/PreferencesScreen';

/**
 * Appearance and language — checklist P-07, C-04, C-09, S-08.
 *
 * The screen sat at 28.6% of statements, and until this change it did not
 * carry a language switcher at all: `LocaleProvider`, the typed
 * catalogues and `language.restartRequired` all existed and nothing in
 * the app could reach them. The copy in their place said Arabic was
 * "planned", which was true when it was written and had stopped being.
 *
 * Two behaviours here are worth more than the rest.
 *
 * **System is a stored value, not an absence.** An app that stops
 * following the OS the moment somebody opens Preferences is an app
 * ignoring a setting the patient already made once.
 *
 * **Choosing Arabic cannot flip the layout until a restart.**
 * `I18nManager.forceRTL` is read by the native view hierarchy at
 * startup — a React Native constraint — so the text changes at once and
 * the direction does not. Saying so is the alternative to a patient
 * concluding the setting is broken.
 */

const installed: { mockRestore: () => void }[] = [];

beforeEach(() => {
  preferenceStore.remove(PREFERENCE_KEYS.themeMode);
  preferenceStore.remove(PREFERENCE_KEYS.locale);
});

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
  preferenceStore.remove(PREFERENCE_KEYS.themeMode);
  preferenceStore.remove(PREFERENCE_KEYS.locale);
});

/**
 * `I18nManager.isRTL` is what the NATIVE layer is doing right now, as
 * opposed to what the chosen language asks for. It is a plain property
 * rather than a getter, so it is redefined rather than spied.
 */
function nativeDirection(isRtl: boolean) {
  const original = I18nManager.isRTL;
  Object.defineProperty(I18nManager, 'isRTL', { value: isRtl, configurable: true });
  installed.push({
    mockRestore: () =>
      Object.defineProperty(I18nManager, 'isRTL', { value: original, configurable: true }),
  });
}

describe('the theme switcher (C-04, P-07)', () => {
  it('offers three modes, with System the default when nothing is stored', () => {
    // A second `ThemeProvider` with no `initialMode`, because the test
    // renderer pins one for determinism and this is the assertion about
    // what happens when nothing has been pinned.
    const { getByTestId } = renderWithProviders(
      <ThemeProvider>
        <PreferencesScreen />
      </ThemeProvider>,
    );

    expect(getByTestId('preferences-theme-system').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(getByTestId('preferences-theme-light').props.accessibilityState).toMatchObject({
      selected: false,
    });
    expect(getByTestId('preferences-theme-dark')).toBeTruthy();
  });

  it('persists a chosen mode, so a cold start does not lose it', () => {
    const { getByTestId } = renderWithProviders(<PreferencesScreen />);

    fireEvent.press(getByTestId('preferences-theme-dark'));

    expect(preferenceStore.get(PREFERENCE_KEYS.themeMode)).toBe('dark');
    expect(getByTestId('preferences-theme-dark').props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('can be put back onto the phone, which is a value and not an absence', () => {
    const { getByTestId } = renderWithProviders(<PreferencesScreen />);

    fireEvent.press(getByTestId('preferences-theme-light'));
    fireEvent.press(getByTestId('preferences-theme-system'));

    expect(preferenceStore.get(PREFERENCE_KEYS.themeMode)).toBe('system');
  });

  it('renders in the dark palette too', () => {
    const { getByTestId } = renderWithProviders(<PreferencesScreen />, { mode: 'dark' });

    expect(getByTestId('preferences-screen')).toBeTruthy();
  });
});

describe('the language switcher (C-09, P-07)', () => {
  it('offers every locale the app ships', () => {
    const { getByTestId } = renderWithProviders(<PreferencesScreen />);

    for (const locale of LOCALES) {
      expect(getByTestId(`preferences-locale-${locale.code}`)).toBeTruthy();
    }
  });

  it('shows the endonym, and says the English name to a screen reader', () => {
    // "العربية" is what a speaker scans a language list for; "Arabic" is
    // what a screen reader running in English should say.
    const { getByTestId, getByText } = renderWithProviders(<PreferencesScreen />);

    expect(getByText('العربية')).toBeTruthy();
    expect(getByTestId('preferences-locale-ar').props.accessibilityLabel).toBe('Arabic');
  });

  it('marks the current locale as selected', () => {
    const { getByTestId } = renderWithProviders(<PreferencesScreen />, { locale: 'ar' });

    expect(getByTestId('preferences-locale-ar').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(getByTestId('preferences-locale-en').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('persists the choice and re-renders the screen in it', () => {
    nativeDirection(false);
    const view = renderWithProviders(<PreferencesScreen />);

    act(() => {
      fireEvent.press(view.getByTestId('preferences-locale-ar'));
    });

    expect(preferenceStore.get(PREFERENCE_KEYS.locale)).toBe('ar');
    // The heading of the language section is itself a catalogue string,
    // so the switch is visible on the screen that made it.
    expect(view.getByText(catalogues.ar['language.title'])).toBeTruthy();
  });
});

describe('the restart notice tells the truth about direction (S-08)', () => {
  it('is absent while the native layout already agrees with the language', () => {
    nativeDirection(false);
    const { queryByTestId } = renderWithProviders(<PreferencesScreen />, { locale: 'en' });

    expect(queryByTestId('preferences-locale-restart')).toBeNull();
  });

  it('appears the moment they disagree', () => {
    // Chosen Arabic, native layout still left-to-right — which is every
    // moment between the tap and the next launch.
    nativeDirection(false);
    const { getByTestId, getByText } = renderWithProviders(<PreferencesScreen />, {
      locale: 'ar',
    });

    expect(getByTestId('preferences-locale-restart')).toBeTruthy();
    expect(getByText(catalogues.ar['language.restartRequired'])).toBeTruthy();
  });

  it('is absent again once the app has been reopened right-to-left', () => {
    nativeDirection(true);
    const { queryByTestId } = renderWithProviders(<PreferencesScreen />, { locale: 'ar' });

    expect(queryByTestId('preferences-locale-restart')).toBeNull();
  });

  it('appears for the reverse case too, going back to English', () => {
    // A patient switching Arabic → English hits the same constraint in
    // the other direction, and a notice that only fired one way would be
    // the half that is easy to forget.
    nativeDirection(true);
    const { getByTestId } = renderWithProviders(<PreferencesScreen />, { locale: 'en' });

    expect(getByTestId('preferences-locale-restart')).toBeTruthy();
  });
});

describe('the unreviewed-translation caveat (C-09)', () => {
  it('is absent in English, where there is nothing to caveat', () => {
    const { queryByTestId } = renderWithProviders(<PreferencesScreen />);

    expect(queryByTestId('preferences-locale-review')).toBeNull();
  });

  it('tells the patient, in Arabic, that the Arabic has not been reviewed', () => {
    // `messages/ar.ts` records it for developers. This is the half that
    // reaches the person who can actually tell us a sentence is wrong.
    const { getByTestId, getByText } = renderWithProviders(<PreferencesScreen />);

    fireEvent.press(getByTestId('preferences-locale-ar'));

    expect(getByTestId('preferences-locale-review')).toBeTruthy();
    expect(getByText(catalogues.ar['language.reviewPending'])).toBeTruthy();
  });
});

describe('what the screen does not claim', () => {
  it('no longer says Arabic is planned', () => {
    const { queryByText } = renderWithProviders(<PreferencesScreen />);

    expect(queryByText(/are planned/)).toBeNull();
  });

  it('still points at the OS for text size, which the app only follows', () => {
    const { getByText } = renderWithProviders(<PreferencesScreen />);

    expect(getByText(/follows the text size set on your phone/)).toBeTruthy();
  });
});
