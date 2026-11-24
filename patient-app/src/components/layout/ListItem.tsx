import { Pressable, StyleSheet, View } from 'react-native';

import { pressableA11y } from '@/accessibility/a11y';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';
import type { ColorToken } from '@/theme/tokens';

import { Icon, type IconName } from '../Icon';
import { Text } from '../Text';

/**
 * A row.
 *
 * The whole row is the touch target, not the chevron — a 44dp hit area at
 * the right edge of a 375pt screen is a target most thumbs miss.
 *
 * `value` is rendered as secondary text on the right; `readOnly` marks a
 * row a patient cannot change. That distinction is load-bearing on the
 * profile screen: AD-2 has not decided which fields a patient owns, so
 * every clinical field renders visibly read-only with a note on who to
 * contact, rather than as an editable field that fails on submit
 * (checklist P-02).
 */
export interface ListItemProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly value?: string;
  readonly icon?: IconName;
  readonly iconColor?: ColorToken;
  readonly onPress?: () => void;
  readonly accessibilityHint?: string;
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly testID?: string;
}

export function ListItem({
  title,
  subtitle,
  value,
  icon,
  iconColor = 'textSecondary',
  onPress,
  accessibilityHint,
  readOnly = false,
  destructive = false,
  testID,
}: ListItemProps) {
  const theme = useTheme();
  const t = useT();

  const body = (
    <View style={[styles.row, { columnGap: theme.space[3], minHeight: theme.minTouchTarget }]}>
      {icon === undefined ? null : (
        <Icon name={icon} size={20} color={destructive ? 'error' : iconColor} />
      )}

      <View style={styles.grow}>
        <Text variant="body" color={destructive ? 'error' : 'textPrimary'}>
          {title}
        </Text>
        {subtitle === undefined ? null : (
          <Text variant="caption" color="textTertiary">
            {subtitle}
          </Text>
        )}
      </View>

      {value === undefined ? null : (
        <Text variant="bodySm" color={readOnly ? 'textDisabled' : 'textSecondary'}>
          {value}
        </Text>
      )}

      {onPress === undefined ? null : <Icon name="forward" size={18} color="textTertiary" />}
    </View>
  );

  if (onPress === undefined) {
    return (
      <View
        testID={testID}
        accessible
        accessibilityRole="text"
        accessibilityLabel={(() => {
          // The separator is the locale's comma: "," in English, "،" in Arabic.
          const spoken = value === undefined ? title : t('a11y.listSeparator', { title, value });
          return readOnly ? t('a11y.readOnly', { value: spoken }) : spoken;
        })()}
        style={[styles.container, { paddingVertical: theme.space[2] }]}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      {...pressableA11y({
        label: `${title}${value === undefined ? '' : `, ${value}`}`,
        ...(accessibilityHint === undefined ? {} : { hint: accessibilityHint }),
      })}
      style={({ pressed }) => [
        styles.container,
        {
          paddingVertical: theme.space[2],
          paddingHorizontal: theme.space[2],
          marginHorizontal: -theme.space[2],
          borderRadius: theme.radius.control,
          backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent',
        },
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { justifyContent: 'center' },
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
