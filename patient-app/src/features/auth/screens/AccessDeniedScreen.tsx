import { useEffect } from 'react';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { View } from 'react-native';

import { announce, headingA11y } from '@/accessibility/a11y';
import { Button, Icon, Screen, Text } from '@/components';
import { useT } from '@/i18n';
import type { AccessDeniedStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { useSession } from '../SessionProvider';

type Props = NativeStackScreenProps<AccessDeniedStackParamList, 'AccessDenied'>;

/**
 * "This app is for patients only" (C-11).
 *
 * Rendered by the navigator when the session ended as `ineligible`: a
 * non-patient account signed in, restored, refreshed, or was refused by
 * the eligibility probe (`eligibility.ts`). By the time this screen is up
 * the session is already over — revoked server-side and swept locally —
 * so it shows nothing about the account: no name, no email, no role.
 *
 * - **Sign out** finishes the job from the patient's side: it is the same
 *   `logout()` every other screen calls, which (with no access token left)
 *   clears locally once more and lands on the sign-in form.
 * - **Emergency** is one tap away, as from every state of this app: the
 *   header button, and the button here, both open the Emergency route this
 *   screen's stack carries (`AccessDeniedStack`).
 *
 * The heading is announced on arrival: the screen replaces whatever the
 * person was looking at, and a screen reader would otherwise say nothing
 * about why.
 */
export function AccessDeniedScreen({ navigation }: Props) {
  const t = useT();
  const theme = useTheme();
  const { logout } = useSession();

  const title = t('eligibility.title');
  useEffect(() => {
    announce(title);
  }, [title]);

  return (
    <Screen edges={['bottom']} testID="access-denied-screen">
      <View
        style={{ alignItems: 'center', rowGap: theme.space[3], paddingVertical: theme.space[6] }}
      >
        <Icon name="lock" size={44} color="primary" />
        <Text variant="h1" align="center" {...headingA11y(title)}>
          {title}
        </Text>
        <Text variant="body" color="textSecondary" align="center">
          {t('eligibility.body')}
        </Text>
        <Text variant="bodySm" color="textSecondary" align="center">
          {t('eligibility.staffHint')}
        </Text>
        <Text variant="bodySm" color="textSecondary" align="center">
          {t('eligibility.signedOut')}
        </Text>
      </View>

      <Button
        label={t('eligibility.signOut')}
        hint={t('eligibility.signOut.hint')}
        size="lg"
        fullWidth
        testID="access-denied-sign-out"
        onPress={() => void logout()}
      />
      <Button
        label={t('emergency.help')}
        hint={t('emergency.entry.hint')}
        tone="secondary"
        icon="alert"
        fullWidth
        testID="access-denied-emergency"
        onPress={() => navigation.navigate('Emergency')}
      />
    </Screen>
  );
}
