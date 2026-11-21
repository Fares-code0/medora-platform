import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { AsyncBoundary, Card, Screen, Text } from '@/components';
import { useDateFormat, useT } from '@/i18n';
import type { ProfileStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { ReleaseNotice } from '../components/ReleaseNotice';
import { useVisit } from '../hooks';

type Props = NativeStackScreenProps<ProfileStackParamList, 'VisitDetail'>;

/**
 * One visit summary — checklist J-08.
 *
 * ── Three states, and none of them is a blank ────────────────────────
 *
 * 1. **Released, with a summary.** The projection is rendered as written
 *    and nothing is added to it. This screen offers no interpretation,
 *    for the reason `LabResultsScreen` states at length: deciding what a
 *    clinical sentence means is a clinical judgement.
 * 2. **Released, with no summary.** A visit happened and no summary was
 *    written for the patient. That is said plainly, because the
 *    alternative — an empty card under a date — reads as a bug.
 * 3. **Not released.** `ReleaseNotice` names the state and there is a
 *    route to ask about it (J-06's rule, applied to a different record).
 *    The body is not shown at all, not shown blurred, and not shown
 *    behind a control: a held record is held.
 *
 * A visit id that is not in the record renders as an answer rather than
 * as a spinner — `useVisit` selects `null` for a miss precisely so this
 * screen can say so.
 */
export function VisitDetailScreen({ route }: Props) {
  const theme = useTheme();
  const { formatLongDate } = useDateFormat();
  const t = useT();
  const visit = useVisit(route.params.visitId);

  /**
   * The heading is outside the boundary — `A11Y_AUDIT` F-7. The visit's
   * own title names the screen once there is one; until then, and if the
   * id is not in the record, the screen's own name does. A heading that
   * only exists on the success path is no heading at all in the state a
   * patient on a slow connection meets first.
   */
  const heading = visit.data == null ? t('nav.title.visit') : visit.data.title;

  return (
    <Screen testID="visit-detail-screen">
      <Text variant="h1" {...headingA11y(heading)}>
        {heading}
      </Text>

      <AsyncBoundary
        testID="visit-detail"
        query={visit}
        isEmpty={(data) => data === null}
        empty={{
          icon: 'alertCircle',
          title: t('health.visits.notFound.title'),
          body: t('health.visits.notFound.body'),
        }}
      >
        {(data) =>
          data === null ? null : (
            <View style={{ rowGap: theme.space[3] }}>
              <View>
                <Text variant="bodySm" color="textSecondary">
                  {t('health.visits.with', { doctor: data.doctorName })}
                </Text>
                <Text variant="caption" color="textTertiary">
                  {t('health.visits.on', { date: formatLongDate(data.visitedOn) })}
                </Text>
              </View>

              <ReleaseNotice state={data.release} testID="visit-detail-release" />

              {data.release !== 'released' ? null : (
                <Card testID="visit-detail-summary">
                  {data.summary === null ? (
                    <Text variant="bodySm" color="textSecondary">
                      {t('health.visits.noSummary')}
                    </Text>
                  ) : (
                    <Text variant="body">{data.summary}</Text>
                  )}
                </Card>
              )}

              <Card tone="sunken">
                <Text variant="bodySm" color="textSecondary">
                  {t('health.visits.notice')}
                </Text>
              </Card>
            </View>
          )
        }
      </AsyncBoundary>
    </Screen>
  );
}
