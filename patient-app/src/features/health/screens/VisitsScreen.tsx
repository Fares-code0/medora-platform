import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { AsyncBoundary, Card, Screen, Text } from '@/components';
import { useDateFormat, useT } from '@/i18n';
import type { ProfileStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { ReleaseNotice } from '../components/ReleaseNotice';
import { useVisits } from '../hooks';

type Props = NativeStackScreenProps<ProfileStackParamList, 'Visits'>;

/**
 * Visit summaries — checklist J-08.
 *
 * ── What a visit summary is, and what it is not ──────────────────────
 *
 * `medical_records` holds the clinician's note: the assessment, the
 * differential, the wording one professional writes for another. This
 * screen renders a **patient-appropriate projection** of it and the row
 * says so in as many words. The distinction is not cosmetic — a patient
 * reading "r/o malignancy" out of a note written to keep a possibility
 * open is the harm AD-5 exists to prevent, and it is why every row here
 * carries a `ReleaseState` and why a summary that has not been released
 * shows `ReleaseNotice` rather than a blank.
 *
 * ── Why the list is the whole query ──────────────────────────────────
 *
 * The detail screen reads its visit out of this same query rather than
 * fetching one (`useVisit`): the contract has `GET /me/health/visits`
 * and no by-id route, and §11 of the brief forbids inventing the one
 * that would make a detail fetch tidy.
 */
export function VisitsScreen({ navigation }: Props) {
  const theme = useTheme();
  const { formatLongDate } = useDateFormat();
  const t = useT();
  const visits = useVisits();

  return (
    <Screen
      testID="visits-screen"
      onRefresh={() => void visits.refetch()}
      refreshing={visits.isRefetching}
    >
      <Text variant="h1" {...headingA11y(t('health.visits.title'))}>
        {t('health.visits.title')}
      </Text>

      <Card tone="sunken">
        <Text variant="bodySm" color="textSecondary">
          {t('health.visits.notice')}
        </Text>
      </Card>

      <AsyncBoundary
        testID="visits-list"
        query={visits}
        keepDataOnRefreshError
        isEmpty={(data) => data.length === 0}
        empty={{
          icon: 'fileText',
          title: t('health.visits.empty.title'),
          body: t('health.visits.empty.body'),
        }}
      >
        {(data) => (
          <View style={{ rowGap: theme.space[3] }}>
            {data.map((visit) => (
              <Card
                key={visit.id}
                testID={`visit-${visit.id}`}
                onPress={() => navigation.navigate('VisitDetail', { visitId: visit.id })}
                accessibilityLabel={t('health.visits.a11y', {
                  title: visit.title,
                  date: formatLongDate(visit.visitedOn),
                })}
                accessibilityHint={t('health.visits.hint')}
              >
                <Text variant="bodyStrong">{visit.title}</Text>
                <Text variant="bodySm" color="textSecondary">
                  {t('health.visits.with', { doctor: visit.doctorName })}
                </Text>
                <Text variant="caption" color="textTertiary">
                  {t('health.visits.on', { date: formatLongDate(visit.visitedOn) })}
                </Text>
                <ReleaseNotice state={visit.release} testID={`visit-release-${visit.id}`} />
              </Card>
            ))}
          </View>
        )}
      </AsyncBoundary>
    </Screen>
  );
}
