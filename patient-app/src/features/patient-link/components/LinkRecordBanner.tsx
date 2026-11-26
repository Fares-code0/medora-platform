import { StyleSheet, View } from 'react-native';

import { Button, Card, Icon, Text } from '@/components';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import { useIsLinked } from '../hooks';

/**
 * "Link your hospital record" — non-blocking.
 *
 * Shown only when the server has said the account is NOT linked; while the
 * state is unknown (loading, or the read failed) it renders nothing, so an
 * unknown is never reported as "not linked". Nothing is disabled around
 * it: discovery, Emergency and the general assistant work unlinked.
 *
 * `onLink` rather than a navigation call inside: Home and Profile reach
 * the link screen through different navigators.
 */
export function LinkRecordBanner({ onLink }: { readonly onLink: () => void }) {
  const t = useT();
  const theme = useTheme();
  const linked = useIsLinked();
  if (linked !== false) return null;

  return (
    <Card tone="info" testID="link-record-banner">
      <View style={[styles.row, { columnGap: theme.space[3] }]}>
        <Icon name="info" size={24} color="primary" />
        <View style={[styles.grow, { rowGap: theme.space[2] }]}>
          <Text variant="h3" accessibilityRole="header">
            {t('link.banner.title')}
          </Text>
          <Text variant="bodySm" color="textSecondary">
            {t('link.banner.body')}
          </Text>
          <Button
            label={t('link.banner.action')}
            hint={t('link.banner.hint')}
            tone="secondary"
            testID="link-record-banner-action"
            onPress={onLink}
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'flex-start', flexDirection: 'row' },
});
