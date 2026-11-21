import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Card, Icon, Screen, Section, Text } from '@/components';
import type { IconName } from '@/components/Icon';
import { useT, type MessageKey } from '@/i18n';
import type { HomeStackParamList, RootStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { useAiAvailability } from '../availability';
import { AiCapabilityCard } from '../components/AiCapabilityCard';
import { AiDisclaimer } from '../components/AiDisclaimer';
import { AiSafetyCard } from '../components/AiSafetyCard';
import { AiUnavailableNotice } from '../components/AiUnavailableNotice';

/**
 * Medora Assistant — the front door.
 *
 * ── What this screen is for ─────────────────────────────────────────
 *
 * It answers three questions in order, which is the order a patient asks
 * them in: *what is this*, *can I use it*, and *what should I do
 * instead*. The capability cards come after the answer to the second
 * one, never before it.
 *
 * ── The layout rule this screen establishes for the phase ───────────
 *
 * `AiDisclaimer` sits **outside** `Screen`, above the scroll view, on
 * this screen and on all three below it. That is K-03 — "visible in
 * every AI surface at all times, not a one-time modal" — and putting it
 * inside the scroll would satisfy the letter of it and none of the
 * point. It mirrors `EmergencyScreen`'s treatment of N-02 exactly.
 *
 * ── Why the capabilities are listed at all ──────────────────────────
 *
 * Because the four of them are K-01's contexts, and a patient deciding
 * whether to wait for this feature deserves to know what it will and
 * will not be. Each card carries a "not connected yet" badge on its face
 * and opens a screen that says so again in full: nothing here is a
 * promise that something works.
 *
 * The clinician modes (`record`, `labs`, `pharmacy`) are deliberately
 * absent, which is the substance of K-01. `availability.test.ts` asserts
 * the absence rather than trusting this comment.
 */
type AiNavigation = NavigationProp<HomeStackParamList & RootStackParamList>;

interface Capability {
  readonly id: string;
  readonly icon: IconName;
  readonly titleKey: MessageKey;
  readonly bodyKey: MessageKey;
  readonly route: 'AiChat' | 'AiSymptoms' | 'AiImage';
}

const CAPABILITIES: readonly Capability[] = [
  {
    id: 'chat',
    icon: 'message',
    titleKey: 'ai.capability.chat.title',
    bodyKey: 'ai.capability.chat.body',
    route: 'AiChat',
  },
  {
    id: 'symptoms',
    icon: 'list',
    titleKey: 'ai.capability.symptoms.title',
    bodyKey: 'ai.capability.symptoms.body',
    route: 'AiSymptoms',
  },
  {
    id: 'image',
    icon: 'camera',
    titleKey: 'ai.capability.image.title',
    bodyKey: 'ai.capability.image.body',
    route: 'AiImage',
  },
];

export function AiHomeScreen() {
  const theme = useTheme();
  const t = useT();
  const navigation = useNavigation<AiNavigation>();
  const availability = useAiAvailability();

  const title = t('ai.home.title');

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      {/* Outside the ScrollView, so it cannot be scrolled away (K-03). */}
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

        {availability.connected ? null : (
          <AiUnavailableNotice blockedBy={availability.blockedBy} />
        )}

        <Section title={t('ai.home.capabilities')} subtitle={t('ai.home.capabilitiesSubtitle')}>
          <View style={{ rowGap: theme.space[3] }}>
            {CAPABILITIES.map((capability) => (
              <AiCapabilityCard
                key={capability.id}
                testID={`ai-capability-${capability.id}`}
                icon={capability.icon}
                title={t(capability.titleKey)}
                body={t(capability.bodyKey)}
                unavailable={!availability.connected}
                onPress={() => navigation.navigate(capability.route)}
              />
            ))}
          </View>
        </Section>

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

        {/*
          The four contexts, named. It is the clearest statement this
          screen can make about what the assistant is scoped to do —
          and, by omission, about what it will not be asked to do.
        */}
        <Card tone="sunken">
          <Text variant="label" color="textSecondary">
            {t('ai.home.scope.title')}
          </Text>
          <Text variant="bodySm" color="textTertiary">
            {t('ai.home.scope.body')}
          </Text>
          <Text variant="bodySm" color="textTertiary">
            {t('ai.home.scope.excluded')}
          </Text>
        </Card>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
