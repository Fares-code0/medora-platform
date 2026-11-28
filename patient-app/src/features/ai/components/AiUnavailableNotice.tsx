import { StyleSheet, View } from 'react-native';

import { Card, Icon, Text } from '@/components';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

/**
 * "The assistant is not available yet."
 *
 * Shown when the server answers `503 service_unavailable` — no model
 * provider is configured for this deployment. It is not an error, not a
 * spinner and not a "coming soon" teaser with a date: it says plainly
 * that the assistant is off, that the patient's phone and account are
 * fine, that retrying will not change it, and where to go instead.
 *
 * `accessibilityLiveRegion="polite"` so it is announced when it replaces
 * the composer, which is the moment a patient has just pressed Send.
 */
export function AiUnavailableNotice({ testID }: { readonly testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const title = t('ai.unavailable.title');
  const body = t('ai.unavailable.body');
  const instead = t('ai.unavailable.instead');

  return (
    <Card tone="info" testID={testID ?? 'ai-unavailable'}>
      <View
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${title}. ${body} ${instead}`}
        style={{ rowGap: theme.space[2] }}
      >
      <View style={[styles.row, { columnGap: theme.space[2] }]}>
        <Icon name="cpu" size={20} color="info" />
        <Text variant="h3" color="info" style={styles.grow}>
          {title}
        </Text>
      </View>
      <Text variant="bodySm" color="textSecondary">
        {body}
      </Text>
      <Text variant="bodySm" color="textSecondary">
        {instead}
      </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
