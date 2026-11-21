import { StyleSheet, View } from 'react-native';

import { Chip, Text } from '@/components';
import { useT, type MessageKey } from '@/i18n';
import { useTheme } from '@/theme';

import { SYMPTOM_GROUPS, SYMPTOM_OPTIONS } from '../content/intake';

/**
 * The symptom selection grid — the first step of the intake.
 *
 * ── It is a multi-select form control ───────────────────────────────
 *
 * Chips rather than a list of checkboxes because the options are short,
 * the set is scanned rather than read, and a wrapping row fits far more
 * of them above the fold on a 375pt screen. `Chip` already carries the
 * selected state in its `accessibilityState`, so a screen-reader user
 * hears "selected" rather than inferring it from a fill colour.
 *
 * Selection is local state owned by the screen. This component reads a
 * `Set` and reports toggles; it stores nothing, sends nothing and
 * concludes nothing. `content/intake.ts` says at length why the absence
 * of any client-side classification is the design and not a gap.
 */
export interface SymptomPickerProps {
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly testID?: string;
}

const GROUP_TITLE: Record<(typeof SYMPTOM_GROUPS)[number], MessageKey> = {
  general: 'ai.symptomGroup.general',
  head: 'ai.symptomGroup.head',
  chest: 'ai.symptomGroup.chest',
  abdomen: 'ai.symptomGroup.abdomen',
  skin: 'ai.symptomGroup.skin',
  mood: 'ai.symptomGroup.mood',
};

export function SymptomPicker({ selected, onToggle, testID }: SymptomPickerProps) {
  const theme = useTheme();
  const t = useT();

  return (
    <View testID={testID ?? 'ai-symptom-picker'} style={{ rowGap: theme.space[4] }}>
      {SYMPTOM_GROUPS.map((group) => {
        const options = SYMPTOM_OPTIONS.filter((option) => option.group === group);
        if (options.length === 0) return null;
        return (
          <View key={group} style={{ rowGap: theme.space[2] }}>
            <Text variant="label" color="textSecondary">
              {t(GROUP_TITLE[group])}
            </Text>
            <View style={[styles.grid, { columnGap: theme.space[2], rowGap: theme.space[2] }]}>
              {options.map((option) => (
                <Chip
                  key={option.id}
                  testID={`ai-symptom-${option.id}`}
                  label={t(option.labelKey as MessageKey)}
                  selected={selected.has(option.id)}
                  onPress={() => onToggle(option.id)}
                />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
});
