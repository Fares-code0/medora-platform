import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Badge, Card, PagedList, Text } from '@/components';
import { useDateFormat, useT, type MessageKey } from '@/i18n';
import { useTheme } from '@/theme';

import { NotLinkedNotice } from '../components/NotLinkedNotice';
import { useLabTests } from '../hooks';
import type { LabTest, LabTestStatus } from '../model/types';
import { isPatientNotLinked } from '../not-linked';

/**
 * Tests — what was ordered for you, and where it has got to.
 *
 * ── Status, never a result ───────────────────────────────────────────
 *
 * Owner decision (2026-11-26): lab RESULTS are not shown. Whether and
 * when one is released to a patient is a clinical policy that is not
 * approved (ADR-031), and the route this reads carries no result, value,
 * flag or interpretation to render. A completed test says one thing —
 * the care team will share the result once it is released — and says it
 * the same way for every test, so the absence of a number never reads as
 * "your result was fine".
 *
 * The status labels are this app's own four words for the server's four
 * values (`awaiting_collection`, `in_progress`, `completed`,
 * `cancelled`); the lab's internal workflow states never reach here.
 * Status is conveyed by the badge text AND the spoken label, not by
 * colour.
 */
const STATUS_LABEL: Record<LabTestStatus, MessageKey> = {
  awaiting_collection: 'health.tests.status.awaiting_collection',
  in_progress: 'health.tests.status.in_progress',
  completed: 'health.tests.status.completed',
  cancelled: 'health.tests.status.cancelled',
};

const STATUS_TONE: Record<LabTestStatus, 'neutral' | 'info' | 'success'> = {
  awaiting_collection: 'neutral',
  in_progress: 'info',
  completed: 'success',
  cancelled: 'neutral',
};

function TestCard({ test }: { test: LabTest }) {
  const theme = useTheme();
  const t = useT();
  const { formatLongDate } = useDateFormat();
  const status = t(STATUS_LABEL[test.status]);

  const dates = [
    t('health.tests.requested', { date: formatLongDate(test.requestedAt) }),
    test.collectedAt === null
      ? null
      : t('health.tests.collected', { date: formatLongDate(test.collectedAt) }),
    test.completedAt === null
      ? null
      : t('health.tests.completedOn', { date: formatLongDate(test.completedAt) }),
  ].filter((line): line is string => line !== null);

  const label = [
    t('health.tests.a11y', { test: test.testName, status }),
    ...dates,
    ...(test.hospitalName === null ? [] : [test.hospitalName]),
    ...(test.status === 'completed' ? [t('health.tests.resultsNote')] : []),
  ].join('. ');

  return (
    <Card testID={`test-card-${test.id}`}>
      <View accessible accessibilityLabel={label} style={{ rowGap: theme.space[1] }}>
      <View style={[styles.row, { columnGap: theme.space[2] }]}>
        <Text variant="bodyStrong" style={styles.grow}>
          {test.testName}
        </Text>
        <Badge label={status} tone={STATUS_TONE[test.status]} testID={`test-status-${test.id}`} />
      </View>
      {dates.map((line) => (
        <Text key={line} variant="caption" color="textTertiary">
          {line}
        </Text>
      ))}
      {test.hospitalName === null ? null : (
        <Text variant="caption" color="textTertiary">
          {test.hospitalName}
        </Text>
      )}
      {test.status === 'completed' ? (
        <Text variant="bodySm" color="textSecondary" testID={`test-results-note-${test.id}`}>
          {t('health.tests.resultsNote')}
        </Text>
      ) : null}
      </View>
    </Card>
  );
}

export function TestsScreen() {
  const theme = useTheme();
  const t = useT();
  const tests = useLabTests();

  if (tests.isError && isPatientNotLinked(tests.error)) {
    return (
      <View
        testID="tests-screen"
        style={{ padding: theme.screenGutter, rowGap: theme.space[4], flex: 1 }}
      >
        <Text variant="h1" {...headingA11y(t('health.tests.title'))}>
          {t('health.tests.title')}
        </Text>
        <NotLinkedNotice />
      </View>
    );
  }

  return (
    <PagedList
      testID="tests-screen"
      statesTestID="tests-list"
      query={tests}
      onRefresh={() => void tests.refetch()}
      renderItem={(test) => <TestCard test={test} />}
      header={
        <View style={{ rowGap: theme.space[3] }}>
          <Text variant="h1" {...headingA11y(t('health.tests.title'))}>
            {t('health.tests.title')}
          </Text>
          <Card tone="sunken" testID="tests-notice">
            <Text variant="bodySm" color="textSecondary">
              {t('health.tests.notice')}
            </Text>
          </Card>
        </View>
      }
      empty={{
        icon: 'lab',
        title: t('health.tests.empty.title'),
        body: t('health.tests.empty.body'),
      }}
      paging={{
        loadMoreLabel: t('health.tests.loadMore'),
        loadMoreHint: t('health.tests.loadMore.hint'),
        endLabel: t('health.tests.end'),
        testIDPrefix: 'tests',
      }}
    />
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
