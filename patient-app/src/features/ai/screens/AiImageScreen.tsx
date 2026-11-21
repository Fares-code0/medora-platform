import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Card, Icon, Screen, Section, Text } from '@/components';
import { useT } from '@/i18n';
import type { HomeStackParamList, RootStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { useAiAvailability } from '../availability';
import { AiDisclaimer } from '../components/AiDisclaimer';
import { AiImagePicker } from '../components/AiImagePicker';
import { AiSafetyCard } from '../components/AiSafetyCard';
import { AiUnavailableNotice } from '../components/AiUnavailableNotice';

/**
 * Medical image assistance — Phase L's interface.
 *
 * ── Blocked three deep, and the screen says which ───────────────────
 *
 * Phase L is blocked at the *infrastructure* level, not the UI level,
 * and that is a different thing from Phase K being blocked on a
 * decision. Three separate things are missing and each blocks a
 * different step:
 *
 * 1. **Choosing** an image needs `expo-image-picker` — a native module,
 *    so a development build (`docs/ARCHITECTURE.md` §1). Not present.
 * 2. **Sending** one needs BE-15: object storage, a malware scanner and
 *    the files service (M25). `File.storage_key` is a column with
 *    nothing behind it. L-02 additionally requires honouring
 *    `403 scan_pending` and never rendering an unscanned file.
 * 3. **Reading** one needs a vision model and, before any build reaches
 *    a store, limitations copy signed off by a named clinical owner
 *    (L-04, AD-4).
 *
 * The picker is therefore mounted in its `empty` state with `canPick`
 * false, and the dependencies are listed on the screen rather than
 * hidden in a disabled button. Its other three states — preview,
 * processing, and handing over to the placeholder — are drawn and tested
 * in `ai-states.test.tsx`.
 *
 * ── The EXIF note is on the screen on purpose ───────────────────────
 *
 * L-01 requires location and EXIF to be stripped **before** upload. That
 * is not something this screen can do today and it is the kind of
 * requirement that gets lost between "picker added" and "upload added",
 * so it is written where the next contributor will be standing.
 */
type AiNavigation = NavigationProp<HomeStackParamList & RootStackParamList>;

export function AiImageScreen() {
  const theme = useTheme();
  const t = useT();
  const navigation = useNavigation<AiNavigation>();
  const availability = useAiAvailability();

  const title = t('ai.image.title');

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      {/* Outside the ScrollView, so it cannot be scrolled away (K-03). */}
      <View style={{ padding: theme.screenGutter, paddingBottom: 0 }}>
        <AiDisclaimer />
      </View>

      <Screen testID="ai-image-screen">
        <View style={{ rowGap: theme.space[1] }}>
          <Text variant="h1" {...headingA11y(title)}>
            {title}
          </Text>
          <Text variant="bodySm" color="textTertiary">
            {t('ai.image.subtitle')}
          </Text>
        </View>

        {availability.connected ? null : (
          <AiUnavailableNotice blockedBy={[...availability.blockedBy, 'BE-15']} />
        )}

        <Section title={t('ai.image.section')}>
          {/* `canPick` is false: no picker module, and nowhere to send
              the result if there were. See the header. */}
          <AiImagePicker state="empty" canPick={false} />
        </Section>

        <Card tone="warning" testID="ai-image-privacy">
          <View style={[styles.row, { columnGap: theme.space[2] }]}>
            <Icon name="shield" size={18} color="warning" />
            <Text variant="bodyStrong" color="warning" style={styles.grow}>
              {t('ai.image.privacy.title')}
            </Text>
          </View>
          <Text variant="bodySm" color="textSecondary">
            {t('ai.image.privacy.body')}
          </Text>
        </Card>

        <AiSafetyCard
          onEmergency={() => navigation.navigate('Emergency')}
          onFindCare={() =>
            navigation.navigate('Tabs', {
              screen: 'DiscoverTab',
              params: { screen: 'DiscoverRoot' },
            })
          }
        />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
