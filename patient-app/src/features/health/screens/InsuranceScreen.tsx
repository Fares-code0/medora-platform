import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { AsyncBoundary, Badge, Card, Icon, Screen, Section, Text } from '@/components';
import { useDateFormat, useT } from '@/i18n';
import { useTheme } from '@/theme';

import { NotLinkedNotice } from '../components/NotLinkedNotice';
import { useInsurance } from '../hooks';
import type { InsuranceOnFile } from '../model/types';
import { isPatientNotLinked } from '../not-linked';

/**
 * Insurance on file.
 *
 * Provider, plan, the LAST FOUR of the policy number, the end date and
 * whether the policy is active — exactly what `GET /me/insurance`
 * carries, and no more: the full number never reaches the device.
 *
 * ── Authorizations are an honest "not available yet" ─────────────────
 *
 * Whether a service is approved or rejected by the insurer needs an
 * authorization workflow nobody has decided (ADR-039 item 5), and the
 * server says so (`authorizations.available: false`). The notice below is
 * therefore always shown, unconditionally and in words: showing nothing
 * would read as "nothing is pending", and showing an empty list would
 * read as "nothing was rejected" — both claims nobody can make.
 */
function PolicyCard({ policy }: { policy: InsuranceOnFile }) {
  const theme = useTheme();
  const t = useT();
  const { formatLongDate } = useDateFormat();

  const number = t('health.insurance.policy', { last4: policy.policyNumberLast4 });
  const valid =
    policy.validUntil === null
      ? t('health.insurance.noEnd')
      : t('health.insurance.validUntil', { date: formatLongDate(policy.validUntil) });
  const state = t(policy.isActive ? 'health.insurance.active' : 'health.insurance.inactive');

  const label = [
    policy.providerName,
    ...(policy.plan === null ? [] : [policy.plan]),
    number,
    valid,
    state,
  ].join('. ');

  return (
    <Card testID="insurance-card">
      <View accessible accessibilityLabel={label} style={{ rowGap: theme.space[2] }}>
      <View style={[styles.row, { columnGap: theme.space[2] }]}>
        <Icon name="shield" size={20} color="primary" />
        <Text variant="h3" style={styles.grow}>
          {policy.providerName}
        </Text>
        <Badge
          label={state}
          tone={policy.isActive ? 'success' : 'neutral'}
          testID="insurance-state"
        />
      </View>
      {policy.plan === null ? null : (
        <Text variant="body" color="textSecondary">
          {policy.plan}
        </Text>
      )}
      <Text variant="body" testID="insurance-policy">
        {number}
      </Text>
      <Text variant="bodySm" color="textSecondary">
        {valid}
      </Text>
      </View>
    </Card>
  );
}

export function InsuranceScreen() {
  const theme = useTheme();
  const t = useT();
  const insurance = useInsurance();

  if (insurance.isError && isPatientNotLinked(insurance.error)) {
    return (
      <Screen testID="insurance-screen">
        <Text variant="h1" {...headingA11y(t('health.insurance.title'))}>
          {t('health.insurance.title')}
        </Text>
        <NotLinkedNotice />
      </Screen>
    );
  }

  return (
    <Screen
      testID="insurance-screen"
      onRefresh={() => void insurance.refetch()}
      refreshing={insurance.isRefetching}
    >
      <Text variant="h1" {...headingA11y(t('health.insurance.title'))}>
        {t('health.insurance.title')}
      </Text>

      <Section title={t('health.insurance.section')}>
        <AsyncBoundary
          testID="insurance-on-file"
          query={insurance}
          keepDataOnRefreshError
          isEmpty={(data) => data.insurance === null}
          empty={{
            icon: 'shield',
            title: t('health.insurance.empty.title'),
            body: t('health.insurance.empty.body'),
          }}
        >
          {(data) => (data.insurance === null ? null : <PolicyCard policy={data.insurance} />)}
        </AsyncBoundary>
      </Section>

      <Card tone="sunken" testID="insurance-authorizations">
        <View style={[styles.row, { columnGap: theme.space[2] }]}>
          <Icon name="clock" size={18} color="textTertiary" />
          <Text variant="bodyStrong" style={styles.grow}>
            {t('health.insurance.auth.title')}
          </Text>
        </View>
        <Text variant="bodySm" color="textSecondary">
          {t('health.insurance.auth.body')}
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
