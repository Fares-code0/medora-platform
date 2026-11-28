import { StyleSheet, View } from 'react-native';

import { Button, Card, Icon, Text } from '@/components';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

/**
 * The server's safety message, rendered so it cannot be mistaken for chat.
 *
 * When a patient's message trips the server's red-flag pre-check, the
 * server answers with a fixed escalation message WITHOUT calling the
 * model. This card draws that message in error tone, labels it as a
 * safety message from Medora rather than from the assistant, and puts
 * the Emergency screen one tap below it — the whole point of an
 * escalation is that the next step is not a hunt for a menu.
 *
 * The body is the SERVER's text, rendered as received. This client never
 * writes, edits or shortens an escalation: the wording of an emergency
 * message is clinical content with an owner (W-10), and it is the
 * server's.
 *
 * `accessibilityRole="alert"` and an assertive live region: it is
 * announced the moment it arrives, ahead of anything else on screen.
 */
export interface AiEscalationCardProps {
  readonly body: string;
  readonly onEmergency: () => void;
  readonly testID?: string;
}

export function AiEscalationCard({ body, onEmergency, testID }: AiEscalationCardProps) {
  const theme = useTheme();
  const t = useT();

  return (
    <Card tone="error" testID={testID ?? 'ai-escalation'}>
      <View
        accessible
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        accessibilityLabel={`${t('ai.chat.escalation.title')}. ${t('ai.chat.escalation.a11y', { body })}`}
        style={{ rowGap: theme.space[2] }}
      >
        <View style={[styles.row, { columnGap: theme.space[2] }]}>
          <Icon name="alert" size={22} color="error" />
          <Text variant="h3" color="error" style={styles.grow}>
            {t('ai.chat.escalation.title')}
          </Text>
        </View>
        <Text variant="body" testID="ai-escalation-body">
          {body}
        </Text>
        <Text variant="caption" color="textTertiary">
          {t('ai.chat.escalation.note')}
        </Text>
      </View>
      <Button
        testID="ai-escalation-emergency"
        label={t('ai.safety.emergency.action')}
        tone="emergency"
        icon="alert"
        fullWidth
        onPress={onEmergency}
        hint={t('ai.safety.emergency.hint')}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
