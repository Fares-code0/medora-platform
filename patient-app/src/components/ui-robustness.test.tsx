import type { ComponentProps } from 'react';

import { HeaderHeightContext } from '@react-navigation/elements';
import { act, fireEvent, render } from '@testing-library/react-native';
import {
  AccessibilityInfo,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
} from 'react-native';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() }),
}));

import { AiChatScreen } from '@/features/ai/screens/AiChatScreen';
import { renderWithProviders } from '@/test/render';

import { Chip } from './Chip';
import { ErrorState } from './feedback/ErrorState';
import { Checkbox } from './form/Checkbox';
import { Input } from './Input';
import { BottomSheet } from './layout/BottomSheet';
import { Screen } from './layout/Screen';
import { useKeyboardAvoidance } from './layout/screen-content';
import { Text } from './Text';

/**
 * Keyboard, announcement, touch-target and rate-limit behaviour that
 * a device would otherwise be the only judge of.
 */

function withPlatform<T>(os: 'ios' | 'android', run: () => T): T {
  const was = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  try {
    return run();
  } finally {
    Object.defineProperty(Platform, 'OS', { value: was, configurable: true });
  }
}

describe('BottomSheet on small screens and with the keyboard', () => {
  it.each(['ios', 'android'] as const)('avoids the keyboard with padding on %s', (os) => {
    withPlatform(os, () => {
      const { UNSAFE_getByType } = renderWithProviders(
        <BottomSheet visible onClose={jest.fn()} title="Reason">
          <Input label="Reason" value="" onChangeText={jest.fn()} />
        </BottomSheet>,
      );
      expect(UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBe('padding');
    });
  });

  it('caps the sheet below the top inset and scrolls the body, keeping the header outside it', () => {
    const { getByTestId, getByLabelText, UNSAFE_getByType } = renderWithProviders(
      <BottomSheet visible onClose={jest.fn()} title="Reason" testID="sheet">
        <Input label="Reason" value="" onChangeText={jest.fn()} />
      </BottomSheet>,
    );

    const style = StyleSheet.flatten(getByTestId('sheet').props.style);
    // Window height 1334 in the jest mock, top inset 47.
    expect(style.maxHeight).toBe(1334 - 47);

    const scroller = UNSAFE_getByType(ScrollView);
    expect(scroller.props.keyboardShouldPersistTaps).toBe('handled');
    // Close is not inside the scrolling body.
    expect(
      scroller.findAll(
        (node: { props: { accessibilityLabel?: string } }) =>
          node.props.accessibilityLabel === 'Close',
      ),
    ).toHaveLength(0);
    expect(getByLabelText('Close')).toBeTruthy();
  });

  it('drops the bottom inset while the keyboard is up', () => {
    const handlers: Record<string, (() => void)[]> = {};
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, fn: () => void) => {
      (handlers[event] ??= []).push(fn);
      return { remove: jest.fn() };
    }) as never);
    const { getByTestId } = renderWithProviders(
      <BottomSheet visible onClose={jest.fn()} title="Reason" testID="sheet">
        <Input label="Reason" value="" onChangeText={jest.fn()} />
      </BottomSheet>,
    );
    const before = StyleSheet.flatten(getByTestId('sheet').props.style).paddingBottom as number;
    act(() => {
      for (const handler of handlers.keyboardWillShow ?? []) handler();
    });
    const after = StyleSheet.flatten(getByTestId('sheet').props.style).paddingBottom as number;
    expect(before - after).toBe(34);
  });

  it('does not animate under reduce-motion, and still dismisses', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const onClose = jest.fn();
    const { UNSAFE_getByType, getByLabelText } = renderWithProviders(
      <BottomSheet visible onClose={onClose} title="Reason">
        <Input label="Reason" value="" onChangeText={jest.fn()} />
      </BottomSheet>,
    );
    await act(async () => undefined);
    expect(UNSAFE_getByType(Modal).props.animationType).toBe('none');
    fireEvent.press(getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => UNSAFE_getByType(Modal).props.onRequestClose());
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('keyboard avoidance offsets', () => {
  function Probe() {
    const props = useKeyboardAvoidance();
    return <KeyboardAvoidingView {...props} testID="kav" />;
  }

  it.each(['ios', 'android'] as const)('follows the real header height on %s', (os) => {
    withPlatform(os, () => {
      const { UNSAFE_getByType } = render(
        <HeaderHeightContext.Provider value={103}>
          <Probe />
        </HeaderHeightContext.Provider>,
      );
      expect(UNSAFE_getByType(KeyboardAvoidingView).props.keyboardVerticalOffset).toBe(103);
      expect(UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBe('padding');
    });
  });

  it('is 0 with no header rather than throwing', () => {
    const { UNSAFE_getByType } = render(<Probe />);
    expect(UNSAFE_getByType(KeyboardAvoidingView).props.keyboardVerticalOffset).toBe(0);
  });

  it('is applied by the AI chat screen on Android too', () => {
    withPlatform('android', () => {
      const { UNSAFE_getByType } = renderWithProviders(
        <HeaderHeightContext.Provider value={56}>
          <AiChatScreen
            {...({ route: { params: { mode: 'general' } } } as unknown as ComponentProps<typeof AiChatScreen>)}
          />
        </HeaderHeightContext.Provider>,
      );
      const kav = UNSAFE_getByType(KeyboardAvoidingView);
      expect(kav.props.behavior).toBe('padding');
      expect(kav.props.keyboardVerticalOffset).toBe(56);
    });
  });
});

describe('error announcements', () => {
  afterEach(() => jest.restoreAllMocks());

  it('speaks a field error on iOS, where there is no live region', () => {
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    withPlatform('ios', () => {
      const view = renderWithProviders(
        <Input label="Email" value="" onChangeText={jest.fn()} error="Enter an email" />,
      );
      expect(spy).toHaveBeenCalledWith('Enter an email');
      view.rerender(
        <Input label="Email" value="" onChangeText={jest.fn()} error="Enter a valid email" />,
      );
      expect(spy).toHaveBeenCalledWith('Enter a valid email');
    });
  });

  it('leaves Android to its live region, so nothing is read twice', () => {
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    withPlatform('android', () => {
      renderWithProviders(
        <>
          <Input label="Email" value="" onChangeText={jest.fn()} error="Enter an email" />
          <Checkbox label="Agree" checked={false} onChange={jest.fn()} error="Required" />
        </>,
      );
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('speaks a checkbox error on iOS', () => {
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    withPlatform('ios', () => {
      renderWithProviders(
        <Checkbox label="Agree" checked={false} onChange={jest.fn()} error="Required" />,
      );
    });
    expect(spy).toHaveBeenCalledWith('Required');
  });

  it('exposes the password toggle state', () => {
    const { getByLabelText } = renderWithProviders(
      <Input label="Password" value="x" onChangeText={jest.fn()} secure />,
    );
    expect(getByLabelText('Show password').props.accessibilityState.selected).toBe(false);
    fireEvent.press(getByLabelText('Show password'));
    expect(getByLabelText('Hide password').props.accessibilityState.selected).toBe(true);
  });
});

describe('Chip touch target', () => {
  it('reaches 44 by 44 including hitSlop, even for a short label', () => {
    const { getByTestId } = renderWithProviders(<Chip label="A" onPress={jest.fn()} testID="c" />);
    const node = getByTestId('c');
    const style = StyleSheet.flatten(node.props.style);
    const slop = node.props.hitSlop as { top: number; bottom: number };
    expect((style.minHeight as number) + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
  });
});

describe('rate-limited ErrorState', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const limited = { kind: 'rate_limited', retryAfterSeconds: 30 };

  it('offers Retry only once the wait has elapsed, and keeps the message', () => {
    const onRetry = jest.fn();
    const { queryByTestId, getByTestId, getByText } = renderWithProviders(
      <ErrorState error={limited} onRetry={onRetry} testID="err" />,
    );
    expect(queryByTestId('err-retry')).toBeNull();
    expect(getByText(/30 seconds/)).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(29_000);
    });
    expect(queryByTestId('err-retry')).toBeNull();

    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    fireEvent.press(getByTestId('err-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(getByText(/30 seconds/)).toBeTruthy();
  });

  it('never offers Retry for a 403', () => {
    const { queryByTestId } = renderWithProviders(
      <ErrorState error={{ kind: 'forbidden' }} onRetry={jest.fn()} testID="err" />,
    );
    act(() => {
      jest.advanceTimersByTime(120_000);
    });
    expect(queryByTestId('err-retry')).toBeNull();
  });
});

describe('Screen bottom inset', () => {
  it('is dropped while the keyboard is open and restored after', () => {
    const handlers: Record<string, (() => void)[]> = {};
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, fn: () => void) => {
      (handlers[event] ??= []).push(fn);
      return { remove: jest.fn() };
    }) as never);
    const { getByTestId } = renderWithProviders(
      <Screen testID="scr">
        <Text>body</Text>
      </Screen>,
    );
    const bottom = () =>
      StyleSheet.flatten(getByTestId('scr').props.contentContainerStyle).paddingBottom as number;
    const resting = bottom();
    act(() => {
      for (const handler of handlers.keyboardWillShow ?? []) handler();
    });
    expect(resting - bottom()).toBe(34);
    act(() => {
      for (const handler of handlers.keyboardWillHide ?? []) handler();
    });
    expect(bottom()).toBe(resting);
  });
});
