import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/theme';

import { useScreenContentStyle, type ScreenEdge } from './screen-content';

/**
 * The screen container. Every screen in this app is one.
 *
 * ── Safe areas ───────────────────────────────────────────────────────
 * Insets are applied as PADDING on the content, not as a coloured band,
 * so a scrolling list runs under the notch and the home indicator rather
 * than stopping short of them — and still never puts a control there
 * (checklist C-07). The top inset is omitted when the screen sits inside a
 * navigator that already draws a header, which is why `edges` exists.
 *
 * ── Scroll vs. flex ──────────────────────────────────────────────────
 * `scroll` defaults to true because a patient on the largest
 * accessibility text size turns almost every screen into a scrolling one.
 * A fixed-height layout that fits at the default size and clips at 1.6x
 * is the most common dynamic-type failure (S-03).
 */
export interface ScreenProps {
  readonly children: React.ReactNode;
  readonly scroll?: boolean;
  readonly padded?: boolean;
  readonly edges?: readonly ScreenEdge[];
  readonly onRefresh?: () => void;
  readonly refreshing?: boolean;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
}

export function Screen({
  children,
  scroll = true,
  padded = true,
  edges = ['bottom'],
  onRefresh,
  refreshing = false,
  testID,
  style,
}: ScreenProps) {
  const theme = useTheme();
  const contentPadding: ViewStyle = useScreenContentStyle({ padded, edges });

  if (!scroll) {
    return (
      <View
        testID={testID}
        style={[styles.fill, { backgroundColor: theme.colors.background }, contentPadding, style]}
      >
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      testID={testID}
      style={[styles.fill, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={[contentPadding, style]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      {...(onRefresh === undefined
        ? {}
        : {
            refreshControl: (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.colors.primary}
                colors={[theme.colors.primary]}
              />
            ),
          })}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
