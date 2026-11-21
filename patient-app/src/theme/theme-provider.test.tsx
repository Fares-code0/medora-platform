import { act, fireEvent, render } from '@testing-library/react-native';
import { Pressable, Text, useColorScheme } from 'react-native';

import { PREFERENCE_KEYS, preferenceStore } from '@/storage/preference-store';

import { ThemeProvider, useTheme, useThemeContext } from './ThemeProvider';

/**
 * Following the phone — checklist C-04.
 *
 * `ThemeProvider` was at 33% of branches, and the branches are the
 * feature: three modes crossed with an OS answer that is `'light'`,
 * `'dark'`, or **not there yet**. The third is the one worth a test.
 * `useColorScheme()` returns `null` before the OS reports, and treating
 * that as dark flashes a dark screen on a light phone — on the launch
 * screen, which is the first thing a patient ever sees of this app.
 *
 * `theme.test.tsx` covers the palettes and their contrast ratios. This
 * covers which of them gets chosen.
 */

jest.mock('react-native/Libraries/Utilities/useColorScheme');

const mockedScheme = useColorScheme as jest.Mock<
  ReturnType<typeof useColorScheme> | null,
  []
>;

function Probe() {
  const theme = useTheme();
  const { mode, setMode } = useThemeContext();
  return (
    <>
      <Text testID="scheme">{theme.scheme}</Text>
      <Text testID="mode">{mode}</Text>
      <Pressable testID="to-dark" onPress={() => setMode('dark')}>
        <Text>dark</Text>
      </Pressable>
      <Pressable testID="to-system" onPress={() => setMode('system')}>
        <Text>system</Text>
      </Pressable>
    </>
  );
}

function renderTheme(initialMode?: 'light' | 'dark' | 'system') {
  return render(
    <ThemeProvider {...(initialMode === undefined ? {} : { initialMode })}>
      <Probe />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  preferenceStore.remove(PREFERENCE_KEYS.themeMode);
  mockedScheme.mockReturnValue('light');
});

afterEach(() => {
  preferenceStore.remove(PREFERENCE_KEYS.themeMode);
  jest.clearAllMocks();
});

describe('System follows the phone', () => {
  it('resolves to the OS palette when the OS has one', () => {
    mockedScheme.mockReturnValue('dark');
    const view = renderTheme('system');

    expect(view.getByTestId('scheme').props.children).toBe('dark');
  });

  it('resolves to light when the OS says light', () => {
    mockedScheme.mockReturnValue('light');
    const view = renderTheme('system');

    expect(view.getByTestId('scheme').props.children).toBe('light');
  });

  it('resolves to LIGHT while the OS has not answered yet', () => {
    // The branch this test exists for. `useColorScheme()` is null for
    // the first frames, and treating that as dark flashes a dark screen
    // on a light phone — on the launch screen, of all places.
    mockedScheme.mockReturnValue(null);
    const view = renderTheme('system');

    expect(view.getByTestId('scheme').props.children).toBe('light');
  });
});

describe('an explicit mode overrides the phone', () => {
  it('stays light on a dark phone', () => {
    mockedScheme.mockReturnValue('dark');
    const view = renderTheme('light');

    expect(view.getByTestId('scheme').props.children).toBe('light');
  });

  it('stays dark on a light phone', () => {
    mockedScheme.mockReturnValue('light');
    const view = renderTheme('dark');

    expect(view.getByTestId('scheme').props.children).toBe('dark');
  });
});

describe('the stored preference', () => {
  it('defaults to system when nothing has been stored', () => {
    const view = renderTheme();

    expect(view.getByTestId('mode').props.children).toBe('system');
  });

  it('reads a stored mode at mount', () => {
    preferenceStore.set(PREFERENCE_KEYS.themeMode, 'dark');
    mockedScheme.mockReturnValue('light');

    const view = renderTheme();

    expect(view.getByTestId('mode').props.children).toBe('dark');
    expect(view.getByTestId('scheme').props.children).toBe('dark');
  });

  it('falls back to system for a value it does not recognize', () => {
    // A hand-edited store, or a value written by an older build.
    preferenceStore.set(PREFERENCE_KEYS.themeMode, 'sepia');

    const view = renderTheme();

    expect(view.getByTestId('mode').props.children).toBe('system');
  });

  it('writes the choice through, and applies it in the same tick', () => {
    mockedScheme.mockReturnValue('light');
    const view = renderTheme('system');

    act(() => {
      fireEvent.press(view.getByTestId('to-dark'));
    });

    expect(preferenceStore.get(PREFERENCE_KEYS.themeMode)).toBe('dark');
    expect(view.getByTestId('scheme').props.children).toBe('dark');
  });

  it('goes back to following the phone, which is a value and not an absence', () => {
    mockedScheme.mockReturnValue('dark');
    const view = renderTheme('light');

    act(() => {
      fireEvent.press(view.getByTestId('to-system'));
    });

    expect(preferenceStore.get(PREFERENCE_KEYS.themeMode)).toBe('system');
    expect(view.getByTestId('scheme').props.children).toBe('dark');
  });
});

describe('using the theme outside a provider', () => {
  it('throws a message that names the fix', () => {
    // Silent-defaulting here would render one screen in a palette
    // nothing else uses, which is harder to notice than a crash.
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<Probe />)).toThrow(/ThemeProvider/);

    errors.mockRestore();
  });
});
