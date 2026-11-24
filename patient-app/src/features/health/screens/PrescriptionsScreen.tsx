import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { AsyncBoundary, Badge, Card, Screen, Text } from '@/components';
import { useT, useDateFormat } from '@/i18n';
import { useTheme } from '@/theme';
import type { PrescriptionStatus } from '@/types/vocabularies';

import { PRESCRIPTION_STATUS_KEY } from '../clinical-word';
import { ReleaseNotice } from '../components/ReleaseNotice';
import { usePrescriptions } from '../hooks';

/**
 * Prescriptions — **read-only, and permanently so**.
 *
 * Prescribing is a clinician capability (`prescriptions.create`). There
 * is no "request a refill" button here and there will not be one until a
 * backend route exists that a patient is authorised to call; a button
 * that composed a message asking for a refill would be a repeat
 * prescription request wearing a different name, with none of the
 * safety checks a real one has (OOS-2).
 */
const STATUS_TONE: Record<PrescriptionStatus, 'success' | 'warning' | 'neutral'> = {
  draft: 'neutral',
  'pending-approval': 'warning',
  active: 'success',
  dispensed: 'success',
  completed: 'neutral',
  discontinued: 'neutral',
  expired: 'warning',
};

export function PrescriptionsScreen() {
  const theme = useTheme();
  const { formatLongDate } = useDateFormat();
  const t = useT();
  const prescriptions = usePrescriptions();

  return (
    <Screen
      testID="prescriptions-screen"
      onRefresh={() => void prescriptions.refetch()}
      refreshing={prescriptions.isRefetching}
    >
      <Text variant="h1" {...headingA11y(t('health.prescriptions.title'))}>
        {t('health.prescriptions.title')}
      </Text>

      <Card tone="sunken">
        <Text variant="bodySm" color="textSecondary">
          {t('health.prescriptions.notice')}
        </Text>
      </Card>

      <AsyncBoundary
        testID="prescriptions-list"
        query={prescriptions}
        keepDataOnRefreshError
        isEmpty={(data) => data.length === 0}
        empty={{
          icon: 'pill',
          title: t('health.prescriptions.empty.title'),
          body: t('health.prescriptions.empty.body'),
        }}
      >
        {(data) => (
          <View style={{ rowGap: theme.space[3] }}>
            {data.map((prescription) => (
              <Card key={prescription.id} testID={`prescription-${prescription.id}`}>
                <ReleaseNotice state={prescription.release} />
                <View style={[styles.row, { columnGap: theme.space[2] }]}>
                  <Text variant="bodyStrong" style={styles.grow}>
                    {prescription.medicationName}
                  </Text>
                  <Badge
                    label={t(PRESCRIPTION_STATUS_KEY[prescription.status])}
                    tone={STATUS_TONE[prescription.status]}
                  />
                </View>
                <Text variant="bodySm" color="textSecondary">
                  {prescription.dosage} · {prescription.frequency}
                </Text>
                <Text variant="caption" color="textTertiary">
                  {t('health.prescriptions.issued', {
                    date: formatLongDate(prescription.issuedOn),
                  })}
                  {prescription.refillsRemaining === null
                    ? ''
                    : ` · ${t('health.prescriptions.refills', {
                        count: prescription.refillsRemaining,
                      })}`}
                </Text>
              </Card>
            ))}
          </View>
        )}
      </AsyncBoundary>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
