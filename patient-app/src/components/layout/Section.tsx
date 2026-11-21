import { Pressable, StyleSheet, View } from 'react-native';

import { headingA11y, pressableA11y } from '@/accessibility/a11y';
import { useTheme } from '@/theme';

import { Icon } from '../Icon';
import { Text } from '../Text';

/**
 * A titled block of a screen.
 *
 * The title is a real `header` for assistive technology, so the rotor can
 * jump between sections instead of walking every row — which is the
 * difference between a records screen a screen-reader user can navigate
 * and one they have to listen through (checklist S-02).
 */
export interface SectionProps {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly subtitle?: string;
  readonly action?: { readonly label: string; readonly onPress: () => void };
  readonly testID?: string;
}

export function Section({ title, subtitle, action, children, testID }: SectionProps) {
  const theme = useTheme();

  return (
    <View testID={testID} style={{ rowGap: theme.space[3] }}>
      <View style={styles.header}>
        <View style={styles.grow}>
          <Text variant="h3" {...headingA11y(title)}>
            {title}
          </Text>
          {subtitle === undefined ? null : (
            <Text variant="caption" color="textTertiary">
              {subtitle}
            </Text>
          )}
        </View>

        {action === undefined ? null : (
          <Pressable
            onPress={action.onPress}
            hitSlop={12}
            {...pressableA11y({ label: action.label })}
            style={[styles.action, { columnGap: theme.space[1] }]}
          >
            <Text variant="bodySm" color="primary">
              {action.label}
            </Text>
            <Icon name="forward" size={16} color="primary" />
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: 'center', flexDirection: 'row' },
  grow: { flex: 1 },
  header: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
});
