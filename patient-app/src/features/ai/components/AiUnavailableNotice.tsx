import { StyleSheet, View } from 'react-native';

import { Badge, Card, Icon, Text } from '@/components';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

/**
 * "No assistant is connected to this copy of Medora."
 *
 * ── This is the shipped state of every assistant screen ─────────────
 *
 * Not an error, not a spinner, not a "coming soon" teaser with a
 * waitlist. It is the same shape as the emergency screen's unconfigured
 * card (N-04) and for the same reason: a deployment that has not been
 * given a capability should say so plainly, in the place the capability
 * would have been, rather than show a plausible-looking imitation of it.
 *
 * ── Why it names the reason ─────────────────────────────────────────
 *
 * "Not available yet" on its own reads as a bug or a network problem,
 * and a patient who thinks it is a network problem will retry it in a
 * worse moment. Saying that no assistant has been connected — and that
 * a person is the thing to use instead — is both true and the more
 * useful sentence. `blockedBy` is rendered as a caption for whoever is
 * reading the screen with the checklist open; it is a row id, not
 * something a patient needs to act on, so it sits last and quietest.
 */
export interface AiUnavailableNoticeProps {
  /** Row ids from `availability.ts`, rendered as provenance. */
  readonly blockedBy: readonly string[];
  readonly testID?: string;
}

export function AiUnavailableNotice({ blockedBy, testID }: AiUnavailableNoticeProps) {
  const theme = useTheme();
  const t = useT();

  return (
    <Card tone="info" testID={testID ?? 'ai-unavailable'}>
      <View style={[styles.row, { columnGap: theme.space[2] }]}>
        <Icon name="cpu" size={20} color="info" />
        <Text variant="h3" color="info" style={styles.grow}>
          {t('ai.unavailable.title')}
        </Text>
        <Badge label={t('ai.badge.notConnected')} tone="info" testID="ai-unavailable-badge" />
      </View>
      <Text variant="bodySm" color="textSecondary">
        {t('ai.unavailable.body')}
      </Text>
      <Text variant="bodySm" color="textSecondary">
        {t('ai.unavailable.instead')}
      </Text>
      {blockedBy.length === 0 ? null : (
        <Text variant="caption" color="textDisabled" testID="ai-unavailable-blockers">
          {t('ai.unavailable.blockedBy', { rows: blockedBy.join(', ') })}
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
