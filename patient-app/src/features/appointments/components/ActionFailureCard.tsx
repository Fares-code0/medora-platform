import { View } from 'react-native';

import { Button, Card, Text } from '@/components';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import type { ActionFailure } from '../errors';

/**
 * A failed appointment write, in words — with the one next step that
 * outcome has (`errors.ts`).
 *
 * The region is assertive so a screen reader says it without the patient
 * having to find it, and the server's `detail`, where there is one, is
 * shown as sent beneath our own sentence.
 */
export function ActionFailureCard({
  failure,
  onLinkAccount,
  testID = 'action-failure',
}: {
  failure: ActionFailure;
  /** Offered for `not_linked` only, and only when the screen can open it. */
  onLinkAccount?: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  const t = useT();
  return (
    <Card tone="error" testID={testID}>
      <View style={{ rowGap: theme.space[2] }}>
        <Text
          variant="bodySm"
          color="error"
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
        >
          {t(failure.messageKey)}
        </Text>
        {failure.detail === null ? null : (
          <Text variant="caption" color="textSecondary" testID={`${testID}-detail`}>
            {failure.detail}
          </Text>
        )}
        {failure.kind === 'not_linked' && onLinkAccount !== undefined ? (
          <Button
            label={t('appointment.error.linkAction')}
            tone="secondary"
            size="sm"
            testID={`${testID}-link`}
            onPress={onLinkAccount}
          />
        ) : null}
      </View>
    </Card>
  );
}
