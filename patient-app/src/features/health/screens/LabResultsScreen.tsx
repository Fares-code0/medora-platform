import { useEffect, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { isStaleDataSafeError } from '@/api/errors';
import { AsyncBoundary, Badge, Button, Card, Divider, Screen, Section, Text } from '@/components';
import { useLocale, useT, type MessageKey, useDateFormat } from '@/i18n';
import { arabicResultCount } from '@/i18n/duration';
import { useTheme } from '@/theme';
import type { LabResultFlag, LabStatus } from '@/types/vocabularies';

import { LAB_FLAG_KEY } from '../clinical-word';
import { ReleaseNotice } from '../components/ReleaseNotice';
import { labKeys, useLabOrder, useLabOrders } from '../hooks';

/**
 * Lab results.
 *
 * ── What this screen refuses to do ───────────────────────────────────
 * It renders the value, the unit, the lab's reference range and the
 * **lab's own flag**. It does not compare the value to the range, does
 * not colour a number the lab called normal, and does not offer a single
 * word of interpretation. Deciding that a haemoglobin of 13.8 is
 * reassuring is a clinical judgement, and a phone app making one is
 * practising medicine (§19 of the brief).
 *
 * ── The AD-5 branch ──────────────────────────────────────────────────
 * An order whose `release` is not `released` shows `ReleaseNotice` and no
 * values. That is the honest state while the results-release policy is
 * undecided: the patient knows the test happened, knows it is being
 * reviewed, and knows how to ask. Blanking the order would be worse, and
 * showing an unreviewed critical result would be the thing AD-5 exists to
 * prevent.
 *
 * ── Expanding is a disclosure, so it has to close again ──────────────
 *
 * An order expands to show its results. For a while that was a one-way
 * door: the expanded set only ever grew — `[...current, order.id]`, with
 * no removal path and no control on the expanded card — so a patient who
 * tapped a panel to check one number was left scrolling past it for the
 * rest of the session, and a patient with eight panels could end up with
 * every one of them open.
 *
 * The way back is an explicit **button** rather than a second tap on the
 * card. An expanded card is tall and full of numbers a patient is reading
 * one at a time; making the whole of it a collapse target means a
 * mis-scroll closes the thing they were reading. The button says what it
 * does and is the only part of the card that does it.
 */

const FLAG_TONE: Record<LabResultFlag, 'neutral' | 'warning' | 'error'> = {
  normal: 'neutral',
  low: 'warning',
  high: 'warning',
  'critical-low': 'error',
  'critical-high': 'error',
  abnormal: 'warning',
};

/**
 * Where the order is in the laboratory's workflow — which side of that
 * line this falls on is worth stating rather than leaving to be guessed.
 * "At the laboratory" is not a clinical judgement about a patient; it is
 * the same class of fact as an appointment's status, which has been
 * translated since C-09. So it reads the catalogue, and held English
 * sentences until 2026-09-12 only because this file was missed.
 */
const STATUS_LABEL: Record<LabStatus, MessageKey> = {
  ordered: 'health.labs.status.ordered',
  collected: 'health.labs.status.collected',
  processing: 'health.labs.status.processing',
  completed: 'health.labs.status.completed',
  cancelled: 'health.labs.status.cancelled',
};

function LabOrderCard({
  orderId,
  onCollapse,
  listFailed,
}: {
  orderId: string;
  onCollapse: () => void;
  /** The list's own refresh failed; it is already telling the patient. */
  listFailed: boolean;
}) {
  const theme = useTheme();
  const { formatLongDate } = useDateFormat();
  const t = useT();
  const order = useLabOrder(orderId);
  // A pull-to-refresh refetches the list and every expanded card together,
  // so one outage fails all of them. The list's boundary says so once; a
  // card whose refresh failed with the list keeps its data silently rather
  // than adding a toast apiece.
  //
  // `covered` remembers WHICH failure the list's toast spoke for. When the
  // list recovers first, the card is still holding that same error object,
  // and without this it would leave silence and announce a stale failure
  // late. A new failure is a new error object, so it is still reported.
  const staleSafe = order.isError && order.data !== undefined && isStaleDataSafeError(order.error);
  const [covered, setCovered] = useState<unknown>(null);
  const coveredByList = staleSafe && listFailed;
  useEffect(() => {
    if (coveredByList) setCovered(order.error);
  }, [coveredByList, order.error]);
  const silent = staleSafe && (listFailed || order.error === covered);
  const boundaryQuery = silent ? { ...order, isError: false } : order;

  return (
    <AsyncBoundary query={boundaryQuery} testID={`lab-order-${orderId}`} keepDataOnRefreshError>
      {(data) => (
        <Card testID={`lab-order-card-${orderId}`}>
          <View style={[styles.row, { columnGap: theme.space[2] }]}>
            <Text variant="bodyStrong" style={styles.grow}>
              {data.panelName}
            </Text>
            <Badge label={t(STATUS_LABEL[data.status])} />
          </View>
          <Text variant="caption" color="textTertiary">
            {t('health.labs.ordered', { date: formatLongDate(data.orderedOn) })}
          </Text>

          <ReleaseNotice state={data.release} testID={`lab-release-${orderId}`} />

          {data.release !== 'released' || data.results.length === 0 ? null : (
            <View style={{ rowGap: theme.space[2], marginTop: theme.space[2] }}>
              {data.results.map((result, index) => (
                <View key={result.id}>
                  {index === 0 ? null : <Divider />}
                  <View
                    accessible
                    accessibilityLabel={t('health.labs.result.a11y', {
                      analyte: result.analyteName,
                      value:
                        result.value === null
                          ? t('health.labs.result.noValue')
                          : `${result.value}${result.unit === null ? '' : ` ${result.unit}`}`,
                      flag:
                        result.flag === null
                          ? t('health.labs.result.unflagged')
                          : t(LAB_FLAG_KEY[result.flag]),
                    })}
                    style={{ paddingVertical: theme.space[2], rowGap: theme.space[1] }}
                  >
                    <View style={[styles.row, { columnGap: theme.space[2] }]}>
                      <Text variant="body" style={styles.grow}>
                        {result.analyteName}
                      </Text>
                      <Text variant="bodyStrong">
                        {result.value ?? '—'}
                        {result.unit === null ? '' : ` ${result.unit}`}
                      </Text>
                    </View>
                    <View style={[styles.row, { columnGap: theme.space[2] }]}>
                      {result.referenceRange === null ? null : (
                        <Text variant="caption" color="textTertiary" style={styles.grow}>
                          {t('health.labs.range', { range: result.referenceRange })}
                        </Text>
                      )}
                      {result.flag === null ? null : (
                        <Badge label={t(LAB_FLAG_KEY[result.flag])} tone={FLAG_TONE[result.flag]} />
                      )}
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}

          <Button
            label={t('health.labs.hide')}
            tone="secondary"
            size="sm"
            testID={`lab-collapse-${orderId}`}
            onPress={onCollapse}
            hint={t('health.labs.hide.hint', { panel: data.panelName })}
          />
        </Card>
      )}
    </AsyncBoundary>
  );
}

export function LabResultsScreen() {
  const theme = useTheme();
  const { formatLongDate } = useDateFormat();
  const t = useT();
  const { locale } = useLocale();
  const orders = useLabOrders();
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const queryClient = useQueryClient();

  // The list and only the details already open: exact keys, no broad
  // invalidation, nothing for collapsed cards. Without this a refreshed
  // list (say, an order now released) sat above stale expanded details.
  const refresh = () => {
    void orders.refetch();
    for (const id of expanded) {
      void queryClient.refetchQueries({ queryKey: labKeys.detail(id), exact: true });
    }
  };

  const toggle = (orderId: string) =>
    setExpanded((current) =>
      current.includes(orderId) ? current.filter((id) => id !== orderId) : [...current, orderId],
    );

  return (
    <Screen testID="lab-results-screen" onRefresh={refresh} refreshing={orders.isRefetching}>
      <Text variant="h1" {...headingA11y(t('health.labs.title'))}>
        {t('health.labs.title')}
      </Text>

      <Card tone="sunken">
        <Text variant="bodySm" color="textSecondary">
          {t('health.labs.notice')}
        </Text>
      </Card>

      <Section title={t('health.labs.section')}>
        <AsyncBoundary
          testID="lab-orders"
          query={orders}
          keepDataOnRefreshError
          isEmpty={(data) => data.length === 0}
          empty={{
            icon: 'lab',
            title: t('health.labs.empty.title'),
            body: t('health.labs.empty.body'),
          }}
        >
          {(data) => (
            <View style={{ rowGap: theme.space[3] }}>
              {data.map((order) =>
                expanded.includes(order.id) ? (
                  <LabOrderCard
                    key={order.id}
                    orderId={order.id}
                    onCollapse={() => toggle(order.id)}
                    listFailed={orders.isError}
                  />
                ) : (
                  <Card
                    key={order.id}
                    testID={`lab-summary-${order.id}`}
                    onPress={() => toggle(order.id)}
                    accessibilityLabel={t('health.labs.a11y', {
                      panel: order.panelName,
                      status: t(STATUS_LABEL[order.status]),
                    })}
                    accessibilityHint={t('health.labs.hint')}
                  >
                    <View style={[styles.row, { columnGap: theme.space[2] }]}>
                      <Text variant="bodyStrong" style={styles.grow}>
                        {order.panelName}
                      </Text>
                      <Badge label={t(STATUS_LABEL[order.status])} />
                    </View>
                    <Text variant="caption" color="textTertiary">
                      {t('health.labs.ordered', { date: formatLongDate(order.orderedOn) })}
                      {/*
                        `resultCount` was fetched and never shown, so a
                        collapsed panel gave no hint whether there was
                        anything behind it. Suppressed at zero: an order
                        that is still `processing` has no results yet, and
                        "0 results" reads as a failure rather than as a
                        stage.
                      */}
                      {order.resultCount === 0
                        ? ''
                        : ` · ${
                            locale === 'ar'
                              ? arabicResultCount(order.resultCount)
                              : t('health.labs.resultCount', { count: order.resultCount })
                          }`}
                    </Text>
                    <ReleaseNotice state={order.release} />
                  </Card>
                ),
              )}
            </View>
          )}
        </AsyncBoundary>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
