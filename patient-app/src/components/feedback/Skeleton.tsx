import { useEffect, useRef } from 'react';

import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { decorative } from '@/accessibility/a11y';
import { useReducedMotion } from '@/accessibility/useReducedMotion';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

/**
 * Loading placeholders.
 *
 * A skeleton and not a spinner, everywhere: a spinner says "something is
 * happening", a skeleton says "a list of appointments is coming and this
 * is its shape", which is the difference between waiting and not knowing
 * (checklist R-01).
 *
 * The pulse honours reduce-motion by not animating at all — a looping
 * opacity animation is exactly the kind of thing the OS switch exists to
 * stop. The static skeleton still communicates the shape.
 *
 * Skeletons are hidden from assistive technology; `SkeletonList` is one
 * labelled element announcing "Loading, please wait" once, which is what
 * a screen-reader user needs instead of six unlabelled boxes. This
 * docblock used to name a `LoadingState` component that did not exist —
 * the claim was true of the intent and false of the tree, and the label
 * now lives on the container below (S-02, C-09).
 */
export function Skeleton({
  width = '100%',
  height = 16,
  radius,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (reduced) {
      pulse.setValue(0.7);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);

  return (
    <Animated.View
      {...decorative}
      style={[
        {
          width,
          height,
          opacity: pulse,
          borderRadius: radius ?? theme.radius.control,
          backgroundColor: theme.colors.surfaceSunken,
        },
        style,
      ]}
    />
  );
}

/** The skeleton of a card: a title, two lines and a trailing chip. */
export function SkeletonCard({ testID }: { testID?: string }) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      {...decorative}
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.surface,
          padding: theme.space[4],
          rowGap: theme.space[3],
        },
      ]}
    >
      <Skeleton width="60%" height={18} />
      <Skeleton width="90%" height={14} />
      <Skeleton width="40%" height={14} />
    </View>
  );
}

/** `count` card skeletons — the loading state of any list screen. */
export function SkeletonList({ count = 3, testID }: { count?: number; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={t('a11y.loading')}
      style={{ rowGap: theme.space[3] }}
    >
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ card: { borderWidth: 1 } });
