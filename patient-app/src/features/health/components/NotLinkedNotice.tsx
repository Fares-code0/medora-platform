import { useNavigation } from '@react-navigation/native';
import { View } from 'react-native';

import { Button, Card, Icon, Text } from '@/components';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

/**
 * "Your account is not linked to a patient record yet."
 *
 * Shown wherever a route answered `409 patient_not_linked`. Linking
 * happens at the hospital desk after staff check the patient's identity
 * in person (ADR-048) — there is no self-service claim and no email
 * matching, so the copy says where to go rather than offering a form
 * that would not work.
 *
 * The button opens the `PatientLink` route, which lives in the Profile
 * stack and is built by the identity work. It is navigated to by name
 * through an untyped handle on purpose: this feature must not import the
 * identity feature's screen or its param list.
 */
type LooseNavigation = {
  navigate(name: string): void;
}

export function NotLinkedNotice({ testID }: { readonly testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const navigation = useNavigation<LooseNavigation>();

  return (
    <Card tone="info" testID={testID ?? 'not-linked-notice'}>
      <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: theme.space[2] }}>
        <Icon name="info" size={20} color="info" />
        <Text variant="h3" color="info" style={{ flex: 1 }}>
          {t('health.notLinked.title')}
        </Text>
      </View>
      <Text variant="bodySm" color="textSecondary">
        {t('health.notLinked.body')}
      </Text>
      <Button
        testID="not-linked-action"
        label={t('health.notLinked.action')}
        tone="secondary"
        icon="user"
        fullWidth
        onPress={() => navigation.navigate('PatientLink')}
      />
    </Card>
  );
}
