import { act } from '@testing-library/react-native';
import { AppState, StyleSheet, Text as RNText, type AppStateStatus } from 'react-native';

import { renderWithProviders } from '@/test/render';

import { PhiPrivacyShield } from './PhiPrivacyShield';

/**
 * The app-switcher shield — checklist T-09.
 *
 * The assertion that matters is the one about the photograph: while a
 * patient is signed in, the app must not be recognisable at the moment
 * the OS leaves the foreground. Everything below is that, from both
 * sides — it appears when it should, and it is not in the way when it
 * should not be.
 */

/** A fake `AppState` whose `remove()` really removes. */
function captureAppState() {
  const listeners: ((state: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.push(listener);
    return {
      remove: () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    };
  });

  return (state: AppStateStatus) => {
    act(() => {
      for (const listener of [...listeners]) listener(state);
    });
  };
}

function renderShield(options: { protecting: boolean; mode?: 'light' | 'dark' }) {
  const emit = captureAppState();
  const view = renderWithProviders(
    <PhiPrivacyShield protecting={options.protecting}>
      <RNText testID="protected-content">Lab results</RNText>
    </PhiPrivacyShield>,
    { mode: options.mode ?? 'light' },
  );

  // The cover is deliberately hidden from assistive technology, and
  // RNTL's queries skip hidden elements by default — so looking for it
  // has to say so explicitly. That the option is *needed* is itself the
  // evidence for the accessibility assertion below.
  const cover = () => view.queryByTestId('phi-privacy-cover', { includeHiddenElements: true });

  return { ...view, emit, cover };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('while signed in (T-09)', () => {
  it('shows nothing over the app in the foreground', () => {
    const { cover, getByTestId } = renderShield({ protecting: true });

    expect(getByTestId('protected-content')).toBeTruthy();
    expect(cover()).toBeNull();
  });

  it('covers the app when it goes to the background', () => {
    const { cover, emit } = renderShield({ protecting: true });

    emit('background');

    expect(cover()).not.toBeNull();
  });

  it('covers the app on `inactive`, which is when iOS takes the snapshot', () => {
    // The snapshot is taken on the way out, and on iOS that transition
    // is `inactive` — covering only on `background` would be too late.
    const { cover, emit } = renderShield({ protecting: true });

    emit('inactive');

    expect(cover()).not.toBeNull();
  });

  it('uncovers on return, leaving the patient where they were', () => {
    const { cover, getByTestId, emit } = renderShield({ protecting: true });

    emit('background');
    emit('active');

    expect(cover()).toBeNull();
    // A cover, not a lock: the content underneath was never unmounted.
    expect(getByTestId('protected-content')).toBeTruthy();
  });

  it('paints an opaque ground rather than letting the screen show through', () => {
    const { cover, emit } = renderShield({ protecting: true });
    emit('background');

    const style = StyleSheet.flatten(cover()?.props.style) as {
      backgroundColor?: string;
    };
    expect(style.backgroundColor).toBeDefined();
    expect(style.backgroundColor).not.toBe('transparent');
  });

  it('takes its ground from the theme, in both palettes', () => {
    const light = renderShield({ protecting: true });
    light.emit('background');
    const lightGround = StyleSheet.flatten(light.cover()?.props.style) as {
      backgroundColor?: string;
    };
    light.unmount();

    const dark = renderShield({ protecting: true, mode: 'dark' });
    dark.emit('background');
    const darkGround = StyleSheet.flatten(dark.cover()?.props.style) as {
      backgroundColor?: string;
    };

    expect(lightGround.backgroundColor).not.toBe(darkGround.backgroundColor);
  });

  it('is invisible to a screen reader, which has nothing to read here', () => {
    const { cover, emit, queryByTestId } = renderShield({ protecting: true });
    emit('background');

    expect(cover()?.props.accessibilityElementsHidden).toBe(true);
    expect(cover()?.props.importantForAccessibility).toBe('no-hide-descendants');
    // And therefore invisible to an ordinary query, which is how a
    // screen reader sees it too.
    expect(queryByTestId('phi-privacy-cover')).toBeNull();
  });
});

describe('while signed out (T-09)', () => {
  it('never covers anything — Welcome and Emergency are public by design', () => {
    const { cover, emit } = renderShield({ protecting: false });

    emit('background');

    expect(cover()).toBeNull();
  });
});
