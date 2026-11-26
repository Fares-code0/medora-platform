import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Card, Divider, Icon, ListItem, Screen, Section, Text } from '@/components';
import { useT } from '@/i18n';
import type { ProfileStackParamList, RootStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

type Props = NativeStackScreenProps<ProfileStackParamList, 'HealthRecords'>;

/**
 * Health information — the patient-facing layer, and a plain statement
 * of what is not in it.
 *
 * ── This screen used to be the medical record ────────────────────────
 *
 * It listed allergies, conditions, medicines and history. Owner decision
 * (2026-11-26): a patient never sees the full medical record, physician
 * notes, internal documentation or unrestricted history. So it is now a
 * hub with three destinations that are real — Tests (status), Insurance
 * on file, Appointments — and one card that says, in words, that the
 * record itself is not shown in the app and is available from the care
 * team. There is no list behind that card: a "records" row that opened
 * an empty list would suggest the record is empty, and an unavailable
 * row would suggest it is coming.
 *
 * Appointments are linked to rather than repeated: they already have a
 * tab, and a second copy of the list is a second place for a status to
 * be stale.
 */
export function HealthRecordsScreen({ navigation }: Props) {
  const theme = useTheme();
  const t = useT();
  const rootNavigation = useNavigation<NavigationProp<RootStackParamList>>();

  return (
    <Screen testID="health-records-screen">
      <Text variant="h1" {...headingA11y(t('health.hub.title'))}>
        {t('health.hub.title')}
      </Text>
      <Text variant="bodySm" color="textSecondary">
        {t('health.hub.subtitle')}
      </Text>

      <Section title={t('health.hub.section')}>
        <Card padded={false}>
          <View style={{ paddingHorizontal: theme.space[4] }}>
            <ListItem
              title={t('health.tests.title')}
              subtitle={t('health.hub.tests.subtitle')}
              icon="lab"
              testID="health-to-tests"
              onPress={() => navigation.navigate('Tests')}
            />
            <Divider />
            <ListItem
              title={t('health.insurance.title')}
              subtitle={t('health.hub.insurance.subtitle')}
              icon="shield"
              testID="health-to-insurance"
              onPress={() => navigation.navigate('Insurance')}
            />
            <Divider />
            <ListItem
              title={t('health.hub.appointments')}
              subtitle={t('health.hub.appointments.subtitle')}
              icon="calendar"
              testID="health-to-appointments"
              onPress={() =>
                rootNavigation.navigate('Tabs', {
                  screen: 'AppointmentsTab',
                  params: { screen: 'AppointmentsRoot' },
                })
              }
            />
          </View>
        </Card>
      </Section>

      <Card tone="sunken" testID="health-care-team-notice">
        <View style={[styles.row, { columnGap: theme.space[2] }]}>
          <Icon name="lock" size={18} color="textTertiary" />
          <Text variant="bodyStrong" style={styles.grow}>
            {t('health.hub.careTeam.title')}
          </Text>
        </View>
        <Text variant="bodySm" color="textSecondary">
          {t('health.hub.careTeam.body')}
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
