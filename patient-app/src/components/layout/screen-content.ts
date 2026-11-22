import { useContext, useEffect, useState } from 'react';

import { HeaderHeightContext } from '@react-navigation/elements';
import { Keyboard, Platform, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

/**
 * Which safe-area edges a screen pads for itself.
 *
 * `top` is omitted when the screen sits inside a navigator that already
 * draws a header — the header owns the notch there, and padding for it
 * twice leaves a band of background above the title.
 */
export type ScreenEdge = 'top' | 'bottom';

export interface ScreenContentOptions {
  readonly padded?: boolean;
  readonly edges?: readonly ScreenEdge[];
  /** Vertical gap between the direct children the padding wraps. */
  readonly rowGap?: number;
}

/**
 * Whether the software keyboard is up.
 *
 * `will*` events on iOS so the bottom inset drops in step with the
 * keyboard's own animation; Android only emits `did*`.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const shown = Keyboard.addListener(show, () => setVisible(true));
    const hidden = Keyboard.addListener(hide, () => setVisible(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return visible;
}

/**
 * `KeyboardAvoidingView` props that keep a bottom composer above the keyboard.
 *
 * - **behavior** is `padding` on BOTH platforms. Under edge-to-edge
 *   (Expo 58 / RN 0.88, enforced on Android 15+) the window is no longer
 *   resized for the IME, so Android gets no help from
 *   `softwareKeyboardLayoutMode`; `KeyboardAvoidingView` reads the
 *   keyboard's frame from RN's keyboard events on Android too. `padding`
 *   rather than `height` because it does not fight a flex layout whose
 *   scroll area must shrink, and it needs no remembered initial height.
 * - **keyboardVerticalOffset** is the height of the header above the view
 *   (0 when there is none, e.g. under test), so the offset follows the
 *   real header rather than a hardcoded guess. The context is read
 *   directly because `useHeaderHeight` throws outside a header-owning
 *   navigator.
 */
export function useKeyboardAvoidance(): {
  readonly behavior: 'padding';
  readonly keyboardVerticalOffset: number;
} {
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  return { behavior: 'padding', keyboardVerticalOffset: headerHeight };
}

/**
 * The padding every screen's content gets, in one place.
 *
 * `Screen` (a `ScrollView`) and `PagedList` (a `FlatList`) are two scroll
 * containers with one layout: the same gutter, the same safe-area rule,
 * the same bottom breathing room. Written twice they drift, and the drift
 * is invisible — a list screen whose gutter is two points narrower than
 * every other screen is not something a test notices and not something a
 * reviewer sees in a diff.
 *
 * Insets are PADDING on the content rather than a coloured band, so a
 * list scrolls under the notch and the home indicator instead of stopping
 * short of them, and still never puts a control there (checklist C-07).
 */
export function useScreenContentStyle({
  padded = true,
  edges = ['bottom'],
  rowGap,
}: ScreenContentOptions = {}): ViewStyle {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // The home-indicator inset is dead space once the keyboard covers that
  // edge: kept, it floats the last control a whole inset above the keys.
  const keyboardVisible = useKeyboardVisible();

  return {
    paddingHorizontal: padded ? theme.screenGutter : 0,
    paddingTop: edges.includes('top') ? insets.top + theme.space[2] : theme.space[2],
    paddingBottom:
      (edges.includes('bottom') && !keyboardVisible ? insets.bottom : 0) + theme.space[6],
    rowGap: rowGap ?? theme.space[4],
  };
}
