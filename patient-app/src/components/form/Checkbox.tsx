import { Pressable, StyleSheet, View } from 'react-native';

import { pressableA11y } from '@/accessibility/a11y';
import { useTheme } from '@/theme';

import { Icon } from '../Icon';
import { Text } from '../Text';

/**
 * A consent checkbox.
 *
 * The whole row is the target — a 20dp box on a consent line is a target
 * a thumb misses, and a consent a patient meant to give and did not is a
 * registration that fails at submit for no visible reason.
 *
 * The tick uses `textInverse`, which inverts with the theme: on the dark
 * palette the filled primary is light, so a fixed white tick would be
 * invisible inside it (see `tokens.ts`).
 */
export interface CheckboxProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly error?: string;
  readonly testID?: string;
}

export function Checkbox({ label, checked, onChange, error, testID }: CheckboxProps) {
  const theme = useTheme();

  return (
    <View style={{ rowGap: theme.space[1] }}>
      <Pressable
        testID={testID}
        onPress={() => onChange(!checked)}
        {...pressableA11y({ label, role: 'checkbox', selected: checked })}
        accessibilityState={{ checked }}
        style={[
          styles.row,
          { columnGap: theme.space[3], minHeight: theme.minTouchTarget, paddingVertical: 4 },
        ]}
      >
        <View
          style={[
            styles.box,
            {
              borderRadius: theme.radius.control,
              borderColor: error
                ? theme.colors.error
                : checked
                  ? theme.colors.primary
                  : theme.colors.borderStrong,
              backgroundColor: checked ? theme.colors.primary : theme.colors.surface,
            },
          ]}
        >
          {checked ? <Icon name="check" size={14} color="textInverse" /> : null}
        </View>
        <Text variant="bodySm" color="textSecondary" style={styles.grow}>
          {label}
        </Text>
      </Pressable>

      {error === undefined ? null : (
        <Text variant="caption" color="error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
