import { StyleSheet, View } from 'react-native';

import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import { Button } from '../Button';
import { Icon, type IconName } from '../Icon';
import { Text } from '../Text';

/**
 * The empty state.
 *
 * Every empty state offers something to do (checklist R-02). "No
 * appointments" is a dead end; "No appointments — Book one" is a screen.
 * `action` is optional only because a few empties genuinely have no next
 * step (an empty search result, where the next step is editing the query
 * that is already on screen).
 *
 * The icon is decorative. The title and body carry the meaning, which is
 * what a screen reader announces.
 *
 * `title` is optional and falls back to the translated generic (C-09).
 * A caller that knows what is empty should always say so — "No
 * appointments" beats "Nothing here yet" — but a caller that does not is
 * better served by a sentence in the patient's language than by an
 * English one hard-coded at the call site.
 */
export interface EmptyStateProps {
  readonly icon?: IconName;
  readonly title?: string;
  readonly body?: string;
  readonly action?: { readonly label: string; readonly onPress: () => void };
  readonly testID?: string;
}

export function EmptyState({ icon = 'inbox', title, body, action, testID }: EmptyStateProps) {
  const theme = useTheme();
  const t = useT();
  // The generic body is shown only alongside the generic title. Pairing
  // a caller's own title with "When there is something to show…" reads
  // as two unrelated sentences.
  const heading = title ?? t('state.empty.title');
  const detail = body ?? (title === undefined ? t('state.empty.body') : undefined);

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={detail === undefined ? heading : `${heading}. ${detail}`}
      style={[styles.container, { paddingVertical: theme.space[10], rowGap: theme.space[3] }]}
    >
      <Icon name={icon} size={40} color="textDisabled" />
      <Text variant="h3" align="center">
        {heading}
      </Text>
      {detail === undefined ? null : (
        <Text variant="bodySm" color="textTertiary" align="center">
          {detail}
        </Text>
      )}
      {action === undefined ? null : (
        <Button label={action.label} tone="secondary" onPress={action.onPress} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
});
