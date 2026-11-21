import { useEffect, useRef } from 'react';

import { Animated, StyleSheet, View } from 'react-native';

import { decorative } from '@/accessibility/a11y';
import { useMotionDuration } from '@/accessibility/useReducedMotion';
import { Icon, Text } from '@/components';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

/**
 * The assistant is composing a reply — K-02's loading state.
 *
 * ── Purely visual, and purely presentational ────────────────────────
 *
 * Three dots that rise and fall. It is not connected to anything, it
 * starts and stops from a prop, and nothing in this tree sets that prop
 * true against a real request — there is no request. It exists so the
 * state is designed and honours the accessibility rules before there is
 * something to wait for.
 *
 * ── Reduce motion collapses it to nothing, not to something faster ──
 *
 * `useMotionDuration` returns 0 when the OS switch is on (checklist
 * S-06, C-10), and at 0 the loop is not started at all — the dots simply
 * render at rest. Shortening the animation instead would still be
 * motion, shown to precisely the person who asked for none, and a
 * vestibular condition is not a preference.
 *
 * ── What a screen reader gets ───────────────────────────────────────
 *
 * The dots are `decorative`; the sentence beside them is the content.
 * `accessibilityLiveRegion="polite"` announces it on appearance without
 * interrupting whatever is being read — an assertive announcement here
 * would talk over the patient's own message being read back to them.
 */
export interface AiTypingIndicatorProps {
  readonly testID?: string;
}

const DOTS = [0, 1, 2];
/** Enough offset that the three dots read as a wave rather than a blink. */
const STAGGER_MS = 140;
const TRAVEL = 4;

export function AiTypingIndicator({ testID }: AiTypingIndicatorProps) {
  const theme = useTheme();
  const t = useT();
  const duration = useMotionDuration(420);

  // One value per dot, created once. `useRef` rather than state: these
  // drive the native animation and must never trigger a React render.
  const values = useRef(DOTS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (duration === 0) return;

    const loops = values.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * STAGGER_MS),
          Animated.timing(value, { toValue: 1, duration, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0, duration, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());

    return () => {
      loops.forEach((loop) => loop.stop());
      // Back to rest, so a remount does not start from mid-bounce.
      values.forEach((value) => value.setValue(0));
    };
  }, [duration, values]);

  return (
    <View
      testID={testID ?? 'ai-typing'}
      accessibilityLiveRegion="polite"
      style={[styles.row, { columnGap: theme.space[2] }]}
    >
      <Icon name="cpu" size={16} color="textTertiary" />
      <View {...decorative} style={[styles.dots, { columnGap: theme.space[1] }]}>
        {values.map((value, index) => (
          <Animated.View
            key={DOTS[index]}
            style={[
              styles.dot,
              {
                backgroundColor: theme.colors.textTertiary,
                transform: [
                  {
                    translateY: value.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -TRAVEL],
                    }),
                  },
                ],
              },
            ]}
          />
        ))}
      </View>
      <Text variant="caption" color="textTertiary">
        {t('ai.chat.typing')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { borderRadius: 3, height: 6, width: 6 },
  dots: { alignItems: 'center', flexDirection: 'row' },
  row: { alignItems: 'center', flexDirection: 'row' },
});
