import { StyleSheet, View } from 'react-native';

import { Card, Icon, Text } from '@/components';
import type { IconName } from '@/components/Icon';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

/**
 * One of the two assistants' doors.
 *
 * Two of these sit on the assistant's front page and are never merged
 * into one "assistant" with a toggle: the two see different things (the
 * general assistant sees nothing about the patient; the personal one is
 * grounded in their appointments, test status and insurance), and a
 * patient has to pick which they are talking to BEFORE they type.
 */
export interface AiModeCardProps {
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
  readonly onPress: () => void;
  /** What opening it does; defaults to "opens your conversations". */
  readonly hint?: string;
  readonly testID?: string;
}

export function AiModeCard({ icon, title, body, onPress, hint, testID }: AiModeCardProps) {
  const theme = useTheme();
  const t = useT();

  return (
    <Card
      testID={testID}
      onPress={onPress}
      accessibilityLabel={t('ai.mode.a11y', { title, body })}
      accessibilityHint={hint ?? t('ai.mode.hint')}
    >
      <View style={[styles.row, { columnGap: theme.space[3] }]}>
        <Icon name={icon} size={24} color="primary" />
        <View style={[styles.grow, { rowGap: theme.space[1] }]}>
          <Text variant="h3">{title}</Text>
          <Text variant="bodySm" color="textSecondary">
            {body}
          </Text>
        </View>
        <Icon name="forward" size={20} color="textTertiary" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
