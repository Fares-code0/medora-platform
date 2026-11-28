import { Pressable, StyleSheet, View } from 'react-native';

import { pressableA11y } from '@/accessibility/a11y';
import { Icon, Text } from '@/components';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import { CANCEL_REASON_KEYS, CANCEL_REASONS } from '../cancel-reasons';
import type { CancelReasonCode } from '../model/types';

/**
 * The closed list of cancellation reasons, as a radio group.
 *
 * One reason is chosen and the server stores its code. Each row is a
 * `radio` with a selected state AND a filled mark, so selection does not
 * depend on colour, and each is at least the 44pt touch floor and wraps
 * rather than truncates at large text sizes.
 */
export function ReasonPicker({
  value,
  onChange,
  disabled = false,
  testIDPrefix = 'cancel-reason',
}: {
  value: CancelReasonCode | null;
  onChange: (code: CancelReasonCode) => void;
  disabled?: boolean;
  testIDPrefix?: string;
}) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('appointment.cancel.reasonLabel')}
      style={{ rowGap: theme.space[2] }}
    >
      {CANCEL_REASONS.map((code) => {
        const selected = value === code;
        const label = t(CANCEL_REASON_KEYS[code]);
        return (
          <Pressable
            key={code}
            testID={`${testIDPrefix}-${code}`}
            disabled={disabled}
            onPress={() => onChange(code)}
            {...pressableA11y({ label, role: 'radio', selected, disabled })}
            style={[
              styles.row,
              {
                minHeight: theme.minTouchTarget,
                columnGap: theme.space[3],
                paddingHorizontal: theme.space[3],
                paddingVertical: theme.space[2],
                borderRadius: theme.radius.control,
                borderWidth: 1,
                borderColor: selected ? theme.colors.primary : theme.colors.border,
                backgroundColor: selected ? theme.colors.surfaceSunken : theme.colors.surface,
              },
            ]}
          >
            <View
              style={[
                styles.mark,
                { borderColor: selected ? theme.colors.primary : theme.colors.borderStrong },
              ]}
            >
              {selected ? <Icon name="check" size={14} color="primary" /> : null}
            </View>
            <Text variant="body" style={styles.grow}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  mark: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    minWidth: 22,
  },
  row: { alignItems: 'center', flexDirection: 'row' },
});
