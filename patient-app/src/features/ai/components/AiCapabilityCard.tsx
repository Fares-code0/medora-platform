import { StyleSheet, View } from 'react-native';

import { Badge, Card, Icon, Text } from '@/components';
import type { IconName } from '@/components/Icon';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

/**
 * One capability on the assistant home — a route, and what it is for.
 *
 * ── Why it navigates even though the destination is inert ───────────
 *
 * Each of these opens a real, designed screen that states its own
 * unavailable condition. The alternative — a card that does nothing, or
 * no cards at all — was rejected because a patient tapping a visible
 * control and getting no response cannot tell a disabled feature from a
 * broken app, and "broken app" is the reading that loses trust in
 * everything else on the phone.
 *
 * So the card carries the answer **before** the tap: a `notConnected`
 * badge on its face. Nothing here implies the capability works, and the
 * screen behind it says so again in full.
 */
export interface AiCapabilityCardProps {
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
  readonly onPress: () => void;
  /** Draws the "not connected yet" marker. Default `true`. */
  readonly unavailable?: boolean;
  readonly testID?: string;
}

export function AiCapabilityCard({
  icon,
  title,
  body,
  onPress,
  unavailable = true,
  testID,
}: AiCapabilityCardProps) {
  const theme = useTheme();
  const t = useT();

  const marker = unavailable ? t('ai.badge.notConnected') : undefined;

  return (
    <Card
      testID={testID}
      onPress={onPress}
      accessibilityLabel={marker === undefined ? `${title}. ${body}` : `${title}. ${marker}. ${body}`}
      accessibilityHint={t('ai.capability.hint')}
    >
      <View style={[styles.row, { columnGap: theme.space[3] }]}>
        <Icon name={icon} size={24} color="primary" />
        <View style={[styles.grow, { rowGap: theme.space[1] }]}>
          <View style={[styles.row, { columnGap: theme.space[2] }]}>
            <Text variant="h3" style={styles.grow}>
              {title}
            </Text>
            {marker === undefined ? null : <Badge label={marker} tone="neutral" />}
          </View>
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
