import type { ViewStyle } from 'react-native';
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

  return {
    paddingHorizontal: padded ? theme.screenGutter : 0,
    paddingTop: edges.includes('top') ? insets.top + theme.space[2] : theme.space[2],
    paddingBottom: (edges.includes('bottom') ? insets.bottom : 0) + theme.space[6],
    rowGap: rowGap ?? theme.space[4],
  };
}
