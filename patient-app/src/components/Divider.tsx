import { View } from 'react-native';

import { decorative } from '@/accessibility/a11y';
import { useTheme } from '@/theme';

/**
 * A hairline rule. Always decorative — a divider that a screen reader
 * announces is noise between every two rows of a list.
 *
 * `StyleSheet.hairlineWidth` is deliberately not used: it renders sub-pixel
 * on high-density Android and disappears against `--color-border`, which is
 * the line the whole elevation system rests on (`tokens.css` header).
 */
export function Divider({ inset = 0 }: { inset?: number }) {
  const theme = useTheme();
  return (
    <View
      {...decorative}
      // `marginStart`, not `marginLeft` (S-08). An inset divider is
      // indented from where the row's content BEGINS — under the avatar,
      // past the icon — and in a right-to-left layout that is the right
      // edge. `marginLeft` would indent it from the wrong side and leave
      // the rule floating away from the content it belongs to.
      style={{ height: 1, marginStart: inset, backgroundColor: theme.colors.border }}
    />
  );
}
