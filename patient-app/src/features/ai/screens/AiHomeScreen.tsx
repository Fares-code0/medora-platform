import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Icon, Screen, Section, Text } from '@/components';
import { useT } from '@/i18n';
import type { HomeStackParamList, RootStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { AiDisclaimer } from '../components/AiDisclaimer';
import { AiModeCard } from '../components/AiModeCard';
import { AiSafetyCard } from '../components/AiSafetyCard';

/**
 * Assistant — the front door, with two doors.
 *
 * ── Two assistants, never one with a switch ─────────────────────────
 *
 * "Health assistant" (general) is given nothing about the patient.
 * "My care assistant" (personal) is grounded in their appointments, test
 * status and insurance on file — never results, never the record. They
 * keep separate conversations, and which one a patient is in is decided
 * by the card they tap here and is fixed for the life of the
 * conversation. The disclaimer on THIS screen is the general one; each
 * assistant's own screens carry the text that is true for it.
 *
 * `AiDisclaimer` sits **outside** `Screen`, above the scroll view, so it
 * cannot be scrolled away (K-03).
 *
 * There is no availability check here: whether an assistant is switched
 * on is the server's to say (503), and it says so when a patient tries
 * to ask. Showing a "connected" state before that would be a guess.
 */
type AiNavigation = NavigationProp<HomeStackParamList & RootStackParamList>;

export function AiHomeScreen() {
  const theme = useTheme();
  const t = useT();
  const navigation = useNavigation<AiNavigation>();

  const title = t('ai.home.title');

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      <View style={{ padding: theme.screenGutter, paddingBottom: 0 }}>
        <AiDisclaimer />
      </View>

      <Screen testID="ai-home-screen">
        <View style={{ rowGap: theme.space[1] }}>
          <View style={[styles.row, { columnGap: theme.space[2] }]}>
            <Icon name="cpu" size={26} color="primary" />
            <Text variant="h1" style={styles.grow} {...headingA11y(title)}>
              {title}
            </Text>
          </View>
          <Text variant="bodySm" color="textTertiary">
            {t('ai.home.subtitle')}
          </Text>
        </View>

        <View style={{ rowGap: theme.space[3] }}>
          <AiModeCard
            testID="ai-mode-general"
            icon="message"
            title={t('ai.mode.general.title')}
            body={t('ai.mode.general.body')}
            onPress={() => navigation.navigate('AiConversations', { mode: 'general' })}
          />
          <AiModeCard
            testID="ai-mode-personal"
            icon="user"
            title={t('ai.mode.personal.title')}
            body={t('ai.mode.personal.body')}
            onPress={() => navigation.navigate('AiConversations', { mode: 'personal' })}
          />
          <Text variant="caption" color="textTertiary">
            {t('ai.mode.separate')}
          </Text>
        </View>

        <Section title={t('ai.home.safety')}>
          <AiSafetyCard
            onEmergency={() => navigation.navigate('Emergency')}
            onFindCare={() =>
              navigation.navigate('Tabs', {
                screen: 'DiscoverTab',
                params: { screen: 'DiscoverRoot' },
              })
            }
          />
        </Section>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
