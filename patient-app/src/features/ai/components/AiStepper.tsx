import { StyleSheet, View } from 'react-native';

import { decorative } from '@/accessibility/a11y';
import { Text } from '@/components';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import type { IntakeProgress } from '../model/types';

/**
 * "Step 2 of 3" — the intake's progress indicator.
 *
 * ── Words first, bar second ─────────────────────────────────────────
 *
 * The sentence is the content and the bar is `decorative`. A progress
 * bar alone tells a screen-reader user nothing, and "you are two thirds
 * through" is exactly the kind of orientation a patient filling in a
 * form about their own symptoms needs most. `accessibilityRole="header"`
 * would be wrong — this is status, not structure — so the whole row is
 * one accessible element carrying the sentence.
 *
 * The segments are drawn as filled/unfilled rather than as one animated
 * width. Nothing moves, so there is no reduce-motion question to answer,
 * and a flex row of `n` segments is correct in RTL for free.
 */
export interface AiStepperProps {
  readonly progress: IntakeProgress;
  readonly testID?: string;
}

export function AiStepper({ progress, testID }: AiStepperProps) {
  const theme = useTheme();
  const t = useT();
  const label = t('ai.intake.step', { step: progress.step, total: progress.total });

  return (
    <View
      testID={testID ?? 'ai-stepper'}
      accessible
      accessibilityLabel={label}
      style={{ rowGap: theme.space[2] }}
    >
      <Text variant="label" color="textSecondary">
        {label}
      </Text>
      <View {...decorative} style={[styles.track, { columnGap: theme.space[1] }]}>
        {Array.from({ length: progress.total }, (_, index) => (
          <View
            key={index}
            style={[
              styles.segment,
              {
                backgroundColor:
                  index < progress.step ? theme.colors.primary : theme.colors.surfaceSunken,
                borderRadius: theme.radius.pill,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { flex: 1, height: 4 },
  track: { flexDirection: 'row' },
});
